// Reports service — READ-ONLY aggregator over existing Supabase tables.
// This module never writes, never alters schema, and degrades gracefully
// when tables/columns are missing: it returns zeros and logs a console warning.
//
// Tables consulted (read-only):
//   - leads (status, created_at, closed_at, lost_at, source, channel,
//            estimated_value, closed_value, loss_reason)
//   - conversations (id, lead_id, created_at)
//   - messages (conversation_id, role, at, created_at)
//   - quotes (id, sent, created_at, sent_at)

import { supabase } from "@/integrations/supabase/client";

export interface LossReasonRow {
  reason: string;
  count: number;
  value: number;
}

export interface SourceRow {
  source: string;
  count: number;
}

export interface DailyLeadsRow {
  day: string; // YYYY-MM-DD
  count: number;
}

export interface ReportsData {
  leadsReceived: number;
  leadsResponded: number;
  closedCount: number;
  lostCount: number;
  avgResponseMin: number;
  totalSold: number;
  conversionRate: number;
  quoteCount: number;
  quoteSentCount: number;
  lossReasons: LossReasonRow[];
  sources: SourceRow[];
  leadsPerDay: DailyLeadsRow[];
  hasData: boolean;
  warnings: string[];
}

export const EMPTY_REPORTS: ReportsData = {
  leadsReceived: 0,
  leadsResponded: 0,
  closedCount: 0,
  lostCount: 0,
  avgResponseMin: 0,
  totalSold: 0,
  conversionRate: 0,
  quoteCount: 0,
  quoteSentCount: 0,
  lossReasons: [],
  sources: [],
  leadsPerDay: [],
  hasData: false,
  warnings: [],
};

function warn(warnings: string[], msg: string, err?: unknown) {
  // eslint-disable-next-line no-console
  console.warn(`[reportsService] ${msg}`, err ?? "");
  warnings.push(msg);
}

async function safeSelect<T = any>(
  table: string,
  columns: string,
  warnings: string[],
): Promise<T[]> {
  try {
    const { data, error } = await (supabase as any)
      .from(table)
      .select(columns)
      .limit(1000);
    if (error) {
      warn(warnings, `Falha ao ler ${table}: ${error.message}`);
      return [];
    }
    return (data ?? []) as T[];
  } catch (err) {
    warn(warnings, `Exceção ao ler ${table}`, err);
    return [];
  }
}

export async function fetchReports(): Promise<ReportsData> {
  const warnings: string[] = [];

  const [leads, conversations, messages, quotes] = await Promise.all([
    safeSelect<any>(
      "leads",
      "id,status,created_at,closed_at,lost_at,source,channel,estimated_value,closed_value,loss_reason",
      warnings,
    ),
    safeSelect<any>("conversations", "id,lead_id,created_at", warnings),
    safeSelect<any>("messages", "conversation_id,role,at,created_at", warnings),
    safeSelect<any>("quotes", "id,sent,created_at,sent_at", warnings),
  ]);

  const leadsReceived = leads.length;
  const closed = leads.filter((l) => l.status === "fechado");
  const lost = leads.filter((l) => l.status === "perdido");

  // Leads respondidos: lead com conversa que tem ao menos 1 mensagem do agente
  const convsByLead = new Map<string, string[]>();
  for (const c of conversations) {
    if (!c?.lead_id) continue;
    const arr = convsByLead.get(c.lead_id) ?? [];
    arr.push(c.id);
    convsByLead.set(c.lead_id, arr);
  }
  const agentConvIds = new Set(
    messages.filter((m) => m.role === "agent").map((m) => m.conversation_id),
  );
  let leadsResponded = 0;
  for (const [, convIds] of convsByLead) {
    if (convIds.some((id) => agentConvIds.has(id))) leadsResponded += 1;
  }

  // Tempo médio de resposta (min): 1ª msg lead -> 1ª msg agent posterior, por conversa
  const msgsByConv = new Map<string, any[]>();
  for (const m of messages) {
    if (!m?.conversation_id) continue;
    const arr = msgsByConv.get(m.conversation_id) ?? [];
    arr.push(m);
    msgsByConv.set(m.conversation_id, arr);
  }
  const diffs: number[] = [];
  for (const [, arr] of msgsByConv) {
    const sorted = arr
      .map((m) => ({ ...m, _t: +new Date(m.at ?? m.created_at) }))
      .filter((m) => Number.isFinite(m._t))
      .sort((a, b) => a._t - b._t);
    const firstLead = sorted.find((m) => m.role === "lead");
    if (!firstLead) continue;
    const firstAgent = sorted.find(
      (m) => m.role === "agent" && m._t > firstLead._t,
    );
    if (!firstAgent) continue;
    diffs.push((firstAgent._t - firstLead._t) / 60_000);
  }
  const avgResponseMin =
    diffs.length > 0 ? diffs.reduce((s, n) => s + n, 0) / diffs.length : 0;

  const totalSold = closed.reduce(
    (s, l) => s + Number(l.closed_value ?? l.estimated_value ?? 0),
    0,
  );

  const conversionRate =
    leadsReceived > 0 ? (closed.length / leadsReceived) * 100 : 0;

  // Motivos de perda
  const lossMap = new Map<string, { count: number; value: number }>();
  for (const l of lost) {
    const reason = l.loss_reason ?? "Não informado";
    const cur = lossMap.get(reason) ?? { count: 0, value: 0 };
    cur.count += 1;
    cur.value += Number(l.estimated_value ?? 0);
    lossMap.set(reason, cur);
  }
  const lossReasons = [...lossMap.entries()]
    .map(([reason, v]) => ({ reason, ...v }))
    .sort((a, b) => b.count - a.count);

  // Origem
  const srcMap = new Map<string, number>();
  for (const l of leads) {
    const s = l.source ?? l.channel ?? "Desconhecido";
    srcMap.set(s, (srcMap.get(s) ?? 0) + 1);
  }
  const sources = [...srcMap.entries()]
    .map(([source, count]) => ({ source, count }))
    .sort((a, b) => b.count - a.count);

  // Leads por dia (últimos 14)
  const perDay = new Map<string, number>();
  for (const l of leads) {
    if (!l.created_at) continue;
    const day = new Date(l.created_at).toISOString().slice(0, 10);
    perDay.set(day, (perDay.get(day) ?? 0) + 1);
  }
  const leadsPerDay = [...perDay.entries()]
    .map(([day, count]) => ({ day, count }))
    .sort((a, b) => (a.day < b.day ? -1 : 1))
    .slice(-14);

  const quoteCount = quotes.length;
  const quoteSentCount = quotes.filter((q) => q.sent).length;

  return {
    leadsReceived,
    leadsResponded,
    closedCount: closed.length,
    lostCount: lost.length,
    avgResponseMin,
    totalSold,
    conversionRate,
    quoteCount,
    quoteSentCount,
    lossReasons,
    sources,
    leadsPerDay,
    hasData:
      leadsReceived > 0 ||
      quoteCount > 0 ||
      conversations.length > 0 ||
      messages.length > 0,
    warnings,
  };
}
