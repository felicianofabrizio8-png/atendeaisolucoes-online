// ============================================================================
// Coach Evolutivo — Telemetria de aprendizados (SPRINT 4 · FASE 2)
//
// PROBLEMA CORRIGIDO
// ------------------
// A rota `/api/coach/suggest` executa com `supabaseAdmin` (service role).
// As RPCs públicas `increment_coach_learning_usage` e
// `record_coach_learning_retrieval` resolvem o tenant via
// `current_company_id()` → `auth.uid()`, que é NULL sob service role.
// Resultado: ambas retornavam 0 sem atualizar nada, silenciosamente.
//
// SOLUÇÃO
// -------
// Variantes `*_internal` no banco recebem `company_id` EXPLÍCITO e são
// executáveis apenas por `service_role` (EXECUTE revogado de anon/authenticated).
// O `company_id` NUNCA vem do navegador — é sempre derivado no servidor a
// partir do JWT do usuário (`profiles.company_id`).
//
// GARANTIAS
// ---------
//  - Isolamento: o banco valida cada `learning_id` contra `company_id`;
//    IDs de outra empresa são ignorados (sem erro, sem vazamento).
//  - Idempotência: `coach_learning_retrievals` tem UNIQUE
//    (learning_id, generation_ref) e a coluna-ledger `usage_counted`.
//    Usamos `suggestion_id` como `generation_ref` → retry não duplica.
//  - Resiliência: nenhuma função aqui lança. A sugestão SEMPRE é entregue.
//  - Observabilidade: falha nunca é silenciosa — gera log estruturado
//    sanitizado com allowlist estrita de campos.
// ============================================================================
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

type SB = SupabaseClient<Database>;

/** Resultado observável — nunca lança, sempre discriminável. */
export type CoachTelemetryResult =
  | { ok: true; updatedCount: number; insertedCount: number; durationMs: number }
  | { ok: false; code: string; pgCode?: string; durationMs: number };

/** Motivo determinístico da seleção. Fase 2 ainda é recuperação estática. */
export const COACH_SELECTION_REASON_STATIC = "priority_static";

/**
 * Campos permitidos em log. Qualquer coisa fora desta allowlist NÃO é logada.
 * Proibido: regra completa, mensagem, prompt, JWT, e-mail, telefone, token.
 */
interface CoachTelemetryLogFields {
  companyId?: string | null;
  suggestionId?: string | null;
  conversationId?: string | null;
  learningCount?: number;
  updatedCount?: number;
  insertedCount?: number;
  durationMs?: number;
  errorCode?: string;
  pgCode?: string | null;
}

type CoachTelemetryEvent =
  | "coach_learning_usage_recorded"
  | "coach_learning_retrieval_recorded"
  | "coach_learning_telemetry_failed";

/** Mascara UUID preservando capacidade de correlação (8 primeiros chars). */
function maskId(id: string | null | undefined): string | null {
  if (!id) return null;
  return `${String(id).slice(0, 8)}…`;
}

function logTelemetry(event: CoachTelemetryEvent, fields: CoachTelemetryLogFields): void {
  const safe: Record<string, unknown> = {
    event,
    companyId: maskId(fields.companyId),
    suggestionId: maskId(fields.suggestionId),
    conversationId: maskId(fields.conversationId),
    learningCount: fields.learningCount ?? 0,
    updatedCount: fields.updatedCount ?? 0,
    insertedCount: fields.insertedCount ?? 0,
    durationMs: fields.durationMs ?? 0,
    timestamp: new Date().toISOString(),
  };
  if (fields.errorCode) safe.errorCode = fields.errorCode;
  if (fields.pgCode) safe.pgCode = fields.pgCode;

  if (event === "coach_learning_telemetry_failed") {
    console.error("[coach-telemetry]", safe);
  } else {
    console.info("[coach-telemetry]", safe);
  }
}

/** Extrai um código estável de erro sem jamais expor conteúdo sensível. */
function errorCodeOf(err: unknown): { code: string; pgCode?: string } {
  const raw = (err ?? {}) as { code?: unknown; message?: unknown };
  const pgCode = typeof raw.code === "string" ? raw.code : undefined;
  if (pgCode === "42501" || pgCode === "PGRST301") return { code: "permission_denied", pgCode };
  if (pgCode === "PGRST202") return { code: "rpc_not_found", pgCode };
  if (typeof raw.message === "string" && raw.message.toLowerCase().includes("failed to fetch")) {
    return { code: "network", pgCode };
  }
  return { code: "internal", pgCode };
}

export interface RecordRetrievalInput {
  companyId: string;
  learningIds: string[];
  /** Chave de idempotência. Na rota de sugestão é o `coach_suggestions.id`. */
  generationRef: string;
  conversationId?: string | null;
  messageId?: string | null;
  selectionReason?: string;
}

/**
 * Registra em `coach_learning_retrievals` os aprendizados que entraram no
 * prompt e incrementa `times_retrieved` / `last_retrieved_at`.
 * Idempotente por (learning_id, generation_ref). Nunca lança.
 */
