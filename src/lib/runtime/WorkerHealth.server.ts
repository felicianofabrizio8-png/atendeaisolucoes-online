// ============================================================================
// WorkerHealth — Estado agregado do Worker. Sem monitoramento ativo.
// ============================================================================

import { RuntimeClock } from "./RuntimeClock.server";

export type WorkerState = "idle" | "busy" | "blocked" | "offline";

export interface WorkerHealthSnapshot {
  ts: string;
  state: WorkerState;
  online: boolean;
  uptimeMs: number;
  inFlight: number;
  jobsProcessed: number;
  lastJobId: string | null;
  lastJobAt: string | null;
  lastError: string | null;
}

export class WorkerHealth {
  private inFlight = 0;
  private jobsProcessed = 0;
  private lastJobId: string | null = null;
  private lastJobAtMs: number | null = null;
  private lastError: string | null = null;
  private online = true;

  constructor(private readonly startedAtMs: number) {}

  markStart(jobId: string): void {
    this.inFlight += 1;
    this.lastJobId = jobId;
  }

  markEnd(err: string | null): void {
    this.inFlight = Math.max(0, this.inFlight - 1);
    this.jobsProcessed += 1;
    this.lastJobAtMs = RuntimeClock.now();
    this.lastError = err;
  }

  setOnline(online: boolean): void {
    this.online = online;
  }

  snapshot(): WorkerHealthSnapshot {
    const state: WorkerState = !this.online ? "offline" : this.inFlight > 0 ? "busy" : "idle";
    return {
      ts: RuntimeClock.nowIso(),
      state,
      online: this.online,
      uptimeMs: RuntimeClock.since(this.startedAtMs),
      inFlight: this.inFlight,
      jobsProcessed: this.jobsProcessed,
      lastJobId: this.lastJobId,
      lastJobAt: this.lastJobAtMs ? new Date(this.lastJobAtMs).toISOString() : null,
      lastError: this.lastError,
    };
  }
}
