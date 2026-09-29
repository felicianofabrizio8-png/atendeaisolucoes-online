import {
  findApprovedTemplateForPurpose,
  renderTemplateBody,
  sendWhatsappTemplate,
  type TemplatePurpose,
} from "@/lib/wa-templates.server";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { isLeadInSegment, parseSegmentDefinition } from "@/lib/relationship-campaigns.server";
import { generateResumePhrase, loadResumeContext } from "@/lib/followup/resume";
import {
  isRelationshipPurpose,
  RELATIONSHIP_PURPOSES,
  type RelationshipPurpose,
} from "@/lib/relationship-campaign-purposes";

export type RelationshipMode = "manual" | "assisted" | "automatic";
export type RelationshipRecipientStatus =
  | "pending" | "sending" | "ineligible" | "sent" | "delivered"
  | "failed" | "replied" | "converted" | "suppressed";

type Db = { from: (table: string) => any };
const db = supabaseAdmin as unknown as Db;

export type RelationshipSettings = {
  mode: RelationshipMode;
  automatic_enabled: boolean;
  daily_limit: number;
  hourly_limit: number;
  business_hours_start: string;
  business_hours_end: string;
  timezone: string;
  retry_max: number;
  retry_backoff_seconds: number;
};

const DEFAULT_SETTINGS: RelationshipSettings = {
  mode: "manual",
  automatic_enabled: false,
  daily_limit: 50,
  hourly_limit: 10,
  business_hours_start: "09:00",
  business_hours_end: "18:00",
  timezone: "America/Sao_Paulo",
  retry_max: 3,
  retry_backoff_seconds: 300,
};

export function normalizeRelationshipPhone(value: string | null | undefined): string {
  return String(value ?? "").replace(/\D/g, "");
}

