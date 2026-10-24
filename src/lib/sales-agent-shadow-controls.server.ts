import { createHash } from "node:crypto";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { RateLimitRepository } from "@/lib/rate-limit/RateLimitRepository.server";
import type { AgentDecision, SalesAgentCompletionRequest } from "./sales-agent-core";
import type { SalesAgentShadowReport } from "./sales-agent-shadow.server";

type Env = NodeJS.ProcessEnv;
type BudgetReservation = { reservationId: string; duplicate: boolean };

export interface ShadowControlConfig {
  enabled: boolean;
  budgetMicroUsd: number;
  reservationMicroUsd: number;
  hourlyCallLimit: number;
  dailyCallLimit: number;
  alertCostMicroUsd: number | null;
  alertHourlyCalls: number | null;
  alertLatencyMs: number | null;
  alertDailyFailures: number | null;
}

function positive(name: string, env: Env): number | null {
  const value = Number(env[name]);
  return Number.isSafeInteger(value) && value > 0 ? value : null;
}

export function resolveShadowControlConfig(env: Env = process.env): ShadowControlConfig {
  const enabled = env.SALES_AGENT_OPENAI_SHADOW_GUARD === "enabled";
  const budget = positive("SALES_AGENT_OPENAI_SHADOW_BUDGET_USD_MICRO", env);
  const reservation = positive("SALES_AGENT_OPENAI_SHADOW_RESERVATION_USD_MICRO", env);
  const hourly = positive("SALES_AGENT_OPENAI_SHADOW_CALLS_PER_HOUR", env);
  const daily = positive("SALES_AGENT_OPENAI_SHADOW_CALLS_PER_DAY", env);
  const optional = (name: string) => positive(name, env);
  const complete = budget !== null && reservation !== null && reservation <= budget && hourly !== null && daily !== null;
  return {
    enabled: enabled && complete,
    budgetMicroUsd: budget ?? 0,
    reservationMicroUsd: reservation ?? 0,
    hourlyCallLimit: hourly ?? 0,
    dailyCallLimit: daily ?? 0,
    alertCostMicroUsd: optional("SALES_AGENT_OPENAI_SHADOW_ALERT_COST_USD_MICRO"),
    alertHourlyCalls: optional("SALES_AGENT_OPENAI_SHADOW_ALERT_CALLS_PER_HOUR"),
    alertLatencyMs: optional("SALES_AGENT_OPENAI_SHADOW_ALERT_LATENCY_MS"),
    alertDailyFailures: optional("SALES_AGENT_OPENAI_SHADOW_ALERT_FAILURES_PER_DAY"),
  };
}

export function shadowIdempotencyKey(companyId: string, request: SalesAgentCompletionRequest, currentDecision: AgentDecision): string {
  return createHash("sha256")
    .update(JSON.stringify({ companyId, request, currentKind: currentDecision.kind, currentNextAction: currentDecision.next_action ?? null }))
    .digest("hex");
}

interface ShadowBudgetStore {
  reserve(input: { companyId: string; periodStart: string; periodEnd: string; budgetMicroUsd: number; reservationMicroUsd: number; idempotencyKey: string }): Promise<BudgetReservation>;
  reconcile(input: { companyId: string; reservationId: string; actualMicroUsd: number; commit: boolean }): Promise<void>;
}

class SupabaseShadowBudgetStore implements ShadowBudgetStore {
  async reserve(input: Parameters<ShadowBudgetStore["reserve"]>[0]): Promise<BudgetReservation> {
    const { data, error } = await (supabaseAdmin as any).rpc("sales_agent_shadow_budget_reserve", {
      p_company_id: input.companyId,
      p_period_start: input.periodStart,
      p_period_end: input.periodEnd,
      p_budget_microusd: input.budgetMicroUsd,
      p_idempotency_key: input.idempotencyKey,
      p_reserve_microusd: input.reservationMicroUsd,
    });
    if (error || !data?.ok) throw new Error(String(data?.code ?? "shadow_budget_unavailable"));
    return { reservationId: String(data.reservation_id), duplicate: data.duplicate === true };
  }

  async reconcile(input: Parameters<ShadowBudgetStore["reconcile"]>[0]): Promise<void> {
    const { data, error } = await (supabaseAdmin as any).rpc("sales_agent_shadow_budget_reconcile", {
      p_company_id: input.companyId,
      p_reservation_id: input.reservationId,
      p_actual_microusd: input.actualMicroUsd,
      p_commit: input.commit,
    });
    if (error || !data?.ok) throw new Error(String(data?.code ?? "shadow_budget_reconcile_failed"));
  }
}

const period = (now = new Date()) => {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  return { start: start.toISOString(), end: end.toISOString() };
};

export interface ShadowControlResult {
  executed: boolean;
  reason?: string;
  report?: SalesAgentShadowReport;
}

