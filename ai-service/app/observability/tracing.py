"""Tracing com Langfuse.

Duas regras do briefing aplicadas aqui:

1. **Langfuse não substitui `ai_flow_events`.** Um é observabilidade de LLM,
   o outro é trilha operacional do produto — e o produto não pode depender de
   um SaaS externo para saber o que aconteceu com uma conversa. Os dois
   convivem, correlacionados por `trace_id`/`correlation_id`.

2. **Nada de segredo, o mínimo de PII.** O texto da mensagem do cliente não
   vai para o trace. O que sobe é estrutura: qual ferramenta, quanto demorou,
   qual decisão. `_scrub` é a última linha de defesa.

Degradação: se o Langfuse estiver desligado ou falhar, o turno continua. Perder
observabilidade é ruim; derrubar atendimento por causa dela é pior.
"""

from __future__ import annotations

import logging
import uuid
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from dataclasses import dataclass, field
from typing import Any

from app.config import settings

logger = logging.getLogger(__name__)

# Chaves que nunca sobem, mesmo se alguém as passar por engano.
_BLOCKED_KEYS = {
    "content",
    "message",
    "text",
    "phone",
    "email",
    "password",
    "token",
    "api_key",
    "authorization",
    "service_auth_token",
}


def _scrub(payload: dict[str, Any]) -> dict[str, Any]:
    out: dict[str, Any] = {}
    for key, value in payload.items():
        if key.lower() in _BLOCKED_KEYS:
            # Guarda o tamanho: útil para depurar truncamento sem expor o texto.
            out[f"{key}_len"] = len(str(value)) if value is not None else 0
            continue
        out[key] = value
    return out


@dataclass(slots=True)
class Trace:
    """Rastro de um turno. Funciona mesmo sem Langfuse configurado."""

    trace_id: str
    company_id: str
    conversation_id: str
    spans: list[dict[str, Any]] = field(default_factory=list)
    _client: Any = None

    def span(self, name: str, **data: Any) -> None:
        self.spans.append({"name": name, **_scrub(data)})

    def finish(self, **summary: Any) -> None:
        payload = _scrub(summary)
        logger.info(
            "turno concluído",
            extra={
                "trace_id": self.trace_id,
                "company_id": self.company_id,
                "conversation_id": self.conversation_id,
                "spans": len(self.spans),
                **payload,
            },
        )
        if self._client is None:
            return
        try:
            self._client.trace(
                id=self.trace_id,
                name="sales_turn",
                metadata={
                    "company_id": self.company_id,
                    "conversation_id": self.conversation_id,
                    "spans": self.spans,
                    **payload,
                },
            )
            self._client.flush()
        except Exception:
            logger.warning("falha ao enviar trace ao Langfuse", exc_info=True)


def _client() -> Any:
    if not settings.langfuse_enabled:
        return None
    public = settings.langfuse_public_key.get_secret_value()
    secret = settings.langfuse_secret_key.get_secret_value()
    if not public or not secret:
        logger.warning("LANGFUSE_ENABLED=true mas faltam chaves; tracing desativado")
        return None
    try:
        from langfuse import Langfuse

        return Langfuse(public_key=public, secret_key=secret, host=settings.langfuse_host)
    except Exception:
        logger.warning("não foi possível inicializar o Langfuse", exc_info=True)
        return None


@asynccontextmanager
async def trace_turn(
    *, company_id: str, conversation_id: str, correlation_id: str | None = None
) -> AsyncIterator[Trace]:
    trace = Trace(
        trace_id=correlation_id or str(uuid.uuid4()),
        company_id=company_id,
        conversation_id=conversation_id,
        _client=_client(),
    )
    try:
        yield trace
    except Exception as err:
        trace.span("error", error_type=type(err).__name__)
        trace.finish(status="error", error_code=type(err).__name__)
        raise
    else:
        trace.finish(status="ok")


__all__ = ["Trace", "trace_turn"]
