// Testes do lock técnico com TTL: garante que locks vazados (sem release
// por request abortada) sejam recuperados após expiração, sem quebrar a
// proteção contra execução concorrente real.

import { describe, it, expect, beforeEach } from "vitest";
import {
  tryAcquireLock,
  releaseLock,
  __resetLocksForTests,
  DEFAULT_LOCK_TTL_MS,
} from "../HookSecurity.server";

describe("HookSecurity — lock com TTL", () => {
  beforeEach(() => __resetLocksForTests());

  it("lock inexistente pode ser adquirido", () => {
    expect(tryAcquireLock("k1")).toBe(true);
  });

  it("segundo lock ativo é rejeitado", () => {
    const t0 = 1_000_000;
    expect(tryAcquireLock("k1", 60_000, t0)).toBe(true);
    expect(tryAcquireLock("k1", 60_000, t0 + 1_000)).toBe(false);
  });

  it("lock expirado é recuperado (recovered_expired)", () => {
    const t0 = 1_000_000;
    expect(tryAcquireLock("k1", 60_000, t0)).toBe(true);
    // Uma vida após TTL — request anterior morreu sem release.
    expect(tryAcquireLock("k1", 60_000, t0 + 60_001)).toBe(true);
  });

  it("releaseLock permite nova aquisição imediata", () => {
    expect(tryAcquireLock("k2")).toBe(true);
    releaseLock("k2");
    expect(tryAcquireLock("k2")).toBe(true);
  });

  it("erro durante o tick não mantém lock permanente (release manual)", () => {
    expect(tryAcquireLock("k3")).toBe(true);
    try {
      throw new Error("boom");
    } catch {
      releaseLock("k3");
    }
    expect(tryAcquireLock("k3")).toBe(true);
  });

  it("DEFAULT_LOCK_TTL_MS cobre o pior caso do polling da Meta (>50s)", () => {
    expect(DEFAULT_LOCK_TTL_MS).toBeGreaterThanOrEqual(90_000);
  });
});
