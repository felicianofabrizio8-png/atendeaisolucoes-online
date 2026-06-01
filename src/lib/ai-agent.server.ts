// ============================================================================
// AI Agent — Phase 1 engine (server-only, sem alterar meta-send/meta-webhook)
// ============================================================================
// Usado por:
//   - POST /api/public/hooks/agent-trigger  (disparado pelo trigger postgres)
//   - POST /api/ai/agent-tick               (cron + chamadas internas)
// ============================================================================

import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  detectObjections,
  detectReadyToClose,
  normalizeState,
  normalizeTiming,
  computeLeadScore,
  temperatureFromScore,
  mergeObjections,
  type Objection,
  type CustomerStage,
  type PurchaseTiming,
  type Temperature,
} from "./ai-qualifier.server";

const GATEWAY_URL = "https://ai.gateway.lovable.dev/v1/chat/completions";
const MODEL = "google/gemini-2.5-flash";
const DEBOUNCE_MS = 30_000;

// ----------------------------------------------------------------------------
// Tipos
// ----------------------------------------------------------------------------

export interface AgentSettings {
  company_id: string;
  ai_auto_reply_enabled: boolean;
  ai_after_hours_only: boolean;
  ai_initial_message: string | null;
  ai_max_auto_replies: number;
  ai_handoff_timeout_minutes: number;
  ai_agent_name: string;
  business_hours_start: string; // HH:MM:SS
  business_hours_end: string;
}

export interface AgentConversation {
  id: string;
  company_id: string;
  lead_id: string;
  channel: string;
  ai_handling: boolean;
  ai_status: string | null;
  auto_reply_count: number;
  last_auto_reply_at: string | null;
  human_takeover_at: string | null;
}

export interface AgentDecision {
  kind: "reply" | "handoff" | "skip";
  message?: string;
  reason?: string;
  detected_city?: string | null;
  detected_pool_size?: string | null;
  detected_intent?: string | null;
  suggested_products?: string[];
}

export type SkipReason =
  | "disabled"
  | "business_hours"
  | "human_active"
  | "rate_limit"
  | "lock_busy"
  | "no_lead_message"
  | "missing_integration";

// ----------------------------------------------------------------------------
// Logging
// ----------------------------------------------------------------------------

export async function logEvent(
  companyId: string,
  conversationId: string | null,
  leadId: string | null,
  event_type: string,
  payload: Record<string, unknown> = {},
): Promise<void> {
  try {
    await supabaseAdmin.from("ai_flow_events").insert({
      company_id: companyId,
      conversation_id: conversationId,
      lead_id: leadId,
      event_type,
      payload: payload as never,
    });
  } catch (e) {
    console.error("[AI_AGENT_LOG_FAIL]", e);
  }
}

// ----------------------------------------------------------------------------
// Decision guards (puras)
// ----------------------------------------------------------------------------

export function isWithinBusinessHours(s: AgentSettings, now: Date = new Date()): boolean {
  const [sh, sm] = s.business_hours_start.split(":").map(Number);
  const [eh, em] = s.business_hours_end.split(":").map(Number);
  const minsNow = now.getHours() * 60 + now.getMinutes();
  const minsStart = sh * 60 + sm;
  const minsEnd = eh * 60 + em;
  return minsNow >= minsStart && minsNow < minsEnd;
}

export function shouldAutoReply(
  conv: AgentConversation,
  settings: AgentSettings,
  now: Date = new Date(),
): { ok: true } | { ok: false; reason: SkipReason } {
  if (!settings.ai_auto_reply_enabled) return { ok: false, reason: "disabled" };
  if (conv.ai_status === "assumido_humano") return { ok: false, reason: "human_active" };
  if (conv.human_takeover_at) return { ok: false, reason: "human_active" };
  if (settings.ai_after_hours_only && isWithinBusinessHours(settings, now)) {
    return { ok: false, reason: "business_hours" };
  }
  if (conv.auto_reply_count >= settings.ai_max_auto_replies) {
    return { ok: false, reason: "rate_limit" };
  }
  if (conv.last_auto_reply_at) {
    const diff = now.getTime() - new Date(conv.last_auto_reply_at).getTime();
    if (diff < DEBOUNCE_MS) return { ok: false, reason: "rate_limit" };
  }
  return { ok: true };
}

