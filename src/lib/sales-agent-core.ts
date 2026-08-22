import {
  normalizeState,
  normalizeTiming,
  type CustomerStage,
  type PurchaseTiming,
} from "./ai-qualifier.server";

export const SALES_AGENT_MODEL = "google/gemini-2.5-flash";

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
    description: string | null;
    price: number | null;
    images: string[];
    notes: string | null;
  }>;
  knowledge: Array<{ question: string; answer: string; type: string }>;
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
}

export interface SalesAgentCoreInput {
  ctx: AgentContext;
  history: Array<{ role: "lead" | "agent" | "system"; text: string }>;
  leadName: string | null;
}

export interface SalesAgentCompletionRequest {
  model: string;
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
}

interface ToolHandoff {
  reason: string;
}

export function buildSalesAgentSystemPrompt(ctx: AgentContext): string {
  const ai = ctx.aiProfile;
  const productLines = ctx.products
    .map((p, i) => {
      const parts = [`${i + 1}. ${p.name}`];
      if (p.description) parts.push(`   ${p.description}`);
      if (p.notes) parts.push(`   Inclusos: ${p.notes}`);
      return parts.join("\n");
    })
    .join("\n");
  const kbLines = ctx.knowledge.map((k, i) => `${i + 1}. ${k.question} → ${k.answer}`).join("\n");
  const faqLines = (ai?.faq ?? [])
    .filter((f) => f.q && f.a)
    .map((f, i) => `${i + 1}. ${f.q} → ${f.a}`)
    .join("\n");

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

FAQ:
${faqLines || "(sem faq cadastrado)"}

BASE DE CONHECIMENTO APROVADA:
${kbLines || "(vazia)"}

SUA MISSÃO:
1. Cumprimentar e identificar: cidade da instalação + tamanho/medida da piscina + interesse principal.
2. Quando tiver os dados, sugerir produtos compatíveis do catálogo.
3. Responder dúvidas básicas (inclusos/por conta, dimensões) usando catálogo + KB.
4. Se faltar dado ou pergunta sair do escopo → request_human_handoff com lowConfidence=true.

Sempre retorne via tool call (respond_to_customer OU request_human_handoff). Texto deve ser pt-BR, máx 4 frases, humano e sem clichês.`;
}

export function buildSalesAgentCompletionRequest(
  params: SalesAgentCoreInput,
): SalesAgentCompletionRequest {
  const transcript = params.history
    .slice(-20)
    .map(
      (m) =>
        `${m.role === "lead" ? "Cliente" : m.role === "agent" ? "Atendente" : "Sistema"}: ${m.text}`,
    )
    .join("\n");

  return {
    model: SALES_AGENT_MODEL,
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
              suggest_products: { type: "array", items: { type: "string" } },
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
    const completion = await this.complete(buildSalesAgentCompletionRequest(params));
    if (!completion.ok) return { kind: "handoff", reason: completion.reason };
    const data = completion.data;
    const call = data.choices?.[0]?.message?.tool_calls?.[0]?.function;
    if (!call?.name || !call.arguments) return { kind: "handoff", reason: "no_tool_call" };

    let args: ToolReply | ToolHandoff;
    try {
      args = JSON.parse(call.arguments);
    } catch {
      return { kind: "handoff", reason: "tool_args_parse_fail" };
    }

    if (call.name === "request_human_handoff") {
      return { kind: "handoff", reason: (args as ToolHandoff).reason || "model_requested" };
    }
    const reply = args as ToolReply;
    if (!reply.message) return { kind: "handoff", reason: "empty_message" };
    const stageRaw = reply.customer_stage?.toLowerCase().trim();
    const stage: CustomerStage | null =
      stageRaw === "curioso" || stageRaw === "pesquisando" || stageRaw === "pronto_para_comprar"
        ? stageRaw
        : null;
    return {
      kind: "reply",
      message: reply.message,
      detected_city: reply.detected_city ?? null,
      detected_state: normalizeState(reply.detected_state) ?? reply.detected_state ?? null,
      detected_pool_size: reply.detected_pool_size ?? null,
      detected_intent: reply.detected_intent ?? null,
      detected_interest: reply.detected_interest ?? null,
      detected_budget: reply.detected_budget ?? null,
      purchase_timing: normalizeTiming(reply.purchase_timing) ?? null,
      customer_stage: stage,
      suggested_products: reply.suggest_products ?? [],
    };
  }
}
