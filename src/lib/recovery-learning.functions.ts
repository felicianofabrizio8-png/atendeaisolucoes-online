// ============================================================================
// RECOVERY LEARNING — camada de leitura (SPRINT 6 · FASE 6.4).
//
// SEGURANÇA
//  · cliente autenticado do middleware ⇒ RLS filtra por empresa;
//  · nenhum companyId é aceito por payload;
//  · nenhum texto de mensagem sai daqui — o dataset guarda fingerprint e
//    faixa de comprimento, e a UI recebe apenas agregados.
//
// SHADOW MODE
//  · esta função NÃO escreve em nenhuma tabela;
//  · não altera Recovery Score, chance, tier nem ordem da fila.
//
// PERFORMANCE
//  · uma leitura de `recovery_attempts` por período, com teto defensivo;
//  · enriquecimento de produto/origem/valor em UM lote `in(...)` de leads;
//  · agregação em memória, sem N+1.
// ============================================================================

import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  buildLearningReport,
  serializeModel,
  type AttemptLike,
  type RecoveryLearningReport,
  type SerializedShadowModel,
} from "@/lib/recovery-learning";
import { toLearningEvent } from "@/lib/recovery-learning/dataset";

export const LEARNING_PERIODS = ["30d", "90d", "180d"] as const;
export type LearningPeriod = (typeof LEARNING_PERIODS)[number];

const PERIOD_DAYS: Record<LearningPeriod, number> = { "30d": 30, "90d": 90, "180d": 180 };
const PERIOD_LABEL: Record<LearningPeriod, string> = {
  "30d": "últimos 30 dias",
  "90d": "últimos 90 dias",
  "180d": "últimos 180 dias",
};

const MAX_ATTEMPTS = 3000;
const MAX_LEADS = 1000;

export interface RecoveryLearningResult {
  report: RecoveryLearningReport | null;
  model: SerializedShadowModel | null;
  period: LearningPeriod;
  /** -1 sinaliza falha de leitura para a UI mostrar o aviso amigável. */
  total: number;
  generatedAt: string;
}

/* eslint-disable @typescript-eslint/no-explicit-any */
type Db = any;

function parsePeriod(input: unknown): LearningPeriod {
  const value = String((input as { period?: unknown })?.period ?? "90d");
  return (LEARNING_PERIODS as readonly string[]).includes(value)
    ? (value as LearningPeriod)
    : "90d";
}

export const getRecoveryLearning = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { period?: string } | undefined) => ({ period: parsePeriod(input) }))
  .handler(async ({ data, context }): Promise<RecoveryLearningResult> => {
    const ctx = context as unknown as { supabase: Db };
    const db = ctx.supabase;
    const now = Date.now();
    const days = PERIOD_DAYS[data.period];
    const since = new Date(now - days * 24 * 60 * 60 * 1000).toISOString();
    const generatedAt = new Date(now).toISOString();

    const { data: rows, error } = await db
      .from("recovery_attempts")
      .select(
        "id, company_id, lead_id, conversation_id, status, recovery_score, recovery_chance, " +
          "recovery_tier, strategy_fingerprint, selected_message_style, selected_message_text, " +
          "template_id, template_name, window_state, initiated_by, sent_at, replied_at, " +
          "response_status, outcome, outcome_at, created_at",
      )
      .gte("created_at", since)
      .order("created_at", { ascending: false })
      .limit(MAX_ATTEMPTS);

    if (error) {
      console.error("[recovery/learning] leitura falhou", error.message);
      return { report: null, model: null, period: data.period, total: -1, generatedAt };
    }

    const attempts = (rows ?? []) as AttemptLike[];
    if (attempts.length === 0) {
      const { report, model } = buildLearningReport([], {
        windowLabel: PERIOD_LABEL[data.period],
        now,
        driftSplitAt: now - (days / 2) * 24 * 60 * 60 * 1000,
      });
      return { report, model: serializeModel(model), period: data.period, total: 0, generatedAt };
    }

    // Enriquecimento em UM lote: produto, origem e valor por lead.
    const leadIds = Array.from(new Set(attempts.map((a) => a.lead_id))).slice(0, MAX_LEADS);
    const { data: leads } = await db
      .from("leads")
      .select("id, product, source, estimated_value, channel")
      .in("id", leadIds);

    const leadById = new Map<string, Record<string, unknown>>(
      ((leads ?? []) as Array<{ id: string }>).map((l) => [l.id, l as Record<string, unknown>]),
    );

    // Índice de insistência: a n-ésima tentativa da mesma conversa.
    const ordered = [...attempts].sort((a, b) => a.created_at.localeCompare(b.created_at));
    const seen = new Map<string, number>();
    const indexById = new Map<string, number>();
    for (const a of ordered) {
      const n = (seen.get(a.conversation_id) ?? 0) + 1;
      seen.set(a.conversation_id, n);
      indexById.set(a.id, n);
    }

    const events = [];
    for (const a of attempts) {
      const lead = leadById.get(a.lead_id);
      const event = toLearningEvent({
        ...a,
        product: (lead?.product as string | null) ?? null,
        source: (lead?.source as string | null) ?? null,
        channel: (lead?.channel as string | null) ?? "whatsapp",
        estimated_value: (lead?.estimated_value as number | null) ?? null,
        tone: a.selected_message_style ?? null,
        attempt_index: indexById.get(a.id) ?? 1,
      });
      if (event) events.push(event);
    }

    const { report, model } = buildLearningReport(events, {
      windowLabel: PERIOD_LABEL[data.period],
      now,
      driftSplitAt: now - (days / 2) * 24 * 60 * 60 * 1000,
    });

    return {
      report,
      model: serializeModel(model),
      period: data.period,
      total: events.length,
      generatedAt,
    };
  });