export async function runSalesAgentShadowWithControls(input: {
  companyId: string;
  request: SalesAgentCompletionRequest;
  currentDecision: AgentDecision;
  execute: () => Promise<SalesAgentShadowReport>;
  now?: Date;
  env?: Env;
  budgetStore?: ShadowBudgetStore;
  rateLimits?: Pick<RateLimitRepository, "increment">;
  alert?: (event: { companyId: string; kind: string; value?: number; threshold?: number }) => void;
}): Promise<ShadowControlResult> {
  const config = resolveShadowControlConfig(input.env);
  if (!config.enabled) return { executed: false, reason: "shadow_controls_disabled_or_incomplete" };
  const budgetStore = input.budgetStore ?? new SupabaseShadowBudgetStore();
  const rateLimits = input.rateLimits ?? new RateLimitRepository(supabaseAdmin);
  const alert = input.alert ?? ((event) => console.warn("[SALES_AGENT_SHADOW_ALERT]", event));
  const key = shadowIdempotencyKey(input.companyId, input.request, input.currentDecision);
  const window = period(input.now);
  let reservation: BudgetReservation;
  try {
    reservation = await budgetStore.reserve({ companyId: input.companyId, periodStart: window.start, periodEnd: window.end, budgetMicroUsd: config.budgetMicroUsd, reservationMicroUsd: config.reservationMicroUsd, idempotencyKey: key });
  } catch (error) {
    alert({ companyId: input.companyId, kind: "budget_unavailable" });
    return { executed: false, reason: error instanceof Error ? error.message : "shadow_budget_unavailable" };
  }
  if (reservation.duplicate) return { executed: false, reason: "shadow_duplicate" };
  let hourly: number;
  let daily: number;
  try {
    hourly = await rateLimits.increment({ companyId: input.companyId, bucket: "sales_agent_shadow_calls_hour", windowSeconds: 3600 });
    daily = await rateLimits.increment({ companyId: input.companyId, bucket: "sales_agent_shadow_calls_day", windowSeconds: 86400 });
    if (hourly > config.hourlyCallLimit || daily > config.dailyCallLimit) throw new Error("shadow_call_limit_exceeded");
  } catch (error) {
    await budgetStore.reconcile({ companyId: input.companyId, reservationId: reservation.reservationId, actualMicroUsd: 0, commit: false }).catch(() => alert({ companyId: input.companyId, kind: "budget_release_failed" }));
    alert({ companyId: input.companyId, kind: error instanceof Error ? error.message : "shadow_call_limit_unavailable" });
    return { executed: false, reason: error instanceof Error ? error.message : "shadow_call_limit_unavailable" };
  }
  if (config.alertHourlyCalls !== null && hourly >= config.alertHourlyCalls) alert({ companyId: input.companyId, kind: "volume_hour", value: hourly, threshold: config.alertHourlyCalls });
  try {
    const report = await input.execute();
    const actual = report.ok
      ? report.estimatedCostUsd === null
        ? config.reservationMicroUsd
        : Math.max(0, Math.round(report.estimatedCostUsd * 1_000_000))
      : 0;
    if (report.ok && report.estimatedCostUsd === null) alert({ companyId: input.companyId, kind: "cost_unknown", value: config.reservationMicroUsd });
    await budgetStore.reconcile({ companyId: input.companyId, reservationId: reservation.reservationId, actualMicroUsd: actual, commit: report.ok });
    if (config.alertCostMicroUsd !== null && actual >= config.alertCostMicroUsd) alert({ companyId: input.companyId, kind: "cost", value: actual, threshold: config.alertCostMicroUsd });
    if (config.alertLatencyMs !== null && report.latencyMs >= config.alertLatencyMs) alert({ companyId: input.companyId, kind: "latency", value: report.latencyMs, threshold: config.alertLatencyMs });
    if (!report.ok) {
      const failures = await rateLimits.increment({ companyId: input.companyId, bucket: "sales_agent_shadow_failures_day", windowSeconds: 86400 });
      if (config.alertDailyFailures !== null && failures >= config.alertDailyFailures) alert({ companyId: input.companyId, kind: "failures_day", value: failures, threshold: config.alertDailyFailures });
    }
    return { executed: true, report };
  } catch (error) {
    await budgetStore.reconcile({ companyId: input.companyId, reservationId: reservation.reservationId, actualMicroUsd: 0, commit: false }).catch(() => alert({ companyId: input.companyId, kind: "budget_release_failed" }));
    const failures = await rateLimits.increment({ companyId: input.companyId, bucket: "sales_agent_shadow_failures_day", windowSeconds: 86400 }).catch(() => null);
    if (failures !== null && config.alertDailyFailures !== null && failures >= config.alertDailyFailures) alert({ companyId: input.companyId, kind: "failures_day", value: failures, threshold: config.alertDailyFailures });
    alert({ companyId: input.companyId, kind: "shadow_execution_failed" });
    return { executed: false, reason: error instanceof Error ? error.message : "shadow_execution_failed" };
  }
}
