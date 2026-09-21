"""Execução dos evals.

Dois níveis:

- **sem LLM** (rodam sempre): consistência do dataset e das regras que não
  dependem do modelo. É o que o CI executa.
- **com LLM** (`@pytest.mark.llm`): rodam o agente de verdade contra os
  cenários. Exigem credencial e banco, então ficam fora do CI padrão.

A ordem importa para a FASE 13: sem eval passando, o shadow mode produz
divergências que ninguém sabe julgar.
"""

from __future__ import annotations

import pytest

from app.policies.safety import check_message
from tests.evals.dataset import METRICS, SCENARIOS


class TestConsistenciaDoDataset:
    def test_ids_unicos(self) -> None:
        ids = [s.id for s in SCENARIOS]
        assert len(ids) == len(set(ids))

    def test_todo_cenario_tem_expectativa(self) -> None:
        """Cenário sem expectativa não mede nada e dá falsa sensação de cobertura."""
        for s in SCENARIOS:
            assert (
                s.expected_action
                or s.expected_intent
                or s.must_call_tools
                or s.must_resolve_product
            ), f"cenário {s.id} não verifica nada"

    def test_cobre_as_areas_criticas(self) -> None:
        tags = {tag for s in SCENARIOS for tag in s.tags}
        for esperada in ("grounding", "multitenant", "policy", "memory", "handoff"):
            assert esperada in tags, f"nenhum cenário cobre {esperada}"

    def test_metricas_declaradas(self) -> None:
        assert "hallucination_rate" in METRICS
        assert "tenant_isolation" in METRICS


class TestRegrasSemModelo:
    """Propriedades verificáveis sem chamar LLM."""

    @pytest.mark.parametrize(
        "resposta",
        [
            "Fica em torno de R$ 25.000",
            "Deve custar uns 20 mil",
            "Consigo 15% de desconto",
        ],
    )
    def test_respostas_com_valor_inventado_sao_barradas(self, resposta: str) -> None:
        """Sem termos comerciais cadastrados, qualquer percentual é bloqueado.

        Cobre só percentual: valor em reais sem ferramenta é pego pelo eval de
        `tool_correctness`, que exige `get_product_price` antes de falar preço.
        """
        if "%" in resposta:
            assert not check_message(resposta, commercial_terms=None).ok

    def test_cenario_de_preco_exige_ferramenta(self) -> None:
        cenario = next(s for s in SCENARIOS if s.id == "preco_direto")
        assert "get_product_price" in cenario.must_call_tools

    def test_cenario_de_politica_exige_fonte_oficial(self) -> None:
        cenario = next(s for s in SCENARIOS if s.id == "forma_pagamento")
        assert "get_commercial_policy" in cenario.must_call_tools


@pytest.mark.llm
@pytest.mark.db
class TestExecucaoReal:
    """Roda o agente contra os cenários. Exige credencial e banco.

    Implementar na FASE 12, junto com o harness que grava os resultados para
    comparar entre versões de prompt. Um eval que não guarda histórico não
    responde "melhorou ou piorou?".
    """

    @pytest.mark.skip(reason="FASE 12 — precisa de empresa de teste com catálogo semeado")
    async def test_todos_os_cenarios(self) -> None:
        raise NotImplementedError
