"""Dependências da API.

Autenticação service-to-service com comparação timing-safe — mesmo padrão do
`safeEqualSecret` já usado nos hooks do TanStack Start
(`src/lib/runtime/HookSecurity.server.ts`). Nenhum endpoint fica público além
do `/health`.
"""

from __future__ import annotations

import hmac
import logging
from typing import Annotated

from fastapi import Depends, Header, HTTPException, status

from app.config import settings

logger = logging.getLogger(__name__)


async def require_service_token(
    x_ai_service_token: Annotated[str | None, Header()] = None,
) -> None:
    """Valida o segredo compartilhado.

    `compare_digest` em vez de `==`: comparação de string vaza o prefixo
    correto pelo tempo de resposta. É barato de fazer certo.
    """
    expected = settings.require_service_auth()
    if not x_ai_service_token or not hmac.compare_digest(x_ai_service_token, expected):
        # Sem detalhe na resposta: dizer "token ausente" vs "token errado"
        # entrega informação para quem está sondando.
        logger.warning("chamada não autorizada rejeitada")
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="unauthorized")


ServiceAuth = Annotated[None, Depends(require_service_token)]

__all__ = ["ServiceAuth", "require_service_token"]
