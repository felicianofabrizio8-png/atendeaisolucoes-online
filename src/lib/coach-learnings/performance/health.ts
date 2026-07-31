/**
 * SPRINT 4 · FASE 5 — Indicador de saúde dos aprendizados.
 *
 * Regra ÚNICA e determinística. Espelha exatamente a função SQL
 * `public.coach_learning_health(...)`, de modo que o backend (que classifica
 * e filtra) e o frontend (que rotula) nunca divirjam.
 *
 * A ordem das cláusulas importa: a primeira que casar vence.
 */

export const COACH_LEARNING_HEALTH_CODES = [
  "healthy",
  "attention",
  "low_confidence",
  "low_usage",
  "no_evidence",
  "negative_recurring",
  "archived",
] as const;

export type CoachLearningHealth = (typeof COACH_LEARNING_HEALTH_CODES)[number];

export interface HealthInput {
  status: string;
  confidence: number | null;
  success_rate: number | null;
  feedback_sample_count: number | null;
  negative_feedback_count: number | null;
  usage_count: number | null;
  times_retrieved: number | null;
}

const n = (v: number | null | undefined, fallback = 0): number =>
  typeof v === "number" && Number.isFinite(v) ? v : fallback;

/** Classificação determinística — mesma ordem da função SQL. */
export function classifyLearningHealth(input: HealthInput): CoachLearningHealth {
  const samples = n(input.feedback_sample_count);
  const retrieved = n(input.times_retrieved);
  const negative = n(input.negative_feedback_count);
  const success = n(input.success_rate, 0.5);
  const confidence = n(input.confidence);
  const usage = n(input.usage_count);

  if (input.status === "archived") return "archived";
  if (samples === 0 && retrieved === 0) return "no_evidence";
  if (negative >= 3 && success < 0.4) return "negative_recurring";
  if (confidence < 0.35) return "low_confidence";
  if (samples > 0 && success < 0.5) return "attention";
  if (usage === 0 && retrieved < 3) return "low_usage";
  return "healthy";
}

export interface HealthPresentation {
  /** Rótulo textual — nunca depender apenas de cor (acessibilidade). */
  label: string;
  /** Descrição usada em tooltip / aria-label. */
  hint: string;
  /** Classes de token semântico (sem cores hard-coded). */
  className: string;
  icon: string;
}

export const HEALTH_PRESENTATION: Record<CoachLearningHealth, HealthPresentation> = {
  healthy: {
    label: "Saudável",
    hint: "Evidência suficiente e desempenho dentro do esperado.",
    className: "border-primary/40 bg-primary/10 text-primary",
    icon: "✓",
  },
  attention: {
    label: "Atenção",
    hint: "Já recebeu feedback, mas a taxa de sucesso está abaixo de 50%.",
    className: "border-border bg-muted text-foreground",
    icon: "!",
  },
  low_confidence: {
    label: "Baixa confiança",
    hint: "Confiança acumulada abaixo de 0,35. Revise o conteúdo da regra.",
    className: "border-destructive/40 bg-destructive/10 text-destructive",
    icon: "▼",
  },
  low_usage: {
    label: "Pouco utilizado",
    hint: "Raramente recuperado pelo Coach. Pode estar específico ou mal formulado.",
    className: "border-border bg-muted text-muted-foreground",
    icon: "◔",
  },
  no_evidence: {
    label: "Sem evidência",
    hint: "Nunca foi recuperado nem avaliado. Ainda não há dados para julgar.",
    className: "border-dashed border-border bg-background text-muted-foreground",
    icon: "–",
  },
  negative_recurring: {
    label: "Feedback negativo recorrente",
    hint: "3 ou mais avaliações negativas e taxa de sucesso abaixo de 40%.",
    className: "border-destructive/50 bg-destructive/15 text-destructive",
    icon: "✕",
  },
  archived: {
    label: "Arquivado",
    hint: "Fora de uso. Não participa das sugestões do Coach.",
    className: "border-border bg-muted text-muted-foreground",
    icon: "⌫",
  },
};

export function healthLabel(code: string): string {
  return (HEALTH_PRESENTATION as Record<string, HealthPresentation>)[code]?.label ?? code;
}
