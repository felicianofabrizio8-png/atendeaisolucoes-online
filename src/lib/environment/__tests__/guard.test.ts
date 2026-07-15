// Testes do EnvironmentGuard usando injeção de dependências (sem I/O real).
import { describe, it, expect, vi } from "vitest";
import { assertOutbound } from "../EnvironmentGuard.server";
import type { OutboundAction, EnvironmentLookup } from "../types";

const ACTION: OutboundAction = {
  companyId: "11111111-1111-1111-1111-111111111111",
  action: "whatsapp.send.text",
  targetUrl: "https://graph.facebook.com/v20.0/x/messages",
  method: "POST",
  payload: { to: "+5511999998888", text: "olá" },
};

describe("EnvironmentGuard", () => {
  it("kill switch OFF → passa direto como legacy (Solário)", async () => {
    const dec = await assertOutbound(ACTION, {
      isEnabled: async () => false,
      lookupEnv: async () => ({ ok: true, environment: "production", cachedAt: 0 }),
      logger: async () => {
        throw new Error("logger nunca deveria ser chamado");
      },
    });
    expect(dec).toEqual({ proceed: true, environment: "legacy" });
  });

  it("production com flag ON → passa sem logar", async () => {
    const loggerSpy = vi.fn(async () => ({ ok: true, id: "sim-1" }));
    const dec = await assertOutbound(ACTION, {
      isEnabled: async () => true,
      lookupEnv: async () => ({ ok: true, environment: "production", cachedAt: 0 }),
      logger: loggerSpy,
    });
    expect(dec).toEqual({ proceed: true, environment: "production" });
    expect(loggerSpy).not.toHaveBeenCalled();
  });

  it("staging com flag ON → bloqueia e loga", async () => {
    const dec = await assertOutbound(ACTION, {
      isEnabled: async () => true,
      lookupEnv: async () => ({ ok: true, environment: "staging", cachedAt: 0 }),
      logger: async () => ({ ok: true, id: "sim-42" }),
    });
    expect(dec.proceed).toBe(false);
    if (dec.proceed) throw new Error("unreachable");
    expect(dec.environment).toBe("staging");
    expect(dec.simulationId).toBe("sim-42");
    expect(dec.reason).toBe("staging_tenant");
  });

  it("lookup falhou → tratado como unknown, bloqueia", async () => {
    const dec = await assertOutbound(ACTION, {
      isEnabled: async () => true,
      lookupEnv: async () =>
        ({ ok: false, reason: "lookup_error", error: "boom" }) as EnvironmentLookup,
      logger: async () => ({ ok: true, id: "sim-99" }),
    });
    expect(dec.proceed).toBe(false);
    if (dec.proceed) throw new Error("unreachable");
    expect(dec.environment).toBe("unknown");
    expect(dec.reason).toBe("lookup_failed");
    expect(dec.simulationId).toBe("sim-99");
  });

  it("company inexistente → bloqueia como unknown", async () => {
    const dec = await assertOutbound(ACTION, {
      isEnabled: async () => true,
      lookupEnv: async () => ({ ok: false, reason: "not_found" }),
      logger: async () => ({ ok: true, id: "sim-100" }),
    });
    expect(dec.proceed).toBe(false);
    if (dec.proceed) throw new Error("unreachable");
    expect(dec.environment).toBe("unknown");
    expect(dec.reason).toBe("lookup_failed");
  });

  it("logger falhou em staging → CONTINUA bloqueando", async () => {
    const dec = await assertOutbound(ACTION, {
      isEnabled: async () => true,
      lookupEnv: async () => ({ ok: true, environment: "staging", cachedAt: 0 }),
      logger: async () => ({ ok: false, id: null, error: "db down" }),
    });
    expect(dec.proceed).toBe(false);
    if (dec.proceed) throw new Error("unreachable");
    expect(dec.simulationId).toBeNull();
    expect(dec.reason).toBe("logger_failed");
    expect(dec.logError).toBe(true);
  });

  it("logger lançou exceção em staging → CONTINUA bloqueando", async () => {
    const dec = await assertOutbound(ACTION, {
      isEnabled: async () => true,
      lookupEnv: async () => ({ ok: true, environment: "staging", cachedAt: 0 }),
      logger: async () => {
        throw new Error("kaboom");
      },
    });
    expect(dec.proceed).toBe(false);
    if (dec.proceed) throw new Error("unreachable");
    expect(dec.simulationId).toBeNull();
    expect(dec.reason).toBe("logger_failed");
    expect(dec.logError).toBe(true);
  });

  it("isEnabled lançou exceção → tratado como flag OFF (preserva Solário)", async () => {
    const dec = await assertOutbound(ACTION, {
      isEnabled: async () => {
        throw new Error("db unreachable");
      },
      lookupEnv: async () => ({ ok: true, environment: "staging", cachedAt: 0 }),
      logger: async () => ({ ok: true, id: "x" }),
    });
    expect(dec).toEqual({ proceed: true, environment: "legacy" });
  });
});
