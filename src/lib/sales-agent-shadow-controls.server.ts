import { createHash } from "node:crypto";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { RateLimitRepository } from "@/lib/rate-limit/RateLimitRepository.server";
import { estimateWorstCaseCostMicroUsd, getModelPrice } from "@/lib/ai-platform/config.server";
import type { AgentDecision, SalesAgentCompletionRequest } from "./sales-agent-core";
import type { SalesAgentShadowReport } from "./sales-agent-shadow.server";

type Env = NodeJS.ProcessEnv;
type BudgetReservation = { reservationId: string; duplicate: boolean };
export type ShadowBudgetSnapshot = { consumedMicroUsd: number; budgetMicroUsd: number };

export interface ShadowControlConfig {
  enabled: boolean;
  model: string;
  budgetMicroUsd: number;
  reservationMicroUsd: number;
  maxInputTokens: number;
  maxOutputTokens: number;
  hourlyCallLimit: number;
  dailyCallLimit: number;
  alertCostThresholdsPercent: number[];
  alertHourlyCalls: number | null;
  alertLatencyMs: number | null;
  alertDailyFailures: number | null;
}

function positive(name: string, env: Env): number | null {
  const value = Number(env[name]);
  return Number.isSafeInteger(value) && value > 0 ? value : null;
}

function parseAlertThresholds(value: string | undefined): number[] {
  const raw = (value ?? "50,80,100").split(",").map((item) => Number(item.trim()));
  return [...new Set(raw.filter((item) => Number.isInteger(item) && item > 0 && item <= 100))].sort((a, b) => a - b);
}

export function estimateShadowInputTokens(request: SalesAgentCompletionRequest): number {
  // Upper-bound heuristic: one UTF-16 code unit per token is intentionally
  // conservative so the provider cannot receive more input than reserved.
  return JSON.stringify({ messages: request.messages, tools: request.tools }).length;
}

