// ============================================================================
// AI Follow-up v2 — camada isolada de inteligência adicional.
// Tudo aqui é OPT-IN via flags em company_settings. Falha silenciosa:
// se algo aqui quebrar, o tick principal (ai-followup.server.ts) continua
// funcionando como antes. NÃO altera inbox/meta-send/meta-webhook.
// ============================================================================

import { supabaseAdmin } from "@/integrations/supabase/client.server";

// ---------------------------------------------------------------------------
// Tipos
// ---------------------------------------------------------------------------

export type LeadTemperature = "hot" | "warm" | "cold";

export interface WhatsappIntegrationStatus {
  connected: boolean;
  hasUnmapped: boolean;
  unmappedCount: number;
  displayName: string | null;
  externalAccountId: string | null;
  tokenExpiresAt: string | null;
  lastError: string | null;
  unmappedSamples: Array<{
    phone_number_id: string;
    display_phone_number: string | null;
    contact_name: string | null;
    created_at: string;
  }>;
}

export interface FollowupV2Settings {
  humanize: boolean;
  delayJitterMinutes: number;
  dailyLimit: number;
  minResponseRate: number;
  warmupEnabled: boolean;
  warmupStartedAt: string | null;
  reactivationEnabled: boolean;
  reactivationDays: number;
  reactivationDailyMax: number;
  reactivationHoursStart: string;
  reactivationHoursEnd: string;
  reactivationTemplate: string;
}

// ---------------------------------------------------------------------------
// Settings v2
// ---------------------------------------------------------------------------

