// ============================================================================
// followup/dispatch.ts
// Responsabilidade: motor único de envio de follow-up — usado pelo tick (cron)
// e pelo "Follow-up agora" (manual). Decide o canal, revalida no último
// instante e persiste a tentativa.
//
//  1. revalida: o follow-up ainda faz sentido AGORA? (cliente respondeu,
//     venda fechada/perdida, humano assumiu, desinteresse, IA processando);
//  2. dentro da janela 24h: texto livre (mensagem já montada pelo chamador);
//  3. fora da janela: `chamar_novamente` com {{1}} = retomada contextual da
//     conversa (IA com fallback determinístico). Empresa sem esse template
//     aprovado segue no template legado por propósito, como antes;
//  4. persiste em `follow_ups` (+ `ai_flow_events`), com o texto de fato
//     enviado.
// ============================================================================

import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { sendWhatsappText } from "@/lib/ai-agent.server";
import {
  findApprovedTemplateForPurpose,
  renderTemplateBody,
  sendWhatsappTemplate,
  type TemplatePurpose,
  type TemplateRow,
} from "@/lib/wa-templates.server";

import { generateResumePhrase, loadResumeContext } from "./resume";
import type { FollowupRule } from "./types";

export type FollowupTrigger =
  | { kind: "auto" }
  | { kind: "manual"; userId: string }
  | { kind: "reactivation"; reason: string; variantSeed?: number };

export interface DispatchInput {
  companyId: string;
  conversationId: string;
  leadId: string;
  rule: FollowupRule;
  attempt: number;
  /** Mensagem de texto para dentro da janela 24h. */
  text: string;
  outsideWindow: boolean;
  signal: string;
  /**
   * Última mensagem do cliente (ou envio de referência, ex. orçamento) que
   * justificou o follow-up. Mensagem do cliente depois disso = ele respondeu.
   */
  referenceAt: string | null;
  trigger: FollowupTrigger;
  /** Ciclo de negociação a que a tentativa pertence (reativação não tem). */
  cycleId?: string | null;
}

export type DispatchStatus = "sent" | "simulated" | "failed" | "blocked" | "skipped";

/**
 * Por que a revalidação barrou o envio. Os definitivos encerram o ciclo;
 * `ai_busy` só adia.
 */
export type SkipCode =
  | "client_replied"
  | "sale_closed"
  | "sale_lost"
  | "human_takeover"
  | "disinterest"
  | "conversation_missing"
  | "ai_busy";

export interface DispatchResult {
  status: DispatchStatus;
  /** skipped/blocked: por que não saiu. */
  reason?: string;
  skipCode?: SkipCode;
  error?: string;
  via: "text" | "template";
  templateName?: string;
  /** Texto efetivamente enviado (ou que seria). */
  message: string;
  externalId?: string | null;
  simulationId?: string | null;
  resumePhrase?: string;
  resumePhraseSource?: string;
}

/** Nome legado do nome do cliente no {{1}}: primeiro nome ou saudação neutra. */
function legacyFirstName(name: string | null | undefined): string {
  return name?.trim().split(/\s+/)[0] || "tudo bem";
}

/**
 * O follow-up ainda é necessário? Roda imediatamente antes do envio — entre a
 * seleção do candidato e o envio há leitura de contexto e chamada de IA, e o
 * cliente pode ter respondido nesse meio-tempo.
 */
