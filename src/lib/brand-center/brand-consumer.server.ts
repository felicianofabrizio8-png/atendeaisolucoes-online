/**
 * Brand Center — Facade de consumo para módulos internos (Marketing IA,
 * futuros PDFs, landing pages, etc).
 *
 * REGRA: outros módulos do sistema NÃO importam `brand.repository.ts`,
 * `brand-editor.functions.ts` nem acessam tabelas/bucket `brand_*`
 * diretamente. Este arquivo é a única superfície server-side permitida
 * para consumo, e espelha o contrato público das server functions
 * `getBrandContext` / `getBrandAssetAccess`.
 *
 * Nenhuma signed URL é persistida — quem chama recebe o objeto de acesso
 * temporário e deve descartá-lo ao final do request.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { resolveBrandContext } from "./brand-resolver";
import { BrandRepository, loadBrandResolverInput } from "./brand.repository";
import type { BrandAssetRef, BrandAssetType, BrandContext } from "./brand.types";

/** TTLs alinhados com `getBrandAssetAccess` (server function pública). */
export const BRAND_ASSET_MIN_TTL_SECONDS = 60;
export const BRAND_ASSET_MAX_TTL_SECONDS = 60 * 60;
export const BRAND_ASSET_DEFAULT_TTL_SECONDS = 300;

export interface BrandAssetAccess {
  assetId: string;
  assetType: BrandAssetType;
  mimeType: string;
  width: number | null;
  height: number | null;
  /** ISO-8601 do instante em que a signed URL expira. */
  expiresAt: string;
  /** URL temporária. NUNCA persistir em banco, logs ou memória de longo prazo. */
  signedUrl: string;
}

type SB = SupabaseClient<Database>;

/**
 * Carrega o BrandContext publicado da empresa (ou fallback com defaults).
 * Nunca lança — se o companyId for inválido/inexistente, retorna fallback.
 */
export async function loadBrandContextForCompany(
  supabase: SB,
  companyId: string,
): Promise<BrandContext> {
  if (!companyId) {
    return resolveBrandContext({
      companyId: "",
      profile: null,
      version: null,
      assets: [],
    });
  }
  const input = await loadBrandResolverInput(supabase, companyId);
  return resolveBrandContext(input);
}

/**
 * Gera acesso temporário a um asset ativo da marca.
 *
 * Defesa em profundidade: além do RLS e do filtro por companyId no
 * repositório, verificamos que o storage_path pertence à empresa atual.
 * Erros são propagados sanitizados — nunca incluem a URL assinada.
 */
export async function signBrandAssetAccess(
  supabase: SB,
  params: {
    companyId: string;
    assetId: string;
    ttlSeconds?: number;
  },
): Promise<BrandAssetAccess> {
  const ttl = clampTtl(params.ttlSeconds);
  const asset = await BrandRepository.getAssetById(
    supabase,
    params.assetId,
    params.companyId,
  );
  if (!asset) throw new Error("brand_asset_access_not_found");
  if (!asset.isActive) throw new Error("brand_asset_access_inactive");
  if (!asset.storagePath.startsWith(`${params.companyId}/`)) {
    throw new Error("brand_asset_access_cross_tenant");
  }

  const { data: signed, error } = await supabase.storage
    .from(asset.storageBucket)
    .createSignedUrl(asset.storagePath, ttl);
  if (error || !signed?.signedUrl) {
    throw new Error(
      `brand_asset_access_sign_failed:${error?.message ?? "unknown"}`,
    );
  }
  return {
    assetId: asset.id,
    assetType: asset.assetType,
    mimeType: asset.mimeType,
    width: asset.width,
    height: asset.height,
    expiresAt: new Date(Date.now() + ttl * 1000).toISOString(),
    signedUrl: signed.signedUrl,
  };
}

/** Atalho: assina o `logo_primary` se existir. */
export async function signPrimaryLogoAccess(
  supabase: SB,
  ctx: BrandContext,
  ttlSeconds?: number,
): Promise<BrandAssetAccess | null> {
  const logo: BrandAssetRef | null = ctx.assets.byType.logo_primary;
  if (!logo) return null;
  return signBrandAssetAccess(supabase, {
    companyId: ctx.companyId,
    assetId: logo.id,
    ttlSeconds,
  });
}

function clampTtl(ttl: number | undefined): number {
  const v = typeof ttl === "number" ? ttl : BRAND_ASSET_DEFAULT_TTL_SECONDS;
  if (v < BRAND_ASSET_MIN_TTL_SECONDS) return BRAND_ASSET_MIN_TTL_SECONDS;
  if (v > BRAND_ASSET_MAX_TTL_SECONDS) return BRAND_ASSET_MAX_TTL_SECONDS;
  return Math.trunc(v);
}
