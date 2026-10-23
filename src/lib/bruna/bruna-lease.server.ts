import { supabaseAdmin } from "@/integrations/supabase/client.server";

const ACQUIRE = "bruna_lease_acquire_v1";
const RENEW = "bruna_lease_renew_v1";
const VALIDATE = "bruna_lease_validate_v1";
const RELEASE = "bruna_lease_release_v1";

type RpcResult = { data: unknown; error: unknown };
type RpcClient = { rpc: (name: string, args: Record<string, unknown>) => Promise<RpcResult> };

export type BrunaLease = {
  companyId: string;
  leaseKey: string;
  ownerId: string;
  fenceToken: number;
  expiresAt: string;
};

export type BrunaLeaseAttempt =
  | { ok: true; lease: BrunaLease }
  | { ok: false; reason: "busy" | "invalid" | "unavailable" };

export type BrunaLeaseCheck =
  | { ok: true; valid: true; expiresAt: string; fenceToken: number }
  | { ok: true; valid: false }
  | { ok: false; reason: "invalid" | "unavailable" };

function client(): RpcClient {
  return supabaseAdmin as unknown as RpcClient;
}

function validIdentity(leaseKey: string, ownerId: string): boolean {
  return leaseKey.trim().length > 0 && ownerId.trim().length > 0;
}

function validTtl(ttlSeconds: number): boolean {
  return Number.isFinite(ttlSeconds) && ttlSeconds > 0;
}

function validCompanyId(companyId: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(companyId.trim());
}

function firstRow(data: unknown): Record<string, unknown> | null {
  const row = Array.isArray(data) ? data[0] : data;
  return row && typeof row === "object" ? (row as Record<string, unknown>) : null;
}

function positiveFence(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : null;
}

export async function acquireBrunaLease(params: {
  leaseKey: string;
  ownerId: string;
  ttlSeconds: number;
  companyId: string;
}): Promise<BrunaLeaseAttempt> {
  if (
    !validCompanyId(params.companyId) ||
    !validIdentity(params.leaseKey, params.ownerId) ||
    !validTtl(params.ttlSeconds)
  ) {
    return { ok: false, reason: "invalid" };
  }
  try {
    const result = await client().rpc(ACQUIRE, {
      _lease_key: params.leaseKey,
      _owner_id: params.ownerId,
      _ttl_seconds: Math.ceil(params.ttlSeconds),
      _company_id: params.companyId,
    });
    if (result.error) return { ok: false, reason: "unavailable" };
    const row = firstRow(result.data);
    if (row?.acquired !== true) return { ok: false, reason: "busy" };
    const fenceToken = positiveFence(row.fence_token);
    if (fenceToken === null || typeof row.expires_at !== "string")
      return { ok: false, reason: "unavailable" };
    return {
      ok: true,
      lease: {
        leaseKey: params.leaseKey,
        ownerId: params.ownerId,
        companyId: params.companyId,
        fenceToken,
        expiresAt: row.expires_at,
      },
    };
  } catch {
    return { ok: false, reason: "unavailable" };
  }
}

export async function renewBrunaLease(params: {
  lease: BrunaLease;
  ttlSeconds: number;
}): Promise<BrunaLeaseAttempt> {
  if (
    !validCompanyId(params.lease.companyId) ||
    !validIdentity(params.lease.leaseKey, params.lease.ownerId) ||
    !validTtl(params.ttlSeconds)
  ) {
    return { ok: false, reason: "invalid" };
  }
  try {
    const result = await client().rpc(RENEW, {
      _lease_key: params.lease.leaseKey,
      _owner_id: params.lease.ownerId,
      _fence_token: params.lease.fenceToken,
      _ttl_seconds: Math.ceil(params.ttlSeconds),
      _company_id: params.lease.companyId,
    });
    if (result.error) return { ok: false, reason: "unavailable" };
    const row = firstRow(result.data);
    const fenceToken = positiveFence(row?.fence_token);
    if (row?.renewed !== true || fenceToken === null || typeof row.expires_at !== "string") {
      return { ok: false, reason: "busy" };
    }
    return { ok: true, lease: { ...params.lease, fenceToken, expiresAt: row.expires_at } };
  } catch {
    return { ok: false, reason: "unavailable" };
  }
}

export async function validateBrunaLease(lease: BrunaLease): Promise<BrunaLeaseCheck> {
  if (
    !validCompanyId(lease.companyId) ||
    !validIdentity(lease.leaseKey, lease.ownerId) ||
    positiveFence(lease.fenceToken) === null
  ) {
    return { ok: false, reason: "invalid" };
  }
  try {
    const result = await client().rpc(VALIDATE, {
      _lease_key: lease.leaseKey,
      _owner_id: lease.ownerId,
      _fence_token: lease.fenceToken,
      _company_id: lease.companyId,
    });
    if (result.error) return { ok: false, reason: "unavailable" };
    const row = firstRow(result.data);
    if (row?.valid !== true) return { ok: true, valid: false };
    const fenceToken = positiveFence(row.fence_token);
    return typeof row.expires_at === "string" && fenceToken === lease.fenceToken
      ? { ok: true, valid: true, expiresAt: row.expires_at, fenceToken }
      : { ok: false, reason: "unavailable" };
  } catch {
    return { ok: false, reason: "unavailable" };
  }
}

export async function releaseBrunaLease(lease: BrunaLease): Promise<boolean> {
  if (
    !validCompanyId(lease.companyId) ||
    !validIdentity(lease.leaseKey, lease.ownerId) ||
    positiveFence(lease.fenceToken) === null
  )
    return false;
  try {
    const result = await client().rpc(RELEASE, {
      _lease_key: lease.leaseKey,
      _owner_id: lease.ownerId,
      _fence_token: lease.fenceToken,
      _company_id: lease.companyId,
    });
    return result.error ? false : result.data === true;
  } catch {
    return false;
  }
}

export const brunaLeaseRpcNames = {
  acquire: ACQUIRE,
  renew: RENEW,
  validate: VALIDATE,
  release: RELEASE,
} as const;
