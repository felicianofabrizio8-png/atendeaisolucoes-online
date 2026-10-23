import type { AgentContext, AgentSettings, SalesAgentGrounding } from "../../sales-agent-core";
import type { ConversationSalesState } from "../../conversation-sales-state";
import type { FollowupSettings } from "../../followup/types";

export const SYNTHETIC_COMPANIES = {
  pools: "tenant-sintetico-piscinas",
  furniture: "tenant-sintetico-moveis",
} as const;

export const syntheticCatalog: SalesAgentGrounding["catalog"] = [
  {
    id: "10000000-0000-4000-8000-000000000001",
    name: "Modelo Horizonte 6x3",
    model: "H6",
    sku: "SYN-H6",
    category: "Piscinas",
    description: "Modelo retangular para área residencial.",
    lengthM: 6,
    widthM: 3,
    depthM: 1.4,
    price: 24000,
    promoPrice: 22900,
    images: [`${SYNTHETIC_COMPANIES.pools}/modelo-h6.jpg`],
    notes: "Instalação sob consulta.",
    shape: "retangular",
    includedItems: ["filtro"],
    specifications: { garantia: "12 meses" },
    variants: [{ name: "Azul" }],
  },
  {
    id: "10000000-0000-4000-8000-000000000002",
    name: "Modelo Horizonte 5x2,4",
    model: "H5",
    sku: "SYN-H5",
    category: "Piscinas",
    description: "Modelo compacto para áreas menores.",
    lengthM: 5,
    widthM: 2.4,
    depthM: 1.3,
    price: 20000,
    promoPrice: null,
    images: [`${SYNTHETIC_COMPANIES.pools}/modelo-h5.jpg`],
    notes: null,
    shape: "retangular",
  },
  {
    id: "20000000-0000-4000-8000-000000000001",
    name: "Mesa Modular 160",
    model: "MM160",
    sku: "SYN-MM160",
    category: "Móveis",
    description: "Mesa modular para escritório.",
    lengthM: null,
    widthM: null,
    depthM: null,
    price: 1800,
    promoPrice: null,
    images: [`${SYNTHETIC_COMPANIES.furniture}/mesa-mm160.jpg`],
    notes: null,
    shape: null,
  },
];

export const syntheticGrounding: SalesAgentGrounding = {
  catalog: syntheticCatalog,
  catalogSearch: { status: "matches", products: syntheticCatalog },
  catalogScope: { companyId: SYNTHETIC_COMPANIES.pools, activeOnly: true },
  faqKnowledge: [
    { question: "Qual o prazo?", answer: "Prazo informado após validar a instalação.", type: "faq" },
  ],
  commercialRules: {
    paymentMethods: "Pix ou cartão.",
    commercialTerms: "Entrada de 30% cadastrada; saldo na instalação.",
    paymentPolicy: "Pix ou cartão conforme análise.",
    installationPolicy: "Instalação avaliada por região.",
    nextLoadForecast: null,
    visitPolicy: "Visita mediante agendamento.",
    heatingPolicy: null,
    shippingPolicy: "Frete calculado por região.",
    includedItemsPolicy: "Filtro incluso no modelo H6.",
  },
  approvedCoachLearnings: [],
};

export const syntheticSettings: AgentSettings = {
  company_id: SYNTHETIC_COMPANIES.pools,
  ai_auto_reply_enabled: true,
  ai_after_hours_only: false,
  ai_initial_message: null,
  ai_max_auto_replies: 5,
  ai_handoff_timeout_minutes: 30,
  ai_agent_name: "Atende Aí",
  business_hours_start: "08:00",
  business_hours_end: "18:00",
};

export const syntheticContext: AgentContext = {
  settings: syntheticSettings,
  companyName: "Empresa Sintética Piscinas",
  aiProfile: {
    tone: "consultivo",
    description: "Atendimento sintético para teste.",
    products: "Piscinas residenciais.",
    payment_methods: "Pix ou cartão.",
    avg_lead_time: "A confirmar.",
    region: "Região sintética",
    differentials: "Catálogo validado.",
    faq: [],
  },
  products: syntheticCatalog,
  catalogForValidation: syntheticCatalog,
  knowledge: [],
  grounding: syntheticGrounding,
};

export const syntheticConversationState: ConversationSalesState = {
  productIds: [syntheticCatalog[0].id, "produto-inexistente"],
  attributes: { spaceLengthM: 8, spaceWidthM: 5, shape: "retangular" },
  intent: "product_inquiry",
  lastValidProductIds: [syntheticCatalog[0].id, "produto-inexistente"],
  lastCatalogQuery: {
    status: "matches",
    criteria: { lengthM: 6, widthM: 3 },
    referencedProductIds: [syntheticCatalog[0].id, "produto-inexistente"],
    subject: "product",
    productReferenceKind: "explicit",
    confirmation: "none",
    confidence: 1.4,
  },
};

export const syntheticFollowupSettings: FollowupSettings = {
  enabled: true,
  maxPerLead: 2,
  minHoursBetween: 24,
  quoteDelayHours: 24,
  silenceDelayHours: 48,
  visitDelayHours: 24,
  hotDelayHours: 4,
  businessHoursOnly: true,
  businessHoursStart: "08:00",
  businessHoursEnd: "18:00",
  timeZone: "America/Sao_Paulo",
  businessDays: [1, 2, 3, 4, 5, 6, 7],
  tone: "consultivo",
  templates: {
    quote_no_reply: "Olá {{nome}}, seu orçamento continua disponível.",
    lead_silent: "Olá {{nome}}, posso ajudar com o projeto?",
    visit_no_return: "Olá {{nome}}, podemos retomar a visita?",
    hot_lead_idle: "Olá {{nome}}, posso esclarecer algo agora?",
    returning_customer: "Olá {{nome}}, deseja retomar o atendimento?",
  },
  initialMessage: null,
  agentName: "Atende Aí",
};
