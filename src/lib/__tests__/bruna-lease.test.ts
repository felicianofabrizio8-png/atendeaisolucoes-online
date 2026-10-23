import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  acquireBrunaLease,
  brunaLeaseRpcNames,
  releaseBrunaLease,
  renewBrunaLease,
  validateBrunaLease,
  type BrunaLease,
} from "../bruna/bruna-lease.server";

const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));

vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: { rpc },
}));

const lease: BrunaLease = {
  companyId: "11111111-1111-4111-8111-111111111111",
  leaseKey: "bruna:tenant-a:conversation-a",
  ownerId: "owner-a",
  fenceToken: 7,
  expiresAt: "2030-01-01T00:00:10.000Z",
};

beforeEach(() => rpc.mockReset());

describe("Bruna renewable lease wrapper", () => {
  it("fails closed when ownership is rejected", async () => {
    rpc.mockResolvedValue({
      data: [{ acquired: false, fence_token: null, expires_at: null }],
      error: null,
    });
    expect(
      await acquireBrunaLease({
        companyId: lease.companyId,
        leaseKey: lease.leaseKey,
        ownerId: "owner-b",
        ttlSeconds: 30,
      }),
    ).toEqual({
      ok: false,
      reason: "busy",
    });
    expect(rpc).toHaveBeenCalledWith(
      brunaLeaseRpcNames.acquire,
      expect.objectContaining({ _owner_id: "owner-b" }),
    );
  });

  it("does not validate an expired lease", async () => {
    rpc.mockResolvedValue({
      data: [{ valid: false, fence_token: null, expires_at: null }],
      error: null,
    });
    expect(await validateBrunaLease(lease)).toEqual({ ok: true, valid: false });
    expect(rpc).toHaveBeenCalledWith(
      brunaLeaseRpcNames.validate,
      expect.objectContaining({ _company_id: lease.companyId }),
    );
  });

  it("preserves a newer monotonic fence token across renewal", async () => {
    rpc.mockResolvedValue({
      data: [{ renewed: true, fence_token: 8, expires_at: "2030-01-01T00:01:00.000Z" }],
      error: null,
    });
    const result = await renewBrunaLease({ lease, ttlSeconds: 30 });
    expect(result).toEqual({
      ok: true,
      lease: { ...lease, fenceToken: 8, expiresAt: "2030-01-01T00:01:00.000Z" },
    });
    expect(rpc).toHaveBeenCalledWith(
      brunaLeaseRpcNames.renew,
      expect.objectContaining({ _fence_token: 7, _company_id: lease.companyId }),
    );
  });

  it("fails closed for RPC outages and stale releases", async () => {
    rpc.mockRejectedValueOnce(new Error("database unavailable"));
    expect(
      await acquireBrunaLease({
        companyId: lease.companyId,
        leaseKey: lease.leaseKey,
        ownerId: lease.ownerId,
        ttlSeconds: 30,
      }),
    ).toEqual({
      ok: false,
      reason: "unavailable",
    });

    rpc.mockResolvedValueOnce({ data: false, error: null });
    expect(await releaseBrunaLease({ ...lease, fenceToken: 6 })).toBe(false);
  });

  it("isolates the same lease key between companies", async () => {
    rpc.mockResolvedValue({
      data: [{ acquired: true, fence_token: 1, expires_at: "2030-01-01T00:01:00.000Z" }],
      error: null,
    });
    const companyB = "22222222-2222-4222-8222-222222222222";
    const result = await acquireBrunaLease({
      companyId: companyB,
      leaseKey: lease.leaseKey,
      ownerId: lease.ownerId,
      ttlSeconds: 30,
    });
    expect(result).toEqual({
      ok: true,
      lease: {
        companyId: companyB,
        leaseKey: lease.leaseKey,
        ownerId: lease.ownerId,
        fenceToken: 1,
        expiresAt: "2030-01-01T00:01:00.000Z",
      },
    });
    expect(rpc).toHaveBeenCalledWith(
      brunaLeaseRpcNames.acquire,
      expect.objectContaining({ _company_id: companyB, _lease_key: lease.leaseKey }),
    );
  });

  it("rejects invalid company ids without calling the RPC", async () => {
    expect(
      await acquireBrunaLease({
        companyId: "not-a-uuid",
        leaseKey: lease.leaseKey,
        ownerId: lease.ownerId,
        ttlSeconds: 30,
      }),
    ).toEqual({ ok: false, reason: "invalid" });
    expect(await validateBrunaLease({ ...lease, companyId: "not-a-uuid" })).toEqual({
      ok: false,
      reason: "invalid",
    });
    expect(rpc).not.toHaveBeenCalled();
  });
});

describe("Bruna lease migration contract", () => {
  const sql = readFileSync("supabase/migrations/20261022190000_bruna_lease_fencing_v1.sql", "utf8");

  it("is additive and leaves runtime RPCs outside the migration", () => {
    expect(sql).toContain("CREATE TABLE IF NOT EXISTS public.bruna_adapter_leases");
    expect(sql).toContain("PRIMARY KEY (company_id, lease_key)");
    expect(sql).toContain("company_id uuid NOT NULL");
    expect(sql).not.toContain("runtime_try_acquire_lock");
    expect(sql).not.toContain("runtime_release_lock");
  });

  it("requires exact owner and fence token for renew, validate, and release", () => {
    expect(sql).toMatch(
      /lease\.owner_id = _owner_id[\s\S]*lease\.fence_token = _fence_token/,
    );
    expect(sql).toContain("fence_token = lease.fence_token + 1");
    expect(sql).toContain("UPDATE public.bruna_adapter_leases AS lease");
    expect(sql).toContain("RETURNING true, lease.fence_token, lease.expires_at");
    expect(sql).toContain("SET search_path = pg_catalog, public");
    expect(sql).toContain("REVOKE ALL ON TABLE public.bruna_adapter_leases");
    expect(sql).toContain("GRANT EXECUTE ON FUNCTION public.bruna_lease_acquire_v1");
    expect(sql).toContain("GRANT EXECUTE ON FUNCTION public.bruna_lease_renew_v1");
    expect(sql).toContain("GRANT EXECUTE ON FUNCTION public.bruna_lease_validate_v1");
    expect(sql).toContain("GRANT EXECUTE ON FUNCTION public.bruna_lease_release_v1");
    expect(sql).toMatch(
      /REVOKE ALL ON FUNCTION public\.bruna_lease_release_v1[\s\S]*FROM PUBLIC, anon, authenticated/,
    );
    expect(sql).toMatch(
      /WHERE lease\.lease_key = _lease_key[\s\S]*AND lease\.company_id = _company_id/,
    );
    expect(sql).toMatch(
      /WHERE l\.lease_key = _lease_key[\s\S]*AND l\.company_id = _company_id/,
    );
  });
});
