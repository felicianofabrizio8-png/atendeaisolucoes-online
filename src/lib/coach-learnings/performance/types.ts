/**
 * SPRINT 4 · FASE 5 — Contratos do painel de desempenho.
 * Client-safe: sem imports de servidor. Usado pela UI, pelas server functions
 * e pelos testes.
 */
import { z } from "zod";
import { COACH_LEARNING_STATUSES } from "../schema";
import { COACH_LEARNING_HEALTH_CODES } from "./health";

/** Ordenações permitidas — allowlist espelhada na RPC. */
export const PERFORMANCE_SORTS = [
  "priority",
  "usage_desc",
  "usage_asc",
  "retrieved_desc",
  "confidence_desc",
  "confidence_asc",
  "success_desc",
  "success_asc",
  "feedback_desc",
  "recent",
  "oldest",
] as const;

export type PerformanceSort = (typeof PERFORMANCE_SORTS)[number];

export const SORT_LABEL_PT: Record<PerformanceSort, string> = {
  priority: "Prioridade",
  usage_desc: "Mais usados",
  usage_asc: "Menos usados",
  retrieved_desc: "Mais recuperados",
  confidence_desc: "Maior confiança",
  confidence_asc: "Menor confiança",
  success_desc: "Maior taxa de sucesso",
  success_asc: "Menor taxa de sucesso",
  feedback_desc: "Mais feedbacks",
  recent: "Mais recentes",
  oldest: "Mais antigos",
};

export const PERFORMANCE_STRATEGIES = ["contextual_v1", "static_fallback"] as const;
export type PerformanceStrategy = (typeof PERFORMANCE_STRATEGIES)[number];

export const PERIOD_PRESETS = ["7d", "30d", "90d", "all"] as const;
export type PeriodPreset = (typeof PERIOD_PRESETS)[number];

export const PERIOD_LABEL_PT: Record<PeriodPreset, string> = {
  "7d": "Últimos 7 dias",
  "30d": "Últimos 30 dias",
  "90d": "Últimos 90 dias",
  all: "Todo o período",
};

export const MAX_PAGE_SIZE = 100;
export const DEFAULT_PAGE_SIZE = 20;

/** Converte um preset em `from` ISO. `all` → null (sem recorte temporal). */
export function periodToFromIso(
  preset: PeriodPreset,
  now: Date = new Date(),
): string | null {
  const days = preset === "7d" ? 7 : preset === "30d" ? 30 : preset === "90d" ? 90 : null;
  if (days === null) return null;
  return new Date(now.getTime() - days * 24 * 60 * 60 * 1000).toISOString();
}

/** Normaliza uma ordenação vinda da URL para um valor seguro. */
export function normalizeSort(value: unknown): PerformanceSort {
  return (PERFORMANCE_SORTS as readonly string[]).includes(String(value))
    ? (value as PerformanceSort)
    : "priority";
}

export const PerformanceQuerySchema = z.object({
  statuses: z.array(z.enum(COACH_LEARNING_STATUSES)).optional(),
  search: z.string().max(160).optional(),
  minConfidence: z.number().min(0).max(1).optional(),
  maxConfidence: z.number().min(0).max(1).optional(),
  minSuccess: z.number().min(0).max(1).optional(),
  maxSuccess: z.number().min(0).max(1).optional(),
  minSamples: z.number().int().min(0).max(100000).optional(),
  minUsage: z.number().int().min(0).max(100000).optional(),
  minPriority: z.number().int().min(0).max(100).optional(),
  health: z.enum(COACH_LEARNING_HEALTH_CODES).optional(),
  strategy: z.enum(PERFORMANCE_STRATEGIES).optional(),
  onlyNegative: z.boolean().optional(),
  onlyUnused: z.boolean().optional(),
  onlyNoFeedback: z.boolean().optional(),
  from: z.string().datetime().nullable().optional(),
  to: z.string().datetime().nullable().optional(),
  sort: z.enum(PERFORMANCE_SORTS).optional(),
  page: z.number().int().min(1).max(10000).optional(),
  pageSize: z.number().int().min(1).max(MAX_PAGE_SIZE).optional(),
});

export type PerformanceQuery = z.infer<typeof PerformanceQuerySchema>;

/** Linha retornada pela RPC de desempenho. */
export interface LearningPerformanceRow {
  id: string;
  title: string;
  category: string;
  product_ref: string | null;
  status: string;
  priority: number;
  confidence: number;
  success_rate: number;
  feedback_sample_count: number;
  positive_feedback_count: number;
  negative_feedback_count: number;
  usage_count: number;
  times_retrieved: number;
  last_used_at: string | null;
  last_retrieved_at: string | null;
  last_feedback_at: string | null;
  created_at: string;
  updated_at: string;
  version: number;
  health: string;
  period_retrievals: number;
  period_contextual: number;
  period_fallback: number;
  period_positive: number;
  period_negative: number;
}

export interface PerformanceSummary {
  active: number;
  paused: number;
  archived: number;
  total: number;
  totalUsage: number;
  totalRetrieved: number;
  lowConfidence: number;
  neverUsed: number;
  noFeedback: number;
  negativeHistory: number;
  avgConfidence: number;
  avgSuccessRate: number;
  feedbackPositive: number;
  feedbackNegative: number;
  feedbackTotal: number;
  positiveRate: number | null;
  retrievalsContextual: number;
  retrievalsFallback: number;
  retrievalsTotal: number;
  contextualShare: number | null;
  fallbackShare: number | null;
  periodFrom: string | null;
  periodTo: string | null;
}

/** Formatação segura de percentuais — "—" quando não há base de cálculo. */
export function formatPercent(value: number | null | undefined, digits = 0): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "—";
  return `${(value * 100).toFixed(digits)}%`;
}

/** Leitura acessível de percentual (screen readers). */
export function percentAriaLabel(value: number | null | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "sem dados";
  return `${Math.round(value * 100)} por cento`;
}

export function maskId(id: string | null | undefined): string {
  if (!id) return "—";
  return `${id.slice(0, 8)}…`;
}