// ----------------------------------------------------------------------------
// Handoff trigger detection (regex + heurística)
// ----------------------------------------------------------------------------

const HANDOFF_PATTERNS: RegExp[] = [
  /\bdesconto\b/i,
  /\babatimento\b/i,
  /\bdescont/i,
  /\bnegoci/i,
  /\bparcel/i,
  /\bbarat/i,
  /\bmenor preço\b/i,
  /\bfechar\b.*\b(hoje|agora|pedido)\b/i,
  /\bfinaliz/i,
  /\bquand?o.*\b(instal|entreg|chega)/i,
  /\bgaranti/i,
  /\breclama/i,
  /\bproblema\b/i,
  /\bquebr/i,
  /\bdefeit/i,
  /\bnota fiscal\b/i,
  /\bcontrato\b/i,
  /\bjurídic/i,
];

export function detectHandoffNeeded(text: string): { needed: boolean; reason?: string } {
  for (const re of HANDOFF_PATTERNS) {
    if (re.test(text)) return { needed: true, reason: re.source };
  }
  return { needed: false };
}

// ----------------------------------------------------------------------------
// Safety layer pós-LLM (vence o LLM)
// ----------------------------------------------------------------------------

const SAFETY_BLOCK_PATTERNS: { pattern: RegExp; reason: string }[] = [
  { pattern: /\bR\$\s*\d/i, reason: "tentou cotar preço" },
  { pattern: /\b\d+\s?%/i, reason: "tentou aplicar percentual/desconto" },
  { pattern: /\bdesconto\b/i, reason: "ofereceu desconto" },
  { pattern: /\bgaranto\b/i, reason: "fez promessa" },
  { pattern: /\bprometo\b/i, reason: "fez promessa" },
  { pattern: /\bfecho\b/i, reason: "tentou fechar venda" },
  { pattern: /\bcondição\s+especial\b/i, reason: "condição comercial nova" },
  { pattern: /\bparcelo\b/i, reason: "negociou parcelamento" },
];

export function runSafetyLayer(decision: AgentDecision): AgentDecision {
  if (decision.kind !== "reply" || !decision.message) return decision;
  for (const { pattern, reason } of SAFETY_BLOCK_PATTERNS) {
    if (pattern.test(decision.message)) {
      return {
        kind: "handoff",
        reason: `safety_block: ${reason}`,
      };
    }
  }
  return decision;
}

// ----------------------------------------------------------------------------
// Context loader
// ----------------------------------------------------------------------------

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

export async function loadAgentContext(companyId: string): Promise<AgentContext | null> {
  const [{ data: settings }, { data: company }, { data: aiProfile }, { data: products }, { data: kb }] =
    await Promise.all([
      supabaseAdmin.from("company_settings").select("*").eq("company_id", companyId).maybeSingle(),
      supabaseAdmin.from("companies").select("name").eq("id", companyId).maybeSingle(),
      supabaseAdmin.from("ai_profiles").select("*").eq("company_id", companyId).maybeSingle(),
      supabaseAdmin
        .from("products")
        .select("id, name, description, price, images, notes")
        .eq("company_id", companyId)
        .eq("active", true)
        .limit(10),
      supabaseAdmin
        .from("ai_knowledge_proposals")
        .select("question, answer, type")
        .eq("company_id", companyId)
        .eq("status", "approved")
        .order("created_at", { ascending: false })
        .limit(20),
    ]);
  if (!settings) return null;
  return {
    settings: settings as AgentSettings,
    companyName: company?.name ?? "—",
    aiProfile: aiProfile
      ? {
          tone: (aiProfile as { tone?: string }).tone ?? "comercial",
          description: (aiProfile as { description?: string | null }).description ?? null,
          products: (aiProfile as { products?: string | null }).products ?? null,
          payment_methods: (aiProfile as { payment_methods?: string | null }).payment_methods ?? null,
          avg_lead_time: (aiProfile as { avg_lead_time?: string | null }).avg_lead_time ?? null,
          region: (aiProfile as { region?: string | null }).region ?? null,
          differentials: (aiProfile as { differentials?: string | null }).differentials ?? null,
          faq: Array.isArray((aiProfile as { faq?: unknown }).faq)
            ? ((aiProfile as { faq: Array<{ q?: string; a?: string }> }).faq ?? [])
            : [],
        }
      : null,
    products: (products ?? []).map((p) => {
      const imgs = Array.isArray(p.images) ? (p.images as unknown[]).filter((x): x is string => typeof x === "string") : [];
      return {
        id: p.id,
        name: p.name,
        description: p.description,
        price: p.price as number | null,
        images: imgs,
        notes: p.notes,
      };
    }),
    knowledge: kb ?? [],
  };
}

