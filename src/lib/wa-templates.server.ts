// Camada desacoplada para gerenciar WhatsApp Templates oficiais (Cloud API).
//
// Responsabilidades:
//  - Detectar janela de atendimento de 24h (última mensagem do lead).
//  - Sincronizar templates aprovados pela Meta para a empresa (Graph API).
//  - Escolher template Utility aprovado por propósito (follow-up, retomada, etc).
//  - Enviar mensagem via template oficial (type=template), nunca texto livre fora da janela.
//  - Registrar logs estruturados (ai_flow_events) com category/status/wamid/erro.
//
// NÃO altera:
//  - meta-send / meta-webhook
//  - engine principal da IA (ai-agent.server.ts)
//  - inbox / messages / conversations

import { supabaseAdmin } from "@/integrations/supabase/client.server";

export type TemplateCategory = "utility" | "marketing" | "authentication";
export type TemplatePurpose =
  // Legacy purposes (mapeados para nomes canônicos abaixo)
  | "quote_no_reply"
  | "lead_silent"
  | "visit_no_return"
  | "hot_lead_idle"
  | "returning_customer"
  | "appointment_confirmation"
  | "conversation_resume"
  // Canonical purposes (mapeados 1:1 para um template aprovado)
  | "quote_followup"          // Marketing: followup_orcamento
  | "reactivation"            // Marketing: reativacao_cliente
  | "visit_confirmed"         // Utility:   visita_confirmada
  | "visit_rescheduled"       // Utility:   visita_reagendada
  | "installation_confirmed"; // Utility:   instalacao_confirmada

/**
 * Mapeamento oficial de propósito → template aprovado na Cloud API.
 * - Marketing: usado em follow-ups e reativação (sempre fora da janela 24h).
 * - Utility:   usado em confirmações operacionais (visita / instalação).
 */
export const PURPOSE_TEMPLATE_MAP: Record<
  TemplatePurpose,
  { templateName: string; category: TemplateCategory }
> = {
  // Canônicos
  quote_followup:           { templateName: "followup_orcamento",   category: "marketing" },
  reactivation:             { templateName: "reativacao_cliente",   category: "marketing" },
  visit_confirmed:          { templateName: "visita_confirmada",    category: "utility" },
  visit_rescheduled:        { templateName: "visita_reagendada",    category: "utility" },
  installation_confirmed:   { templateName: "instalacao_confirmada", category: "utility" },
  // Legacy → caem nos canônicos
  quote_no_reply:           { templateName: "followup_orcamento",   category: "marketing" },
  lead_silent:              { templateName: "followup_orcamento",   category: "marketing" },
  visit_no_return:          { templateName: "followup_orcamento",   category: "marketing" },
  hot_lead_idle:            { templateName: "followup_orcamento",   category: "marketing" },
  returning_customer:       { templateName: "reativacao_cliente",   category: "marketing" },
  appointment_confirmation: { templateName: "visita_confirmada",    category: "utility" },
  conversation_resume:      { templateName: "reativacao_cliente",   category: "marketing" },
};

