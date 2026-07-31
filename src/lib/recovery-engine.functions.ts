// ============================================================================
// RECOVERY ENGINE — camada de leitura (SPRINT 6 · FASE 6.1)
//
// Responsabilidade única: montar os snapshots de UMA empresa e delegar todo o
// raciocínio ao motor puro em `src/lib/recovery/`.
//
// SEGURANÇA
//  · `companyId` vem SEMPRE de `profiles.company_id` do usuário autenticado,
//    nunca do payload. Toda consulta filtra por ele; as consultas satélite
//    partem de ids já restritos a essa empresa. Não há cálculo cruzado.
//  · Cliente do middleware `requireSupabaseAuth` ⇒ RLS aplica como o usuário.
//
// PERFORMANCE
//  · Uma consulta por tabela (nunca N+1): conversas primeiro, depois lotes
//    `in(...)` para leads, mensagens agregadas, orçamentos, visitas,
//    follow-ups e Coach.
//  · Teto de 300 conversas por execução, ordenadas pela mais recente.
//  · Contagem/agregação de mensagens é resolvida em memória sobre um único
//    lote, e o motor expõe `fingerprint` para recálculo incremental.
//
// Esta fase NÃO envia mensagens e NÃO escreve em nenhuma tabela.
// ============================================================================

import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  assessRecovery,
  buildDashboardCards,
  buildRecoveryQueue,
  type ApprovedTemplate,
  type RecoveryDashboardCards,
  type RecoveryQueueItem,
  type RecoverySnapshot,
} from "@/lib/recovery";

const MAX_CONVERSATIONS = 300;
/** Mensagens lidas por execução para derivar primeira/última e contagem. */
const MAX_MESSAGES = 4000;

export interface RecoveryEngineResult {
  cards: RecoveryDashboardCards;
  queue: RecoveryQueueItem[];
  generatedAt: string;
  /** Quantos templates aprovados a empresa tem — a UI alerta quando é zero. */
  approvedTemplates: number;
}

const EMPTY: RecoveryEngineResult = {
  cards: {
    recoveredToday: 0,
    windowOpen: 0,
    windowClosed: 0,
    highPriority: 0,
    recovered: 0,
    pending: 0,
    lost: 0,
    pipelineValue: 0,
  },
  queue: [],
  generatedAt: new Date(0).toISOString(),
  approvedTemplates: 0,
};

/* eslint-disable @typescript-eslint/no-explicit-any */
type Db = any;

