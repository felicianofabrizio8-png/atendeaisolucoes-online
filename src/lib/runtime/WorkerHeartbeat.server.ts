// ============================================================================
// WorkerHeartbeat — Batimento do Worker.
// Nenhum loop iniciado automaticamente.
// ============================================================================

import { RuntimeClock } from "./RuntimeClock.server";
import type { WorkerHealth, WorkerHealthSnapshot } from "./WorkerHealth.server";

export interface WorkerHeartbeatTick {
  ts: string;
  state: WorkerHealthSnapshot["state"];
  inFlight: number;
  jobsProcessed: number;
}

export class WorkerHeartbeat {
  private last: WorkerHeartbeatTick | null = null;

  constructor(private readonly health: WorkerHealth) {}

  tick(): WorkerHeartbeatTick {
    const s = this.health.snapshot();
    this.last = {
      ts: RuntimeClock.nowIso(),
      state: s.state,
      inFlight: s.inFlight,
      jobsProcessed: s.jobsProcessed,
    };
    return this.last;
  }

  lastTick(): WorkerHeartbeatTick | null {
    return this.last;
  }
}
