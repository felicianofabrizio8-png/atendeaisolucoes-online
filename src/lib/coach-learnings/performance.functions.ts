/**
 * SPRINT 4 · FASE 5 — Server functions do painel de desempenho.
 *
 * Somente leitura. A empresa NUNCA vem do cliente: é derivada da sessão
 * dentro das RPCs (`current_company_id()`), que também exigem papel admin.
 * Nenhum conteúdo de conversa é retornado — apenas metadados e trace.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  PerformanceQuerySchema,
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
  type LearningPerformanceRow,
  type PerformanceSummary,
} from "./performance/types";
import { listLearningVersions } from "./coach-learnings.repository";
import type { CoachLearningRow, CoachLearningVersionRow } from "./schema";

type AnyRow = Record<string, unknown>;

function num(v: unknown, fallback = 0): number {
  const n = typeof v === "string" ? Number(v) : v;
  return typeof n === "number" && Number.isFinite(n) ? n : fallback;
}

function str(v: unknown): string | null {
  return typeof v === "string" ? v : null;
}

function mapRow(r: AnyRow): LearningPerformanceRow {
  return {
    id: String(r.id),
    title: String(r.title ?? ""),
    category: String(r.category ?? "other"),
    product_ref: str(r.product_ref),
    status: String(r.status ?? "active"),
    priority: num(r.priority),
    confidence: num(r.confidence),
    success_rate: num(r.success_rate, 0.5),
    feedback_sample_count: num(r.feedback_sample_count),
    positive_feedback_count: num(r.positive_feedback_count),
    negative_feedback_count: num(r.negative_feedback_count),
    usage_count: num(r.usage_count),
    times_retrieved: num(r.times_retrieved),
    last_used_at: str(r.last_used_at),
    last_retrieved_at: str(r.last_retrieved_at),
    last_feedback_at: str(r.last_feedback_at),
    created_at: String(r.created_at ?? new Date(0).toISOString()),
    updated_at: String(r.updated_at ?? new Date(0).toISOString()),
    version: num(r.version, 1),
    health: String(r.health ?? "no_evidence"),
    period_retrievals: num(r.period_retrievals),
    period_contextual: num(r.period_contextual),
    period_fallback: num(r.period_fallback),
    period_positive: num(r.period_positive),
    period_negative: num(r.period_negative),
  };
}

/** Traduz erros do banco em códigos estáveis para a UI (sem SQL bruto). */
function translateError(err: unknown): Error {
  const raw = err as { code?: string; message?: string } | null;
  const code = raw?.code ?? "";
  const message = raw?.message ?? "";
  if (code === "42501" || message.includes("insufficient_privilege")) {
    return new Error("forbidden");
  }
  if (code === "22007" || message.includes("invalid_date_range")) {
    return new Error("invalid_date_range");
  }
  return new Error("performance_query_failed");
}

// ---------------------------------------------------------------------------
// Listagem paginada
// ---------------------------------------------------------------------------

export const listLearningPerformanceFn = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => PerformanceQuerySchema.parse(data ?? {}))
  .handler(async ({ data, context }) => {
    const pageSize = Math.min(MAX_PAGE_SIZE, data.pageSize ?? DEFAULT_PAGE_SIZE);
    const page = data.page ?? 1;

    const { data: rows, error } = await context.supabase.rpc(
      "list_coach_learning_performance" as never,
      {
        _statuses: data.statuses ?? null,
        _search: data.search?.trim() ? data.search.trim() : null,
        _min_confidence: data.minConfidence ?? null,
        _max_confidence: data.maxConfidence ?? null,
        _min_success: data.minSuccess ?? null,
        _max_success: data.maxSuccess ?? null,
        _min_samples: data.minSamples ?? null,
        _min_usage: data.minUsage ?? null,
        _min_priority: data.minPriority ?? null,
        _health: data.health ?? null,
        _strategy: data.strategy ?? null,
        _only_negative: data.onlyNegative ?? false,
        _only_unused: data.onlyUnused ?? false,
        _only_no_feedback: data.onlyNoFeedback ?? false,
        _from: data.from ?? null,
        _to: data.to ?? null,
        _sort: data.sort ?? "priority",
        _page: page,
        _page_size: pageSize,
      } as never,
    );
    if (error) throw translateError(error);

    const list = ((rows ?? []) as AnyRow[]) ?? [];
    const totalCount = list.length > 0 ? num(list[0].total_count) : 0;
    return {
      rows: list.map(mapRow),
      totalCount,
      page,
      pageSize,
      pageCount: Math.max(1, Math.ceil(totalCount / pageSize)),
    };
  });

