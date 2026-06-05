// Helpers centrais para storage por empresa.
// - getSignedImageUrl(): resolve um caminho (ou URL pública legada) para uma
//   signed URL temporária. Mantém cache em memória para evitar requisições
//   repetidas no mesmo render. Funciona enquanto o bucket está público (apenas
//   devolve a URL pública) E continuará funcionando quando flipar para privado.
// - getStorageUsage(): consulta o uso atual da empresa (bytes/MB/percentual).
//
// IMPORTANTE: não altera nada do inbox, WhatsApp, webhooks ou Meta OAuth.

import { supabase } from "@/integrations/supabase/client";

const BUCKET = "product-images";
const SIGNED_URL_TTL_SECONDS = 60 * 10; // 10 min — equilíbrio entre cache e segurança
const SIGNED_URL_REFRESH_BEFORE_MS = 60 * 1000; // renova 1 min antes de expirar

interface CachedUrl {
  url: string;
  expiresAt: number;
}

const cache = new Map<string, CachedUrl>();

/**
 * Extrai o path dentro do bucket a partir de um valor armazenado no banco.
 * Aceita tanto path puro ("companyId/foo.jpg") quanto URL pública legada
 * ("https://.../object/public/product-images/companyId/foo.jpg").
 */
export function extractStoragePath(stored: string): string | null {
  if (!stored) return null;
  // Já é path
  if (!stored.startsWith("http")) return stored.replace(/^\/+/, "");
  const marker = `/object/public/${BUCKET}/`;
  const idx = stored.indexOf(marker);
  if (idx >= 0) return stored.slice(idx + marker.length);
  // URL signed antiga: /object/sign/<bucket>/<path>?token=...
  const signMarker = `/object/sign/${BUCKET}/`;
  const sIdx = stored.indexOf(signMarker);
  if (sIdx >= 0) {
    const rest = stored.slice(sIdx + signMarker.length);
    const q = rest.indexOf("?");
    return q >= 0 ? rest.slice(0, q) : rest;
  }
  return null;
}

/**
 * Devolve uma URL utilizável para exibir a imagem.
 * - Se o bucket for público, devolve a URL pública (rápido, sem rede).
 * - Quando o bucket virar privado, troca para signed URL com cache de 10 min.
 *
 * Aceita path puro ou URL legada. Em caso de erro, devolve o valor original
 * para não quebrar a UI.
 */
export async function getSignedImageUrl(stored: string): Promise<string> {
  if (!stored) return stored;
  const path = extractStoragePath(stored);
  if (!path) return stored;

  const now = Date.now();
  const hit = cache.get(path);
  if (hit && hit.expiresAt - SIGNED_URL_REFRESH_BEFORE_MS > now) return hit.url;

  try {
    const { data, error } = await supabase.storage
      .from(BUCKET)
      .createSignedUrl(path, SIGNED_URL_TTL_SECONDS);
    if (error || !data?.signedUrl) {
      // Fallback: tenta URL pública (funciona enquanto o bucket estiver público)
      const pub = supabase.storage.from(BUCKET).getPublicUrl(path);
      return pub.data.publicUrl;
    }
    cache.set(path, {
      url: data.signedUrl,
      expiresAt: now + SIGNED_URL_TTL_SECONDS * 1000,
    });
    return data.signedUrl;
  } catch (e) {
    console.error("[getSignedImageUrl] falhou, devolvendo valor original", e);
    return stored;
  }
}

// ============================================================================
// Mídias recebidas via WhatsApp (bucket privado whatsapp-media)
// ============================================================================

const WA_MEDIA_BUCKET = "whatsapp-media";
const waMediaCache = new Map<string, CachedUrl>();

/**
 * Gera signed URL para um arquivo no bucket privado `whatsapp-media`.
 * O path deve começar pelo company_id (a policy do bucket filtra por isso).
 * TTL curto + cache em memória.
 */
export async function getSignedWaMediaUrl(path: string): Promise<string | null> {
  if (!path) return null;
  const clean = path.replace(/^\/+/, "");
  const now = Date.now();
  const hit = waMediaCache.get(clean);
  if (hit && hit.expiresAt - SIGNED_URL_REFRESH_BEFORE_MS > now) return hit.url;
  try {
    const { data, error } = await supabase.storage
      .from(WA_MEDIA_BUCKET)
      .createSignedUrl(clean, SIGNED_URL_TTL_SECONDS);
    if (error || !data?.signedUrl) return null;
    waMediaCache.set(clean, {
      url: data.signedUrl,
      expiresAt: now + SIGNED_URL_TTL_SECONDS * 1000,
    });
    return data.signedUrl;
  } catch (e) {
    console.error("[getSignedWaMediaUrl] falhou", e);
    return null;
  }
}

/**
 * Versão síncrona: devolve a URL pública direta. Use para uploads onde
 * o bucket ainda é público; para migração futura para privado, use a versão
 * assíncrona acima.
 */
export function getPublicImageUrl(path: string): string {
  const cleanPath = extractStoragePath(path) ?? path;
  return supabase.storage.from(BUCKET).getPublicUrl(cleanPath).data.publicUrl;
}

/**
 * Limpa cache de signed URLs. Útil ao deletar/atualizar uma imagem.
 */
export function clearSignedUrlCache(stored?: string) {
  if (!stored) {
    cache.clear();
    return;
  }
  const path = extractStoragePath(stored);
  if (path) cache.delete(path);
}

// ============================================================================
// Quota de armazenamento por empresa
// ============================================================================

export interface StorageUsage {
  usedBytes: number;
  usedMb: number;
  quotaMb: number;
  percent: number;
  remainingMb: number;
}

/**
 * Consulta uso atual + quota da empresa. Usa RPC seguro (security definer).
 */
export async function getStorageUsage(companyId: string): Promise<StorageUsage> {
  // Uso atual via função SECURITY DEFINER
  const usageRes = await supabase.rpc("get_storage_usage_bytes", {
    _company_id: companyId,
  });
  const usedBytes = Number(usageRes.data ?? 0);

  // Quota da empresa
  const { data: company } = await supabase
    .from("companies")
    .select("storage_quota_mb")
    .eq("id", companyId)
    .maybeSingle();
  const quotaMb = (company as { storage_quota_mb?: number } | null)?.storage_quota_mb ?? 500;
  const quotaBytes = quotaMb * 1024 * 1024;
  const usedMb = usedBytes / (1024 * 1024);

  return {
    usedBytes,
    usedMb,
    quotaMb,
    percent: quotaBytes > 0 ? Math.min(100, (usedBytes / quotaBytes) * 100) : 0,
    remainingMb: Math.max(0, quotaMb - usedMb),
  };
}

export function getStoragePercent(usage: StorageUsage): number {
  return usage.percent;
}
