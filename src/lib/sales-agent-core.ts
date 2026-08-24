import {
  normalizeState,
  normalizeTiming,
  type CustomerStage,
  type PurchaseTiming,
} from "./ai-qualifier.server";

export type SalesAgentGroundingSource =
  | "catalog"
  | "faq_knowledge"
  | "commercial_rules"
  | "coach_learnings";

export interface AgentSettings {
  company_id: string;
  ai_auto_reply_enabled: boolean;
  ai_after_hours_only: boolean;
  ai_initial_message: string | null;
  ai_max_auto_replies: number;
  ai_handoff_timeout_minutes: number;
  ai_agent_name: string;
  business_hours_start: string;
  business_hours_end: string;
}

export interface SalesAgentGrounding {
  catalog: Array<{
    id: string;
    name: string;
    model?: string | null;
    sku?: string | null;
    category: string | null;
    description: string | null;
    lengthM?: number | null;
    widthM?: number | null;
    depthM?: number | null;
    capacityL?: number | null;
    shape?: string | null;
    specifications?: unknown;
    includedItems?: string[];
    variants?: unknown[];
    price: number | null;
    promoPrice: number | null;
    images: string[];
    notes: string | null;
  }>;
  faqKnowledge: Array<{ question: string; answer: string; type: string }>;
  commercialRules: {
    paymentMethods: string | null;
    commercialTerms: string | null;
  };
  approvedCoachLearnings: Array<{
    id: string;
    category: string;
    title: string;
    description: string;
    rule: string;
    productRef: string | null;
    positiveExample: string | null;
    negativeExample: string | null;
    priority: number;
    confidence: number;
  }>;
}

export interface AgentContext {
  settings: AgentSettings;
  companyName: string;
  aiProfile: {
    tone: string;
    description: string | null;
    products: string | null;
    payment_methods: string | null;
    avg_lead_time: string | null;
    region: string | null;
    differentials: string | null;
    faq: Array<{ q?: string; a?: string }>;
  } | null;
  products: Array<{
    id: string;
    name: string;
    model?: string | null;
    sku?: string | null;
    category: string | null;
    description: string | null;
    lengthM?: number | null;
    widthM?: number | null;
    depthM?: number | null;
    capacityL?: number | null;
    shape?: string | null;
    specifications?: unknown;
    includedItems?: string[];
    variants?: unknown[];
    price: number | null;
    promoPrice: number | null;
    images: string[];
    notes: string | null;
  }>;
  knowledge: Array<{ question: string; answer: string; type: string }>;
  grounding: SalesAgentGrounding;
}

export interface AgentDecision {
  kind: "reply" | "handoff" | "skip";
  message?: string;
  reason?: string;
  detected_city?: string | null;
  detected_state?: string | null;
  detected_pool_size?: string | null;
  detected_intent?: string | null;
  detected_interest?: string | null;
  detected_budget?: string | null;
  purchase_timing?: PurchaseTiming | null;
  customer_stage?: CustomerStage | null;
  suggested_products?: string[];
  product_image_ids?: string[];
  grounding_sources?: SalesAgentGroundingSource[];
  learning_ids_used?: string[];
}

export interface SalesAgentCoreInput {
  ctx: AgentContext;
  history: Array<{ role: "lead" | "agent" | "system"; text: string }>;
  leadName: string | null;
  model: string;
}

export interface SalesAgentCompletionRequest {
  model: string;
  reasoning_effort?: "none";
  messages: Array<{ role: "system" | "user"; content: string }>;
  tools: Array<Record<string, unknown>>;
  tool_choice: "auto";
}

export interface SalesAgentCompletionResponse {
  choices?: Array<{
    message?: { tool_calls?: Array<{ function?: { name?: string; arguments?: string } }> };
  }>;
}

export type SalesAgentCompletion = (
  request: SalesAgentCompletionRequest,
) => Promise<{ ok: true; data: SalesAgentCompletionResponse } | { ok: false; reason: string }>;

interface ToolReply {
  message: string;
  detected_city?: string;
  detected_state?: string;
  detected_pool_size?: string;
  detected_intent?: string;
  detected_interest?: string;
  detected_budget?: string;
  purchase_timing?: string;
  customer_stage?: string;
  suggest_products?: string[];
  send_product_images?: string[];
}

interface ToolHandoff {
  reason: string;
}

export function customerAskedForProductImages(history: SalesAgentCoreInput["history"]): boolean {
  const lastLeadMessage = [...history].reverse().find((message) => message.role === "lead")?.text;
  if (!lastLeadMessage) return false;
  return /\b(foto(?:s)?|imagen(?:s)?|imagem|ver\s+(?:os\s+)?modelos?|mostr\w*\s+(?:os\s+)?modelos?)\b/i.test(
    lastLeadMessage,
  );
}