// ---------------------------------------------------------------------------
// Resumo agregado
// ---------------------------------------------------------------------------

const summaryInput = z.object({
  from: z.string().datetime().nullable().optional(),
  to: z.string().datetime().nullable().optional(),
});

export const getLearningPerformanceSummaryFn = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => summaryInput.parse(data ?? {}))
  .handler(async ({ data, context }) => {
    const { data: json, error } = await context.supabase.rpc(
      "coach_learning_performance_summary" as never,
      { _from: data.from ?? null, _to: data.to ?? null } as never,
    );
    if (error) throw translateError(error);
    const s = (json ?? {}) as AnyRow;
    const summary: PerformanceSummary = {
      active: num(s.active),
      paused: num(s.paused),
      archived: num(s.archived),
      total: num(s.total),
      totalUsage: num(s.totalUsage),
      totalRetrieved: num(s.totalRetrieved),
      lowConfidence: num(s.lowConfidence),
      neverUsed: num(s.neverUsed),
      noFeedback: num(s.noFeedback),
      negativeHistory: num(s.negativeHistory),
      avgConfidence: num(s.avgConfidence),
      avgSuccessRate: num(s.avgSuccessRate),
      feedbackPositive: num(s.feedbackPositive),
      feedbackNegative: num(s.feedbackNegative),
      feedbackTotal: num(s.feedbackTotal),
      positiveRate: s.positiveRate === null || s.positiveRate === undefined ? null : num(s.positiveRate),
      retrievalsContextual: num(s.retrievalsContextual),
      retrievalsFallback: num(s.retrievalsFallback),
      retrievalsTotal: num(s.retrievalsTotal),
      contextualShare:
        s.contextualShare === null || s.contextualShare === undefined ? null : num(s.contextualShare),
      fallbackShare:
        s.fallbackShare === null || s.fallbackShare === undefined ? null : num(s.fallbackShare),
      periodFrom: str(s.periodFrom),
      periodTo: str(s.periodTo),
    };
    return { summary };
  });

// ---------------------------------------------------------------------------
// Detalhe: trace de uso + histórico de feedback (carregado sob demanda)
// ---------------------------------------------------------------------------

export interface RetrievalTraceItem {
  id: string;
  created_at: string;
  suggestion_ref: string | null;
  conversation_ref: string | null;
  rank: number | null;
  final_score: number | null;
  strategy: string | null;
  selection_reason: string | null;
  matched_reasons: string[];
  penalties: string[];
  fallback_reason: string | null;
  usage_counted: boolean;
  suggestion_feedback: string | null;
  raw: Record<string, unknown>;
}

export interface FeedbackEventItem {
  id: string;
  created_at: string;
  transition: string | null;
  new_feedback: string | null;
  previous_feedback: string | null;
  event_weight: number | null;
  rank: number | null;
  final_score: number | null;
  confidence_before: number | null;
  confidence_after: number | null;
  success_rate_before: number | null;
  success_rate_after: number | null;
  source: string | null;
  actor_ref: string | null;
}

const detailInput = z.object({
  id: z.string().uuid(),
  limit: z.number().int().min(1).max(50).optional(),
});

function maskRef(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? `${v.slice(0, 8)}…` : null;
}

function strList(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string").slice(0, 12) : [];
}