export function resolveShadowControlConfig(env: Env = process.env): ShadowControlConfig {
  const enabled = env.SALES_AGENT_OPENAI_SHADOW_GUARD === "enabled";
  const model = env.SALES_AGENT_OPENAI_SHADOW_MODEL?.trim() ?? "";
  const budget = positive("SALES_AGENT_OPENAI_SHADOW_BUDGET_USD_MICRO", env);
  const maxInputTokens = positive("SALES_AGENT_OPENAI_SHADOW_MAX_INPUT_TOKENS", env);
  const maxOutputTokens = positive("SALES_AGENT_OPENAI_SHADOW_MAX_OUTPUT_TOKENS", env);
  const price = getModelPrice(model);
  const reservation = price && maxInputTokens !== null && maxOutputTokens !== null
    ? estimateWorstCaseCostMicroUsd(model, maxInputTokens, maxOutputTokens)
    : null;
  const hourly = positive("SALES_AGENT_OPENAI_SHADOW_CALLS_PER_HOUR", env);
  const daily = positive("SALES_AGENT_OPENAI_SHADOW_CALLS_PER_DAY", env);
  const optional = (name: string) => positive(name, env);
  const complete = Boolean(model && price && budget !== null && reservation !== null && reservation <= budget && maxInputTokens && maxOutputTokens && hourly && daily);
  return {
    enabled: enabled && complete,
    model,
    budgetMicroUsd: budget ?? 0,
    reservationMicroUsd: reservation ?? 0,
    maxInputTokens: maxInputTokens ?? 0,
    maxOutputTokens: maxOutputTokens ?? 0,
    hourlyCallLimit: hourly ?? 0,
    dailyCallLimit: daily ?? 0,
    alertCostThresholdsPercent: parseAlertThresholds(env.SALES_AGENT_OPENAI_SHADOW_ALERT_COST_THRESHOLDS_PERCENT),
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
  reconcile(input: { companyId: string; reservationId: string; actualMicroUsd: number; commit: boolean }): Promise<ShadowBudgetSnapshot>;
  claimAlert(input: { companyId: string; periodStart: string; kind: string; thresholdPercent: number }): Promise<boolean>;
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

  async reconcile(input: Parameters<ShadowBudgetStore["reconcile"]>[0]): Promise<ShadowBudgetSnapshot> {
    const { data, error } = await (supabaseAdmin as any).rpc("sales_agent_shadow_budget_reconcile", {
      p_company_id: input.companyId,
      p_reservation_id: input.reservationId,
      p_actual_microusd: input.actualMicroUsd,
      p_commit: input.commit,
    });
    if (error || !data?.ok) throw new Error(String(data?.code ?? "shadow_budget_reconcile_failed"));
    return { consumedMicroUsd: Number(data.consumed_microusd ?? 0), budgetMicroUsd: Number(data.budget_microusd ?? 0) };
  }

  async claimAlert(input: Parameters<ShadowBudgetStore["claimAlert"]>[0]): Promise<boolean> {
    const { data, error } = await (supabaseAdmin as any).rpc("sales_agent_shadow_alert_claim", {
      p_company_id: input.companyId,
      p_period_start: input.periodStart,
      p_alert_kind: input.kind,
      p_threshold_percent: input.thresholdPercent,
    });
    if (error || !data?.ok) throw new Error("shadow_alert_unavailable");
    return data.claimed === true;
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
  execute: (boundedRequest: SalesAgentCompletionRequest) => Promise<SalesAgentShadowReport>;
  now?: Date;
  env?: Env;
  budgetStore?: ShadowBudgetStore;
  rateLimits?: Pick<RateLimitRepository, "increment">;
  alert?: (event: { companyId: string; kind: string; value?: number; threshold?: number }) => void;
}): Promise<ShadowControlResult> {
  const config = resolveShadowControlConfig(input.env);
  if (!config.enabled) return { executed: false, reason: "shadow_controls_disabled_or_incomplete" };
  if (input.request.model !== config.model) return { executed: false, reason: "shadow_model_mismatch" };
  if (estimateShadowInputTokens(input.request) > config.maxInputTokens) return { executed: false, reason: "shadow_input_token_limit" };
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
    const boundedRequest = { ...input.request, max_tokens: config.maxOutputTokens };
    const report = await input.execute(boundedRequest);
    const actual = report.ok
      ? report.estimatedCostUsd === null
        ? config.reservationMicroUsd
        : Math.max(0, Math.round(report.estimatedCostUsd * 1_000_000))
      : 0;
    if (report.ok && report.estimatedCostUsd === null) alert({ companyId: input.companyId, kind: "cost_unknown", value: config.reservationMicroUsd });
    const snapshot = await budgetStore.reconcile({ companyId: input.companyId, reservationId: reservation.reservationId, actualMicroUsd: actual, commit: report.ok });
    try {
      if (report.ok) {
        for (const threshold of config.alertCostThresholdsPercent) {
          if (snapshot.consumedMicroUsd * 100 < snapshot.budgetMicroUsd * threshold) continue;
          if (await budgetStore.claimAlert({ companyId: input.companyId, periodStart: window.start, kind: "budget", thresholdPercent: threshold })) {
            alert({ companyId: input.companyId, kind: "budget_percent", value: snapshot.consumedMicroUsd, threshold });
          }
        }
      }
      if (config.alertLatencyMs !== null && report.latencyMs >= config.alertLatencyMs) alert({ companyId: input.companyId, kind: "latency", value: report.latencyMs, threshold: config.alertLatencyMs });
    } catch {
      alert({ companyId: input.companyId, kind: "shadow_alerts_unavailable" });
    }
    if (!report.ok) {
      try {
        const failures = await rateLimits.increment({ companyId: input.companyId, bucket: "sales_agent_shadow_failures_day", windowSeconds: 86400 });
        if (config.alertDailyFailures !== null && failures >= config.alertDailyFailures) alert({ companyId: input.companyId, kind: "failures_day", value: failures, threshold: config.alertDailyFailures });
      } catch {
        alert({ companyId: input.companyId, kind: "shadow_failure_metrics_unavailable" });
      }
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