export function customerAskedAboutProducts(history: SalesAgentCoreInput["history"]): boolean {
  const lastLeadMessage = [...history].reverse().find((message) => message.role === "lead")?.text;
  if (!lastLeadMessage) return false;
  return /\b(produto|catálogo|modelo|sku|piscina|fibra|vinil|spa|banheira|aquecedor|acessório|comprimento|largura|profundidade|litros?|capacidade|formato|quadrad[ao]|retangular|redond[ao]|oval|cor|variante|\d{1,2}\s*(?:m|metros?))\b/i.test(
    lastLeadMessage,
  );
}

function messageClaimsProductReference(message: string): boolean {
  return /\bmodelo\s+[\p{L}\d]|\bproduto\s+[\p{L}\d]|\bpiscina\s+(?:de\s+)?(?:fibra|vinil|\d)/iu.test(
    message,
  );
}

export function buildValidatedCatalogReply(products: SalesAgentGrounding["catalog"]): string {
  const items = products.map((product) => {
    const specificationFacts =
      product.specifications && typeof product.specifications === "object"
        ? Object.entries(product.specifications as Record<string, unknown>)
            .map(([key, value]) => `${key}: ${String(value)}`)
            .join(", ")
        : "";
    const variantFacts = (product.variants ?? [])
      .flatMap((variant) => {
        if (!variant || typeof variant !== "object") return [];
        const row = variant as Record<string, unknown>;
        const values = [row.name, row.color].filter(
          (value): value is string => typeof value === "string" && value.trim().length > 0,
        );
        return values.length > 0 ? [values.join("/")] : [];
      })
      .join(", ");
    const facts = [
      product.model ? `modelo ${product.model}` : null,
      product.sku ? `SKU ${product.sku}` : null,
      product.category ? `categoria ${product.category}` : null,
      product.lengthM != null || product.widthM != null || product.depthM != null
        ? `dimensões ${[product.lengthM, product.widthM, product.depthM]
            .filter((value) => value != null)
            .join(" x ")} m`
        : null,
      product.capacityL != null ? `capacidade ${product.capacityL} L` : null,
      product.shape ? `formato ${product.shape}` : null,
      product.description || null,
      product.includedItems?.length ? `itens inclusos: ${product.includedItems.join(", ")}` : null,
      specificationFacts ? `especificações: ${specificationFacts}` : null,
      variantFacts ? `variantes/cores: ${variantFacts}` : null,
      product.notes ? `observações: ${product.notes}` : null,
    ].filter((fact): fact is string => Boolean(fact));
    return `${product.name}${facts.length ? ` — ${facts.join("; ")}` : ""}.`;
  });
  return `Encontrei no catálogo: ${items.join(" ")}`;
}

