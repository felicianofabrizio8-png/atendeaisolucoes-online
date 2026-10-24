import { buildSalesAgentCompletionRequest, type AgentContext, type AgentDecision, type SalesAgentCompletionRequest } from "./sales-agent-core";

const PRODUCT = {
  id: "fixture-piscina-6x3",
  name: "Piscina Fictícia 6x3",
  model: "F6X3",
  sku: "FIX-6X3",
  category: "piscina",
  description: "Produto fictício para homologação local.",
  lengthM: 6,
  widthM: 3,
  depthM: 1.4,
  capacityL: 20_000,
  shape: "retangular",
  specifications: null,
  includedItems: ["instalação básica fictícia"],
  variants: [],
  price: 18_000,
  promoPrice: 17_100,
  images: [],
  notes: "Fixture sem estoque ou disponibilidade real.",
};

export const BRUNA_HOMOLOGATION_FIXTURE = {
  companyName: "Empresa Fictícia de Homologação",
  productName: PRODUCT.name,
  productId: PRODUCT.id,
};

export function buildBrunaHomologationRequest(
  model: string,
  companyId: string,
  history: Array<{ role: "lead" | "agent"; text: string }>,
): SalesAgentCompletionRequest {
  const product = { ...PRODUCT };
  const ctx = {
    settings: {
      company_id: companyId,
      ai_auto_reply_enabled: false,
      ai_after_hours_only: true,
      ai_initial_message: null,
      ai_max_auto_replies: 0,
      ai_handoff_timeout_minutes: 30,
      ai_agent_name: "Bruna",
      business_hours_start: "08:00:00",
      business_hours_end: "18:00:00",
      ai_discount_mode: "authorized",
      ai_discount_rules: [{ percent: 5, condition: "pagamento à vista" }],
    },
    companyName: BRUNA_HOMOLOGATION_FIXTURE.companyName,
    products: [product],
    catalogProductIds: [product.id],
    aiProfile: {
      tone: "comercial",
      description: "Fixture fictício para validar catálogo, negociação e handoff.",
      products: product.name,
      payment_methods: "Pix ou cartão, conforme aprovação humana.",
      avg_lead_time: "Prazo fictício; não afirmar sem confirmação.",
      business_hours: "08:00 às 18:00",
      region: "Brasil",
      differentials: "Atendimento consultivo de homologação.",
      faq: [{ q: "O desconto é permitido?", a: "Até 5% somente para pagamento à vista." }],
    },
    knowledge: [],
    grounding: {
      catalog: [product],
      faqKnowledge: [{ question: "O desconto é permitido?", answer: "Até 5% somente para pagamento à vista.", type: "commercial" }],
      commercialRules: {
        paymentMethods: "Pix ou cartão, conforme aprovação humana.",
        commercialTerms: "Não confirmar estoque, entrega ou condição fora do cadastro.",
        paymentPolicy: "Até 5% somente para pagamento à vista.",
        installationPolicy: "Instalação básica fictícia incluída; validar antes de ofertar.",
        visitPolicy: null,
        heatingPolicy: null,
        shippingPolicy: "Frete não informado no fixture.",
        includedItemsPolicy: "Instalação básica fictícia.",
      },
      approvedCoachLearnings: [],
      catalogSearch: { status: "matches", products: [product], basis: "focus", focusProductIds: [product.id] },
      catalogScope: { companyId, activeOnly: true },
      activeCoachRules: [],
      quickReplies: [],
    },
  } as unknown as AgentContext;

  const safeHistory = history.slice(-12).map((item) => ({ ...item, text: item.text.slice(0, 1200) }));
  return buildSalesAgentCompletionRequest({
    ctx,
    history: safeHistory.map((item) => ({ ...item, role: item.role === "lead" ? "lead" : "agent" as const })),
    leadName: "Cliente Fictício",
    model,
    catalogSearch: { status: "matches", products: [product], basis: "focus", focusProductIds: [product.id] },
    priceComparison: { catalog: [product], attributeMatches: [product] },
    interpretation: { intent: "product_inquiry", attributes: {}, references: { lastLeadText: safeHistory.at(-1)?.text ?? "", productIds: [product.id] } },
    customerContext: { stage: "discovery", lastNextAction: "propose_next_step", needs: ["validar produto e condição"], preferences: [], objections: [], buyingSignals: [], presentedProductIds: [product.id] },
    memoryStatus: "found",
  });
}

export const BRUNA_HOMOLOGATION_CURRENT_DECISION: AgentDecision = {
  kind: "reply",
  next_action: null,
  sales_plan: null,
  suggested_products: [],
};
