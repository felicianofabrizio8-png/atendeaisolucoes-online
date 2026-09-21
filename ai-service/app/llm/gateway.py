"""Gateway LLM sobre LiteLLM.

Duas regras que o briefing pede e que vale explicitar no código:

1. **Retry só em chamada de LLM.** Gerar texto duas vezes custa token; enviar
   mensagem duas vezes custa cliente. Retry cego em ação externa é como o
   sistema manda dois orçamentos para a mesma pessoa. Por isso o retry vive
   aqui e não no executor de ações.

2. **Falha de modelo não derruba o turno.** `complete()` levanta
   `LLMUnavailableError`, e quem chama decide — no caso do Sales Agent, vira
   handoff, que é o comportamento seguro.
"""

from __future__ import annotations

import asyncio
import logging
import time
from dataclasses import dataclass, field
from typing import Any

from app.config import settings
from app.llm.routing import ModelClass, fallback_for, model_for

logger = logging.getLogger(__name__)


class LLMUnavailableError(Exception):
    """Todas as tentativas e o fallback falharam."""


@dataclass(slots=True)
class LLMUsage:
    model: str
    provider: str
    latency_ms: int
    tokens_in: int = 0
    tokens_out: int = 0
    attempts: int = 1
    fallback_used: bool = False


@dataclass(slots=True)
class LLMResult:
    text: str
    usage: LLMUsage
    raw: dict[str, Any] = field(default_factory=dict)


_RETRYABLE = ("timeout", "rate", "overload", "503", "502", "500", "connection")


def _is_retryable(err: Exception) -> bool:
    msg = str(err).lower()
    return any(token in msg for token in _RETRYABLE)


async def complete(
    messages: list[dict[str, str]],
    *,
    model_class: ModelClass = ModelClass.FAST,
    temperature: float = 0.3,
    max_tokens: int | None = None,
    response_format: dict[str, Any] | None = None,
) -> LLMResult:
    """Uma completion, com retry e fallback de provider."""
    import litellm

    primary = model_for(model_class)
    chain = [primary]
    if (fb := fallback_for(model_class)) is not None:
        chain.append(fb)

    started = time.perf_counter()
    attempts = 0
    last_error: Exception | None = None

    for position, model in enumerate(chain):
        for _ in range(settings.llm_max_retries + 1):
            attempts += 1
            try:
                # `acompletion` é tipada como união com CustomStreamWrapper
                # (streaming). Aqui nunca pedimos stream, então o cast é
                # honesto — mas fica explícito em vez de silencioso.
                response: Any = await litellm.acompletion(
                    model=model,
                    messages=messages,
                    temperature=temperature,
                    max_tokens=max_tokens,
                    timeout=settings.llm_timeout_seconds,
                    response_format=response_format,
                    stream=False,
                )
                usage = getattr(response, "usage", None)
                return LLMResult(
                    text=response.choices[0].message.content or "",
                    usage=LLMUsage(
                        model=model,
                        provider=model.split("/", 1)[0],
                        latency_ms=int((time.perf_counter() - started) * 1000),
                        tokens_in=getattr(usage, "prompt_tokens", 0) or 0,
                        tokens_out=getattr(usage, "completion_tokens", 0) or 0,
                        attempts=attempts,
                        fallback_used=position > 0,
                    ),
                )
            except Exception as err:
                last_error = err
                if not _is_retryable(err):
                    break  # erro determinístico: tentar de novo no mesmo modelo não adianta
                await asyncio.sleep(0.5 * attempts)

        logger.warning(
            "modelo falhou, avaliando fallback",
            extra={"model": model, "error": type(last_error).__name__},
        )

    raise LLMUnavailableError(f"todas as tentativas falharam: {last_error}") from last_error


async def embed(texts: list[str]) -> list[list[float]]:
    """Gera embeddings.

    Sem retry com backoff longo: a indexação é assíncrona e um lote que falhou
    é reprocessado pelo job, o que é mais barato que segurar o worker.
    """
    import litellm

    if not texts:
        return []

    model = model_for(ModelClass.EMBEDDING)
    response = await litellm.aembedding(model=model, input=texts)
    vectors = [item["embedding"] for item in response.data]

    for vector in vectors:
        if len(vector) != settings.embedding_dim:
            raise ValueError(
                f"EMBEDDING_DIM={settings.embedding_dim} não bate com o modelo "
                f"{model} (retornou {len(vector)}). A dimensão está no DDL da "
                "coluna vector(N) — corrigir exige migration e reindexação."
            )
    return vectors


__all__ = ["LLMResult", "LLMUnavailableError", "LLMUsage", "complete", "embed"]