export interface TemplateRow {
  id: string;
  company_id: string;
  integration_id: string | null;
  meta_template_id: string | null;
  name: string;
  language: string;
  category: TemplateCategory;
  status:
    | "approved"
    | "pending"
    | "rejected"
    | "paused"
    | "disabled"
    | "in_appeal"
    | "pending_deletion";
  components: unknown[];
  variables: string[];
  purpose: TemplatePurpose | null;
  auto_use: boolean;
  last_synced_at: string | null;
  meta_payload: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Janela de 24h
// ---------------------------------------------------------------------------

/**
 * Verifica se a conversa está dentro da janela oficial de 24h da Meta.
 * Usa um buffer de 23h para evitar borda do fuso/atraso de relógio.
 */
export async function isWithin24hWindow(
  conversationId: string,
): Promise<{ inside: boolean; lastLeadAt: string | null }> {
  const cutoff = new Date(Date.now() - 23 * 3600 * 1000).toISOString();
  const { data } = await supabaseAdmin
    .from("messages")
    .select("at")
    .eq("conversation_id", conversationId)
    .eq("role", "lead")
    .order("at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const lastAt = data?.at ?? null;
  if (!lastAt) return { inside: false, lastLeadAt: null };
  return { inside: lastAt >= cutoff, lastLeadAt: lastAt };
}

// ---------------------------------------------------------------------------
// Seleção de template aprovado por propósito
// ---------------------------------------------------------------------------

/**
 * Encontra o melhor template Utility aprovado para um determinado propósito.
 *  - Sempre prioriza category='utility'.
 *  - Nunca usa marketing/authentication em follow-up automático.
 *  - Exige status='approved' e auto_use=true.
 */
/**
 * Encontra o template aprovado que atende um propósito.
 *
 * Estratégia (em ordem):
 *  1) Lookup direto pelo NOME canônico do template (Marketing ou Utility,
 *     conforme `PURPOSE_TEMPLATE_MAP`) — exige status='approved'.
 *  2) Fallback: lookup pelo campo legacy `purpose` (auto_use + approved),
 *     respeitando a categoria esperada do mapa.
 *
 * Nunca devolve template em status diferente de "approved".
 */
export async function findApprovedTemplateForPurpose(
  companyId: string,
  purpose: TemplatePurpose,
  preferredLanguage = "pt_BR",
): Promise<TemplateRow | null> {
  const mapped = PURPOSE_TEMPLATE_MAP[purpose];
  const expectedCategory = mapped?.category ?? "utility";
  const expectedName = mapped?.templateName ?? null;

  // 1) Busca pelo nome canônico
  if (expectedName) {
    const { data } = await supabaseAdmin
      .from("whatsapp_templates")
      .select("*")
      .eq("company_id", companyId)
      .eq("name", expectedName)
      .eq("status", "approved")
      .eq("category", expectedCategory);
    const rows = (data ?? []) as unknown as TemplateRow[];
    if (rows.length > 0) {
      const lang = rows.find((r) => r.language === preferredLanguage);
      return lang ?? rows[0];
    }
  }

  // 2) Fallback legacy: pelo campo purpose + auto_use
  const { data } = await supabaseAdmin
    .from("whatsapp_templates")
    .select("*")
    .eq("company_id", companyId)
    .eq("purpose", purpose)
    .eq("auto_use", true)
    .eq("status", "approved")
    .eq("category", expectedCategory);
  const rows = (data ?? []) as unknown as TemplateRow[];
  if (rows.length === 0) return null;
  const lang = rows.find((r) => r.language === preferredLanguage);
  return lang ?? rows[0];
}

// ---------------------------------------------------------------------------
// Render: substitui {{1}}, {{2}}... no body
// ---------------------------------------------------------------------------

interface RenderedTemplate {
  body: string;
  parameters: string[];
}

export function renderTemplateBody(
  template: TemplateRow,
  variables: Record<string, string>,
): RenderedTemplate {
  const bodyComp = (template.components as Array<Record<string, unknown>>).find(
    (c) => (c.type as string)?.toUpperCase() === "BODY",
  );
  const text = (bodyComp?.text as string) ?? "";
  // Variáveis declaradas em ordem (pelo nome lógico) — mapeia para {{1..N}}.
  const orderedNames = template.variables ?? [];
  const parameters: string[] = orderedNames.map((n) => variables[n] ?? "");
  let rendered = text;
  parameters.forEach((value, i) => {
    rendered = rendered.replaceAll(`{{${i + 1}}}`, value);
  });
  return { body: rendered, parameters };
}

// ---------------------------------------------------------------------------
// Envio via Cloud API (type=template)
// ---------------------------------------------------------------------------

export interface SendTemplateResult {
  ok: boolean;
  externalId?: string | null;
  error?: string;
  metaError?: {
    code?: number;
    subcode?: number;
    type?: string;
    message?: string;
  } | null;
  status?: number;
}

export async function sendWhatsappTemplate(params: {
  companyId: string;
  conversationId: string;
  leadId: string;
  purpose: TemplatePurpose;
  variables?: Record<string, string>;
  source?: string;
}): Promise<SendTemplateResult> {
  const { companyId, conversationId, leadId, purpose } = params;
  const variables = params.variables ?? {};

  // 1) Lead + telefone
  const { data: lead } = await supabaseAdmin
    .from("leads")
    .select("phone, external_id, integration_id, name")
    .eq("id", leadId)
    .maybeSingle();
  if (!lead) return { ok: false, error: "lead não encontrado" };
  const recipient = String(lead.external_id ?? lead.phone ?? "").replace(/\D/g, "");
  if (recipient.length < 8 || recipient.length > 15) {
    return { ok: false, error: "telefone inválido" };
  }

  // 2) Integração WhatsApp Cloud da empresa
  const intQuery = supabaseAdmin
    .from("integrations")
    .select("id, access_token, external_account_id")
    .eq("company_id", companyId)
    .eq("channel", "whatsapp")
    .eq("active", true);
  const { data: integration } = lead.integration_id
    ? await intQuery.eq("id", lead.integration_id).maybeSingle()
    : await intQuery.limit(1).maybeSingle();
  if (!integration?.access_token || !integration.external_account_id) {
    return { ok: false, error: "WhatsApp Cloud não conectado" };
  }

  // 3) Template aprovado
  const mapped = PURPOSE_TEMPLATE_MAP[purpose];
  const expectedCategory = mapped?.category ?? "utility";
  const expectedName = mapped?.templateName ?? null;
  const template = await findApprovedTemplateForPurpose(companyId, purpose);
  if (!template) {
    const reason = expectedName
      ? `Template "${expectedName}" (${expectedCategory}) não está aprovado na Cloud API para o propósito "${purpose}".`
      : `Nenhum template aprovado para "${purpose}".`;
    await logTemplateEvent(companyId, conversationId, leadId, "template_missing", {
      purpose,
      expected_template_name: expectedName,
      expected_category: expectedCategory,
      delivery_method: "template",
    });
    await logErrorAndAudit(companyId, leadId, "template_missing", {
      purpose,
      expected_template_name: expectedName,
      expected_category: expectedCategory,
      conversation_id: conversationId,
    });
    return { ok: false, error: reason };
  }
  // Garantia: a categoria do template precisa bater com a esperada para o propósito.
  if (template.category !== expectedCategory) {
    await logTemplateEvent(companyId, conversationId, leadId, "template_blocked", {
      purpose,
      template_name: template.name,
      template_category: template.category,
      expected_category: expectedCategory,
      delivery_method: "template",
    });
    return {
      ok: false,
      error: `Template "${template.name}" tem categoria ${template.category}, esperada ${expectedCategory} para o propósito "${purpose}".`,
    };
  }

  // 4) Render parâmetros e payload
  const rendered = renderTemplateBody(template, variables);
  const payload = {
    messaging_product: "whatsapp",
    to: recipient,
    type: "template",
    template: {
      name: template.name,
      language: { code: template.language },
      components:
        rendered.parameters.length > 0
          ? [
              {
                type: "body",
                parameters: rendered.parameters.map((text) => ({ type: "text", text })),
              },
            ]
          : [],
    },
  };

  // 5) Envia para Cloud API
  const apiUrl = `https://graph.facebook.com/v20.0/${integration.external_account_id}/messages`;
  let res: Response;
  try {
    res = await fetch(apiUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${integration.access_token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });
  } catch (e) {
    const error = e instanceof Error ? e.message : "falha de rede";
    await logTemplateEvent(companyId, conversationId, leadId, "template_send_error", {
      template_name: template.name,
      category: template.category,
      purpose,
      error,
    });
    return { ok: false, error: `network: ${error}` };
  }

  const raw = await res.text();
  let parsed: {
    messages?: Array<{ id: string }>;
    error?: { message?: string; code?: number; type?: string; error_subcode?: number };
  } = {};
  try {
    parsed = JSON.parse(raw);
  } catch {
    /* not json */
  }

  if (!res.ok) {
    const metaError = parsed.error ?? null;
    console.error("[WA_TEMPLATE_HTTP]", res.status, raw.slice(0, 500));
    await logTemplateEvent(companyId, conversationId, leadId, "template_send_error", {
      template_name: template.name,
      category: template.category,
      language: template.language,
      purpose,
      status: res.status,
      meta_error_code: metaError?.code ?? null,
      meta_error_subcode: metaError?.error_subcode ?? null,
      meta_error_type: metaError?.type ?? null,
      meta_error_message: metaError?.message ?? null,
    });
    return {
      ok: false,
      error: metaError?.message ?? `HTTP ${res.status}`,
      metaError: {
        code: metaError?.code,
        subcode: metaError?.error_subcode,
        type: metaError?.type,
        message: metaError?.message,
      },
      status: res.status,
    };
  }

  const externalId = parsed.messages?.[0]?.id ?? null;

  // 6) Persiste mensagem (role=agent, source=template)
  const sentAt = new Date().toISOString();
  await supabaseAdmin.from("messages").insert({
    company_id: companyId,
    conversation_id: conversationId,
    role: "agent",
    text: rendered.body,
    at: sentAt,
    external_id: externalId,
    integration_id: integration.id,
    source: params.source ?? "wa_template",
    source_subtype: "template",
    source_metadata: {
      template_name: template.name,
      template_id: template.id,
      meta_template_id: template.meta_template_id,
      language: template.language,
      category: template.category,
      purpose,
      wamid: externalId,
      variables: rendered.parameters,
    },
  });
  await supabaseAdmin
    .from("conversations")
    .update({ last_message_at: sentAt, awaiting_reply: false })
    .eq("id", conversationId);

  await logTemplateEvent(companyId, conversationId, leadId, "template_sent", {
    template_name: template.name,
    category: template.category,
    language: template.language,
    purpose,
    wamid: externalId,
  });

  return { ok: true, externalId };
}

// ---------------------------------------------------------------------------
// Sync com Meta (Graph API)
// ---------------------------------------------------------------------------

interface MetaTemplateRaw {
  id?: string;
  name: string;
  language: string;
  category: string; // UTILITY | MARKETING | AUTHENTICATION
  status: string; // APPROVED | PENDING | REJECTED | ...
  components?: Array<{ type: string; text?: string; example?: unknown }>;
}

/**
 * Detecta variáveis declaradas no body. Tenta usar example.body_text quando
 * disponível para nomeá-las; caso contrário, usa var1..varN.
 */
function extractVariables(components: MetaTemplateRaw["components"]): string[] {
  const body = (components ?? []).find((c) => c.type?.toUpperCase() === "BODY");
  if (!body?.text) return [];
  const matches = body.text.match(/\{\{(\d+)\}\}/g) ?? [];
  return matches.map((_, i) => `var${i + 1}`);
}

export interface SyncResult {
  ok: boolean;
  count?: number;
  approved?: number;
  error?: string;
}

export async function syncTemplatesFromMeta(companyId: string): Promise<SyncResult> {
  const { data: integration } = await supabaseAdmin
    .from("integrations")
    .select("id, access_token, account_metadata")
    .eq("company_id", companyId)
    .eq("channel", "whatsapp")
    .eq("active", true)
    .limit(1)
    .maybeSingle();
  if (!integration?.access_token) {
    return { ok: false, error: "WhatsApp Cloud não conectado" };
  }
  const meta = (integration.account_metadata ?? {}) as Record<string, unknown>;
  const wabaId =
    (meta.waba_id as string | undefined) ?? (meta.verified_waba_id as string | undefined) ?? null;
  if (!wabaId) {
    return { ok: false, error: "WABA ID não encontrado na integração" };
  }

  const url = `https://graph.facebook.com/v20.0/${wabaId}/message_templates?fields=id,name,language,category,status,components&limit=200`;
  let res: Response;
  try {
    res = await fetch(url, {
      headers: { Authorization: `Bearer ${integration.access_token}` },
    });
  } catch (e) {
    return { ok: false, error: `network: ${e instanceof Error ? e.message : "erro"}` };
  }
  const raw = await res.text();
  if (!res.ok) {
    return { ok: false, error: `Meta API HTTP ${res.status}: ${raw.slice(0, 200)}` };
  }
  let parsed: { data?: MetaTemplateRaw[] } = {};
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, error: "resposta inválida da Meta" };
  }
  const items = parsed.data ?? [];

