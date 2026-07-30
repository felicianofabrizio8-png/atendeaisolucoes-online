// Coach Learnings — client-safe schemas & types.
import { z } from "zod";

export const COACH_LEARNING_CATEGORIES = [
  "objection",
  "product_positioning",
  "pricing",
  "qualification",
  "closing",
  "followup",
  "tone",
  "process",
  "other",
] as const;

export type CoachLearningCategory = (typeof COACH_LEARNING_CATEGORIES)[number];

export const COACH_LEARNING_STATUSES = ["active", "paused", "archived"] as const;
export type CoachLearningStatus = (typeof COACH_LEARNING_STATUSES)[number];

/**
 * Mapeamento oficial DB ↔ UI (BLOCO 4).
 * - `active`   → "Ativo"    → usado pelo Coach.
 * - `paused`   → "Inativo"  → editável, não é usado pelo Coach; pode ser reativado.
 * - `archived` → "Arquivado" → oculto das listas principais; nunca usado pelo Coach.
 */
export const STATUS_LABEL_PT: Record<CoachLearningStatus, string> = {
  active: "Ativo",
  paused: "Inativo",
  archived: "Arquivado",
};

/** Origens permitidas para uma versão (espelha CHECK no banco). */
export const COACH_LEARNING_VERSION_ORIGINS = [
  "teach_mode",
  "manual_edit",
  "restore",
  "migration",
  "system",
] as const;
export type CoachLearningVersionOrigin =
  (typeof COACH_LEARNING_VERSION_ORIGINS)[number];

export const CoachLearningDraftSchema = z.object({
  category: z.enum(COACH_LEARNING_CATEGORIES),
  product_ref: z.string().max(120).nullable().optional(),
  title: z.string().min(3).max(120),
  description: z.string().min(3).max(2000),
  rule_structured: z.string().min(3).max(2000),
  positive_example: z.string().max(2000).nullable().optional(),
  negative_example: z.string().max(2000).nullable().optional(),
  priority: z.number().int().min(0).max(100).default(50),
  confidence: z.number().min(0).max(1).default(0.7),
});

export type CoachLearningDraft = z.infer<typeof CoachLearningDraftSchema>;

export interface CoachLearningRow {
  id: string;
  company_id: string;
  category: string;
  product_ref: string | null;
  title: string;
  description: string;
  rule_structured: string;
  positive_example: string | null;
  negative_example: string | null;
  priority: number;
  status: CoachLearningStatus;
  confidence: number;
  usage_count: number; // aplicações confirmadas (feedback 👍)
  last_used_at: string | null;
  times_retrieved: number; // vezes que o Coach recuperou para o contexto
  last_retrieved_at: string | null;
  // --- Ciclo de feedback (SPRINT 4 · FASE 4) --------------------------------
  // Contadores brutos são auditáveis; os *_weight são as versões ponderadas
  // por rank/score da recuperação, e alimentam success_rate/confidence.
  positive_feedback_count: number;
  negative_feedback_count: number;
  feedback_sample_count: number;
  positive_feedback_weight: number;
  negative_feedback_weight: number;
  /** Função pura dos pesos acumulados (média bayesiana). 0.5 = neutro. */
  success_rate: number;
  last_feedback_at: string | null;
  last_positive_feedback_at: string | null;
  last_negative_feedback_at: string | null;
  content_hash: string;
  taught_by: string | null;
  updated_by: string | null;
  source_conversation_id: string | null;
  version: number;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
}

export interface CoachLearningVersionRow {
  id: string;
  learning_id: string;
  version: number;
  category: string;
  product_ref: string | null;
  title: string;
  description: string;
  rule_structured: string;
  positive_example: string | null;
  negative_example: string | null;
  priority: number;
  status: string;
  confidence: number;
  edited_by: string | null;
  origin: CoachLearningVersionOrigin;
  change_reason: string | null;
  prompt_version: string | null;
  // `{}` (não `unknown`) para casar com o tipo inferido do PostgREST/JSON
  // gerado por supabase-js. É JSONB opaco em ambos os lados.
  metadata: { [key: string]: {} };
  created_at: string;
}

export const TEACH_MODE_PROMPT_VERSION = "coach-teach-mode@2026-07-23.b2";

/** Limite operacional de aprendizados injetados por sugestão do Coach. */
export const COACH_GROUNDING_DEFAULT_LIMIT = 5;
export const COACH_GROUNDING_MAX_LIMIT = 10;

export function clampGroundingLimit(n: number | null | undefined): number {
  const base = typeof n === "number" && Number.isFinite(n) ? Math.floor(n) : COACH_GROUNDING_DEFAULT_LIMIT;
  return Math.min(COACH_GROUNDING_MAX_LIMIT, Math.max(1, base));
}