export async function revalidateFollowup(
  input: Pick<DispatchInput, "companyId" | "conversationId" | "leadId" | "referenceAt">,
): Promise<{ ok: true } | { ok: false; code: SkipCode; reason: string }> {
  const { companyId, conversationId, leadId, referenceAt } = input;

  const { data: conv } = await supabaseAdmin
    .from("conversations")
    .select("ai_status, ai_handling, human_takeover_at")
    .eq("company_id", companyId)
    .eq("id", conversationId)
    .maybeSingle();
  if (!conv) return { ok: false, code: "conversation_missing", reason: "conversa não encontrada" };
  if (conv.ai_status === "assumido_humano" || conv.human_takeover_at)
    return { ok: false, code: "human_takeover", reason: "humano assumiu" };
  if (conv.ai_status === "desinteresse")
    return { ok: false, code: "disinterest", reason: "cliente sem interesse" };
  if (conv.ai_status === "perdido")
    return { ok: false, code: "sale_lost", reason: "venda perdida" };
  if (conv.ai_handling) return { ok: false, code: "ai_busy", reason: "IA em processamento" };

  const { data: lead } = await supabaseAdmin
    .from("leads")
    .select("status, closed_at, lost_at")
    .eq("company_id", companyId)
    .eq("id", leadId)
    .maybeSingle();
  if (lead?.status === "fechado" || lead?.closed_at)
    return { ok: false, code: "sale_closed", reason: "venda fechada" };
  if (lead?.status === "perdido" || lead?.lost_at)
    return { ok: false, code: "sale_lost", reason: "venda perdida" };

  const { data: lastLead } = await supabaseAdmin
    .from("messages")
    .select("at")
    .eq("company_id", companyId)
    .eq("conversation_id", conversationId)
    .eq("role", "lead")
    .order("at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const lastLeadAt = (lastLead as { at?: string } | null)?.at ?? null;
  // Compara por instante, não por texto: o mesmo horário pode vir como "Z" ou
  // "+00:00" e com casas de fração diferentes. 1s absorve arredondamento.
  if (lastLeadAt && (!referenceAt || Date.parse(lastLeadAt) > Date.parse(referenceAt) + 1000))
    return { ok: false, code: "client_replied", reason: "cliente respondeu" };

  return { ok: true };
}

type Outcome = Omit<DispatchResult, "status" | "via" | "message"> & {
  status: Exclude<DispatchStatus, "skipped">;
};

async function persist(
  input: DispatchInput,
  result: DispatchResult,
  extra: Record<string, unknown>,
) {
  if (result.status === "skipped") return;
  const manual = input.trigger.kind === "manual";
  const reactivation = input.trigger.kind === "reactivation";
  const metadata: Record<string, unknown> = {
    signal: input.signal,
    via: result.via,
    ...(result.templateName ? { template_name: result.templateName } : {}),
    ...(result.resumePhrase
      ? { resume_phrase: result.resumePhrase, resume_phrase_source: result.resumePhraseSource }
      : {}),
    ...(manual ? { manual: true, by: (input.trigger as { userId: string }).userId } : {}),
    ...(reactivation ? { reactivation: true } : {}),
    ...extra,
  };
  if (result.status === "simulated") {
    metadata.simulated = true;
    metadata.simulation_id = result.simulationId ?? null;
    metadata.external_request_sent = false;
  } else if (result.status === "sent") {
    metadata.external_id = result.externalId ?? null;
  } else if (result.status === "failed") {
    metadata.error = result.error;
  } else if (result.status === "blocked") {
    metadata.reason = extra.reason ?? result.reason;
  }

  await supabaseAdmin.from("follow_ups").insert({
    company_id: input.companyId,
    conversation_id: input.conversationId,
    lead_id: input.leadId,
    rule_type: input.rule,
    attempt_number: input.attempt,
    message_text: result.message,
    status: result.status,
    cycle_id: input.cycleId ?? null,
    ...(manual ? { trigger_reason: "manual_admin" } : {}),
    ...(input.trigger.kind === "reactivation"
      ? { trigger_reason: input.trigger.reason, variant_seed: input.trigger.variantSeed ?? null }
      : {}),
    metadata: metadata as never,
  });

  const eventType =
    result.status === "sent"
      ? "followup_sent"
      : result.status === "simulated"
        ? "followup_simulated"
        : result.status === "failed"
          ? "followup_failed"
          : "template_missing";
  await supabaseAdmin.from("ai_flow_events").insert({
    company_id: input.companyId,
    conversation_id: input.conversationId,
    lead_id: input.leadId,
    event_type: eventType,
    payload: {
      rule: input.rule,
      attempt: input.attempt,
      signal: input.signal,
      via: result.via,
      ...(result.templateName ? { template_name: result.templateName } : {}),
      ...(result.simulationId ? { simulation_id: result.simulationId } : {}),
      ...(result.error ? { error: result.error } : {}),
      ...(manual ? { manual: true } : {}),
    },
  });
}

/** Template fora da janela: `chamar_novamente` contextual, senão o legado. */
async function pickTemplate(
  input: DispatchInput,
): Promise<
  | { kind: "resume"; template: TemplateRow }
  | { kind: "legacy"; template: TemplateRow; purpose: TemplatePurpose }
  | null
> {
  const resume = await findApprovedTemplateForPurpose(input.companyId, "followup_resume");
  if (resume) return { kind: "resume", template: resume };
  const purpose = input.rule as TemplatePurpose;
  const legacy = await findApprovedTemplateForPurpose(input.companyId, purpose);
  return legacy ? { kind: "legacy", template: legacy, purpose } : null;
}

function bodyText(template: TemplateRow): string {
  const body = (template.components as Array<Record<string, unknown>>).find(
    (c) => String(c.type ?? "").toUpperCase() === "BODY",
  );
  return String(body?.text ?? "");
}

export async function dispatchFollowup(input: DispatchInput): Promise<DispatchResult> {
  // Revalida antes do trabalho caro (contexto + IA)…
  const early = await revalidateFollowup(input);
  if (!early.ok) {
    return {
      status: "skipped",
      reason: early.reason,
      skipCode: early.code,
      via: input.outsideWindow ? "template" : "text",
      message: input.text,
    };
  }

  if (!input.outsideWindow) {
    // …e de novo imediatamente antes de enviar.
    const late = await revalidateFollowup(input);
    if (!late.ok)
      return {
        status: "skipped",
        reason: late.reason,
        skipCode: late.code,
        via: "text",
        message: input.text,
      };
    const send = await sendWhatsappText({
      companyId: input.companyId,
      conversationId: input.conversationId,
      leadId: input.leadId,
      text: input.text,
    });
    const outcome: Outcome = !send.ok
      ? { status: "failed", error: send.error }
      : send.simulated
        ? { status: "simulated", simulationId: send.simulationId ?? null, externalId: null }
        : { status: "sent", externalId: send.externalId ?? null };
    const result: DispatchResult = { ...outcome, via: "text", message: input.text };
    await persist(input, result, {});
    return result;
  }

  const picked = await pickTemplate(input);
  if (!picked) {
    const result: DispatchResult = {
      status: "blocked",
      reason: "fora da janela 24h e sem template aprovado",
      via: "template",
      message: input.text,
    };
    await persist(input, result, { purpose: "followup_resume", reason: "template_missing" });
    return result;
  }

  const { template } = picked;
  const firstVar = template.variables?.[0];
  let variables: Record<string, string> = {};
  let resumePhrase: { text: string; source: string } | undefined;
  let purpose: TemplatePurpose;

  if (picked.kind === "resume") {
    purpose = "followup_resume";
    const context = await loadResumeContext(input.companyId, input.conversationId, input.leadId);
    const phrase = await generateResumePhrase({
      companyId: input.companyId,
      context,
      templateBody: bodyText(template),
    });
    resumePhrase = phrase;
    if (phrase.aiError) console.warn("[followup] retomada sem IA:", phrase.aiError);
    if (firstVar) variables = { [firstVar]: phrase.text };
  } else {
    // Templates legados foram aprovados com o nome em {{1}}.
    purpose = picked.purpose;
    const { data: lead } = await supabaseAdmin
      .from("leads")
      .select("name")
      .eq("company_id", input.companyId)
      .eq("id", input.leadId)
      .maybeSingle();
    (template.variables ?? []).forEach((v, i) => {
      variables[v] = i === 0 ? legacyFirstName(lead?.name) : "";
    });
  }
  const message = renderTemplateBody(template, variables).body || input.text;

  // A geração da frase leva tempo: o cliente pode ter respondido.
  const late = await revalidateFollowup(input);
  if (!late.ok) {
    return {
      status: "skipped",
      reason: late.reason,
      skipCode: late.code,
      via: "template",
      templateName: template.name,
      message,
      resumePhrase: resumePhrase?.text,
      resumePhraseSource: resumePhrase?.source,
    };
  }

  const send = await sendWhatsappTemplate({
    companyId: input.companyId,
    conversationId: input.conversationId,
    leadId: input.leadId,
    purpose,
    variables,
    source: "followup_template",
  });
  const outcome: Outcome = !send.ok
    ? { status: "failed", error: send.error }
    : send.simulated
      ? { status: "simulated", simulationId: send.simulationId, externalId: null }
      : { status: "sent", externalId: send.externalId };
  const result: DispatchResult = {
    ...outcome,
    via: "template",
    templateName: template.name,
    message,
    resumePhrase: resumePhrase?.text,
    resumePhraseSource: resumePhrase?.source,
  };
  await persist(input, result, { category: template.category, purpose });
  return result;
}
