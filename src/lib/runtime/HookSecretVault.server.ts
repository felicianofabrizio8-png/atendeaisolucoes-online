// ============================================================================
// HookSecretVault — leitura de segredos do Supabase Vault com cache em memória.
// Usado exclusivamente pelos hooks internos server-to-server.
// ============================================================================

import { supabaseAdmin } from "@/integrations/supabase/client.server";

type CacheEntry = { value: string; expiresAt: number };
const cache = new Map<string, CacheEntry>();
const TTL_MS = 60_000; // 60s: minimiza latência sem prender rotação por muito tempo.

export async function getHookSecret(name: string): Promise<string | null> {
  const now = Date.now();
  const cached = cache.get(name);
  if (cached && cached.expiresAt > now) return cached.value;

  const { data, error } = await supabaseAdmin.rpc("get_hook_secret", { _name: name });
  if (error || !data || typeof data !== "string" || data.length === 0) {
    return null;
  }
  cache.set(name, { value: data, expiresAt: now + TTL_MS });
  return data;
}
