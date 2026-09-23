"""Modos de execução e resolução por empresa.

Aviso que vem da auditoria §1.1: `silent`/`assisted`/`automatic` **não existem
hoje** no Atende Aí. O sistema atual tem `ai_auto_reply_enabled` (liga/desliga)
e `ai_pilot_mode` (que só muda um rótulo na tela, não o comportamento).

O mapeamento de compatibilidade é:

    ai_auto_reply_enabled = false  ->  silent
    ai_auto_reply_enabled = true   ->  automatic
    (não existe hoje)              ->  assisted

`assisted` só é alcançável por flag explícita em `ai_company_flags`, porque
depende de tela de aprovação que ainda não existe. Enquanto a tela não existir,
uma sugestão em `assisted` fica pendente no banco e ninguém a aprova — por isso
o default do serviço é `silent`.
"""

from __future__ import annotations

from dataclasses import dataclass
from uuid import UUID

from app.config import ExecutionMode, settings
from app.policies.tenant import TenantScope


@dataclass(frozen=True, slots=True)
class ModeCapabilities:
    """O que cada modo permite. Read-only sempre pode: interpretar e pesquisar
    não tem efeito externo."""

    can_read_tools: bool
    can_write_internal: bool
    can_act_externally: bool
    persists_suggestion: bool

    @staticmethod
    def for_mode(mode: ExecutionMode) -> ModeCapabilities:
        if mode == "silent":
            return ModeCapabilities(
                can_read_tools=True,
                can_write_internal=False,
                can_act_externally=False,
                persists_suggestion=False,
            )
        if mode == "assisted":
            return ModeCapabilities(
                can_read_tools=True,
                can_write_internal=True,
                can_act_externally=False,
                persists_suggestion=True,
            )
        return ModeCapabilities(
            can_read_tools=True,
            can_write_internal=True,
            can_act_externally=True,
            persists_suggestion=False,
        )


@dataclass(frozen=True, slots=True)
class CompanyFlags:
    """Flags por empresa, lidas de `ai_company_flags`."""

    python_ai_enabled: bool = False
    python_ai_shadow_mode: bool = False
    python_ai_assisted_mode: bool = False
    python_ai_automatic_mode: bool = False
    python_ai_rag_enabled: bool = False


def resolve_execution_mode(
    flags: CompanyFlags,
    legacy_auto_reply_enabled: bool,
) -> ExecutionMode:
    """Decide o modo efetivo.

    Ordem importa. `shadow_mode` vence tudo: enquanto a empresa estiver em
    shadow, o Python observa e não age, mesmo que as outras flags digam o
    contrário. É a fase de validação — deixá-la ser sobreposta por engano
    anularia o propósito dela.
    """
    if not flags.python_ai_enabled:
        return "silent"
    if flags.python_ai_shadow_mode:
        return "silent"
    if flags.python_ai_automatic_mode and legacy_auto_reply_enabled:
        return "automatic"
    if flags.python_ai_assisted_mode:
        return "assisted"
    return settings.default_execution_mode


@dataclass(frozen=True, slots=True)
class ExecutionContext:
    """Tudo que o Policy Engine precisa saber sobre a conversa agora."""

    scope: TenantScope
    conversation_id: UUID
    mode: ExecutionMode
    flags: CompanyFlags

    human_active: bool = False
    within_business_hours: bool = True
    after_hours_only: bool = False
    auto_reply_count: int = 0
    max_auto_replies: int = 10
    seconds_since_last_auto_reply: float | None = None
    whatsapp_window_open: bool = True

    @property
    def capabilities(self) -> ModeCapabilities:
        return ModeCapabilities.for_mode(self.mode)


__all__ = [
    "CompanyFlags",
    "ExecutionContext",
    "ExecutionMode",
    "ModeCapabilities",
    "resolve_execution_mode",
]