export function localTimeInZone(now: Date, timeZone: string): { weekday: number; minutes: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "0";
  const weekdays: Record<string, number> = { Sun: 7, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return {
    weekday: weekdays[get("weekday")] ?? 0,
    minutes: Number(get("hour")) * 60 + Number(get("minute")),
  };
}

export function isWithinRelationshipWindow(
  now: Date,
  settings: Pick<RelationshipSettings, "timezone" | "business_hours_start" | "business_hours_end">,
): boolean {
  let local: { weekday: number; minutes: number };
  try {
    local = localTimeInZone(now, settings.timezone);
  } catch {
    return false;
  }
  const start = parseClock(settings.business_hours_start);
  const end = parseClock(settings.business_hours_end);
  if (!start || !end || local.weekday < 1 || local.weekday > 5) return false;
  return local.minutes >= start && local.minutes < end;
}

function parseClock(value: string): number | null {
  const match = /^(\d{2}):(\d{2})/.exec(value)
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  return hours >= 0 && hours < 24 && minutes >= 0 && minutes < 60
    ? hours * 60 + minutes
    : null;
}

export async function getRelationshipSettings(companyId: string): Promise<RelationshipSettings> {
  const { data, error } = await db
    .from("relationship_campaign_settings")
    .select("*")
    .eq("company_id", companyId)
    .maybeSingle();
  if (error) throw error;
  return { ...DEFAULT_SETTINGS, ...(data ?? {}) } as RelationshipSettings;
}

export async function saveRelationshipSettings(
  companyId: string,
  patch: Partial<RelationshipSettings>,
): Promise<RelationshipSettings> {
  const next = {
    ...DEFAULT_SETTINGS,
    ...(await getRelationshipSettings(companyId)),
    ...patch,
    automatic_enabled: patch.automatic_enabled === true,
  };
  const { data, error } = await db
    .from("relationship_campaign_settings")
    .upsert({ company_id: companyId, ...next, updated_at: new Date().toISOString() })
    .select("*")
    .single();
  if (error) throw error;
  return data as RelationshipSettings;
}

function realSendIsEnabled(): boolean {
  // Deliberately fail-closed: this implementation cannot send real messages
  // until an explicit later rollout enables the server-only flag.
  return process.env.RELATIONSHIP_CAMPAIGN_ENABLE_REAL_SEND === "true";
}

function finalStatus(status: RelationshipRecipientStatus): boolean {
  return ["sent", "delivered", "replied", "converted", "suppressed"].includes(status);
}

export async function listRelationshipCampaigns(companyId: string) {
  const [{ data: campaigns, error: campaignError }, { data: recipients, error: recipientError }, settings] =
    await Promise.all([
      db.from("relationship_campaigns")
        .select("id,name,status,segment_id,segment_version,template_purpose,created_at,updated_at")
        .eq("company_id", companyId)
        .order("updated_at", { ascending: false }),
      db.from("relationship_campaign_recipients")
        .select("id,relationship_campaign_id,status,attempts,next_attempt_at,sent_at,replied_at,external_message_id")
        .eq("company_id", companyId)
        .order("updated_at", { ascending: false }),
      getRelationshipSettings(companyId),
    ]);
  if (campaignError) throw campaignError;
  if (recipientError) throw recipientError;
  const all = recipients ?? [];
  return {
    settings,
    campaigns: (campaigns ?? []).map((campaign: any) => ({
      ...campaign,
      recipients: {
        total: all.filter((row: any) => row.relationship_campaign_id === campaign.id).length,
        pending: all.filter((row: any) => row.relationship_campaign_id === campaign.id && row.status === "pending").length,
        failed: all.filter((row: any) => row.relationship_campaign_id === campaign.id && row.status === "failed").length,
        sent: all.filter((row: any) => row.relationship_campaign_id === campaign.id && ["sent", "delivered", "replied", "converted"].includes(row.status)).length,
        replied: all.filter((row: any) => row.relationship_campaign_id === campaign.id && ["replied", "converted"].includes(row.status)).length,
      },
    })),
  };
}

export async function listRelationshipRecipients(companyId: string, campaignId: string) {
  const { data, error } = await db
    .from("relationship_campaign_recipients")
    .select("id,relationship_campaign_id,lead_id,conversation_id,status,attempts,next_attempt_at,last_error,sent_at,replied_at,external_message_id,name_snapshot,phone_snapshot,metadata")
    .eq("company_id", companyId)
    .eq("relationship_campaign_id", campaignId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data ?? [];
}

async function hasSuppression(companyId: string, leadId: string, phone: string) {
  const { data: byLead, error: leadError } = await db
    .from("relationship_campaign_suppressions")
    .select("id,reason")
    .eq("company_id", companyId)
    .eq("lead_id", leadId)
    .eq("active", true)
    .maybeSingle();
  if (leadError) throw leadError;
  if (byLead) return byLead;
  const normalized = normalizeRelationshipPhone(phone);
  if (!normalized) return null;
  const { data, error } = await db
    .from("relationship_campaign_suppressions")
    .select("id,reason")
    .eq("company_id", companyId)
    .eq("phone", normalized)
    .eq("active", true)
    .maybeSingle();
  if (error) throw error;
  return data;
}

/** Conversa WhatsApp do lead (a de outro canal não serve para template WhatsApp). */
async function findWhatsappConversation(companyId: string, leadId: string) {
  const { data, error } = await db
    .from("conversations")
    .select("id,company_id,lead_id,channel")
    .eq("company_id", companyId)
    .eq("lead_id", leadId)
    .eq("channel", "whatsapp")
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return (data as { id: string } | null) ?? null;
}

/** Só no envio real: a simulação nunca cria conversa. */
async function createWhatsappConversation(companyId: string, leadId: string) {
  const { data, error } = await db
    .from("conversations")
    .insert({ company_id: companyId, lead_id: leadId, channel: "whatsapp" })
    .select("id,company_id,lead_id,channel")
    .single();
  if (error) throw error;
  return data as { id: string };
}

function firstName(name: string | null | undefined): string {
  return String(name ?? "").trim().split(/\s+/)[0] ?? "";
}

type HardStop = { status: "blocked"; reason: string };

/** Destinatário que não pode receber — só na simulação isso fica sem registro. */
type Exclusion = {
  status: "ineligible" | "suppressed";
  reason: string;
  recipientPatch: Record<string, unknown>;
};

export type PreparedDispatch = {
  status: "ready";
  recipient: any;
  lead: any;
  purpose: RelationshipPurpose;
  purposeLabel: string;
  template: { name: string; category: string; language: string };
  variables: Record<string, string>;
  parameters: string[];
  content: string;
  phraseSource?: string;
  conversationId: string | null;
  /** Impedem o envio real agora (a prévia mostra, o envio respeita). */
  blockers: string[];
};

/**
 * Tudo o que o envio real faz até ANTES da chamada externa: destinatário,
 * lead, segmento, supressão, telefone, conversa WhatsApp, template aprovado,
 * variáveis e conteúdo renderizado. Só lê — nenhuma escrita acontece aqui.
 */
export async function prepareRelationshipDispatch(input: {
  companyId: string;
  relationshipCampaignId: string;
  recipientId: string;
  mode: RelationshipMode;
  now: Date;
}): Promise<PreparedDispatch | HardStop | Exclusion> {
  const { companyId, now } = input;
  const settings = await getRelationshipSettings(companyId);
  const blockers: string[] = [];
  if (input.mode === "automatic" && (!settings.automatic_enabled || settings.mode !== "automatic"))
    blockers.push("automação desativada");
  if (!isWithinRelationshipWindow(now, settings)) blockers.push("fora do horário comercial configurado");

  const { data: recipient, error: recipientError } = await db
    .from("relationship_campaign_recipients")
    .select("*, relationship_campaigns!inner(id,company_id,template_purpose,segment_id)")
    .eq("company_id", companyId)
    .eq("relationship_campaign_id", input.relationshipCampaignId)
    .eq("id", input.recipientId)
    .maybeSingle();
  if (recipientError) throw recipientError;
  if (!recipient) return { status: "blocked", reason: "destinatário não encontrado" };
  if (finalStatus(recipient.status)) blockers.push(`destinatário já está como ${recipient.status}`);
  if (recipient.attempts >= settings.retry_max + 1) blockers.push("limite de tentativas atingido");

  const { data: lead, error: leadError } = await db
    .from("leads")
    .select("id,company_id,name,phone,external_id,status,closed_at,channel,tags,product,assigned_to")
    .eq("company_id", companyId)
    .eq("id", recipient.lead_id)
    .maybeSingle();
  if (leadError) throw leadError;
  if (!lead) return { status: "blocked", reason: "lead não encontrado" };

  const { data: segment, error: segmentError } = await db
    .from("relationship_segments")
    .select("definition,active")
    .eq("company_id", companyId)
    .eq("id", recipient.relationship_campaigns?.segment_id)
    .maybeSingle();
  if (segmentError) throw segmentError;
  if (!segment?.active || !isLeadInSegment(lead, parseSegmentDefinition(segment.definition))) {
    return {
      status: "ineligible",
      reason: "lead não é mais elegível para o segmento",
      recipientPatch: { status: "ineligible", last_error: "segmento mudou antes do envio" },
    };
  }

  const suppression = await hasSuppression(companyId, lead.id, lead.external_id ?? lead.phone);
  if (suppression || lead.status === "fechado" || lead.status === "perdido" || lead.closed_at) {
    const reason = suppression?.reason ?? "lead encerrado";
    return { status: "suppressed", reason, recipientPatch: { status: "suppressed", last_error: reason } };
  }

  const phone = normalizeRelationshipPhone(lead.external_id ?? lead.phone);
  if (phone.length < 8 || phone.length > 15) return { status: "blocked", reason: "telefone inválido para WhatsApp" };

  const rawPurpose = recipient.relationship_campaigns?.template_purpose ?? "reactivation";
  if (!isRelationshipPurpose(rawPurpose))
    return { status: "blocked", reason: `propósito de template não suportado: ${rawPurpose}` };
  const purpose: RelationshipPurpose = rawPurpose;
  const info = RELATIONSHIP_PURPOSES[purpose];

  const template = await findApprovedTemplateForPurpose(companyId, purpose as TemplatePurpose);
  if (!template)
    return { status: "blocked", reason: `template "${info.template}" não está aprovado para ${info.label}` };
  const names = template.variables ?? [];
  if (names.length > 1)
    return {
      status: "blocked",
      reason: `template "${template.name}" tem ${names.length} variáveis; só {{1}} é suportado`,
    };

  const conversation = await findWhatsappConversation(companyId, lead.id);

  const variables: Record<string, string> = {};
  let phraseSource: string | undefined;
  if (names.length === 1) {
    if (info.var1 === "resume_phrase") {
      const context = await loadResumeContext(companyId, conversation?.id ?? null, lead.id);
      const body = (template.components as Array<Record<string, unknown>>).find(
        (c) => String(c.type ?? "").toUpperCase() === "BODY",
      );
      const phrase = await generateResumePhrase({
        companyId,
        context,
        templateBody: String(body?.text ?? ""),
      });
      variables[names[0]] = phrase.text;
      phraseSource = phrase.source;
    } else {
      variables[names[0]] = firstName(lead.name);
    }
  }
  const rendered = renderTemplateBody(template, variables);
  if (rendered.parameters.some((p) => !p || !p.trim()))
    return { status: "blocked", reason: `variável {{1}} ficaria vazia no template "${template.name}"` };

  return {
    status: "ready",
    recipient,
    lead,
    purpose,
    purposeLabel: info.label,
    template: { name: template.name, category: template.category, language: template.language },
    variables,
    parameters: rendered.parameters,
    content: rendered.body,
    phraseSource,
    conversationId: conversation?.id ?? null,
    blockers,
  };
}

/**
 * Prévia do disparo para um destinatário: a mesma preparação do envio real,
 * sem enviar, sem criar conversa e sem alterar o destinatário.
 */
export async function previewRelationshipDispatch(input: {
  companyId: string;
  relationshipCampaignId: string;
  recipientId: string;
  mode: RelationshipMode;
  now?: Date;
}) {
  const prepared = await prepareRelationshipDispatch({ ...input, now: input.now ?? new Date() });
  if (prepared.status !== "ready") {
    return { status: "preview" as const, would_send: false, blockers: [prepared.reason], outcome: prepared.status };
  }
  const blockers = [...prepared.blockers];
  if (!realSendIsEnabled()) blockers.push("envio real desabilitado no servidor");
  return {
    status: "preview" as const,
    would_send: blockers.length === 0,
    blockers,
    purpose: prepared.purpose,
    purpose_label: prepared.purposeLabel,
    template: prepared.template,
    variables: prepared.variables,
    parameters: prepared.parameters,
    content: prepared.content,
    phrase_source: prepared.phraseSource ?? null,
    lead_id: prepared.lead.id,
    conversation_id: prepared.conversationId,
    conversation_note: prepared.conversationId
      ? null
      : "lead sem conversa WhatsApp — o envio real criaria uma; a prévia não cria",
  };
}

export async function dispatchRelationshipRecipient(input: {
  companyId: string;
  relationshipCampaignId: string;
  recipientId: string;
  mode: RelationshipMode;
  now?: Date;
  dryRun?: boolean;
}) {
  const now = input.now ?? new Date();
  // Simulação (pedida ou forçada pelo gate do servidor) = prévia, sem efeitos.
  if (input.dryRun !== false || !realSendIsEnabled()) {
    return previewRelationshipDispatch({ ...input, now });
  }

  const prepared = await prepareRelationshipDispatch({ ...input, now });
  if (prepared.status !== "ready") {
    // Só no envio real a exclusão fica registrada no destinatário.
    if ("recipientPatch" in prepared) {
      await db
        .from("relationship_campaign_recipients")
        .update({ ...prepared.recipientPatch, updated_at: now.toISOString() })
        .eq("company_id", input.companyId)
        .eq("id", input.recipientId);
    }
    return { status: prepared.status, reason: prepared.reason };
  }
  if (finalStatus(prepared.recipient.status)) return { status: "idempotent" as const, recipient: prepared.recipient };
  if (prepared.blockers.length > 0) return { status: "blocked" as const, reason: prepared.blockers.join("; ") };

  const { recipient, lead } = prepared;
  const conversationId =
    prepared.conversationId ?? (await createWhatsappConversation(input.companyId, lead.id)).id;

  const dispatchKey = `relationship:${input.relationshipCampaignId}:${recipient.id}:${recipient.attempts + 1}`;
  const { data: claimed, error: claimError } = await db
    .from("relationship_campaign_recipients")
    .update({
      status: "sending",
      attempts: recipient.attempts + 1,
      last_attempt_at: now.toISOString(),
      dispatch_key: dispatchKey,
      locked_until: new Date(now.getTime() + 10 * 60_000).toISOString(),
      updated_at: now.toISOString(),
    })
    .eq("company_id", input.companyId)
    .eq("id", recipient.id)
    .in("status", ["pending", "failed"])
    .select("id")
    .maybeSingle();
  if (claimError) throw claimError;
  if (!claimed) return { status: "idempotent" as const, reason: "destinatário já reservado" };

  // Mesmo propósito e mesmas variáveis da preparação (e da prévia).
  const send = await sendWhatsappTemplate({
    companyId: input.companyId,
    conversationId,
    leadId: lead.id,
    purpose: prepared.purpose as TemplatePurpose,
    variables: prepared.variables,
    source: "relationship_campaign",
    sourceMetadata: {
      relationship_campaign_id: input.relationshipCampaignId,
      relationship_recipient_id: recipient.id,
      dispatch_key: dispatchKey,
      relationship_purpose: prepared.purpose,
    },
  });

  if (!send.ok || send.simulated) {
    const nextAttempt = new Date(
      now.getTime() + settingsBackoffMs(await getRelationshipSettings(input.companyId), recipient.attempts + 1),
    );
    await db
      .from("relationship_campaign_recipients")
      .update({
        status: "failed",
        last_error: send.ok ? "simulated delivery" : send.error,
        next_attempt_at: nextAttempt.toISOString(),
        locked_until: null,
        updated_at: now.toISOString(),
      })
      .eq("company_id", input.companyId)
      .eq("id", recipient.id);
    return { status: "failed" as const, error: send.ok ? "simulated delivery" : send.error };
  }

  await db
    .from("relationship_campaign_recipients")
    .update({
      status: "sent",
      sent_at: now.toISOString(),
      external_message_id: send.externalId,
      conversation_id: conversationId,
      next_attempt_at: null,
      locked_until: null,
      last_error: null,
      updated_at: now.toISOString(),
    })
    .eq("company_id", input.companyId)
    .eq("id", recipient.id);

  return { status: "sent" as const, external_id: send.externalId, content: prepared.content };
}

function settingsBackoffMs(settings: RelationshipSettings, attempt: number): number {
  return settings.retry_backoff_seconds * 1000 * Math.max(1, attempt);
}

export async function scheduleRelationshipCampaign(input: {
  companyId: string;
  relationshipCampaignId: string;
  mode: RelationshipMode;
  now?: Date;
  limit?: number;
}) {
  const now = input.now ?? new Date();
  const settings = await getRelationshipSettings(input.companyId);
  if (input.mode === "automatic" && (!settings.automatic_enabled || settings.mode !== "automatic")) {
    return { status: "disabled" as const, reason: "automação desativada", candidates: [] };
  }
  if (!isWithinRelationshipWindow(now, settings)) {
    return { status: "outside_window" as const, reason: "fora do horário comercial", candidates: [] };
  }

  const max = Math.max(0, Math.min(input.limit ?? settings.hourly_limit, settings.hourly_limit));
  const { data: sentRecent, error: sentError } = await db
    .from("relationship_campaign_recipients")
    .select("id")
    .eq("company_id", input.companyId)
    .in("status", ["sent", "delivered", "replied", "converted"])
    .gte("sent_at", new Date(now.getTime() - 24 * 3600_000).toISOString());
  if (sentError) throw sentError;
  if ((sentRecent ?? []).length >= settings.daily_limit) {
    return { status: "daily_limit" as const, reason: "limite diário atingido", candidates: [] };
  }

  const remaining = Math.max(0, Math.min(max, settings.daily_limit - (sentRecent ?? []).length));
  const { data, error } = await db
    .from("relationship_campaign_recipients")
    .select("id,relationship_campaign_id,lead_id,status,attempts,next_attempt_at")
    .eq("company_id", input.companyId)
    .eq("relationship_campaign_id", input.relationshipCampaignId)
    .in("status", ["pending", "failed"])
    .or(`next_attempt_at.is.null,next_attempt_at.lte.${now.toISOString()}`)
    .order("created_at", { ascending: true })
    .limit(remaining);
  if (error) throw error;

  // Scheduler only plans. A later worker can call dispatchRelationshipRecipient
  // with dryRun=false after an explicit rollout enables the server gate.
  return {
    status: "planned" as const,
    candidates: data ?? [],
    dry_run: true,
    real_send_enabled: realSendIsEnabled(),
  };
}

export async function upsertRelationshipSuppression(
  companyId: string,
  input: { leadId?: string; phone?: string; reason?: string; source?: string; active?: boolean },
) {
  const phone = input.phone ? normalizeRelationshipPhone(input.phone) : null;
  if (!input.leadId && !phone) throw new Error("leadId ou phone é obrigatório");
  const { data, error } = await db
    .from("relationship_campaign_suppressions")
    .upsert({
      company_id: companyId,
      lead_id: input.leadId ?? null,
      phone,
      reason: input.reason ?? "opt_out",
      source: input.source ?? "manual",
      active: input.active ?? true,
    }, { onConflict: "company_id,target_key" })
    .select("*")
    .single();
  if (error) throw error;
  return data;
}
