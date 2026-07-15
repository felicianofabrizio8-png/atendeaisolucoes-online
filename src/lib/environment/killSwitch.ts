// Kill switch com duas camadas:
//   1) Env var `ENVIRONMENT_GUARD_FORCE_DISABLE` (emergência por deploy)
//   2) Tabela `runtime_config.environment_guard_enabled` (operacional, cache 15s)
//
// Se qualquer uma delas indicar desligado → guard é NO-OP (comportamento legado).
// Isso preserva a Solário sem qualquer alteração enquanto a flag global estiver false.
//
// Cache in-isolate: um único fetch em ≤15s.
// NUNCA lança: em caso de erro no lookup, retorna `enabled=false` (fail-open p/
// legado). O fail-SAFE de bloqueio ocorre no EnvironmentGuard após a leitura
// do ambiente do tenant, não aqui — o kill switch existe justamente para
// preservar produção sem risco.

const CACHE_TTL_MS = 15_000;

interface CacheEntry {
  enabled: boolean;
  cachedAt: number;
}

let cache: CacheEntry | null = null;

/** Testes: limpa o cache. Não usar em produção. */
export function __resetKillSwitchCacheForTests(): void {
  cache = null;
}

/** Testes: injeta um estado sintético. Não usar em produção. */
export function __setKillSwitchForTests(enabled: boolean): void {
  cache = { enabled, cachedAt: Date.now() };
}

type SupabaseAdminClient = {
  from: (table: string) => {
    select: (cols: string) => {
      eq: (
        col: string,
        val: string,
      ) => { maybeSingle: () => Promise<{ data: { value: unknown } | null; error: unknown }> };
    };
  };
};

async function readFromDb(): Promise<boolean> {
  try {
    // Import dinâmico: client.server só existe no bundle de servidor.
    const mod = await import("@/integrations/supabase/client.server");
    const admin = mod.supabaseAdmin as unknown as SupabaseAdminClient;
    const { data } = await admin
      .from("runtime_config")
      .select("value")
      .eq("key", "environment_guard_enabled")
      .maybeSingle();
    if (!data) return false;
    // JSONB pode voltar como boolean, string "true" ou objeto — normalizamos.
    const v = data.value;
    if (typeof v === "boolean") return v;
    if (typeof v === "string") return v.toLowerCase() === "true";
    return false;
  } catch {
    // Fail-open p/ preservar produção legada.
    return false;
  }
}

/**
 * Retorna se o EnvironmentGuard deve ser aplicado.
 * - false → guard vira NO-OP, tudo segue o fluxo atual (Solário).
 * - true  → guard verifica `companies.environment` e aplica fail-safe.
 */
export async function isGuardEnabled(): Promise<boolean> {
  // 1) Force-disable por env — precedência absoluta.
  const forceDisable = (globalThis as { process?: { env?: Record<string, string | undefined> } })
    .process?.env?.ENVIRONMENT_GUARD_FORCE_DISABLE;
  if (forceDisable && forceDisable.toLowerCase() === "true") return false;

  // 2) Cache in-isolate.
  const now = Date.now();
  if (cache && now - cache.cachedAt < CACHE_TTL_MS) return cache.enabled;

  const enabled = await readFromDb();
  cache = { enabled, cachedAt: now };
  return enabled;
}