export async function recordRetrievalInternal(
  sb: SB,
  input: RecordRetrievalInput,
): Promise<CoachTelemetryResult> {
  const t0 = Date.now();
  const learningCount = input.learningIds.length;

  // Lista vazia é caminho normal (conversa sem aprendizados) — não é erro.
  if (learningCount === 0 || !input.companyId || !input.generationRef) {
    return { ok: true, updatedCount: 0, insertedCount: 0, durationMs: Date.now() - t0 };
  }

  try {
    const { data, error } = await sb.rpc(
      "record_coach_learning_retrieval_internal" as never,
      {
        _company_id: input.companyId,
        _ids: input.learningIds,
        _generation_ref: input.generationRef,
        _conversation_id: input.conversationId ?? null,
        _message_id: input.messageId ?? null,
        _selection_reason: input.selectionReason ?? COACH_SELECTION_REASON_STATIC,
      } as never,
    );
    if (error) throw error;

    const insertedCount = Number(data ?? 0);
    const durationMs = Date.now() - t0;
    logTelemetry("coach_learning_retrieval_recorded", {
      companyId: input.companyId,
      suggestionId: input.generationRef,
      conversationId: input.conversationId ?? null,
      learningCount,
      insertedCount,
      durationMs,
    });
    return { ok: true, updatedCount: 0, insertedCount, durationMs };
  } catch (err) {
    const { code, pgCode } = errorCodeOf(err);
    const durationMs = Date.now() - t0;
    logTelemetry("coach_learning_telemetry_failed", {
      companyId: input.companyId,
      suggestionId: input.generationRef,
      conversationId: input.conversationId ?? null,
      learningCount,
      durationMs,
      errorCode: `retrieval:${code}`,
      pgCode: pgCode ?? null,
    });
    return { ok: false, code, pgCode, durationMs };
  }
}

export interface IncrementUsageInput {
  companyId: string;
  learningIds: string[];
  /** Quando informado, o incremento é idempotente por geração. */
  generationRef?: string | null;
}

/**
 * Incrementa `usage_count` / `last_used_at` dos aprendizados efetivamente
 * usados. Idempotente quando `generationRef` é informado — o banco usa
 * `coach_learning_retrievals.usage_counted` como ledger, de modo que um
 * retry da MESMA sugestão não recontabiliza. Nunca lança.
 */
export async function incrementUsageInternal(
  sb: SB,
  input: IncrementUsageInput,
): Promise<CoachTelemetryResult> {
  const t0 = Date.now();
  const learningCount = input.learningIds.length;

  if (learningCount === 0 || !input.companyId) {
    return { ok: true, updatedCount: 0, insertedCount: 0, durationMs: Date.now() - t0 };
  }

  try {
    const { data, error } = await sb.rpc(
      "increment_coach_learning_usage_internal" as never,
      {
        _company_id: input.companyId,
        _ids: input.learningIds,
        _generation_ref: input.generationRef ?? null,
      } as never,
    );
    if (error) throw error;

    const updatedCount = Number(data ?? 0);
    const durationMs = Date.now() - t0;
    logTelemetry("coach_learning_usage_recorded", {
      companyId: input.companyId,
      suggestionId: input.generationRef ?? null,
      learningCount,
      updatedCount,
      durationMs,
    });
    return { ok: true, updatedCount, insertedCount: 0, durationMs };
  } catch (err) {
    const { code, pgCode } = errorCodeOf(err);
    const durationMs = Date.now() - t0;
    logTelemetry("coach_learning_telemetry_failed", {
      companyId: input.companyId,
      suggestionId: input.generationRef ?? null,
      learningCount,
      durationMs,
      errorCode: `usage:${code}`,
      pgCode: pgCode ?? null,
    });
    return { ok: false, code, pgCode, durationMs };
  }
}

export interface SuggestionTelemetryInput {
  companyId: string;
  suggestionId: string;
  learningIds: string[];
  conversationId?: string | null;
  messageId?: string | null;
}

export interface SuggestionTelemetryOutcome {
  ok: boolean;
  insertedCount: number;
  updatedCount: number;
}

/**
 * Orquestra a ordem correta de persistência da telemetria de UMA sugestão:
 *   1. retrievals (cria o ledger)  →  2. usage (consome o ledger)
 *
 * O incremento de uso depende do retrieval já existir, então a ordem importa.
 * Nunca lança: uma falha aqui NÃO pode impedir a entrega da sugestão.
 */
export async function recordSuggestionTelemetry(
  sb: SB,
  input: SuggestionTelemetryInput,
): Promise<SuggestionTelemetryOutcome> {
  const retrieval = await recordRetrievalInternal(sb, {
    companyId: input.companyId,
    learningIds: input.learningIds,
    generationRef: input.suggestionId,
    conversationId: input.conversationId ?? null,
    messageId: input.messageId ?? null,
    selectionReason: COACH_SELECTION_REASON_STATIC,
  });

  const usage = await incrementUsageInternal(sb, {
    companyId: input.companyId,
    learningIds: input.learningIds,
    generationRef: input.suggestionId,
  });

  return {
    ok: retrieval.ok && usage.ok,
    insertedCount: retrieval.ok ? retrieval.insertedCount : 0,
    updatedCount: usage.ok ? usage.updatedCount : 0,
  };
}