export const getLearningPerformanceDetailFn = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => detailInput.parse(data))
  .handler(async ({ data, context }) => {
    const limit = data.limit ?? 15;
    const sb = context.supabase;

    // Todas as leituras passam por RLS (company_id = current_company_id()).
    const [learningRes, retrievalRes, feedbackRes, versions] = await Promise.all([
      sb.from("coach_learnings" as never).select("*").eq("id", data.id).maybeSingle(),
      sb
        .from("coach_learning_retrievals" as never)
        .select(
          "id, created_at, generation_ref, conversation_id, rank, final_score, selection_reason, usage_counted, ranking_metadata",
        )
        .eq("learning_id", data.id)
        .order("created_at", { ascending: false })
        .limit(limit),
      sb
        .from("coach_learning_feedback_events" as never)
        .select(
          "id, created_at, transition, new_feedback, previous_feedback, event_weight, rank, final_score, confidence_before, confidence_after, success_rate_before, success_rate_after, source, actor_user_id",
        )
        .eq("learning_id", data.id)
        .order("created_at", { ascending: false })
        .limit(limit),
      listLearningVersions(sb, data.id).catch(() => [] as CoachLearningVersionRow[]),
    ]);

    if (learningRes.error) throw translateError(learningRes.error);
    const learning = (learningRes.data ?? null) as CoachLearningRow | null;
    if (!learning) throw new Error("not_found");

    const retrievalRows = ((retrievalRes.data ?? []) as AnyRow[]) ?? [];

    // Feedback da sugestão em UMA consulta (nunca N+1).
    const refs = Array.from(
      new Set(
        retrievalRows
          .map((r) => (typeof r.generation_ref === "string" ? r.generation_ref : null))
          .filter((v): v is string => Boolean(v) && /^[0-9a-f-]{36}$/i.test(v)),
      ),
    ).slice(0, 50);
    const feedbackBySuggestion = new Map<string, string | null>();
    if (refs.length > 0) {
      const { data: sugg } = await sb
        .from("coach_suggestions" as never)
        .select("id, feedback_status")
        .in("id", refs);
      for (const s of ((sugg ?? []) as AnyRow[]) ?? []) {
        feedbackBySuggestion.set(String(s.id), str(s.feedback_status));
      }
    }

    const retrievals: RetrievalTraceItem[] = retrievalRows.map((r) => {
      const meta = (r.ranking_metadata ?? {}) as Record<string, unknown>;
      const ref = typeof r.generation_ref === "string" ? r.generation_ref : null;
      return {
        id: String(r.id),
        created_at: String(r.created_at),
        suggestion_ref: maskRef(ref),
        conversation_ref: maskRef(r.conversation_id),
        rank: r.rank === null || r.rank === undefined ? null : num(r.rank),
        final_score:
          r.final_score === null || r.final_score === undefined
            ? meta.final_score === undefined
              ? null
              : num(meta.final_score)
            : num(r.final_score),
        strategy: str(meta.strategy),
        selection_reason: str(r.selection_reason),
        matched_reasons: strList(meta.matchedReasons),
        penalties: strList(meta.penalties),
        fallback_reason: str(meta.fallbackReason),
        usage_counted: r.usage_counted === true,
        suggestion_feedback: ref ? (feedbackBySuggestion.get(ref) ?? null) : null,
        raw: meta,
      };
    });

    const feedbackEvents: FeedbackEventItem[] = (((feedbackRes.data ?? []) as AnyRow[]) ?? []).map(
      (f) => ({
        id: String(f.id),
        created_at: String(f.created_at),
        transition: str(f.transition),
        new_feedback: str(f.new_feedback),
        previous_feedback: str(f.previous_feedback),
        event_weight: f.event_weight === null || f.event_weight === undefined ? null : num(f.event_weight),
        rank: f.rank === null || f.rank === undefined ? null : num(f.rank),
        final_score: f.final_score === null || f.final_score === undefined ? null : num(f.final_score),
        confidence_before:
          f.confidence_before === null || f.confidence_before === undefined ? null : num(f.confidence_before),
        confidence_after:
          f.confidence_after === null || f.confidence_after === undefined ? null : num(f.confidence_after),
        success_rate_before:
          f.success_rate_before === null || f.success_rate_before === undefined
            ? null
            : num(f.success_rate_before),
        success_rate_after:
          f.success_rate_after === null || f.success_rate_after === undefined
            ? null
            : num(f.success_rate_after),
        source: str(f.source),
        // Identificador parcial — nunca e-mail/nome (PII).
        actor_ref: maskRef(f.actor_user_id),
      }),
    );

    return { learning, versions, retrievals, feedbackEvents };
  });
