// Repositório de ambiente: lê `companies.environment` com cache in-isolate.
// SEMPRE via supabaseAdmin (bypassa RLS) para performance e consistência.
// A leitura é somente-leitura; alterações em `environment` são bloqueadas
// no banco pelo trigger `prevent_environment_flip`.

import type { EnvironmentLookup, EnvironmentName } from "./types";

const CACHE_TTL_MS = 30_000;

interface CacheEntry {
  environment: EnvironmentName;
  cachedAt: number;
}

const cache = new Map<string, CacheEntry>();

/** Testes: limpa o cache. */
export function __resetEnvRepositoryCacheForTests(): void {
  cache.clear();
}

/** Testes: injeta um estado sintético. */
export function __setEnvironmentForTests(companyId: string, env: EnvironmentName): void {
  cache.set(companyId, { environment: env, cachedAt: Date.now() });
}

type SupabaseAdminClient = {
  from: (table: string) => {
    select: (cols: string) => {
      eq: (
        col: string,
        val: string,
      ) => { maybeSingle: () => Promise<{ data: { environment: string } | null; error: unknown }> };
    };
  };
};

/**
 * Descobre o ambiente de uma empresa. Cache 30s.
 * Retorna `ok:false` em caso de company inexistente ou erro de rede.
 * O EnvironmentGuard trata `ok:false` como "bloquear e simular" (fail-safe).
 */
export async function getEnvironment(companyId: string): Promise<EnvironmentLookup> {
  const now = Date.now();
  const hit = cache.get(companyId);
  if (hit && now - hit.cachedAt < CACHE_TTL_MS) {
    return { ok: true, environment: hit.environment, cachedAt: hit.cachedAt };
  }

  try {
    const mod = await import("@/integrations/supabase/client.server");
    const admin = mod.supabaseAdmin as unknown as SupabaseAdminClient;
    const { data, error } = await admin
      .from("companies")
      .select("environment")
      .eq("id", companyId)
      .maybeSingle();
    if (error) {
      return { ok: false, reason: "lookup_error", error: String(error) };
    }
    if (!data) {
      return { ok: false, reason: "not_found" };
    }
    const raw = String(data.environment ?? "").toLowerCase();
    const environment: EnvironmentName = raw === "staging" ? "staging" : "production";
    cache.set(companyId, { environment, cachedAt: now });
    return { ok: true, environment, cachedAt: now };
  } catch (e) {
    return {
      ok: false,
      reason: "lookup_error",
      error: e instanceof Error ? e.message : String(e),
    };
  }
}