function formatPrice(price: number | null): string {
  if (price == null) return "preço não cadastrado";
  const amount = new Intl.NumberFormat("pt-BR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(price);
  return `R$ ${amount}`;
}

export function getSalesAgentGroundingSources(ctx: AgentContext): SalesAgentGroundingSource[] {
  const sources: SalesAgentGroundingSource[] = [];
  if (ctx.grounding.catalog.length > 0 || ctx.products.length > 0) sources.push("catalog");
  if (ctx.grounding.faqKnowledge.length > 0 || ctx.knowledge.length > 0) {
    sources.push("faq_knowledge");
  }
  if (
    ctx.grounding.commercialRules.paymentMethods ||
    ctx.grounding.commercialRules.commercialTerms
  ) {
    sources.push("commercial_rules");
  }
  if (ctx.grounding.approvedCoachLearnings.length > 0) sources.push("coach_learnings");
  return sources;
}

export function buildSalesAgentSystemPrompt(ctx: AgentContext): string {
  const ai = ctx.aiProfile;
  const usesGroundedCatalog = ctx.grounding.catalog.length > 0;
  const groundedProducts = usesGroundedCatalog ? ctx.grounding.catalog : ctx.products;
  const groundedKnowledge =
    ctx.grounding.faqKnowledge.length > 0 ? ctx.grounding.faqKnowledge : ctx.knowledge;
  const productLines = groundedProducts
    .map((p, i) => {
      const parts = [`${i + 1}. ${p.name} (ID: ${p.id})`];
      if (p.model) parts.push(`   Modelo: ${p.model}`);
      if (p.sku) parts.push(`   SKU: ${p.sku}`);
      if (p.category) parts.push(`   Categoria: ${p.category}`);
      if (p.lengthM != null) parts.push(`   Comprimento: ${p.lengthM} m`);
      if (p.widthM != null) parts.push(`   Largura: ${p.widthM} m`);
      if (p.depthM != null) parts.push(`   Profundidade: ${p.depthM} m`);
      if (p.capacityL != null) parts.push(`   Capacidade: ${p.capacityL} L`);
      if (p.shape) parts.push(`   Formato real: ${p.shape}`);
      if (p.description) parts.push(`   ${p.description}`);
      if (usesGroundedCatalog) {
        parts.push(`   Preço cadastrado: ${formatPrice(p.price)}`);
        if (p.promoPrice != null) {
          parts.push(`   Preço promocional cadastrado: ${formatPrice(p.promoPrice)}`);
        }
      }
      if (p.notes) parts.push(`   Inclusos: ${p.notes}`);
      if (p.includedItems?.length) {
        parts.push(`   Itens inclusos: ${p.includedItems.join(", ")}`);
      }
      if (
        p.specifications &&
        typeof p.specifications === "object" &&
        Object.keys(p.specifications).length > 0
      ) {
        parts.push(`   Especificações: ${JSON.stringify(p.specifications)}`);
      }
      if (p.variants?.length) parts.push(`   Variantes/cores: ${JSON.stringify(p.variants)}`);
      if (p.images.length > 0) parts.push(`   Fotos cadastradas: ${p.images.length}`);
      return parts.join("\n");
    })
    .join("\n");
  const kbLines = groundedKnowledge
    .map((k, i) => `${i + 1}. ${k.question} → ${k.answer}`)
    .join("\n");
  const faqLines = (ai?.faq ?? [])
    .filter((f) => f.q && f.a)
    .map((f, i) => `${i + 1}. ${f.q} → ${f.a}`)
    .join("\n");
  const commercialLines = [
    ctx.grounding.commercialRules.paymentMethods
      ? `- Formas de pagamento: ${ctx.grounding.commercialRules.paymentMethods}`
      : null,
    ctx.grounding.commercialRules.commercialTerms
      ? `- Condições cadastradas: ${ctx.grounding.commercialRules.commercialTerms}`
      : null,
  ]
    .filter((line): line is string => Boolean(line))
    .join("\n");
  const learningLines = ctx.grounding.approvedCoachLearnings
    .map((learning, i) => {
      return `${i + 1}. ${learning.title}: ${learning.rule}`;
    })
    .join("\n");
  const groundingSections = [
    commercialLines
      ? `REGRAS COMERCIAIS CADASTRADAS (somente informe; nunca negocie nem crie condições):\n${commercialLines}`
      : null,
    learningLines
      ? `APRENDIZADOS ATIVOS DO COACH (somente orientação de comportamento comercial; nomes, modelos, medidas, preços, descrições, categorias e exemplos de produto contidos em aprendizados NÃO são fatos e devem ser ignorados):\n${learningLines}`
      : null,
  ]
    .filter((section): section is string => Boolean(section))
    .join("\n\n");

  return `Você é "${ctx.settings.ai_agent_name}", pré-atendente automático da empresa "${ctx.companyName}".
Você atende clientes via WhatsApp/Instagram FORA do horário comercial enquanto o vendedor humano não chega.

REGRAS INVIOLÁVEIS (se violar, peça handoff imediato):
- NUNCA negocie desconto, preço, parcelamento ou condição comercial.
- NUNCA prometa prazo de instalação ou entrega.
- NUNCA invente informação que não esteja no contexto abaixo.
- NUNCA feche venda sozinho — apenas qualifique o lead.
- Se o cliente pedir qualquer item acima, chame request_human_handoff.

CONTEXTO DA EMPRESA:
- Tom: ${ai?.tone ?? "comercial"}
- Descrição: ${ai?.description ?? "—"}
- Região atendida: ${ai?.region ?? "—"}
- Diferenciais: ${ai?.differentials ?? "—"}
- Pagamento (apenas mencionar formas, sem negociar): ${ai?.payment_methods ?? "—"}

CATÁLOGO (use apenas estes produtos):
${productLines || "(catálogo vazio)"}

REGRA DE REFERÊNCIA DE PRODUTO:
- Todo produto mencionado na resposta deve estar no CATÁLOGO acima e também ter seu ID incluído em suggest_products.
- Nunca use FAQ, histórico ou aprendizados como fonte de nome, modelo, medida, preço ou especificação de produto.
- Se o produto ou especificação pedida não estiver no catálogo, não proponha alternativa inventada: solicite atendimento humano.
- Em piscinas, "quadrada" pode representar intenção por linhas retas. Quando o catálogo relevante trouxer apenas um produto reto/retangular como aproximação, descreva sempre o formato real cadastrado e nunca o chame de quadrado.

FAQ:
${faqLines || "(sem faq cadastrado)"}

BASE DE CONHECIMENTO APROVADA:
${kbLines || "(vazia)"}${groundingSections ? `\n\n${groundingSections}` : ""}

SUA MISSÃO:
1. Cumprimentar e identificar: cidade da instalação + tamanho/medida da piscina + interesse principal.
2. Quando tiver os dados, sugerir produtos compatíveis do catálogo.
3. Responder dúvidas básicas (inclusos/por conta, dimensões) usando catálogo + KB.
4. Se faltar dado ou pergunta sair do escopo → request_human_handoff com lowConfidence=true.
5. Somente quando o cliente pedir explicitamente para ver fotos, imagens ou modelos, preencha send_product_images com os IDs dos produtos adequados do catálogo. Nunca invente IDs ou URLs e selecione no máximo 5 produtos.

Sempre retorne via tool call (respond_to_customer OU request_human_handoff). Texto deve ser pt-BR, máx 4 frases, humano e sem clichês.`;
}

export function buildSalesAgentCompletionRequest(
  params: SalesAgentCoreInput,
): SalesAgentCompletionRequest {
  const catalogProducts =
    params.ctx.grounding.catalog.length > 0 ? params.ctx.grounding.catalog : params.ctx.products;
  const transcript = params.history
    .slice(-20)
    .map(
      (m) =>
        `${m.role === "lead" ? "Cliente" : m.role === "agent" ? "Atendente" : "Sistema"}: ${m.text}`,
    )
    .join("\n");

  return {
    model: params.model,
    ...(params.model.split("/").at(-1) === "gpt-5.6-luna"
      ? { reasoning_effort: "none" as const }
      : {}),
    messages: [
      { role: "system", content: buildSalesAgentSystemPrompt(params.ctx) },
      {
        role: "user",
        content: `Lead: ${params.leadName ?? "—"}\n\nConversa até agora:\n${transcript}\n\nResponda agora.`,
      },
    ],
    tools: [
      {
        type: "function",
        function: {
          name: "respond_to_customer",
          description:
            "Enviar mensagem ao cliente. Sempre que possível extraia também os campos de qualificação observados na conversa (cidade, estado, medida desejada, tipo de cliente, etc.).",
          parameters: {
            type: "object",
            properties: {
              message: {
                type: "string",
                description: "Texto enviado ao cliente (pt-BR, máx 4 frases).",
              },
              detected_city: { type: "string", description: "Cidade da instalação." },
              detected_state: { type: "string", description: "Estado/UF (ex.: SP, RJ)." },
              detected_pool_size: { type: "string", description: "Medida/tamanho da piscina." },
              detected_intent: {
                type: "string",
                description: "Intenção principal (informação, orçamento, instalação, etc.).",
              },
              detected_interest: {
                type: "string",
                description: "Interesse específico (piscina fibra, aquecimento, lona, manutenção).",
              },
              detected_budget: {
                type: "string",
                description: "Orçamento aproximado mencionado pelo cliente (ex.: 'até 20 mil').",
              },
              purchase_timing: {
                type: "string",
                enum: ["imediato", "30d", "60d", "90d+", "indefinido"],
                description: "Quando o cliente pretende comprar.",
              },
              customer_stage: {
                type: "string",
                enum: ["curioso", "pesquisando", "pronto_para_comprar"],
                description: "Em que estágio o cliente está.",
              },
              suggest_products: {
                type: "array",
                items: {
                  type: "string",
                  enum: catalogProducts.map((product) => product.id),
                },
                maxItems: 5,
                description: "IDs exatos de produtos existentes no catálogo fornecido.",
              },
              send_product_images: {
                type: "array",
                items: { type: "string" },
                maxItems: 5,
                description:
                  "IDs de atÃ© 5 produtos do catÃ¡logo cujas fotos foram pedidas explicitamente pelo cliente. Nunca envie URLs.",
              },
            },
            required: ["message"],
            additionalProperties: false,
          },
        },
      },
      {
        type: "function",
        function: {
          name: "request_human_handoff",
          description: "Parar IA e marcar conversa para humano.",
          parameters: {
            type: "object",
            properties: { reason: { type: "string" } },
            required: ["reason"],
            additionalProperties: false,
          },
        },
      },
    ],
    tool_choice: "auto",
  };
}

export class SalesAgentCore {
  constructor(private readonly complete: SalesAgentCompletion) {}

  async decide(params: SalesAgentCoreInput): Promise<AgentDecision> {
    const groundingSources = getSalesAgentGroundingSources(params.ctx);
    const learningIdsUsed = params.ctx.grounding.approvedCoachLearnings.map(
      (learning) => learning.id,
    );
    if (params.ctx.grounding.catalog.length === 0 && customerAskedAboutProducts(params.history)) {
      return {
        kind: "handoff",
        reason: "catalog_product_not_found",
        grounding_sources: groundingSources,
        learning_ids_used: learningIdsUsed,
      };
    }
    const completion = await this.complete(buildSalesAgentCompletionRequest(params));
    if (!completion.ok) {
      return {
        kind: "handoff",
        reason: completion.reason,
        grounding_sources: groundingSources,
        learning_ids_used: learningIdsUsed,
      };
    }
    const data = completion.data;
    const call = data.choices?.[0]?.message?.tool_calls?.[0]?.function;
    if (!call?.name || !call.arguments) {
      return {
        kind: "handoff",
        reason: "no_tool_call",
        grounding_sources: groundingSources,
        learning_ids_used: learningIdsUsed,
      };
    }

    let args: ToolReply | ToolHandoff;
    try {
      args = JSON.parse(call.arguments);
    } catch {
      return {
        kind: "handoff",
        reason: "tool_args_parse_fail",
        grounding_sources: groundingSources,
        learning_ids_used: learningIdsUsed,
      };
    }

    if (call.name === "request_human_handoff") {
      return {
        kind: "handoff",
        reason: (args as ToolHandoff).reason || "model_requested",
        grounding_sources: groundingSources,
        learning_ids_used: learningIdsUsed,
      };
    }
    const reply = args as ToolReply;
    if (!reply.message) {
      return {
        kind: "handoff",
        reason: "empty_message",
        grounding_sources: groundingSources,
        learning_ids_used: learningIdsUsed,
      };
    }
    const catalogIds = new Set(params.ctx.grounding.catalog.map((product) => product.id));
    const catalogById = new Map(
      params.ctx.grounding.catalog.map((product) => [product.id, product]),
    );
    const modelSuggestions = Array.isArray(reply.suggest_products)
      ? reply.suggest_products.filter((id): id is string => typeof id === "string")
      : [];
    const requestedSuggestions =
      modelSuggestions.length === 0 &&
      customerAskedAboutProducts(params.history) &&
      params.ctx.grounding.catalog.length === 1
        ? [params.ctx.grounding.catalog[0].id]
        : modelSuggestions;
    const requestedImages = Array.isArray(reply.send_product_images)
      ? reply.send_product_images.filter((id): id is string => typeof id === "string")
      : [];
    if (
      requestedSuggestions.some((id) => !catalogIds.has(id)) ||
      requestedImages.some((id) => !catalogIds.has(id))
    ) {
      return {
        kind: "handoff",
        reason: "catalog_invalid_product_reference",
        grounding_sources: groundingSources,
        learning_ids_used: learningIdsUsed,
      };
    }
    if (messageClaimsProductReference(reply.message) && requestedSuggestions.length === 0) {
      return {
        kind: "handoff",
        reason: "catalog_unvalidated_product_claim",
        grounding_sources: groundingSources,
        learning_ids_used: learningIdsUsed,
      };
    }
    const stageRaw = reply.customer_stage?.toLowerCase().trim();
    const stage: CustomerStage | null =
      stageRaw === "curioso" || stageRaw === "pesquisando" || stageRaw === "pronto_para_comprar"
        ? stageRaw
        : null;
    return {
      kind: "reply",
      message:
        requestedSuggestions.length > 0
          ? buildValidatedCatalogReply(
              requestedSuggestions.flatMap((id) => {
                const product = catalogById.get(id);
                return product ? [product] : [];
              }),
            )
          : reply.message,
      detected_city: reply.detected_city ?? null,
      detected_state: normalizeState(reply.detected_state) ?? reply.detected_state ?? null,
      detected_pool_size: reply.detected_pool_size ?? null,
      detected_intent: reply.detected_intent ?? null,
      detected_interest: reply.detected_interest ?? null,
      detected_budget: reply.detected_budget ?? null,
      purchase_timing: normalizeTiming(reply.purchase_timing) ?? null,
      customer_stage: stage,
      suggested_products: requestedSuggestions,
      product_image_ids: customerAskedForProductImages(params.history) ? requestedImages : [],
      grounding_sources: groundingSources,
      learning_ids_used: learningIdsUsed,
    };
  }
}
