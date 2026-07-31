// ============================================================================
// MÉTRICAS OPERACIONAIS DE RECUPERAÇÃO (SPRINT 6 · FASE 6.3.1) — leitura.
//
// Derivam EXCLUSIVAMENTE de tentativas reais persistidas em `recovery_attempts`.
// Não se misturam com Recovery Score nem com a chance heurística da Fase 6.1:
// aqui só aparece o que o vendedor de fato executou.
//
// SEGURANÇA
//  · cliente autenticado do middleware ⇒ RLS aplica o filtro por empresa;
//  · nenhum companyId é aceito por payload;
//  · nenhum texto de mensagem é retornado para a UI de métricas.
// ============================================================================

import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { buildAttemptMetrics, type RecoveryAttemptMetrics } from "@/lib/recovery-exec/metrics";
import type { RecoveryAttempt } from "@/lib/recovery-exec/types";

/** Períodos oferecidos na interface. `hoje` = últimas 24 horas. */
export const METRIC_PERIODS = ["hoje", "7d", "30d", "90d"] as const;
export type MetricPeriod = (typeof METRIC_PERIODS)[number];

const PERIOD_DAYS: Record<MetricPeriod, number> = { hoje: 1, "7d": 7, "30d": 30, "90d": 90 };

/** Teto defensivo por leitura — a agregação é feita em memória. */
const MAX_ATTEMPTS = 2000;

export interface RecoveryAttemptMetricsResult {
  metrics: RecoveryAttemptMetrics;
  period: MetricPeriod;
  total: number;
  generatedAt: string;
}

const EMPTY_METRICS: RecoveryAttemptMetrics = {
  today: 0,
  sent: 0,
  failed: 0,
  waitingReply: 0,
  replied: 0,
  recovered: 0,
  notRecovered: 0,
  replyRate: 0,
  recoveryRate: 0,
};

function parsePeriod(input: unknown): MetricPeriod {
  const value = String((input as { period?: unknown })?.period ?? "30d");
  return (METRIC_PERIODS as readonly string[]).includes(value)
    ? (value as MetricPeriod)
    : "30d";
}

export const getRecoveryAttemptMetrics = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { period?: string } | undefined) => ({ period: parsePeriod(input) }))
  .handler(async ({ data, context }): Promise<RecoveryAttemptMetricsResult> => {
    const now = Date.now();
    const since = new Date(now - PERIOD_DAYS[data.period] * 24 * 60 * 60 * 1000).toISOString();

    const { data: rows, error } = await context.supabase
      .from("recovery_attempts")
      .select(
        "id, conversation_id, lead_id, status, response_status, outcome, created_at, sent_at, delivery_status",
      )
      .gte("created_at", since)
      .order("created_at", { ascending: false })
      .limit(MAX_ATTEMPTS);

    if (error) {
      // Falha de leitura não pode quebrar a fila: devolvemos zeros e a UI
      // mostra o aviso amigável a partir de `total = -1`.
      console.error("[recovery/metrics] leitura falhou", error.message);
      return { metrics: EMPTY_METRICS, period: data.period, total: -1, generatedAt: new Date(now).toISOString() };
    }

    const attempts = (rows ?? []).map(
      (r) =>
        ({
          ...(r as Record<string, unknown>),
          status: (r as { status: string }).status,
          responseStatus: (r as { response_status: string | null }).response_status,
          outcome: (r as { outcome: string | null }).outcome,
          createdAt: (r as { created_at: string }).created_at,
        }) as unknown as RecoveryAttempt,
    );

    return {
      metrics: buildAttemptMetrics(attempts, now),
      period: data.period,
      total: attempts.length,
      generatedAt: new Date(now).toISOString(),
    };
  });
