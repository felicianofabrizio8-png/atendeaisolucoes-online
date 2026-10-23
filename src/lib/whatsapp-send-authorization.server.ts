import type { ExecutionScope } from "./execution-scope";
import { isAutomaticReplyAllowed, normalizeAiReplyMode } from "./ai-reply-control";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

const AUTHORIZATION = Symbol("whatsapp-send-authorization");

/**
 * `campaign`: disparo de campanha configurado pelo lojista; valida só o contexto do tenant.
 * `handoff_notice`: aviso automático de que um atendente vai continuar; vale com a conversa
 * aguardando humano (é o motivo do aviso), mas não depois que um humano assumiu.
 */
export type WhatsappSendSource = "human" | "automatic" | "followup" | "campaign" | "handoff_notice";

export type WhatsappSendAuthorization = {
  readonly [AUTHORIZATION]: true;
  readonly companyId: string;
  readonly conversationId: string;
  readonly leadId: string;
  readonly integrationId: string;
  readonly source: WhatsappSendSource;
};

type AuthorizationInput = {
  companyId: string;
  conversationId: string;
  leadId: string;
  source: WhatsappSendSource;
};

async function resolveSoleWhatsappIntegrationId(companyId: string): Promise<string | null> {
  const { data } = await supabaseAdmin
    .from("integrations")
    .select("id")
    .eq("company_id", companyId)
    .eq("channel", "whatsapp")
    .eq("active", true)
    .limit(2);
  const rows = (data ?? []) as Array<{ id?: string | null }>;
  return rows.length === 1 && rows[0].id ? rows[0].id : null;
}

export async function authorizeWhatsappSend(
  input: AuthorizationInput,
): Promise<WhatsappSendAuthorization> {
  if (
    !input.companyId.trim() ||
    !input.conversationId.trim() ||
    !input.leadId.trim() ||
    !["human", "automatic", "followup", "campaign", "handoff_notice"].includes(input.source)
  ) {
    throw new Error("whatsapp_send_scope_invalid");
  }

  const [{ data: company }, { data: conversation }, { data: lead }] = await Promise.all([
    supabaseAdmin.from("companies").select("id").eq("id", input.companyId).maybeSingle(),
    supabaseAdmin
      .from("conversations")
      .select(
        "id, company_id, lead_id, channel, sales_agent_auto_reply, ai_status, human_takeover_at",
      )
      .eq("id", input.conversationId)
      .eq("company_id", input.companyId)
      .maybeSingle(),
    supabaseAdmin
      .from("leads")
      .select("id, company_id, channel, integration_id")
      .eq("id", input.leadId)
      .eq("company_id", input.companyId)
      .maybeSingle(),
  ]);

  // Lead sem integration_id (leads antigos ou criados manualmente) só usa a
  // integração da empresa quando ela é a única ativa: nunca escolhe entre números.
  const integrationId = (lead as { integration_id?: string | null } | null)?.integration_id ??
    (lead ? await resolveSoleWhatsappIntegrationId(input.companyId) : null);
  const { data: integration } = integrationId
    ? await supabaseAdmin
        .from("integrations")
        .select("id")
        .eq("id", integrationId)
        .eq("company_id", input.companyId)
        .eq("channel", "whatsapp")
        .eq("active", true)
        .maybeSingle()
    : { data: null };

  const conversationRow = conversation as {
    company_id?: string;
    lead_id?: string;
    channel?: string;
    sales_agent_auto_reply?: boolean | null;
    ai_status?: string | null;
    human_takeover_at?: string | null;
  } | null;
  const leadRow = lead as { company_id?: string; channel?: string } | null;

  if (
    !company ||
    !conversationRow ||
    !leadRow ||
    !integration ||
    conversationRow.company_id !== input.companyId ||
    conversationRow.lead_id !== input.leadId ||
    conversationRow.channel !== "whatsapp" ||
    leadRow.company_id !== input.companyId ||
    leadRow.channel !== "whatsapp" ||
    !integrationId ||
    (integration as { id?: string }).id !== integrationId
  ) {
    throw new Error("whatsapp_send_context_invalid");
  }

  if (input.source === "automatic") {
    const { data: companySettings } = await supabaseAdmin
      .from("company_settings")
      .select(
        "ai_auto_reply_enabled, ai_auto_reply_scope, sales_agent_master_enabled, sales_agent_v2_enabled, sales_agent_v2_mode",
      )
      .eq("company_id", input.companyId)
      .maybeSingle();

    const settings = companySettings as {
      ai_auto_reply_enabled?: boolean | null;
      sales_agent_master_enabled?: boolean | null;
      ai_auto_reply_scope?: unknown;
      sales_agent_v2_enabled?: boolean | null;
      sales_agent_v2_mode?: unknown;
    } | null;
    const v2Enabled = settings?.sales_agent_v2_enabled === true;
    const effectiveMode = v2Enabled ? normalizeAiReplyMode(settings?.sales_agent_v2_mode) : null;

    if (v2Enabled && !effectiveMode) {
      throw new Error("whatsapp_send_not_permitted");
    }

    const replyPermission = isAutomaticReplyAllowed({
      masterEnabled: settings?.sales_agent_master_enabled,
      mode: effectiveMode,
      scope: settings?.ai_auto_reply_scope,
      legacyEnabled: settings?.ai_auto_reply_enabled ?? false,
      salesAgentAutoReply: conversationRow.sales_agent_auto_reply,
      aiStatus: conversationRow.ai_status,
      humanTakeoverAt: conversationRow.human_takeover_at,
    });
    if (!replyPermission.ok) {
      throw new Error("whatsapp_send_not_permitted");
    }
  }

  if (
    input.source === "handoff_notice" &&
    (conversationRow.ai_status === "assumido_humano" || Boolean(conversationRow.human_takeover_at))
  ) {
    throw new Error("whatsapp_send_not_permitted");
  }

  if (
    (input.source === "automatic" || input.source === "followup") &&
    (conversationRow.ai_status === "aguardando_humano" ||
      conversationRow.ai_status === "assumido_humano" ||
      Boolean(conversationRow.human_takeover_at))
  ) {
    throw new Error("whatsapp_send_not_permitted");
  }

  return {
    [AUTHORIZATION]: true,
    companyId: input.companyId,
    conversationId: input.conversationId,
    leadId: input.leadId,
    integrationId,
    source: input.source,
  };
}

export async function authorizeWhatsappSendFromExecutionScope(
  scope: Pick<ExecutionScope, "kind" | "companyId" | "scopeId" | "capabilities">,
  input: { leadId: string; source: "automatic" },
): Promise<WhatsappSendAuthorization> {
  if (scope.kind !== "whatsapp_conversation" || scope.capabilities.send_whatsapp !== true) {
    throw new Error("whatsapp_send_scope_not_allowed");
  }
  return authorizeWhatsappSend({
    companyId: scope.companyId,
    conversationId: scope.scopeId,
    leadId: input.leadId,
    source: input.source,
  });
}

export function isWhatsappSendAuthorization(value: unknown): value is WhatsappSendAuthorization {
  return Boolean(
    value &&
    typeof value === "object" &&
    (value as Record<symbol, unknown>)[AUTHORIZATION] === true,
  );
}
