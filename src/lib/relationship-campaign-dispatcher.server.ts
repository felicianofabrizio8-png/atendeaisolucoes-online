import {
  fitVar1ToTemplate,
  resumeTemplateProblem,
  templateBodyText,
} from "@/lib/wa-template-contract";
import {
  findApprovedTemplateForPurpose,
  renderTemplatePreview,
  renderTemplateBody,
  sendWhatsappTemplate,
  type TemplatePurpose,
} from "@/lib/wa-templates.server";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { isLeadInSegment, parseSegmentDefinition } from "@/lib/relationship-campaigns.server";
import { generateResumePhrase, loadResumeContext } from "@/lib/followup/resume";
import { normalizeResumePhrase } from "@/lib/followup/resume-phrase";
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

/** Kill switch global (variável de servidor): sem ele, nada é enviado. */
export function realSendIsEnabled(): boolean {
  // Deliberately fail-closed: this implementation cannot send real messages
  // until an explicit later rollout enables the server-only flag.
  return process.env.RELATIONSHIP_CAMPAIGN_ENABLE_REAL_SEND === "true";
}

export const RELATIONSHIP_DISPATCH_MODES = ["manual", "assisted", "automatic"] as const;

export function isRelationshipMode(value: unknown): value is RelationshipMode {
  return typeof value === "string" && (RELATIONSHIP_DISPATCH_MODES as readonly string[]).includes(value);
}

/**
 * Automação é por campanha: só `dispatch_mode = automatic` +
 * `automatic_enabled = true` + campanha pronta. Colunas ausentes (migration
 * não aplicada) contam como desligado.
 */
export function campaignAutomationProblem(campaign: any): string | null {
  if (campaign?.dispatch_mode !== "automatic" || campaign?.automatic_enabled !== true)
    return "automação desativada";
  if (campaign?.status !== "ready") return `campanha não está pronta (status ${campaign?.status ?? "?"})`;
  return null;
}

async function loadCampaign(companyId: string, campaignId: string) {
  const { data, error } = await db
    .from("relationship_campaigns")
    .select("*")
    .eq("company_id", companyId)
    .eq("id", campaignId)
    .maybeSingle();
  if (error) throw error;
  return data as any;
}

/** Troca o modo da campanha. Sair do automático desliga a automação. */
export async function setRelationshipCampaignMode(
  companyId: string,
  campaignId: string,
  mode: RelationshipMode,
  actorId: string | null,
) {
  if (!isRelationshipMode(mode)) throw new Error("modo inválido");
  const campaign = await loadCampaign(companyId, campaignId);
  if (!campaign) throw new Error("campanha não encontrada");
  const patch: Record<string, unknown> = { dispatch_mode: mode };
  if (mode !== "automatic" && campaign.automatic_enabled) {
    patch.automatic_enabled = false;
    patch.automation_changed_at = new Date().toISOString();
    patch.automation_changed_by = actorId;
  }
  const { data, error } = await db
    .from("relationship_campaigns")
    .update(patch)
    .eq("company_id", companyId)
    .eq("id", campaignId)
    .select("*")
    .maybeSingle();
  if (error) throw error;
  return data;
}

/**
 * "Ativar automação" / "Pausar automação" — sempre explícito, por campanha.
 * Ativar exige modo automático e campanha pronta.
 */
export async function setRelationshipCampaignAutomation(
  companyId: string,
  campaignId: string,
  enabled: boolean,
  actorId: string | null,
) {
  const campaign = await loadCampaign(companyId, campaignId);
  if (!campaign) throw new Error("campanha não encontrada");
  if (enabled && campaign.dispatch_mode !== "automatic")
    throw new Error("só campanhas no modo automático podem ter a automação ativada");
  if (enabled && campaign.status !== "ready")
    throw new Error("materialize os destinatários antes de ativar a automação");
  const { data, error } = await db
    .from("relationship_campaigns")
    .update({
      automatic_enabled: enabled,
      automation_changed_at: new Date().toISOString(),
      automation_changed_by: actorId,
    })
    .eq("company_id", companyId)
    .eq("id", campaignId)
    .select("*")
    .maybeSingle();
  if (error) throw error;
  return data;
}

function finalStatus(status: RelationshipRecipientStatus): boolean {
  return ["sent", "delivered", "replied", "converted", "suppressed"].includes(status);
}

