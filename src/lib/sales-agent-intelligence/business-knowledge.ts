// ============================================================================
// Business Knowledge — o que ESTA empresa vende e até onde a Vendedora pode
// ir. Montado a partir do cadastro do tenant (perfil, catálogo, políticas).
// Define capacidades/limites usados pelo gate do plano de vendas.
// ============================================================================

import type { AgentContext } from "../sales-agent-core";

export type ClosingCapability = "human";
export type NegotiationCapability = "not_authorized";

export interface BusinessKnowledge {
  companyName: string;
  offering: string | null;
  region: string | null;
  differentials: string | null;
  /** Assuntos com política cadastrada que a IA pode responder. */
  policyTopics: string[];
  capabilities: {
    /** Catálogo com preços cadastrados → comparação de preço possível. */
    priceComparison: boolean;
    /** Existe política de visita cadastrada para propor como próximo passo. */
    visit: boolean;
    /** Pedido/fechamento é concluído por atendente humano. */
    closing: ClosingCapability;
    /** Nenhuma condição fora do cadastro pode ser concedida pela IA. */
    negotiation: NegotiationCapability;
  };
}

const text = (value: string | null | undefined): string | null => value?.trim() || null;

export function buildBusinessKnowledge(ctx: AgentContext): BusinessKnowledge {
  const rules = ctx.grounding.commercialRules;
  const catalog = ctx.grounding.catalog.length > 0 ? ctx.grounding.catalog : ctx.products;
  const policyTopics = [
    text(rules.paymentPolicy) || text(rules.paymentMethods) ? "pagamento" : null,
    text(rules.installationPolicy) ? "instalação" : null,
    text(rules.shippingPolicy) || text(rules.nextLoadForecast) ? "entrega" : null,
    text(rules.visitPolicy) ? "visita" : null,
    text(rules.includedItemsPolicy) ? "itens inclusos" : null,
  ].filter((topic): topic is string => Boolean(topic));
  return {
    companyName: ctx.companyName,
    offering: text(ctx.aiProfile?.description) ?? text(ctx.aiProfile?.products),
    region: text(ctx.aiProfile?.region),
    differentials: text(ctx.aiProfile?.differentials),
    policyTopics,
    capabilities: {
      priceComparison: catalog.some(
        (product) => (product.promoPrice ?? 0) > 0 || (product.price ?? 0) > 0,
      ),
      visit: Boolean(text(rules.visitPolicy)),
      closing: "human",
      negotiation: "not_authorized",
    },
  };
}

export function renderBusinessKnowledge(knowledge: BusinessKnowledge): string {
  const next = [
    "escolher entre opções do catálogo",
    knowledge.capabilities.visit ? "agendar visita conforme a política de visita" : null,
    "falar com um atendente para concluir o pedido",
  ].filter(Boolean);
  return [
    `CONHECIMENTO DO NEGÓCIO — ${knowledge.companyName}:`,
    `- O que vende: ${knowledge.offering ?? "ver CATÁLOGO"}`,
    knowledge.region ? `- Região atendida: ${knowledge.region}` : null,
    knowledge.differentials ? `- Diferenciais cadastrados: ${knowledge.differentials}` : null,
    `- Assuntos com política cadastrada: ${knowledge.policyTopics.length ? knowledge.policyTopics.join(", ") : "nenhum"}`,
    `- Próximos passos possíveis: ${next.join("; ")}`,
    "- Limites: pedido/fechamento é concluído por atendente; desconto, contraproposta ou condição fora do cadastro não podem ser oferecidos.",
  ]
    .filter((line): line is string => Boolean(line))
    .join("\n");
}
