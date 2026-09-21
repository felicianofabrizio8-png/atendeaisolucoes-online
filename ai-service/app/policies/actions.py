"""Policy Engine — decide se a decisão do agente pode virar ação.

Separação que o projeto inteiro depende: o agente **decide**, o Policy Engine
**autoriza**. O modelo nunca chama uma ação externa direto; ele devolve uma
`AgentDecision` e esta camada resolve o que acontece.

Ordem das checagens é deliberada — do mais barato e mais absoluto para o mais
específico:

    barreira física -> tenant -> humano -> modo -> safety -> janela/limites

A barreira física (`ALLOW_EXTERNAL_ACTIONS`) vem primeiro porque é a única que
nenhuma flag de empresa consegue desligar. É ela que garante que um worker de
shadow mode não envie mensagem nem por bug nem por configuração errada.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

from app.config import settings
from app.policies.execution import ExecutionContext
from app.policies.safety import check_message
from app.schemas.agent import AgentDecision

Verdict = Literal["execute", "persist_suggestion", "block"]

# Debounce entre respostas automáticas. Espelha DEBOUNCE_MS do agente TS.
MIN_SECONDS_BETWEEN_AUTO_REPLIES = 8.0


@dataclass(frozen=True, slots=True)
class PolicyResult:
    verdict: Verdict
    reason: str | None = None

    @property
    def allowed(self) -> bool:
        return self.verdict == "execute"


def evaluate(decision: AgentDecision, ctx: ExecutionContext) -> PolicyResult:
    """Avalia uma decisão contra o contexto de execução."""

    # Sem efeito externo: só registrar. Não passa por nenhuma das checagens
    # seguintes porque não há o que autorizar.
    if decision.action == "skip":
        return PolicyResult(verdict="block", reason="skip")

    if decision.action == "handoff":
        # Handoff é sempre permitido — é o caminho seguro por definição, e
        # bloqueá-lo prenderia a conversa com a IA justamente quando ela
        # concluiu que não deveria seguir.
        return PolicyResult(verdict="execute")

    if not decision.mentions_external_action():
        return PolicyResult(verdict="execute")

    # 1. Barreira física. Nenhuma flag de empresa desliga isto.
    if not settings.allow_external_actions:
        return PolicyResult(verdict="block", reason="external_actions_disabled")

    # 2. Humano assumiu. Espelha shouldAutoReply (ai-agent.server.ts:165-166).
    if ctx.human_active:
        return PolicyResult(verdict="block", reason="human_active")

    # 3. Modo de execução.
    caps = ctx.capabilities
    if not caps.can_act_externally:
        if caps.persists_suggestion:
            return PolicyResult(verdict="persist_suggestion", reason="assisted_mode")
        return PolicyResult(verdict="block", reason="silent_mode")

    # 4. Aprovação humana pedida pelo próprio agente.
    if decision.requires_human_approval:
        return PolicyResult(verdict="persist_suggestion", reason="requires_human_approval")

    # 5. Conteúdo da mensagem.
    if decision.action == "reply":
        if not decision.message:
            return PolicyResult(verdict="block", reason="empty_message")
        verdict = check_message(decision.message, _commercial_terms(ctx))
        if not verdict.ok:
            return PolicyResult(verdict="block", reason=verdict.reason)

    # 6. Janela e limites operacionais.
    if ctx.after_hours_only and ctx.within_business_hours:
        return PolicyResult(verdict="block", reason="business_hours")

    if ctx.auto_reply_count >= ctx.max_auto_replies:
        return PolicyResult(verdict="block", reason="rate_limit")

    if (
        ctx.seconds_since_last_auto_reply is not None
        and ctx.seconds_since_last_auto_reply < MIN_SECONDS_BETWEEN_AUTO_REPLIES
    ):
        return PolicyResult(verdict="block", reason="debounce")

    if decision.action == "reply" and not ctx.whatsapp_window_open:
        # Fora da janela de 24h a Meta só aceita template. Enviar texto livre
        # daria erro na API; bloquear aqui evita gastar a tentativa.
        return PolicyResult(verdict="block", reason="whatsapp_window_closed")

    return PolicyResult(verdict="execute")


def _commercial_terms(ctx: ExecutionContext) -> str | None:
    """Termos comerciais para a checagem de percentual.

    TODO(fase 8): carregar de `marketing_knowledge_base` via
    `tools/knowledge.get_commercial_policy` e passar no ExecutionContext.
    Até lá devolve None, o que torna a regra mais restritiva (qualquer
    percentual é bloqueado) — que é o lado seguro do erro.
    """
    return None


__all__ = [
    "MIN_SECONDS_BETWEEN_AUTO_REPLIES",
    "PolicyResult",
    "Verdict",
    "evaluate",
]