export async function listRelationshipCampaigns(companyId: string) {
  const [{ data: campaigns, error: campaignError }, { data: recipients, error: recipientError }, settings] =
    await Promise.all([
      // `*`: sem a migration de modo por campanha, as colunas novas só faltam.
      db.from("relationship_campaigns")
        .select("*")
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
    real_send_enabled: realSendIsEnabled(),
    campaigns: (campaigns ?? []).map((campaign: any) => ({
      ...campaign,
      dispatch_mode: isRelationshipMode(campaign.dispatch_mode) ? campaign.dispatch_mode : "manual",
      automatic_enabled: campaign.automatic_enabled === true,
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

/**
 * var1 preparado na prévia, guardado em `metadata.prepared_dispatch` do
 * destinatário. O envio real reutiliza exatamente estas variáveis — sem
 * chamar a IA de novo — e bloqueia se não houver registro válido.
 */
export type PreparedVariables = {
  version: 1;
  id: string;
  company_id: string;
  relationship_campaign_id: string;
  recipient_id: string;
  lead_id: string;
  purpose: RelationshipPurpose;
  template: { name: string; language: string };
  /** Conteúdo interno, sem {{ }} — é o que vai no payload da Meta. */
  variables: Record<string, string>;
  content: string;
  phrase_source: string | null;
  prepared_at: string;
};

const PREPARED_KEY = "prepared_dispatch";

function storedPrepared(recipient: any): PreparedVariables | null {
  const value = recipient?.metadata?.[PREPARED_KEY];
  return value && typeof value === "object" ? (value as PreparedVariables) : null;
}

/** Por que o var1 salvo não pode ser usado agora; `null` = pode. */
function preparedProblem(
  stored: PreparedVariables | null,
  expected: {
    companyId: string;
    relationshipCampaignId: string;
    recipientId: string;
    lead: { id: string; name: string | null };
    purpose: RelationshipPurpose;
    template: TemplateForPreparation;
  },
): string | null {
  if (!stored) return "nenhum var1 preparado na prévia";
  if (stored.version !== 1) return "registro de preparação em formato desconhecido";
  if (
    stored.company_id !== expected.companyId ||
    stored.relationship_campaign_id !== expected.relationshipCampaignId ||
    stored.recipient_id !== expected.recipientId ||
    stored.lead_id !== expected.lead.id
  )
    return "var1 preparado pertence a outro destinatário";
  if (stored.purpose !== expected.purpose) return "tipo de campanha mudou desde a prévia";
  const { template } = expected;
  if (stored.template?.name !== template.name || stored.template?.language !== template.language)
    return "template mudou desde a prévia";
  const names = template.variables ?? [];
  const stamped = stored.variables && typeof stored.variables === "object" ? stored.variables : {};
  if (Object.keys(stamped).sort().join(",") !== [...names].sort().join(","))
    return "variáveis do template mudaram desde a prévia";
  const kind = RELATIONSHIP_PURPOSES[expected.purpose].var1;
  for (const name of names) {
    const value = stamped[name];
    if (typeof value !== "string" || !value.trim()) return `variável ${name} vazia`;
    if (/\{\{|\}\}|[\r\n\t]| {4,}/.test(value)) return `variável ${name} com formato inválido`;
    const stillValid =
      kind === "resume_phrase"
        ? normalizeResumePhrase(value, { leadName: expected.lead.name }) === value &&
          fitVar1ToTemplate(value, templateBodyText(template.components)) === value
        : value === firstName(expected.lead.name);
    if (!stillValid) return `variável ${name} não passa mais nas proteções`;
  }
  if (renderTemplateBody(template, stamped).body !== stored.content)
    return "texto do template mudou desde a prévia";
  return null;
}

type TemplateForPreparation = NonNullable<Awaited<ReturnType<typeof findApprovedTemplateForPurpose>>>;

type HardStop = {
  status: "blocked";
  reason: string;
  /** "not_prepared": falta var1 válido salvo (só no envio real). */
  code?: "not_prepared";
  /** Bloqueios de política já apurados (automação, horário, status, tentativas). */
  blockers?: string[];
};

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
  /** Mesmo conteúdo com cada variável entre {{ }} — só para exibição. */
  contentPreview: string;
  phraseSource?: string;
  /** Registro do var1: recém-gerado (a prévia salva) ou reutilizado do salvo. */
  preparedRecord: PreparedVariables;
  preparedOrigin: "generated" | "reused";
  conversationId: string | null;
  /** Impedem o envio real agora (a prévia mostra, o envio respeita). */
  blockers: string[];
};

/**
 * Tudo o que o envio real faz até ANTES da chamada externa: destinatário,
 * lead, segmento, supressão, telefone, conversa WhatsApp, template aprovado,
 * variáveis e conteúdo renderizado. Só lê — nenhuma escrita acontece aqui.
 *
 * `varSource`:
 *  - "preview" (padrão): reutiliza o var1 salvo se ainda for válido; senão
 *    (ou com `regenerate`) gera um novo — quem chama decide salvar.
 *  - "prepared": envio real. Só o var1 salvo serve; sem ele, bloqueia. Nunca
 *    chama a IA.
 */
export async function prepareRelationshipDispatch(input: {
  companyId: string;
  relationshipCampaignId: string;
  recipientId: string;
  mode: RelationshipMode;
  now: Date;
  varSource?: "preview" | "prepared";
  regenerate?: boolean;
}): Promise<PreparedDispatch | HardStop | Exclusion> {
  const { companyId, now } = input;
  const settings = await getRelationshipSettings(companyId);
  const blockers: string[] = [];
  if (!isWithinRelationshipWindow(now, settings)) blockers.push("fora do horário comercial configurado");

  const { data: recipient, error: recipientError } = await db
    .from("relationship_campaign_recipients")
    .select("*, relationship_campaigns!inner(*)")
    .eq("company_id", companyId)
    .eq("relationship_campaign_id", input.relationshipCampaignId)
    .eq("id", input.recipientId)
    .maybeSingle();
  if (recipientError) throw recipientError;
  if (!recipient) return { status: "blocked", reason: "destinatário não encontrado" };
  if (input.mode === "automatic") {
    const automation = campaignAutomationProblem(recipient.relationship_campaigns);
    if (automation) blockers.unshift(automation);
  }
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
  // Mesmo contrato do Follow-up V2 para a retomada (exatamente {{1}}).
  const contract =
    info.var1 === "resume_phrase"
      ? resumeTemplateProblem(template)
      : names.length > 1
        ? `template "${template.name}" tem ${names.length} variáveis; só {{1}} é suportado`
        : null;
  if (contract) return { status: "blocked", reason: contract };

  const conversation = await findWhatsappConversation(companyId, lead.id);

  const stored = storedPrepared(recipient);
  const problem = preparedProblem(stored, {
    companyId,
    relationshipCampaignId: input.relationshipCampaignId,
    recipientId: recipient.id,
    lead,
    purpose,
    template,
  });
  if (input.varSource === "prepared" && problem)
    return {
      status: "blocked",
      code: "not_prepared",
      blockers,
      reason: `envio bloqueado: ${problem} — gere a prévia do destinatário antes de enviar`,
    };
  const reuse = !problem && (input.varSource === "prepared" || !input.regenerate);

  const variables: Record<string, string> = {};
  let phraseSource: string | undefined;
  if (reuse) {
    Object.assign(variables, stored!.variables);
    phraseSource = stored!.phrase_source ?? undefined;
  } else if (names.length === 1) {
    if (info.var1 === "resume_phrase") {
      const context = await loadResumeContext(companyId, conversation?.id ?? null, lead.id);
      const phrase = await generateResumePhrase({
        companyId,
        context,
        templateBody: templateBodyText(template.components),
      });
      variables[names[0]] = phrase.text;
      phraseSource = phrase.source;
    } else {
      variables[names[0]] = firstName(lead.name);
    }
  }
  // Prévia: mesmo template, mesmas variáveis; as chaves só marcam o trecho
  // variável na tela — o envio usa `variables` sem elas.
  const rendered = renderTemplatePreview(template, variables);
  if (rendered.parameters.some((p) => !p || !p.trim()))
    return { status: "blocked", reason: `variável {{1}} ficaria vazia no template "${template.name}"` };
  const preparedRecord: PreparedVariables = reuse
    ? stored!
    : {
        version: 1,
        id: crypto.randomUUID(),
        company_id: companyId,
        relationship_campaign_id: input.relationshipCampaignId,
        recipient_id: recipient.id,
        lead_id: lead.id,
        purpose,
        template: { name: template.name, language: template.language },
        variables,
        content: rendered.body,
        phrase_source: phraseSource ?? null,
        prepared_at: now.toISOString(),
      };

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
    contentPreview: rendered.marked,
    phraseSource,
    preparedRecord,
    preparedOrigin: reuse ? "reused" : "generated",
    conversationId: conversation?.id ?? null,
    blockers,
  };
}

/**
 * Salva o var1 da prévia no destinatário — só `metadata.prepared_dispatch`;
 * status, tentativas e demais campos não mudam. Escrita condicionada ao
 * `updated_at` lido (compare-and-set): prévias concorrentes não se atropelam.
 */
async function savePreparedVariables(
  companyId: string,
  relationshipCampaignId: string,
  recipient: any,
  record: PreparedVariables,
): Promise<{ saved: boolean; error?: string }> {
  if (!["pending", "failed"].includes(recipient.status))
    return { saved: false, error: `destinatário está como ${recipient.status}` };
  const { data, error } = await db
    .from("relationship_campaign_recipients")
    .update({ metadata: { ...(recipient.metadata ?? {}), [PREPARED_KEY]: record } })
    .eq("company_id", companyId)
    .eq("relationship_campaign_id", relationshipCampaignId)
    .eq("id", recipient.id)
    .eq("updated_at", recipient.updated_at)
    .in("status", ["pending", "failed"])
    .select("id")
    .maybeSingle();
  if (error) return { saved: false, error: error.message ?? String(error) };
  if (!data) return { saved: false, error: "destinatário mudou durante a prévia; gere a prévia de novo" };
  return { saved: true };
}

/**
 * Prévia do disparo para um destinatário: a mesma preparação do envio real,
 * sem enviar e sem criar conversa. A única escrita é salvar o var1 preparado
 * (quando é novo), que o envio real vai reutilizar tal e qual.
 */
export async function previewRelationshipDispatch(input: {
  companyId: string;
  relationshipCampaignId: string;
  recipientId: string;
  mode: RelationshipMode;
  now?: Date;
  /** Gera outro var1 mesmo havendo um salvo válido. */
  regenerate?: boolean;
}) {
  const prepared = await prepareRelationshipDispatch({
    ...input,
    now: input.now ?? new Date(),
    varSource: "preview",
  });
  if (prepared.status !== "ready") {
    return { status: "preview" as const, would_send: false, blockers: [prepared.reason], outcome: prepared.status };
  }
  const blockers = [...prepared.blockers];
  const save =
    prepared.preparedOrigin === "reused"
      ? { saved: true }
      : await savePreparedVariables(
          input.companyId,
          input.relationshipCampaignId,
          prepared.recipient,
          prepared.preparedRecord,
        );
  if (!save.saved) blockers.push(`var1 não foi salvo para o envio: ${save.error}`);
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
    content_preview: prepared.contentPreview,
    phrase_source: prepared.phraseSource ?? null,
    prepared: {
      id: prepared.preparedRecord.id,
      prepared_at: prepared.preparedRecord.prepared_at,
      reused: prepared.preparedOrigin === "reused",
      saved: save.saved,
      error: save.error ?? null,
    },
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

  // Envio real: só com o var1 salvo na prévia — sem IA, sem gerar outro.
  let prepared = await prepareRelationshipDispatch({ ...input, now, varSource: "prepared" });

  // Automático: sem var1 válido salvo, prepara agora pelo mesmo pipeline do
  // "Testar" (prévia + salvamento) e relê do banco. Manual/assistido seguem
  // exigindo a prévia explícita.
  if (prepared.status === "blocked" && prepared.code === "not_prepared" && input.mode === "automatic") {
    // Proteções antes da IA: automação desligada, fora do horário, status
    // final ou tentativas esgotadas não geram nada.
    if (prepared.blockers?.length) return { status: "blocked" as const, reason: prepared.blockers.join("; ") };
    const failure = await autoPrepareRecipient(input, now);
    if (failure) return failure;
    prepared = await prepareRelationshipDispatch({ ...input, now, varSource: "prepared" });
    if (prepared.status === "blocked" && prepared.code === "not_prepared") {
      await recordPreparationFailure(input, now, prepared.reason);
      return { status: "blocked" as const, reason: `preparação automática inválida: ${prepared.reason}` };
    }
  }

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
    .eq("relationship_campaign_id", input.relationshipCampaignId)
    .eq("id", recipient.id)
    // Compare-and-set: se outra prévia trocou o var1 (ou outro worker reservou)
    // depois da leitura, nada é enviado.
    .eq("updated_at", recipient.updated_at)
    .in("status", ["pending", "failed"])
    .select("id")
    .maybeSingle();
  if (claimError) throw claimError;
  if (!claimed)
    return { status: "idempotent" as const, reason: "destinatário mudou ou já foi reservado; nada enviado" };

  // Exatamente o var1 salvo na prévia (conteúdo interno, sem {{ }}).
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

/**
 * Preparação automática: exatamente `previewRelationshipDispatch` (o mesmo do
 * botão "Testar"), que gera o var1 e o salva com compare-and-set. Devolve o
 * bloqueio quando não há var1 salvo utilizável — e registra o motivo.
 */
async function autoPrepareRecipient(
  input: { companyId: string; relationshipCampaignId: string; recipientId: string; mode: RelationshipMode },
  now: Date,
): Promise<{ status: "blocked"; reason: string } | null> {
  let reason: string | null = null;
  try {
    const preview = await previewRelationshipDispatch({ ...input, now });
    if (!("prepared" in preview) || !preview.prepared) reason = preview.blockers.join("; ");
    else if (!preview.prepared.saved) reason = `var1 não foi salvo: ${preview.prepared.error}`;
  } catch (e) {
    reason = e instanceof Error ? e.message : String(e);
  }
  if (!reason) return null;
  await recordPreparationFailure(input, now, reason);
  return { status: "blocked", reason: `preparação automática falhou: ${reason}` };
}

/**
 * Registra no destinatário por que a preparação automática não serviu e adia
 * a próxima tentativa (backoff). Status e tentativas não mudam: nada foi enviado.
 */
async function recordPreparationFailure(
  input: { companyId: string; relationshipCampaignId: string; recipientId: string },
  now: Date,
  reason: string,
) {
  const settings = await getRelationshipSettings(input.companyId);
  const { error } = await db
    .from("relationship_campaign_recipients")
    .update({
      last_error: `preparação automática: ${reason}`.slice(0, 500),
      next_attempt_at: new Date(now.getTime() + settingsBackoffMs(settings, 1)).toISOString(),
      updated_at: now.toISOString(),
    })
    .eq("company_id", input.companyId)
    .eq("relationship_campaign_id", input.relationshipCampaignId)
    .eq("id", input.recipientId)
    .in("status", ["pending", "failed"]);
  if (error) throw error;
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
  if (input.mode === "automatic") {
    const problem = campaignAutomationProblem(await loadCampaign(input.companyId, input.relationshipCampaignId));
    if (problem) return { status: "disabled" as const, reason: problem, candidates: [] };
  }
  if (!isWithinRelationshipWindow(now, settings)) {
    return { status: "outside_window" as const, reason: "fora do horário comercial", candidates: [] };
  }

  // Limites da empresa (todas as campanhas): janela móvel de 24 h e de 1 h.
  const { data: sentRecent, error: sentError } = await db
    .from("relationship_campaign_recipients")
    .select("id,sent_at")
    .eq("company_id", input.companyId)
    .in("status", ["sent", "delivered", "replied", "converted"])
    .gte("sent_at", new Date(now.getTime() - 24 * 3600_000).toISOString());
  if (sentError) throw sentError;
  const sentDay = (sentRecent ?? []).length;
  const hourAgo = now.getTime() - 3600_000;
  const sentHour = (sentRecent ?? []).filter(
    (row: { sent_at: string | null }) => row.sent_at && new Date(row.sent_at).getTime() >= hourAgo,
  ).length;
  if (sentDay >= settings.daily_limit) {
    return { status: "daily_limit" as const, reason: "limite diário atingido", candidates: [] };
  }
  if (sentHour >= settings.hourly_limit) {
    return { status: "hourly_limit" as const, reason: "limite por hora atingido", candidates: [] };
  }

  const remaining = Math.max(
    0,
    Math.min(
      input.limit ?? settings.hourly_limit,
      settings.hourly_limit - sentHour,
      settings.daily_limit - sentDay,
    ),
  );
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

/**
 * Um ciclo do modo automático para uma campanha: o scheduler aplica
 * automação ligada, horário e limites; cada candidato passa por
 * `dispatchRelationshipRecipient` (modo automático), que prepara o var1 se
 * preciso e envia só o salvo. Com o envio real desligado no servidor, cada
 * disparo vira prévia. Chamado pelo runtime-tick (relationship-campaign-tick).
 */
export async function runAutomaticRelationshipBatch(input: {
  companyId: string;
  relationshipCampaignId: string;
  now?: Date;
  limit?: number;
  /** Epoch ms: candidatos restantes ficam para o próximo tick. */
  deadlineAt?: number;
}) {
  const now = input.now ?? new Date();
  const plan = await scheduleRelationshipCampaign({ ...input, now, mode: "automatic" });
  if (plan.status !== "planned")
    return { status: plan.status, reason: plan.reason, results: [] as Array<Record<string, unknown>> };

  const results: Array<Record<string, unknown>> = [];
  for (const candidate of plan.candidates as Array<{ id: string }>) {
    if (input.deadlineAt !== undefined && Date.now() > input.deadlineAt) {
      results.push({ recipient_id: candidate.id, status: "deferred", reason: "prazo do tick" });
      continue;
    }
    try {
      const result = await dispatchRelationshipRecipient({
        companyId: input.companyId,
        relationshipCampaignId: input.relationshipCampaignId,
        recipientId: candidate.id,
        mode: "automatic",
        now,
        dryRun: false,
      });
      results.push({ recipient_id: candidate.id, ...result });
    } catch (e) {
      results.push({ recipient_id: candidate.id, status: "error", error: e instanceof Error ? e.message : String(e) });
    }
  }
  return { status: "ran" as const, real_send_enabled: realSendIsEnabled(), results };
}

/**
 * Assistido: "Preparar com IA" — roda a prévia (mesmo pipeline do "Testar")
 * para os próximos destinatários pendentes e salva o var1 de cada um. Nada é
 * enviado; o operador aprova o envio depois, destinatário a destinatário.
 */
export async function prepareRelationshipCampaignBatch(input: {
  companyId: string;
  relationshipCampaignId: string;
  limit?: number;
  now?: Date;
}) {
  const limit = Math.max(1, Math.min(input.limit ?? 25, 50));
  const { data, error } = await db
    .from("relationship_campaign_recipients")
    .select("id")
    .eq("company_id", input.companyId)
    .eq("relationship_campaign_id", input.relationshipCampaignId)
    .in("status", ["pending", "failed"])
    .order("created_at", { ascending: true })
    .limit(limit);
  if (error) throw error;
  const summary = { prepared: 0, reused: 0, blocked: 0 };
  const results: Array<Record<string, unknown>> = [];
  for (const row of (data ?? []) as Array<{ id: string }>) {
    const preview = await previewRelationshipDispatch({
      companyId: input.companyId,
      relationshipCampaignId: input.relationshipCampaignId,
      recipientId: row.id,
      mode: "assisted",
      now: input.now,
    });
    const prepared = "prepared" in preview ? preview.prepared : undefined;
    if (prepared?.saved) summary[prepared.reused ? "reused" : "prepared"] += 1;
    else summary.blocked += 1;
    results.push({ recipient_id: row.id, saved: prepared?.saved === true, blockers: preview.blockers });
  }
  return { status: "prepared" as const, ...summary, results };
}

/**
 * Envio pelo operador (manual: "Enviar"; assistido: "Aprovar e enviar").
 * Usa só o var1 salvo; sem ele, bloqueia. O kill switch continua valendo.
 */
export async function sendRelationshipRecipientByOperator(input: {
  companyId: string;
  relationshipCampaignId: string;
  recipientId: string;
  now?: Date;
}) {
  const campaign = await loadCampaign(input.companyId, input.relationshipCampaignId);
  if (!campaign) throw new Error("campanha não encontrada");
  return dispatchRelationshipRecipient({
    ...input,
    mode: campaign.dispatch_mode === "assisted" ? "assisted" : "manual",
    dryRun: false,
  });
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
