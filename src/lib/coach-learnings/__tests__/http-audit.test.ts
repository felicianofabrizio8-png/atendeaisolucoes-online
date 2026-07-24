// Testes de HttpAudit — validam retorno explícito e sanitização.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { HttpAudit } from "@/lib/audit/HttpAudit.server";

function makeWriter(insertImpl: (payload: unknown) => unknown) {
  return {
    from: (table: string) => {
      expect(table).toBe("http_audit_log");
      return {
        insert: async (payload: unknown) => insertImpl(payload),
      };
    },
  } as never;
}

describe("HttpAudit.record", () => {
  const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

  beforeEach(() => errSpy.mockClear());
  afterEach(() => errSpy.mockClear());

  it("returns { ok: true } on success and forwards sanitized payload", async () => {
    let captured: Record<string, unknown> | null = null;
    const writer = makeWriter((payload) => {
      captured = payload as Record<string, unknown>;
      return { error: null };
    });
    const audit = new HttpAudit(writer);
    const res = await audit.record({
      companyId: "00000000-0000-0000-0000-000000000001",
      userId: "00000000-0000-0000-0000-000000000002",
      method: "POST",
      path: "rpc:create_coach_learning",
      status: 500,
      durationMs: 12.7,
      outcome: "error",
      error: "boom user@x.com +5511999999999 eyJabc.def.ghi",
    });
    expect(res).toEqual({ ok: true });
    expect(captured).toMatchObject({
      path: "rpc:create_coach_learning",
      outcome: "error",
      status: 500,
      duration_ms: 12,
    });
    const raw = (captured as unknown as { error: string }).error;
    expect(raw).not.toContain("user@x.com");
    expect(raw).not.toContain("5511");
    expect(raw).not.toContain("eyJabc");
  });

  it("returns { ok:false, code:'permission_denied', pgCode:'42501' } on RLS block", async () => {
    const writer = makeWriter(() => ({
      error: { code: "42501", message: "new row violates row-level security policy" },
    }));
    const res = await audit.recordCall(writer, "42501");
    expect(res).toEqual({ ok: false, code: "permission_denied", pgCode: "42501" });
    expect(errSpy).toHaveBeenCalledWith(
      "[http_audit] write_failed",
      expect.objectContaining({
        pgCode: "42501",
        code: "permission_denied",
        path: "rpc:create_coach_learning",
        outcome: "error",
      }),
    );
  });

  it("returns foreign_key_violation for pg 23503", async () => {
    const writer = makeWriter(() => ({
      error: { code: "23503", message: "insert or update on table violates foreign key" },
    }));
    const res = await audit.recordCall(writer, "23503");
    expect(res).toEqual({ ok: false, code: "foreign_key_violation", pgCode: "23503" });
  });

  it("returns table_unavailable for pg 42P01", async () => {
    const writer = makeWriter(() => ({
      error: { code: "42P01", message: 'relation "public.http_audit_log" does not exist' },
    }));
    const res = await audit.recordCall(writer, "42P01");
    expect(res).toEqual({ ok: false, code: "table_unavailable", pgCode: "42P01" });
  });

  it("returns { ok:false, code:'network' } and logs on thrown exception", async () => {
    const writer = makeWriter(() => {
      throw new Error("fetch failed");
    });
    const res = await audit.recordCall(writer, "network");
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe("network");
    expect(errSpy).toHaveBeenCalledWith(
      "[http_audit] write_failed",
      expect.objectContaining({ code: "network" }),
    );
  });

  it("logs never contain PII", async () => {
    const writer = makeWriter(() => ({
      error: { code: "42501", message: "user user@x.com token eyJfoo.bar.baz" },
    }));
    await audit.recordCall(writer, "42501");
    const call = errSpy.mock.calls.find((c) => c[0] === "[http_audit] write_failed");
    expect(call).toBeTruthy();
    const payload = call![1] as { message: string };
    expect(payload.message).not.toContain("user@x.com");
    expect(payload.message).not.toContain("eyJfoo");
  });
});

// Pequeno helper para reduzir boilerplate nos testes.
declare module "@/lib/audit/HttpAudit.server" {
  interface HttpAudit {
    recordCall(
      writer: never,
      _tag: string,
    ): Promise<{ ok: true } | { ok: false; code: string; pgCode?: string }>;
  }
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(HttpAudit.prototype as any).recordCall = async function (writer: never, _tag: string) {
  // Substitui o writer para a chamada única e delega no método principal.
  const original = (this as unknown as { writer: unknown }).writer;
  (this as unknown as { writer: unknown }).writer = writer;
  try {
    return await this.record({
      companyId: null,
      userId: null,
      method: "POST",
      path: "rpc:create_coach_learning",
      status: 500,
      durationMs: 1,
      outcome: "error",
      error: "probe",
    });
  } finally {
    (this as unknown as { writer: unknown }).writer = original;
  }
};

// Reinstancia com writer dummy para permitir chamadas via recordCall(writer).
const audit = new HttpAudit({ from: () => ({ insert: async () => ({ error: null }) }) } as never);
