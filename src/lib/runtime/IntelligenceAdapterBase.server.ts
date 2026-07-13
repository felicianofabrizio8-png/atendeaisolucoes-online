// ============================================================================
// IntelligenceAdapterBase — Base compartilhada para adapters de agentes de
// inteligência (READ-ONLY). Padroniza validate/prepare/cleanup/health e
// delega apenas o `probe()` — a chamada ao agente real — para o subclasse.
// ============================================================================

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import type { AdapterHealthSnapshot, AgentAdapter } from "./AgentAdapter.server";
import type { ExecutionContext } from "./ExecutionContext.server";
import type { ExecutionResult } from "./ExecutionResult.server";
import { RuntimeClock } from "./RuntimeClock.server";

export interface IntelligenceProbeContext {
  ctx: ExecutionContext;
  supabase: SupabaseClient<Database>;
  companyId: string;
}

export interface IntelligenceProbeOutput {
  reason: string;
  detail?: Record<string, unknown>;
}

export abstract class IntelligenceAdapterBase implements AgentAdapter {
  abstract readonly agentId: string;
  readonly version: string = "real-1.0.0";
  readonly supportedJobs: string[];

  private lastCheckAtMs: number | null = null;
  private lastError: string | null = null;
  private lastDetail: Record<string, unknown> | null = null;
  private consecutiveFailures = 0;

  constructor() {
    // supportedJobs preenchido no construtor da subclasse via override.
    this.supportedJobs = [];
  }

  async validate(ctx: ExecutionContext): Promise<{ ok: boolean; reason: string }> {
    if (!ctx.tenantId) return { ok: false, reason: "missing_tenant" };
    if (ctx.agentId !== this.agentId) return { ok: false, reason: "agent_mismatch" };
    return { ok: true, reason: "valid" };
  }

  async prepare(_ctx: ExecutionContext): Promise<{ ok: boolean; reason: string }> {
    return { ok: true, reason: "prepared" };
  }

  async execute(ctx: ExecutionContext): Promise<ExecutionResult> {
    const startedMs = RuntimeClock.now();
    const startedIso = new Date(startedMs).toISOString();
    try {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const out = await this.probe({
        ctx,
        supabase: supabaseAdmin,
        companyId: ctx.tenantId,
      });
      this.lastCheckAtMs = RuntimeClock.now();
      this.lastError = null;
      this.lastDetail = out.detail ?? null;
      this.consecutiveFailures = 0;
      const finishedMs = RuntimeClock.now();
      return {
        executionId: ctx.executionId,
        jobId: ctx.job.id,
        agentId: ctx.agentId,
        tenantId: ctx.tenantId,
        outcome: "success",
        reason: out.reason,
        attempt: ctx.attempt,
        startedAt: startedIso,
        finishedAt: new Date(finishedMs).toISOString(),
        durationMs: finishedMs - startedMs,
        stub: false,
        error: null,
      };
    } catch (e) {
      const msg = e instanceof Error ? e.message : `${this.agentId}_error`;
      this.lastCheckAtMs = RuntimeClock.now();
      this.lastError = msg;
      this.consecutiveFailures += 1;
      const finishedMs = RuntimeClock.now();
      return {
        executionId: ctx.executionId,
        jobId: ctx.job.id,
        agentId: ctx.agentId,
        tenantId: ctx.tenantId,
        outcome: "failure",
        reason: msg,
        attempt: ctx.attempt,
        startedAt: startedIso,
        finishedAt: new Date(finishedMs).toISOString(),
        durationMs: finishedMs - startedMs,
        stub: false,
        error: msg,
      };
    }
  }

  async cleanup(_ctx: ExecutionContext): Promise<void> {
    /* no-op */
  }

  health(): AdapterHealthSnapshot {
    let level: AdapterHealthSnapshot["level"] = "unknown";
    if (this.lastCheckAtMs !== null) {
      if (this.consecutiveFailures === 0) level = "healthy";
      else if (this.consecutiveFailures < 3) level = "degraded";
      else level = "down";
    }
    return {
      level,
      lastCheckAt: this.lastCheckAtMs ? new Date(this.lastCheckAtMs).toISOString() : null,
      lastError: this.lastError,
    };
  }

  lastDetailSnapshot(): Record<string, unknown> | null {
    return this.lastDetail;
  }

  /** Subclasse implementa a chamada READ-ONLY ao agente real. */
  protected abstract probe(input: IntelligenceProbeContext): Promise<IntelligenceProbeOutput>;
}