  let approved = 0;
  const now = new Date().toISOString();
  for (const t of items) {
    const category = t.category?.toLowerCase();
    if (category !== "utility" && category !== "marketing" && category !== "authentication") {
      continue;
    }
    const status = t.status?.toLowerCase();
    if (status === "approved") approved++;
    await supabaseAdmin
      .from("whatsapp_templates")
      .upsert(
        [
          {
            company_id: companyId,
            integration_id: integration.id,
            meta_template_id: t.id ?? null,
            name: t.name,
            language: t.language,
            category,
            status,
            components: (t.components ?? []) as unknown as never,
            variables: extractVariables(t.components) as unknown as never,
            meta_payload: (t as unknown) as never,
            last_synced_at: now,
          },
        ],
        { onConflict: "company_id,name,language" },
      );
  }

  return { ok: true, count: items.length, approved };
}

// ---------------------------------------------------------------------------
// Logs
// ---------------------------------------------------------------------------

async function logTemplateEvent(
  companyId: string,
  conversationId: string | null,
  leadId: string | null,
  eventType:
    | "template_sent"
    | "template_send_error"
    | "template_missing"
    | "template_blocked",
  payload: Record<string, unknown>,
) {
  await supabaseAdmin.from("ai_flow_events").insert({
    company_id: companyId,
    conversation_id: conversationId,
    lead_id: leadId,
    event_type: eventType,
    payload: payload as never,
  });
}
