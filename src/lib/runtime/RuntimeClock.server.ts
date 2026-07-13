// ============================================================================
// RuntimeClock — Relógio central do Runtime.
// Toda infraestrutura futura DEVE usar este relógio (facilita testes/mocks).
// ============================================================================

export class RuntimeClock {
  private static _now: () => number = () => Date.now();

  static now(): number {
    return RuntimeClock._now();
  }

  static nowDate(): Date {
    return new Date(RuntimeClock.now());
  }

  static nowIso(): string {
    return RuntimeClock.nowDate().toISOString();
  }

  static since(tsMs: number): number {
    return Math.max(0, RuntimeClock.now() - tsMs);
  }

  /** Uso EXCLUSIVO em testes. */
  static __setNowForTests(fn: () => number): void {
    RuntimeClock._now = fn;
  }

  static __resetForTests(): void {
    RuntimeClock._now = () => Date.now();
  }
}
