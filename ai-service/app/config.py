"""Configuração do serviço.

Tudo vem de variável de ambiente. Nada de valor sensível embutido em código —
o repositório já tem histórico de `.env` versionado (ver a auditoria da FASE 0),
então a regra aqui é estrita: se o segredo não veio do ambiente, o serviço não
finge que está configurado, ele falha na validação.
"""

from __future__ import annotations

from functools import lru_cache
from typing import Literal

from pydantic import SecretStr, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

ExecutionMode = Literal["silent", "assisted", "automatic"]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
        case_sensitive=False,
    )

    app_env: Literal["development", "staging", "production"] = "development"
    log_level: str = "INFO"

    # --- auth service-to-service -------------------------------------------
    service_auth_token: SecretStr = SecretStr("")

    # --- banco --------------------------------------------------------------
    database_url: SecretStr = SecretStr("")
    db_pool_min: int = 1
    db_pool_max: int = 10
    db_statement_timeout_ms: int = 15_000

    # --- llm ----------------------------------------------------------------
    llm_fast_model: str = "openai/gpt-4o-mini"
    llm_smart_model: str = "openai/gpt-4o"
    llm_vision_model: str = "openai/gpt-4o"
    llm_embedding_model: str = "openai/text-embedding-3-small"
    llm_fast_fallback: str = ""
    llm_smart_fallback: str = ""
    llm_timeout_seconds: float = 30.0
    llm_max_retries: int = 2

    # --- embeddings / rag ---------------------------------------------------
    embedding_dim: int = 1536
    embedding_batch_size: int = 64
    retrieval_top_k: int = 8
    retrieval_candidates: int = 40

    # --- observabilidade ----------------------------------------------------
    langfuse_public_key: SecretStr = SecretStr("")
    langfuse_secret_key: SecretStr = SecretStr("")
    langfuse_host: str = "https://cloud.langfuse.com"
    langfuse_enabled: bool = False

    # --- worker -------------------------------------------------------------
    worker_id: str = "ai-service-local"
    worker_job_types: str = "python_sales_turn"
    worker_lock_seconds: int = 300
    worker_poll_interval_seconds: float = 2.0
    worker_max_concurrency: int = 1

    # --- modos --------------------------------------------------------------
    default_execution_mode: ExecutionMode = "silent"

    # Barreira física de envio. Ver policies/actions.py: mesmo que a empresa
    # esteja em `automatic` e o agente decida enviar, nada sai com isto em
    # false. É o guarda-corpo do shadow mode — flag de empresa não o desliga.
    allow_external_actions: bool = False

    @field_validator("embedding_dim")
    @classmethod
    def _dim_positiva(cls, v: int) -> int:
        if v < 1:
            raise ValueError("embedding_dim precisa ser positiva")
        return v

    @property
    def job_types(self) -> list[str]:
        return [t.strip() for t in self.worker_job_types.split(",") if t.strip()]

    @property
    def is_production(self) -> bool:
        return self.app_env == "production"

    def require_service_auth(self) -> str:
        token = self.service_auth_token.get_secret_value()
        if not token:
            raise RuntimeError(
                "SERVICE_AUTH_TOKEN ausente. O serviço não sobe sem autenticação "
                "service-to-service configurada."
            )
        return token

    def require_database_url(self) -> str:
        url = self.database_url.get_secret_value()
        if not url:
            raise RuntimeError("DATABASE_URL ausente.")
        return url


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    """Instância única. `lru_cache` para os testes poderem limpar com
    `get_settings.cache_clear()` depois de mexer no ambiente."""
    return Settings()


settings: Settings = get_settings()

__all__ = ["ExecutionMode", "Settings", "get_settings", "settings"]