export const getRecoveryEngine = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<RecoveryEngineResult> => {
    const ctx = context as unknown as { supabase: Db; userId: string };
    const db = ctx.supabase;

    const { data: prof } = await db
      .from("profiles")
      .select("company_id")
      .eq("id", ctx.userId)
      .maybeSingle();
    const companyId = (prof as { company_id?: string } | null)?.company_id;
    if (!companyId) return { ...EMPTY, generatedAt: new Date().toISOString() };

    const now = Date.now();

    const { data: convRows } = await db
      .from("conversations")
      .select("id, lead_id, channel, last_message_at, lead_temperature")
      .eq("company_id", companyId)
      .order("last_message_at", { ascending: false, nullsFirst: false })
      .limit(MAX_CONVERSATIONS);

    const convs =
      (convRows as Array<{
        id: string;
        lead_id: string;
        channel: string;
        last_message_at: string | null;
        lead_temperature: string | null;
      }> | null) ?? [];
    if (convs.length === 0) return { ...EMPTY, generatedAt: new Date().toISOString() };

    const convIds = convs.map((c) => c.id);
    const leadIds = [...new Set(convs.map((c) => c.lead_id).filter(Boolean))];

    const [msgRes, leadRes, quoteRes, visitRes, followRes, coachRes, tplRes] = await Promise.all([
      db
        .from("messages")
        .select("conversation_id, role, at")
        .eq("company_id", companyId)
        .in("conversation_id", convIds)
        .is("deleted_at", null)
        .order("at", { ascending: false })
        .limit(MAX_MESSAGES),
      db
        .from("leads")
        .select(
          "id, name, product, status, estimated_value, source, tags, assigned_to, lead_temperature_cached, lost_at, closed_at, reactivated_at",
        )
        .eq("company_id", companyId)
        .in("id", leadIds),
      db
        .from("quotes")
        .select("lead_id, sent_at, viewed_at, status, final_value, total, created_at")
        .eq("company_id", companyId)
        .in("lead_id", leadIds),
      db
        .from("visits")
        .select("lead_id, scheduled_at, status")
        .eq("company_id", companyId)
        .in("lead_id", leadIds),
      db
        .from("follow_ups")
        .select("conversation_id, sent_at, responded_at")
        .eq("company_id", companyId)
        .in("conversation_id", convIds),
      db
        .from("coach_suggestions")
        .select("conversation_id, risk_score, urgency, created_at")
        .eq("company_id", companyId)
        .in("conversation_id", convIds)
        .order("created_at", { ascending: false })
        .limit(500),
      db
        .from("whatsapp_templates")
        .select("id, name, status")
        .eq("company_id", companyId),
    ]);

    const rows = <T>(r: unknown): T[] => ((r as { data?: T[] })?.data ?? []) as T[];

    // ---- agregação de mensagens (1 passada, sem N+1) ----
    interface MsgAgg {
      count: number;
      first: string | null;
      last: string | null;
      lastInbound: string | null;
      lastOutbound: string | null;
    }
    const msgByConv = new Map<string, MsgAgg>();
    for (const m of rows<{ conversation_id: string; role: string; at: string }>(msgRes)) {
      const agg =
        msgByConv.get(m.conversation_id) ??
        { count: 0, first: null, last: null, lastInbound: null, lastOutbound: null };
      agg.count += 1;
      // A consulta vem em ordem decrescente: o primeiro visto é o mais recente.
      if (!agg.last) agg.last = m.at;
      agg.first = m.at;
      if (m.role === "lead") {
        if (!agg.lastInbound) agg.lastInbound = m.at;
      } else if (!agg.lastOutbound) {
        agg.lastOutbound = m.at;
      }
      msgByConv.set(m.conversation_id, agg);
    }

    const leadById = new Map(
      rows<{
        id: string;
        name: string;
        product: string | null;
        status: string;
        estimated_value: number | null;
        source: string | null;
        tags: string[] | null;
        assigned_to: string | null;
        lead_temperature_cached: string | null;
        lost_at: string | null;
        closed_at: string | null;
        reactivated_at: string | null;
      }>(leadRes).map((l) => [l.id, l]),
    );

    // Orçamento mais recente por lead.
    const quoteByLead = new Map<
      string,
      { sentAt: string | null; viewedAt: string | null; status: string | null; total: number | null }
    >();
    for (const q of rows<{
      lead_id: string;
      sent_at: string | null;
      viewed_at: string | null;
      status: string | null;
      final_value: number | null;
      total: number | null;
      created_at: string;
    }>(quoteRes)) {
      const prev = quoteByLead.get(q.lead_id);
      const ref = q.sent_at ?? q.created_at;
      if (prev && prev.sentAt && new Date(prev.sentAt).getTime() >= new Date(ref).getTime()) continue;
      quoteByLead.set(q.lead_id, {
        sentAt: q.sent_at,
        viewedAt: q.viewed_at,
        status: q.status,
        total: q.final_value ?? q.total,
      });
    }

    // Visita mais próxima/recente por lead.
    const visitByLead = new Map<string, { scheduledAt: string | null; status: string | null }>();
    for (const v of rows<{ lead_id: string; scheduled_at: string | null; status: string | null }>(
      visitRes,
    )) {
      const prev = visitByLead.get(v.lead_id);
      if (
        prev?.scheduledAt &&
        v.scheduled_at &&
        new Date(prev.scheduledAt).getTime() >= new Date(v.scheduled_at).getTime()
      ) {
        continue;
      }
      visitByLead.set(v.lead_id, { scheduledAt: v.scheduled_at, status: v.status });
    }

    const followByConv = new Map<string, { lastAt: string | null; responded: boolean }>();
    for (const f of rows<{
      conversation_id: string;
      sent_at: string | null;
      responded_at: string | null;
    }>(followRes)) {
      const prev = followByConv.get(f.conversation_id);
      const responded = (prev?.responded ?? false) || !!f.responded_at;
      const lastAt =
        prev?.lastAt && f.sent_at && new Date(prev.lastAt).getTime() >= new Date(f.sent_at).getTime()
          ? prev.lastAt
          : f.sent_at ?? prev?.lastAt ?? null;
      followByConv.set(f.conversation_id, { lastAt, responded });
    }

    const coachByConv = new Map<
      string,
      { risk: number | null; urgency: RecoverySnapshot["coachUrgency"] }
    >();
    for (const c of rows<{
      conversation_id: string;
      risk_score: number | null;
      urgency: string | null;
    }>(coachRes)) {
      if (coachByConv.has(c.conversation_id)) continue; // já ordenado por data desc
      coachByConv.set(c.conversation_id, {
        risk: c.risk_score,
        urgency: (c.urgency as RecoverySnapshot["coachUrgency"]) ?? null,
      });
    }

    const templates: ApprovedTemplate[] = rows<{ id: string; name: string; status: string }>(tplRes);
    const approvedTemplates = templates.filter(
      (t) => (t.status ?? "").toLowerCase() === "approved",
    ).length;

    // ---- montagem dos snapshots + avaliação ----
    const assessments = convs
      .map((c) => {
        const lead = leadById.get(c.lead_id);
        if (!lead) return null; // lead de outra empresa/removido: nunca avaliar
        const agg = msgByConv.get(c.id);
        const follow = followByConv.get(c.id);
        const coach = coachByConv.get(c.id);

        const snap: RecoverySnapshot = {
          conversationId: c.id,
          leadId: lead.id,
          leadName: lead.name,
          product: lead.product,
          channel: c.channel,
          leadStatus: lead.status,
          temperature: c.lead_temperature ?? lead.lead_temperature_cached ?? null,
          estimatedValue: lead.estimated_value != null ? Number(lead.estimated_value) : null,
          source: lead.source,
          tags: lead.tags ?? [],
          assignedTo: lead.assigned_to,
          assignedToName: null,
          lastInboundAt: agg?.lastInbound ?? null,
          lastOutboundAt: agg?.lastOutbound ?? null,
          lastMessageAt: c.last_message_at ?? agg?.last ?? null,
          firstMessageAt: agg?.first ?? null,
          messageCount: agg?.count ?? 0,
          quote: quoteByLead.get(lead.id) ?? null,
          visit: visitByLead.get(lead.id) ?? null,
          lastFollowUpAt: follow?.lastAt ?? null,
          followUpResponded: follow?.responded ?? false,
          coachRiskScore: coach?.risk ?? null,
          coachUrgency: coach?.urgency ?? null,
          lostAt: lead.lost_at,
          closedAt: lead.closed_at,
          reactivatedAt: lead.reactivated_at,
        };

        return assessRecovery(snap, now, templates);
      })
      .filter((a): a is NonNullable<typeof a> => a !== null);

    const queue = buildRecoveryQueue(assessments);
    const cards = buildDashboardCards(queue, assessments, now);

    return {
      cards,
      queue,
      generatedAt: new Date(now).toISOString(),
      approvedTemplates,
    };
  });
