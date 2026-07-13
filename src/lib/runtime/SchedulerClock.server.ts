// ============================================================================
// SchedulerClock — Relógio do Scheduler. Sempre delega ao RuntimeClock.
// Nunca usar Date.now() diretamente em nenhum ponto do Scheduler.
// ============================================================================

import { RuntimeClock } from "./RuntimeClock.server";

export class SchedulerClock {
  static now(): number {
    return RuntimeClock.now();
  }
  static nowIso(): string {
    return RuntimeClock.nowIso();
  }
  static nowDate(): Date {
    return RuntimeClock.nowDate();
  }
  static addSeconds(seconds: number): Date {
    return new Date(RuntimeClock.now() + Math.max(0, seconds) * 1000);
  }
  static addMs(ms: number): Date {
    return new Date(RuntimeClock.now() + Math.max(0, ms));
  }
  /** Retorna "HH:mm" em UTC. */
  static utcHHmm(ts: number = RuntimeClock.now()): string {
    const d = new Date(ts);
    const h = String(d.getUTCHours()).padStart(2, "0");
    const m = String(d.getUTCMinutes()).padStart(2, "0");
    return `${h}:${m}`;
  }
  /** 0 = Domingo … 6 = Sábado (UTC). */
  static utcDayOfWeek(ts: number = RuntimeClock.now()): number {
    return new Date(ts).getUTCDay();
  }
  static driftMs(expectedIso: string): number {
    return RuntimeClock.now() - new Date(expectedIso).getTime();
  }
}
