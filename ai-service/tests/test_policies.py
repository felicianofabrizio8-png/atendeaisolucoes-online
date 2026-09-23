"""Policy Engine, modos de execução e camada de segurança de texto."""

from __future__ import annotations

from uuid import uuid4

import pytest

from app.config import settings
from app.policies import actions
from app.policies.execution import (
    CompanyFlags,
    ExecutionContext,
    ModeCapabilities,
    resolve_execution_mode,
)
from app.policies.safety import check_message
from app.schemas.agent import AgentDecision


class TestResolucaoDeModo:
    def test_desligado_e_silent(self) -> None:
        assert resolve_execution_mode(CompanyFlags(), legacy_auto_reply_enabled=True) == "silent"

    def test_shadow_vence_automatic(self) -> None:
        """Shadow tem que ganhar de tudo: é a fase em que o Python observa sem
        agir, e deixá-la ser sobreposta anularia a validação."""
        flags = CompanyFlags(
            python_ai_enabled=True,
            python_ai_shadow_mode=True,
            python_ai_automatic_mode=True,
        )
        assert resolve_execution_mode(flags, legacy_auto_reply_enabled=True) == "silent"

    def test_automatic_exige_auto_reply_legado(self) -> None:
        """Não basta a flag nova: se a empresa desligou a resposta automática
        no sistema atual, essa decisão continua valendo."""
        flags = CompanyFlags(python_ai_enabled=True, python_ai_automatic_mode=True)
        assert resolve_execution_mode(flags, legacy_auto_reply_enabled=False) != "automatic"

    def test_assisted(self) -> None:
        flags = CompanyFlags(python_ai_enabled=True, python_ai_assisted_mode=True)
        assert resolve_execution_mode(flags, legacy_auto_reply_enabled=False) == "assisted"


class TestCapacidades:
    def test_silent_nao_escreve_nem_age(self) -> None:
        caps = ModeCapabilities.for_mode("silent")
        assert caps.can_read_tools
        assert not caps.can_write_internal
        assert not caps.can_act_externally

    def test_assisted_persiste_sugestao(self) -> None:
        caps = ModeCapabilities.for_mode("assisted")
        assert caps.persists_suggestion
        assert not caps.can_act_externally

    def test_automatic_age(self) -> None:
        assert ModeCapabilities.for_mode("automatic").can_act_externally


def _ctx(mode: str, **kwargs: object) -> ExecutionContext:
    from app.policies.tenant import TenantScope
    from tests.conftest import COMPANY_A

    return ExecutionContext(
        scope=TenantScope(company_id=COMPANY_A),
        conversation_id=uuid4(),
        mode=mode,  # type: ignore[arg-type]
        flags=CompanyFlags(),
        **kwargs,  # type: ignore[arg-type]
    )


class TestPolicyEngine:
    def test_handoff_sempre_passa(self) -> None:
        """Mesmo em silent, mesmo com humano ativo: bloquear handoff prenderia
        a conversa com a IA justamente quando ela desistiu."""
        result = actions.evaluate(
            AgentDecision(action="handoff", reason="negociação"),
            _ctx("silent", human_active=True),
        )
        assert result.verdict == "execute"

    def test_silent_bloqueia_resposta(self) -> None:
        result = actions.evaluate(
            AgentDecision(action="reply", message="Olá!"), _ctx("silent")
        )
        assert result.verdict == "block"

    def test_assisted_persiste_em_vez_de_enviar(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setattr(settings, "allow_external_actions", True)
        result = actions.evaluate(
            AgentDecision(action="reply", message="Olá!"), _ctx("assisted")
        )
        assert result.verdict == "persist_suggestion"

    def test_barreira_fisica_vence_modo_automatic(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """O guarda-corpo do shadow mode: nenhuma flag de empresa o desliga."""
        monkeypatch.setattr(settings, "allow_external_actions", False)
        result = actions.evaluate(
            AgentDecision(action="reply", message="Olá!"), _ctx("automatic")
        )
        assert result.verdict == "block"
        assert result.reason == "external_actions_disabled"

    def test_humano_ativo_bloqueia(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setattr(settings, "allow_external_actions", True)
        result = actions.evaluate(
            AgentDecision(action="reply", message="Olá!"),
            _ctx("automatic", human_active=True),
        )
        assert result.reason == "human_active"

    def test_rate_limit(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setattr(settings, "allow_external_actions", True)
        result = actions.evaluate(
            AgentDecision(action="reply", message="Olá!"),
            _ctx("automatic", auto_reply_count=10, max_auto_replies=10),
        )
        assert result.reason == "rate_limit"

    def test_janela_whatsapp_fechada(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setattr(settings, "allow_external_actions", True)
        result = actions.evaluate(
            AgentDecision(action="reply", message="Olá!"),
            _ctx("automatic", whatsapp_window_open=False),
        )
        assert result.reason == "whatsapp_window_closed"

    def test_aprovacao_pedida_pelo_agente(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setattr(settings, "allow_external_actions", True)
        result = actions.evaluate(
            AgentDecision(action="reply", message="Olá!", requires_human_approval=True),
            _ctx("automatic"),
        )
        assert result.verdict == "persist_suggestion"


class TestSafetyLayer:
    def test_percentual_nao_registrado_bloqueia(self) -> None:
        verdict = check_message("Consigo 10% de desconto", commercial_terms=None)
        assert not verdict.ok

    def test_percentual_registrado_passa(self) -> None:
        verdict = check_message(
            "Consigo 10% de desconto", commercial_terms="Desconto máximo de 10%"
        )
        assert verdict.ok

    def test_normalizacao_de_percentual(self) -> None:
        """'10 %' e '10%' são a mesma condição comercial."""
        assert check_message("fica 10 % off", commercial_terms="até 10%").ok

    @pytest.mark.parametrize(
        "texto",
        [
            "Te mando com frete grátis",
            "Incluo um brinde",
            "Faço por R$ 8000",
            "Tenho desconto especial para você",
        ],
    )
    def test_padroes_bloqueados(self, texto: str) -> None:
        assert not check_message(texto, commercial_terms=None).ok

    def test_mensagem_normal_passa(self) -> None:
        assert check_message(
            "A piscina 6x3 está disponível. Quer que eu envie fotos?",
            commercial_terms=None,
        ).ok

    def test_mensagem_vazia_bloqueia(self) -> None:
        assert not check_message("   ", commercial_terms=None).ok