export async function getFollowupV2Settings(
  companyId: string,
): Promise<FollowupV2Settings | null> {
  try {
    const { data } = await supabaseAdmin
      .from("company_settings")
      .select(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        "ai_followup_humanize, ai_followup_delay_jitter_minutes, ai_followup_daily_limit, ai_followup_min_response_rate, ai_followup_warmup_enabled, ai_followup_warmup_started_at, ai_followup_reactivation_enabled, ai_followup_reactivation_days, ai_followup_reactivation_daily_max, ai_followup_reactivation_hours_start, ai_followup_reactivation_hours_end, ai_followup_reactivation_template" as any,
      )
      .eq("company_id", companyId)
      .maybeSingle();
    if (!data) return null;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const d = data as any;
    return {
      humanize: d.ai_followup_humanize ?? true,
      delayJitterMinutes: d.ai_followup_delay_jitter_minutes ?? 35,
      dailyLimit: d.ai_followup_daily_limit ?? 50,
      minResponseRate: Number(d.ai_followup_min_response_rate ?? 0.05),
      warmupEnabled: d.ai_followup_warmup_enabled ?? true,
      warmupStartedAt: d.ai_followup_warmup_started_at ?? null,
      reactivationEnabled: d.ai_followup_reactivation_enabled ?? false,
      reactivationDays: d.ai_followup_reactivation_days ?? 30,
      reactivationDailyMax: d.ai_followup_reactivation_daily_max ?? 10,
      reactivationHoursStart: d.ai_followup_reactivation_hours_start ?? "09:00:00",
      reactivationHoursEnd: d.ai_followup_reactivation_hours_end ?? "18:00:00",
      reactivationTemplate:
        d.ai_followup_reactivation_template ??
        "Oi {{nome}}, faz um tempinho que não nos falamos. Posso te ajudar com algo hoje?",
    };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Humanização — variações automáticas (saudação, emoji, CTA)
// ---------------------------------------------------------------------------

const GREETINGS = [
  "Oi {{nome}}",
  "Olá {{nome}}",
  "E aí {{nome}}",
  "Oi {{nome}}, tudo bem?",
  "Passando aqui rapidinho, {{nome}}",
];

const EMOJIS = ["😊", "🙂", "✨", "👋", ""];

const CTAS = [
  "Qualquer dúvida estou por aqui.",
  "Se preferir, é só me chamar quando puder.",
  "Posso te ajudar com algo agora?",
  "Fico no aguardo do seu retorno 🙏",
  "Quando puder, me dá um retorno por aqui.",
];

function pickSeeded<T>(arr: T[], seed: number, salt: number): T {
  const idx = Math.abs((seed * 9301 + salt * 49297) % 233280) % arr.length;
  return arr[idx];
}

export function humanizeTemplate(
  rawTemplate: string,
  attemptNumber: number,
  seed: number,
  vars: Record<string, string> = {},
): { text: string; variant: number } {
  // Substituição final de placeholders ({{nome}}, {{produto}}, {{agente}}, ...).
  // Executada também AO FINAL para cobrir placeholders introduzidos pelas
  // variações de saudação/CTA (ex.: "E aí {{nome}}"), evitando vazar
  // "{{nome}}" no WhatsApp.
  const interpolate = (s: string): string =>
    s.replace(/\{\{(\w+)\}\}/g, (_, k: string) => vars[k] ?? "");

  try {
    // Variante 1 = template original; 2+ aplica mutação
    if (attemptNumber <= 1 && seed % 3 === 0) {
      return { text: interpolate(rawTemplate), variant: 0 };
    }
    let text = rawTemplate;
    // Substitui saudação inicial se começar com "Oi" / "Olá"
    const greetingMatch = text.match(/^(Oi|Olá|Ola|E aí)[^,\n!.]*[,!.]?\s*/i);
    if (greetingMatch) {
      const newGreeting = pickSeeded(GREETINGS, seed, attemptNumber);
      text = newGreeting + ", " + text.slice(greetingMatch[0].length).trim();
    }
    // Emoji opcional
    const emoji = pickSeeded(EMOJIS, seed, attemptNumber + 7);
    if (emoji && !/[\u{1F300}-\u{1FAFF}]/u.test(text)) {
      text = text.replace(/([.!?])\s/, `$1 ${emoji} `);
    }
    // CTA final na 2ª+ tentativa
    if (attemptNumber > 1) {
      const cta = pickSeeded(CTAS, seed, attemptNumber + 13);
      text = text.trim() + "\n\n" + cta;
    }
    return { text: interpolate(text), variant: (seed * 31 + attemptNumber) | 0 };
  } catch {
    return { text: interpolate(rawTemplate), variant: 0 };
  }
}

// ---------------------------------------------------------------------------
// Lead score
// ---------------------------------------------------------------------------

export interface LeadScoreResult {
  score: number;
  temperature: LeadTemperature;
}

export async function computeLeadScore(leadId: string): Promise<LeadScoreResult> {
  try {
    const { data: lead } = await supabaseAdmin
      .from("leads")
      .select("id, company_id, created_at, updated_at")
      .eq("id", leadId)
      .maybeSingle();
    if (!lead) return { score: 0, temperature: "cold" };

    // mensagens do lead nas últimas 30 dias
    const since = new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString();
    const { data: convs } = await supabaseAdmin
      .from("conversations")
      .select("id, last_message_at")
      .eq("lead_id", leadId)
      .gte("updated_at", since);
    const convIds = (convs ?? []).map((c) => c.id);

    let msgCount = 0;
    let lastClientAt: string | null = null;
    if (convIds.length) {
      const { data: msgs } = await supabaseAdmin
        .from("messages")
        .select("role, at")
        .in("conversation_id", convIds)
        .gte("at", since);
      for (const m of msgs ?? []) {
        if (m.role === "lead") {
          msgCount++;
          if (!lastClientAt || m.at > lastClientAt) lastClientAt = m.at;
        }
      }
    }

    const { data: quotes } = await supabaseAdmin
      .from("quotes")
      .select("id")
      .eq("lead_id", leadId)
      .limit(5);

    const { data: respondedFu } = await supabaseAdmin
      .from("follow_ups")
      .select("id")
      .eq("lead_id", leadId)
      .in("status", ["responded", "recovered"])
      .limit(5);

    let score = 0;
    score += Math.min(msgCount, 10) * 4; // até 40
    if ((quotes?.length ?? 0) > 0) score += 25; // pediu/recebeu orçamento
    if ((respondedFu?.length ?? 0) > 0) score += 15;
    if (lastClientAt) {
      const ageHrs = (Date.now() - new Date(lastClientAt).getTime()) / 3600_000;
      if (ageHrs < 24) score += 20;
      else if (ageHrs < 72) score += 10;
      else if (ageHrs < 168) score += 5;
    }
    score = Math.max(0, Math.min(100, score));
    const temperature: LeadTemperature =
      score >= 60 ? "hot" : score >= 30 ? "warm" : "cold";

    await supabaseAdmin
      .from("leads")
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .update({
        lead_score: score,
        lead_temperature_cached: temperature,
        last_score_at: new Date().toISOString(),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any)
      .eq("id", leadId);

    return { score, temperature };
  } catch {
    return { score: 0, temperature: "cold" };
  }
}

export async function getLeadTemperatureSummary(
  companyId: string,
): Promise<{ hot: number; warm: number; cold: number }> {
  try {
    // 1) Leads ativos da empresa
    const { data: leads } = await supabaseAdmin
      .from("leads")
      .select("id, status, lead_temperature_cached")
      .eq("company_id", companyId)
      .not("status", "in", "(fechado,perdido)");
    const leadRows = (leads ?? []) as Array<{
      id: string;
      status: string;
      lead_temperature_cached: string | null;
    }>;
    if (!leadRows.length) return { hot: 0, warm: 0, cold: 0 };

    const leadIds = leadRows.map((l) => l.id);
    const now = Date.now();
    const since30 = new Date(now - 30 * 24 * 3600 * 1000).toISOString();
    const nowIso = new Date(now).toISOString();

    // 2) Sinais em lote (conversas, quotes, visitas)
    const [convsRes, quotesRes, visitsRes] = await Promise.all([
      supabaseAdmin
        .from("conversations")
        .select("id, lead_id")
        .eq("company_id", companyId)
        .in("lead_id", leadIds),
      supabaseAdmin
        .from("quotes")
        .select("lead_id")
        .eq("company_id", companyId)
        .in("lead_id", leadIds),
      supabaseAdmin
        .from("visits")
        .select("lead_id, scheduled_at, status")
        .eq("company_id", companyId)
        .in("lead_id", leadIds),
    ]);

    const convs = (convsRes.data ?? []) as Array<{ id: string; lead_id: string }>;
    const convToLead = new Map<string, string>();
    for (const c of convs) convToLead.set(c.id, c.lead_id);

    // Última mensagem do cliente por lead (últimos 30 dias)
    const lastClientByLead = new Map<string, number>();
    if (convs.length) {
      const { data: msgs } = await supabaseAdmin
        .from("messages")
        .select("conversation_id, at, role")
        .eq("company_id", companyId)
        .eq("role", "lead")
        .in(
          "conversation_id",
          convs.map((c) => c.id),
        )
        .gte("at", since30);
      for (const m of msgs ?? []) {
        const leadId = convToLead.get(m.conversation_id as string);
        if (!leadId) continue;
        const t = new Date(m.at as string).getTime();
        const cur = lastClientByLead.get(leadId) ?? 0;
        if (t > cur) lastClientByLead.set(leadId, t);
      }
    }

    const hasQuote = new Set<string>();
    for (const q of quotesRes.data ?? [])
      if (q.lead_id) hasQuote.add(q.lead_id as string);

    const hasUpcomingVisit = new Set<string>();
    for (const v of visitsRes.data ?? []) {
      if (!v.lead_id) continue;
      const when = v.scheduled_at
        ? new Date(v.scheduled_at as string).getTime()
        : 0;
      if (when >= now && v.status !== "cancelada")
        hasUpcomingVisit.add(v.lead_id as string);
    }

    let hot = 0;
    let warm = 0;
    let cold = 0;
    const updates: Array<{ id: string; t: LeadTemperature }> = [];

    for (const l of leadRows) {
      const lastClient = lastClientByLead.get(l.id) ?? 0;
      const ageDays = lastClient ? (now - lastClient) / 86_400_000 : Infinity;
      let t: LeadTemperature;
      // QUENTE: pediu orçamento, agendou visita, ou respondeu nos últimos 7 dias
      if (
        hasQuote.has(l.id) ||
        hasUpcomingVisit.has(l.id) ||
        (lastClient && ageDays <= 7)
      ) {
        t = "hot";
      } else if (lastClient && ageDays <= 30) {
        // MORNO: interagiu nos últimos 30 dias
        t = "warm";
      } else {
        // FRIO: sem interação há mais de 30 dias
        t = "cold";
      }
      if (t === "hot") hot++;
      else if (t === "warm") warm++;
      else cold++;
      if (l.lead_temperature_cached !== t) updates.push({ id: l.id, t });
    }

    // Persiste o cache (best-effort)
    if (updates.length) {
      await Promise.all(
        updates.map((u) =>
          supabaseAdmin
            .from("leads")
            .update({
              lead_temperature_cached: u.t,
              last_score_at: nowIso,
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
            } as any)
            .eq("id", u.id),
        ),
      ).catch(() => undefined);
    }

    return { hot, warm, cold };
  } catch {
    return { hot: 0, warm: 0, cold: 0 };
  }
}

// ---------------------------------------------------------------------------
// Status da integração WhatsApp
// ---------------------------------------------------------------------------

export async function getWhatsappIntegrationStatus(
  companyId: string,
): Promise<WhatsappIntegrationStatus> {
  const out: WhatsappIntegrationStatus = {
    connected: false,
    hasUnmapped: false,
    unmappedCount: 0,
    displayName: null,
    externalAccountId: null,
    tokenExpiresAt: null,
    lastError: null,
    unmappedSamples: [],
  };
  try {
    const { data: integ } = await supabaseAdmin
      .from("integrations")
      .select(
        "display_name, external_account_id, active, last_error, token_expires_at, has_access_token",
      )
      .eq("company_id", companyId)
      .eq("channel", "whatsapp")
      .eq("active", true)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (integ && integ.has_access_token) {
      out.connected = true;
      out.displayName = integ.display_name ?? null;
      out.externalAccountId = integ.external_account_id ?? null;
      out.tokenExpiresAt = integ.token_expires_at ?? null;
      out.lastError = integ.last_error ?? null;
    }
    const since = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString();
    const { data: unmapped } = await supabaseAdmin
      .from("whatsapp_unmapped_events")
      .select("phone_number_id, display_phone_number, contact_name, created_at")
      .gte("created_at", since)
      .order("created_at", { ascending: false })
      .limit(20);
    if (unmapped && unmapped.length > 0) {
      out.hasUnmapped = true;
      out.unmappedCount = unmapped.length;
      out.unmappedSamples = unmapped.slice(0, 5).map((u) => ({
        phone_number_id: u.phone_number_id,
        display_phone_number: u.display_phone_number,
        contact_name: u.contact_name,
        created_at: u.created_at,
      }));
    }
  } catch (e) {
    out.lastError = e instanceof Error ? e.message : "erro ao consultar integração";
  }
  return out;
}

// ---------------------------------------------------------------------------
// Anti-ban / gates centralizados
// ---------------------------------------------------------------------------

export interface SendGateResult {
  ok: boolean;
  reason?: string;
  remainingToday?: number;
}

function warmupCapacity(startedAt: string | null, dailyLimit: number): number {
  if (!startedAt) return Math.ceil(dailyLimit * 0.1);
  const days = Math.floor((Date.now() - new Date(startedAt).getTime()) / (24 * 3600 * 1000));
  if (days >= 7) return dailyLimit;
  if (days >= 3) return Math.ceil(dailyLimit * 0.5);
  if (days >= 1) return Math.ceil(dailyLimit * 0.25);
  return Math.ceil(dailyLimit * 0.1);
}

export async function canSendFollowupNow(companyId: string): Promise<SendGateResult> {
  try {
    const v2 = await getFollowupV2Settings(companyId);
    if (!v2) return { ok: true }; // sem v2, deixa o tick principal decidir

    // 1) integração ativa
    const status = await getWhatsappIntegrationStatus(companyId);
    if (!status.connected) return { ok: false, reason: "sem integração WhatsApp ativa" };

    // 2) limite diário (com warmup)
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    const { count: sentToday } = await supabaseAdmin
      .from("follow_ups")
      .select("id", { count: "exact", head: true })
      .eq("company_id", companyId)
      .eq("status", "sent")
      .gte("sent_at", startOfDay.toISOString());
    const cap = v2.warmupEnabled
      ? warmupCapacity(v2.warmupStartedAt, v2.dailyLimit)
      : v2.dailyLimit;
    if ((sentToday ?? 0) >= cap)
      return { ok: false, reason: `limite diário atingido (${cap})`, remainingToday: 0 };

    // 3) pausa por taxa de resposta baixa nos últimos 7 dias
    const sevenDays = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString();
    const { data: recent } = await supabaseAdmin
      .from("follow_ups")
      .select("status, responded_at")
      .eq("company_id", companyId)
      .gte("sent_at", sevenDays);
    const totalRecent = recent?.length ?? 0;
    if (totalRecent >= 20) {
      const responded = (recent ?? []).filter((f) => f.responded_at).length;
      const rate = responded / totalRecent;
      if (rate < v2.minResponseRate)
        return {
          ok: false,
          reason: `taxa de resposta baixa (${(rate * 100).toFixed(1)}% < ${(v2.minResponseRate * 100).toFixed(1)}%) — pausado automaticamente`,
        };
    }

    return { ok: true, remainingToday: cap - (sentToday ?? 0) };
  } catch (e) {
    // safe fallback: se quebrar, libera (tick principal ainda valida)
    return { ok: true, reason: e instanceof Error ? e.message : "gate v2 falhou" };
  }
}

// ---------------------------------------------------------------------------
// Jitter
// ---------------------------------------------------------------------------

export function jitterDelayMs(baseMs: number, jitterMinutes: number): number {
  const jitter = (Math.random() * 2 - 1) * jitterMinutes * 60 * 1000;
  return Math.max(0, baseMs + jitter);
}

// ---------------------------------------------------------------------------
// Analytics avançado
// ---------------------------------------------------------------------------

export interface AdvancedAnalytics {
  byDay: Array<{ day: string; sent: number; responded: number; recovered: number }>;
  byRule: Array<{ rule: string; sent: number; responded: number; rate: number }>;
  recoveredValue: number;
  bestHour: number | null;
  bestTemplate: string | null;
  bestTemplateRate: number;
  todaySent: number;
  todayLimit: number;
}

export async function getAdvancedAnalytics(
  companyId: string,
): Promise<AdvancedAnalytics> {
  const out: AdvancedAnalytics = {
    byDay: [],
    byRule: [],
    recoveredValue: 0,
    bestHour: null,
    bestTemplate: null,
    bestTemplateRate: 0,
    todaySent: 0,
    todayLimit: 0,
  };
  try {
    const since = new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString();
    const { data: fups } = await supabaseAdmin
      .from("follow_ups")
      .select("rule_type, status, sent_at, responded_at, lead_id")
      .eq("company_id", companyId)
      .gte("sent_at", since);
    const list = fups ?? [];

    // por dia
    const dayMap = new Map<string, { sent: number; responded: number; recovered: number }>();
    for (const f of list) {
      const day = new Date(f.sent_at).toISOString().slice(0, 10);
      const cur = dayMap.get(day) ?? { sent: 0, responded: 0, recovered: 0 };
      cur.sent++;
      if (f.responded_at) cur.responded++;
      if (f.status === "recovered") cur.recovered++;
      dayMap.set(day, cur);
    }
    out.byDay = Array.from(dayMap.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([day, v]) => ({ day, ...v }));

    // por regra
    const ruleMap = new Map<string, { sent: number; responded: number }>();
    for (const f of list) {
      const cur = ruleMap.get(f.rule_type) ?? { sent: 0, responded: 0 };
      cur.sent++;
      if (f.responded_at) cur.responded++;
      ruleMap.set(f.rule_type, cur);
    }
    out.byRule = Array.from(ruleMap.entries()).map(([rule, v]) => ({
      rule,
      sent: v.sent,
      responded: v.responded,
      rate: v.sent ? Math.round((v.responded / v.sent) * 1000) / 10 : 0,
    }));

    let best: { rule: string; rate: number } | null = null;
    for (const r of out.byRule) {
      if (r.sent >= 3 && (!best || r.rate > best.rate)) best = { rule: r.rule, rate: r.rate };
    }
    if (best) {
      out.bestTemplate = best.rule;
      out.bestTemplateRate = best.rate;
    }

    // melhor hora
    const hourMap = new Map<number, number>();
    for (const f of list) {
      if (!f.responded_at) continue;
      const h = new Date(f.sent_at).getHours();
      hourMap.set(h, (hourMap.get(h) ?? 0) + 1);
    }
    let bestH = -1,
      bestC = 0;
    for (const [h, c] of hourMap.entries()) {
      if (c > bestC) {
        bestH = h;
        bestC = c;
      }
    }
    if (bestH >= 0) out.bestHour = bestH;

    // valor recuperado
    const recoveredLeadIds = list
      .filter((f) => f.status === "recovered" && f.lead_id)
      .map((f) => f.lead_id as string);
    if (recoveredLeadIds.length) {
      const { data: leads } = await supabaseAdmin
        .from("leads")
        .select("id, closed_value, estimated_value")
        .in("id", recoveredLeadIds);
      for (const l of leads ?? []) {
        out.recoveredValue += Number(l.closed_value ?? l.estimated_value ?? 0);
      }
    }

    // limite/sent hoje
    const v2 = await getFollowupV2Settings(companyId);
    if (v2) {
      const startOfDay = new Date();
      startOfDay.setHours(0, 0, 0, 0);
      const { count } = await supabaseAdmin
        .from("follow_ups")
        .select("id", { count: "exact", head: true })
        .eq("company_id", companyId)
        .eq("status", "sent")
        .gte("sent_at", startOfDay.toISOString());
      out.todaySent = count ?? 0;
      out.todayLimit = v2.warmupEnabled
        ? warmupCapacity(v2.warmupStartedAt, v2.dailyLimit)
        : v2.dailyLimit;
    }
  } catch {
    // fallback silencioso
  }
  return out;
}

// ---------------------------------------------------------------------------
// Reativação de leads antigos
// ---------------------------------------------------------------------------

export interface ReactivationResult {
  scanned: number;
  sent: number;
  skipped: Array<{ leadId: string; reason: string }>;
}

function withinTimeWindow(start: string, end: string, now = new Date()): boolean {
  const [sh, sm] = start.split(":").map(Number);
  const [eh, em] = end.split(":").map(Number);
  const mins = now.getHours() * 60 + now.getMinutes();
  return mins >= sh * 60 + (sm || 0) && mins <= eh * 60 + (em || 0);
}

export async function runReactivation(companyId: string): Promise<ReactivationResult> {
  const out: ReactivationResult = { scanned: 0, sent: 0, skipped: [] };
  try {
    const v2 = await getFollowupV2Settings(companyId);
    if (!v2 || !v2.reactivationEnabled) return out;
    if (
      !withinTimeWindow(v2.reactivationHoursStart, v2.reactivationHoursEnd)
    ) {
      out.skipped.push({ leadId: "-", reason: "fora do horário de reativação" });
      return out;
    }
    const gate = await canSendFollowupNow(companyId);
    if (!gate.ok) {
      out.skipped.push({ leadId: "-", reason: gate.reason ?? "gate" });
      return out;
    }
    const cutoff = new Date(
      Date.now() - v2.reactivationDays * 24 * 3600 * 1000,
    ).toISOString();
    const { data: leads } = await supabaseAdmin
      .from("leads")
      .select("id, name, phone, updated_at")
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .eq("company_id", companyId)
      .lt("updated_at", cutoff)
      .is("reactivated_at" as never, null)
      .not("status", "in", "(fechado,perdido)")
      .limit(v2.reactivationDailyMax);
    out.scanned = leads?.length ?? 0;

    // Importa sender on-demand para evitar ciclo
    const { sendWhatsappText } = await import("@/lib/ai-agent.server");

    for (const lead of leads ?? []) {
      try {
        const { data: conv } = await supabaseAdmin
          .from("conversations")
          .select("id")
          .eq("lead_id", lead.id)
          .order("last_message_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        if (!conv) {
          out.skipped.push({ leadId: lead.id, reason: "sem conversa" });
          continue;
        }
        const nome = (lead.name || "").trim().split(/\s+/)[0] || "tudo bem";
        const seed = Math.floor(Date.now() / 1000) + lead.id.charCodeAt(0);
        const { text, variant } = humanizeTemplate(
          v2.reactivationTemplate.replace(/\{\{nome\}\}/g, nome),
          1,
          seed,
          { nome },
        );
        const send = await sendWhatsappText({
          companyId,
          conversationId: conv.id,
          leadId: lead.id,
          text,
        });
        if (!send.ok) {
          out.skipped.push({ leadId: lead.id, reason: send.error ?? "envio falhou" });
          continue;
        }
        await supabaseAdmin.from("follow_ups").insert({
          company_id: companyId,
          conversation_id: conv.id,
          lead_id: lead.id,
          rule_type: "returning_customer",
          attempt_number: 1,
          message_text: text,
          status: "sent",
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          variant_seed: variant,
          trigger_reason: `Reativação: lead parado há mais de ${v2.reactivationDays} dias`,
          metadata: { signal: "reactivation", via: "text" },
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as any);
        await supabaseAdmin
          .from("leads")
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          .update({ reactivated_at: new Date().toISOString() } as any)
          .eq("id", lead.id);
        out.sent++;
      } catch (e) {
        out.skipped.push({
          leadId: lead.id,
          reason: e instanceof Error ? e.message : "erro",
        });
      }
    }
  } catch (e) {
    out.skipped.push({
      leadId: "-",
      reason: e instanceof Error ? e.message : "erro",
    });
  }
  return out;
}
