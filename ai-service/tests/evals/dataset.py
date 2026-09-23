"""Dataset de avaliação — cenários comerciais reais.

Vem dos casos do briefing, mais os que a auditoria mostrou serem os pontos
frágeis da arquitetura atual (contexto anafórico e aterramento de preço).

Cada cenário declara o que se espera da DECISÃO, não do texto. Avaliar string
de resposta gera eval frágil que quebra a cada ajuste de prompt; avaliar
"chamou get_product_price antes de falar de preço" mede a propriedade que
realmente importa.
"""

from __future__ import annotations

from dataclasses import dataclass, field


@dataclass(frozen=True, slots=True)
class Scenario:
    id: str
    description: str
    last_message: str

    # Contexto prévio da conversa.
    prior_product_in_focus: bool = False

    # Expectativas.
    expected_action: str | None = None
    expected_intent: str | None = None
    must_call_tools: tuple[str, ...] = ()
    must_not_call_tools: tuple[str, ...] = ()
    must_resolve_product: bool = False
    must_not_invent_price: bool = True
    tags: tuple[str, ...] = field(default=())


SCENARIOS: list[Scenario] = [
    Scenario(
        id="busca_produto",
        description="Cliente pergunta por medida específica",
        last_message="Tem piscina de 6 metros?",
        expected_intent="product_search",
        must_call_tools=("search_catalog",),
        tags=("catalog", "grounding"),
    ),
    Scenario(
        id="referencia_anaforica",
        description="Cliente se refere ao produto já apresentado",
        last_message="essa mesmo",
        prior_product_in_focus=True,
        must_resolve_product=True,
        tags=("context", "memory"),
    ),
    Scenario(
        id="objecao_preco",
        description="Cliente tenta negociar valor",
        last_message="faz por 8 mil?",
        expected_action="handoff",
        must_call_tools=("get_commercial_policy",),
        tags=("objection", "policy"),
    ),
    Scenario(
        id="forma_pagamento",
        description="Cliente pergunta condição comercial",
        last_message="qual a forma de pagamento?",
        must_call_tools=("get_commercial_policy",),
        tags=("policy", "grounding"),
    ),
    Scenario(
        id="preco_direto",
        description="Cliente pede preço; não pode sair sem consultar",
        last_message="quanto custa a de 6x3?",
        must_call_tools=("search_catalog", "get_product_price"),
        tags=("pricing", "grounding"),
    ),
    Scenario(
        id="pede_fotos",
        description="Cliente pede imagens",
        last_message="tem foto?",
        prior_product_in_focus=True,
        must_call_tools=("get_product_images",),
        tags=("catalog",),
    ),
    Scenario(
        id="isolamento_tenant",
        description="Produto de outra empresa jamais aparece",
        last_message="Tem piscina de 6 metros?",
        must_call_tools=("search_catalog",),
        tags=("multitenant", "security"),
    ),
    Scenario(
        id="produto_inexistente",
        description="Catálogo não tem o que o cliente pediu",
        last_message="vocês têm piscina olímpica de 50 metros?",
        # Precisa CONSULTAR para poder dizer que não tem. Responder "não
        # temos" sem buscar é chute que acerta por acaso — e que erraria no
        # dia em que o catálogo passasse a ter.
        must_call_tools=("search_catalog",),
        must_not_call_tools=("get_product_price",),
        must_not_invent_price=True,
        tags=("grounding", "hallucination"),
    ),
    Scenario(
        id="reclamacao",
        description="Pós-venda com problema vai para humano",
        last_message="a piscina que comprei está vazando",
        expected_action="handoff",
        tags=("handoff",),
    ),
]


# Métricas que a suíte precisa medir, conforme o briefing.
METRICS = (
    "hallucination_rate",
    "tool_correctness",
    "product_correctness",
    "tenant_isolation",
    "context_retention",
    "intent_accuracy",
    "handoff_correctness",
    "retrieval_relevance",
    "answer_groundedness",
    "policy_compliance",
    "latency_ms",
    "tokens",
    "cost",
)


__all__ = ["METRICS", "SCENARIOS", "Scenario"]
