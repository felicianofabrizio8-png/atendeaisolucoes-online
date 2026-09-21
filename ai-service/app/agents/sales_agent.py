"""Sales Agent — o único agente desta fase.

O briefing pediu um agente, não uma dezena. Ele concentra interpretação,
memória, retrieval, ferramentas, decisão e resposta; a validação fica fora, no
Policy Engine, porque quem decide não pode ser quem autoriza.

Duas notas de integração que valem ler antes de mexer:

1. **API do Pydantic AI.** O nome do parâmetro de saída estruturada mudou entre
   versões (`result_type` nas antigas, `output_type` nas novas). Está isolado
   em `build_agent()` de propósito: se a versão instalada reclamar, é uma linha
   para corrigir, não uma caçada pelo projeto.

2. **Modelo.** Hoje o loop do agente usa o provider do próprio Pydantic AI, e o
   `llm/gateway.py` (LiteLLM) atende embeddings e sumarização. Unificar tudo
   sob LiteLLM exige um provider customizado — FASE 10. Até lá o roteamento
   FAST/SMART é aplicado na escolha do modelo passado aqui.
"""

from __future__ import annotations

from app.llm.routing import ModelClass, model_for
from app.schemas.agent import AgentDecision
from app.schemas.tools import (
    CatalogSearchResult,
    CommercialPolicy,
    KnowledgeSearchResult,
    LeadSnapshot,
    ProductDetail,
    ProductImages,
    ProductPrice,
    ToolError,
)
from app.tools import catalog, knowledge, leads, messaging, pricing
from app.tools.deps import AgentDeps

SYSTEM_PROMPT = """\
Você é o atendente comercial da {company_name}. Fala português do Brasil, tom \
direto e cordial, no máximo 4 frases por mensagem.

REGRA INEGOCIÁVEL — você não inventa fato comercial.

Precisa de preço? Chame get_product_price.
Precisa de produto? Chame search_catalog ou get_product.
Precisa de forma de pagamento, prazo, frete, instalação ou itens inclusos? \
Chame get_commercial_policy.
Precisa de qualquer outra informação da empresa? Chame search_company_knowledge.

Se a ferramenta não devolver o dado, diga que vai confirmar com a equipe. \
NUNCA estime, arredonde ou deduza preço, medida, prazo ou condição. Um número \
que você escreveu sem ter vindo de ferramenta é um erro grave.

Não ofereça desconto, brinde, frete grátis ou condição especial. Se o cliente \
pedir, use handoff.

Quando a busca trouxer vários produtos parecidos, pergunte qual interessa em \
vez de escolher por conta própria.

Use o estado da conversa para entender referências como "esse", "o segundo", \
"quanto fica" — não peça ao cliente que repita o que ele já disse.

Preencha a decisão estruturada com o que observou: intenção, temperatura, \
objeções e produtos. Se a situação pedir uma pessoa (negociação, reclamação, \
jurídico, pós-venda complexo), escolha action="handoff".
"""


def build_agent(
    *, company_name: str, model_class: ModelClass = ModelClass.FAST
) -> object:
    """Monta o agente com as ferramentas registradas.

    Devolve `object` porque o tipo concreto depende da versão do Pydantic AI
    instalada — anotar `Agent[AgentDeps, AgentDecision]` quebraria o pyright
    quando a assinatura genérica mudasse. O chamador usa só `.run()`.
    """
    from pydantic_ai import Agent, RunContext

    model_name = model_for(model_class).replace("/", ":", 1)

    agent = Agent(
        model_name,
        deps_type=AgentDeps,
        output_type=AgentDecision,
        system_prompt=SYSTEM_PROMPT.format(company_name=company_name),
        retries=1,
    )

    # ---- ferramentas de leitura (FASE 3) --------------------------------
    @agent.tool
    async def search_catalog(
        ctx: RunContext[AgentDeps],
        query: str,
        category: str | None = None,
        min_length_m: float | None = None,
        max_length_m: float | None = None,
    ) -> CatalogSearchResult | ToolError:
        """Busca produtos ativos no catálogo da empresa."""
        return await catalog.search_catalog(
            ctx.deps,
            query,
            category=category,
            min_length_m=min_length_m,
            max_length_m=max_length_m,
        )

    @agent.tool
    async def get_product(
        ctx: RunContext[AgentDeps], product_id: str
    ) -> ProductDetail | ToolError:
        """Detalhes completos de um produto."""
        return await catalog.get_product(ctx.deps, product_id)

    @agent.tool
    async def get_product_price(
        ctx: RunContext[AgentDeps], product_id: str
    ) -> ProductPrice | ToolError:
        """Preço oficial. Única fonte válida de preço."""
        return await pricing.get_product_price(ctx.deps, product_id)

    @agent.tool
    async def get_product_images(
        ctx: RunContext[AgentDeps], product_id: str
    ) -> ProductImages | ToolError:
        """IDs das fotos cadastradas do produto."""
        return await catalog.get_product_images(ctx.deps, product_id)

    @agent.tool
    async def search_company_knowledge(
        ctx: RunContext[AgentDeps], query: str
    ) -> KnowledgeSearchResult | ToolError:
        """Busca no conhecimento indexado da empresa."""
        return await knowledge.search_company_knowledge(ctx.deps, query)

    @agent.tool
    async def get_commercial_policy(
        ctx: RunContext[AgentDeps],
    ) -> CommercialPolicy | ToolError:
        """Políticas oficiais: pagamento, prazo, frete, instalação, inclusos."""
        return await knowledge.get_commercial_policy(ctx.deps)

    @agent.tool
    async def get_lead(ctx: RunContext[AgentDeps]) -> LeadSnapshot | ToolError:
        """Dados do lead desta conversa."""
        return await leads.get_lead(ctx.deps)

    # ---- escrita interna --------------------------------------------------
    @agent.tool
    async def update_lead_state(
        ctx: RunContext[AgentDeps],
        detected_city: str | None = None,
        detected_state: str | None = None,
        detected_budget: str | None = None,
        detected_intent: str | None = None,
        purchase_timing: str | None = None,
    ) -> dict[str, int] | ToolError:
        """Registra a qualificação observada nesta conversa."""
        return await leads.update_lead_state(
            ctx.deps,
            detected_city=detected_city,
            detected_state=detected_state,
            detected_budget=detected_budget,
            detected_intent=detected_intent,
            purchase_timing=purchase_timing,
        )

    @agent.tool
    async def human_handoff(
        ctx: RunContext[AgentDeps], reason: str
    ) -> dict[str, str] | ToolError:
        """Passa a conversa para uma pessoa. Sempre disponível."""
        return await messaging.human_handoff(ctx.deps, reason)

    return agent


__all__ = ["SYSTEM_PROMPT", "build_agent"]