// ----------------------------------------------------------------------------
// Prompt builder (curto, baseado em dados)
// ----------------------------------------------------------------------------

function buildSystemPrompt(ctx: AgentContext): string {
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

// ----------------------------------------------------------------------------
// LLM call com tool-calling estruturado
// ----------------------------------------------------------------------------

interface ToolReply {
  message: string;
  detected_city?: string;
  detected_pool_size?: string;
  detected_intent?: string;
  suggest_products?: string[];
}
interface ToolHandoff {
  reason: string;
}

export async function runAgentTurn(params: {
  ctx: AgentContext;
  history: Array<{ role: "lead" | "agent" | "system"; text: string }>;
  leadName: string | null;
}): Promise<AgentDecision> {
  const apiKey = process.env.LOVABLE_API_KEY;
  if (!apiKey) return { kind: "handoff", reason: "missing_api_key" };

  const systemPrompt = buildSystemPrompt(params.ctx);
  const transcript = params.history
    .slice(-20)
    .map((m) => `${m.role === "lead" ? "Cliente" : m.role === "agent" ? "Atendente" : "Sistema"}: ${m.text}`)
    .join("\n");

  const payload = {
    model: MODEL,
    messages: [
      { role: "system", content: systemPrompt },
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
          description: "Enviar mensagem ao cliente.",
          parameters: {
            type: "object",
            properties: {
              message: { type: "string" },
              detected_city: { type: "string" },
              detected_pool_size: { type: "string" },
              detected_intent: { type: "string" },
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
    tool_choice: "auto" as const,
  };

  let res: Response;
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 20_000);
    res = await fetch(GATEWAY_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: ctrl.signal,
    });
    clearTimeout(t);
  } catch (e) {
    console.error("[AGENT_GATEWAY_NETWORK]", e);
    return { kind: "handoff", reason: "gateway_network_fail" };
  }
  if (!res.ok) {
    console.error("[AGENT_GATEWAY_HTTP]", res.status);
    return { kind: "handoff", reason: `gateway_http_${res.status}` };
  }
  const data = (await res.json()) as {
    choices?: Array<{ message?: { tool_calls?: Array<{ function?: { name?: string; arguments?: string } }> } }>;
  };
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
  return {
    kind: "reply",
    message: reply.message,
    detected_city: reply.detected_city ?? null,
    detected_pool_size: reply.detected_pool_size ?? null,
    detected_intent: reply.detected_intent ?? null,
    suggested_products: reply.suggest_products ?? [],
  };
}

// ----------------------------------------------------------------------------
// WhatsApp Cloud API sender (direto, sem alterar meta-send)
// ----------------------------------------------------------------------------

export async function sendWhatsappText(params: {
  companyId: string;
  conversationId: string;
  leadId: string;
  text: string;
}): Promise<{ ok: true; externalId: string | null } | { ok: false; error: string }> {
  const { data: lead } = await supabaseAdmin
    .from("leads")
    .select("phone, external_id, integration_id, channel")
    .eq("id", params.leadId)
    .maybeSingle();
  if (!lead) return { ok: false, error: "lead não encontrado" };

  const recipient = String(lead.external_id ?? lead.phone ?? "").replace(/\D/g, "");
  if (recipient.length < 8 || recipient.length > 15) return { ok: false, error: "telefone inválido" };

  const integrationQuery = supabaseAdmin
    .from("integrations")
    .select("id, access_token, external_account_id")
    .eq("company_id", params.companyId)
    .eq("channel", "whatsapp")
    .eq("active", true);
  const { data: integration } = lead.integration_id
    ? await integrationQuery.eq("id", lead.integration_id).maybeSingle()
    : await integrationQuery.limit(1).maybeSingle();

  const accessTok =
    integration?.access_token ||
    process.env.WHATSAPP_ACCESS_TOKEN ||
    process.env.WHATSAPP_API_KEY ||
    "";
  const phoneNumberId =
    integration?.external_account_id || process.env.WHATSAPP_PHONE_NUMBER_ID || "";
  if (!accessTok || !phoneNumberId) return { ok: false, error: "WhatsApp não conectado" };

  const apiUrl = `https://graph.facebook.com/v20.0/${phoneNumberId}/messages`;
  let res: Response;
  try {
    res = await fetch(apiUrl, {
      method: "POST",
      headers: { Authorization: `Bearer ${accessTok}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to: recipient,
        type: "text",
        text: { body: params.text },
      }),
    });
  } catch (e) {
    return { ok: false, error: `network: ${e instanceof Error ? e.message : "erro"}` };
  }
  const raw = await res.text();
  let parsed: { messages?: Array<{ id: string }>; error?: { message?: string } } = {};
  try {
    parsed = JSON.parse(raw);
  } catch {
    /* */
  }
  if (!res.ok) {
    console.error("[AGENT_WHATSAPP_HTTP]", res.status, raw.slice(0, 500));
    return { ok: false, error: parsed.error?.message ?? `HTTP ${res.status}` };
  }
  const externalId = parsed.messages?.[0]?.id ?? null;

  // Insere mensagem na DB (role=agent, source=ai_agent)
  await supabaseAdmin.from("messages").insert({
    company_id: params.companyId,
    conversation_id: params.conversationId,
    role: "agent",
    text: params.text,
    at: new Date().toISOString(),
    external_id: externalId,
    integration_id: integration?.id ?? null,
    source: "ai_agent",
  });
  await supabaseAdmin
    .from("conversations")
    .update({ last_message_at: new Date().toISOString(), awaiting_reply: false })
    .eq("id", params.conversationId);

  return { ok: true, externalId };
}

// ----------------------------------------------------------------------------
// Tick orquestrador: 1 turno completo
// ----------------------------------------------------------------------------

export async function runAgentTick(conversationId: string): Promise<{
  ok: boolean;
  action: "replied" | "handoff" | "skipped" | "error";
  reason?: string;
}> {
  const { data: conv } = await supabaseAdmin
    .from("conversations")
    .select(
      "id, company_id, lead_id, channel, ai_handling, ai_status, auto_reply_count, last_auto_reply_at, human_takeover_at",
    )
    .eq("id", conversationId)
    .maybeSingle();
  if (!conv) return { ok: false, action: "error", reason: "conversation_not_found" };

  // Atualmente Fase 1 suporta apenas WhatsApp
  if (conv.channel !== "whatsapp") {
    return { ok: true, action: "skipped", reason: "channel_unsupported" };
  }

  const ctx = await loadAgentContext(conv.company_id);
  if (!ctx) return { ok: false, action: "error", reason: "no_settings" };

  const guard = shouldAutoReply(conv as AgentConversation, ctx.settings);
  if (!guard.ok) {
    await logEvent(conv.company_id, conv.id, conv.lead_id, `skipped_${guard.reason}`, {});
    return { ok: true, action: "skipped", reason: guard.reason };
  }

  // Lock leve anti-corrida
  const { data: locked } = await supabaseAdmin
    .from("conversations")
    .update({ ai_handling: true })
    .eq("id", conv.id)
    .eq("ai_handling", false)
    .select("id")
    .maybeSingle();
  if (!locked) {
    await logEvent(conv.company_id, conv.id, conv.lead_id, "skipped_human_active", {
      reason: "lock_busy",
    });
    return { ok: true, action: "skipped", reason: "lock_busy" };
  }

  try {
    // Histórico do DB (não confia no body)
    const { data: msgs } = await supabaseAdmin
      .from("messages")
      .select("role, text, at")
      .eq("conversation_id", conv.id)
      .order("at", { ascending: true })
      .limit(40);
    const history = (msgs ?? []).map((m) => ({
      role: m.role as "lead" | "agent" | "system",
      text: m.text,
    }));

    const lastLeadMsg = [...history].reverse().find((m) => m.role === "lead");
    if (!lastLeadMsg) {
      return { ok: true, action: "skipped", reason: "no_lead_message" };
    }

    // Pre-check handoff
    const triggerCheck = detectHandoffNeeded(lastLeadMsg.text);
    if (triggerCheck.needed) {
      await supabaseAdmin
        .from("conversations")
        .update({ ai_status: "aguardando_humano" })
        .eq("id", conv.id);
      await logEvent(conv.company_id, conv.id, conv.lead_id, "handoff_human", {
        source: "pre_check",
        pattern: triggerCheck.reason,
      });
      return { ok: true, action: "handoff", reason: "pre_check_pattern" };
    }

    const { data: lead } = await supabaseAdmin
      .from("leads")
      .select("name")
      .eq("id", conv.lead_id)
      .maybeSingle();

    const decision = runSafetyLayer(
      await runAgentTurn({ ctx, history, leadName: lead?.name ?? null }),
    );

    if (decision.kind === "handoff") {
      await supabaseAdmin
        .from("conversations")
        .update({ ai_status: "aguardando_humano" })
        .eq("id", conv.id);
      await logEvent(conv.company_id, conv.id, conv.lead_id, "handoff_human", {
        reason: decision.reason,
      });
      return { ok: true, action: "handoff", reason: decision.reason };
    }

    if (decision.kind !== "reply" || !decision.message) {
      return { ok: true, action: "skipped", reason: "no_message" };
    }

    const sent = await sendWhatsappText({
      companyId: conv.company_id,
      conversationId: conv.id,
      leadId: conv.lead_id,
      text: decision.message,
    });

    if (!sent.ok) {
      await logEvent(conv.company_id, conv.id, conv.lead_id, "agent_error", {
        stage: "send",
        error: sent.error,
      });
      return { ok: false, action: "error", reason: sent.error };
    }

    // Atualiza counters + slots
    const update: {
      ai_status: string;
      auto_reply_count: number;
      last_auto_reply_at: string;
      detected_city?: string;
      detected_pool_size?: string;
      detected_intent?: string;
    } = {
      ai_status: "pre_atendido_ia",
      auto_reply_count: (conv.auto_reply_count ?? 0) + 1,
      last_auto_reply_at: new Date().toISOString(),
    };
    if (decision.detected_city) update.detected_city = decision.detected_city;
    if (decision.detected_pool_size) update.detected_pool_size = decision.detected_pool_size;
    if (decision.detected_intent) update.detected_intent = decision.detected_intent;
    await supabaseAdmin.from("conversations").update(update).eq("id", conv.id);

    await logEvent(conv.company_id, conv.id, conv.lead_id, "auto_reply_sent", {
      message: decision.message.slice(0, 240),
      external_id: sent.externalId,
      suggested_products: decision.suggested_products ?? [],
    });
    if (decision.detected_city)
      await logEvent(conv.company_id, conv.id, conv.lead_id, "detected_city", {
        value: decision.detected_city,
      });
    if (decision.detected_pool_size)
      await logEvent(conv.company_id, conv.id, conv.lead_id, "detected_pool_size", {
        value: decision.detected_pool_size,
      });
    if (decision.detected_intent)
      await logEvent(conv.company_id, conv.id, conv.lead_id, "detected_intent", {
        value: decision.detected_intent,
      });

    return { ok: true, action: "replied" };
  } finally {
    // Libera lock
    await supabaseAdmin
      .from("conversations")
      .update({ ai_handling: false })
      .eq("id", conv.id);
  }
}
