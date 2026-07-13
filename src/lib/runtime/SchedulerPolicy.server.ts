// ============================================================================
// SchedulerPolicy — Contratos de agenda para o RuntimeScheduler.
// Não executa nada. Apenas define intervalos, janelas, cooldown, retry, etc.
// ============================================================================

import type { RuntimeJobPriority } from "./RuntimeTypes";
import { SchedulerClock } from "./SchedulerClock.server";

export type SchedulerDayOfWeek = 0 | 1 | 2 | 3 | 4 | 5 | 6;

export interface SchedulerWindow {
  /** "HH:mm" UTC inclusivo. */
  startUtc: string;
  /** "HH:mm" UTC exclusivo. */
  endUtc: string;
}

export interface SchedulerPolicySpec {
  /** Intervalo entre execuções em segundos. Ignorado se cronExpression for definido. */
  intervalSeconds?: number;
  /** Expressão cron (5 campos). Reservado para futura expansão — não avaliado aqui. */
  cronExpression?: string;
  /** Timezone lógico (documentação; toda avaliação real é em UTC). */
  timezone?: string;
  /** Janela horária permitida (UTC). */
  window?: SchedulerWindow;
  /** Dias permitidos (0=Dom … 6=Sáb, UTC). Vazio = qualquer dia. */
  daysOfWeek?: SchedulerDayOfWeek[];
  /** Somente dias úteis (Seg–Sex, UTC). */
  businessDaysOnly?: boolean;
  /** Retry máximo por avaliação bloqueada. */
  maxRetries: number;
  /** Segundos de backoff quando bloqueado. */
  retryBackoffSeconds: number;
  /** Delay máximo tolerado entre "esperado" e "agora" (segundos). */
  maxDelaySeconds: number;
  /** Drift máximo tolerado antes de considerar atraso crítico (segundos). */
  maxDriftSeconds: number;
  /** Cooldown mínimo entre execuções (segundos). */
  cooldownSeconds: number;
  /** Prioridade padrão do Job gerado. */
  priority: RuntimeJobPriority;
}

export interface SchedulerPolicyEvaluation {
  ok: boolean;
  reason: string;
  nextEvaluationAt: string;
}

export const DEFAULT_SCHEDULER_POLICY: SchedulerPolicySpec = {
  intervalSeconds: 300,
  timezone: "UTC",
  maxRetries: 3,
  retryBackoffSeconds: 60,
  maxDelaySeconds: 300,
  maxDriftSeconds: 120,
  cooldownSeconds: 60,
  priority: "normal",
};

export class SchedulerPolicy {
  static create(overrides: Partial<SchedulerPolicySpec> = {}): SchedulerPolicySpec {
    return { ...DEFAULT_SCHEDULER_POLICY, ...overrides };
  }

  /** Avalia se a política permite disparar agora. Não cria job. */
  static evaluate(
    policy: SchedulerPolicySpec,
    ctx: { lastEnqueueAt: string | null; nowMs?: number } = { lastEnqueueAt: null },
  ): SchedulerPolicyEvaluation {
    const now = ctx.nowMs ?? SchedulerClock.now();

    // Janela
    if (policy.window) {
      const hhmm = SchedulerClock.utcHHmm(now);
      if (!SchedulerPolicy.inWindow(hhmm, policy.window)) {
        return {
          ok: false,
          reason: "outside_window",
          nextEvaluationAt: SchedulerClock.addSeconds(policy.retryBackoffSeconds).toISOString(),
        };
      }
    }

    // Dia útil
    const dow = SchedulerClock.utcDayOfWeek(now) as SchedulerDayOfWeek;
    if (policy.businessDaysOnly && (dow === 0 || dow === 6)) {
      return {
        ok: false,
        reason: "weekend_blocked",
        nextEvaluationAt: SchedulerClock.addSeconds(3600).toISOString(),
      };
    }
    if (policy.daysOfWeek?.length && !policy.daysOfWeek.includes(dow)) {
      return {
        ok: false,
        reason: "day_not_allowed",
        nextEvaluationAt: SchedulerClock.addSeconds(3600).toISOString(),
      };
    }

    // Cooldown / intervalo
    if (ctx.lastEnqueueAt) {
      const elapsed = (now - new Date(ctx.lastEnqueueAt).getTime()) / 1000;
      if (elapsed < policy.cooldownSeconds) {
        return {
          ok: false,
          reason: "cooldown_active",
          nextEvaluationAt: new Date(
            new Date(ctx.lastEnqueueAt).getTime() + policy.cooldownSeconds * 1000,
          ).toISOString(),
        };
      }
      if (policy.intervalSeconds && elapsed < policy.intervalSeconds) {
        return {
          ok: false,
          reason: "interval_not_reached",
          nextEvaluationAt: new Date(
            new Date(ctx.lastEnqueueAt).getTime() + policy.intervalSeconds * 1000,
          ).toISOString(),
        };
      }
    }

    return {
      ok: true,
      reason: "ready",
      nextEvaluationAt: SchedulerClock.addSeconds(policy.intervalSeconds ?? 60).toISOString(),
    };
  }

  static inWindow(hhmm: string, w: SchedulerWindow): boolean {
    const toMin = (s: string) => {
      const [h, m] = s.split(":").map(Number);
      return h * 60 + m;
    };
    const cur = toMin(hhmm);
    const start = toMin(w.startUtc);
    const end = toMin(w.endUtc);
    return start <= end ? cur >= start && cur < end : cur >= start || cur < end;
  }
}
