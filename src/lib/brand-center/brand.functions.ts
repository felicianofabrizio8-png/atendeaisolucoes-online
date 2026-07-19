/**
 * Server functions PÚBLICAS do Brand Center (contrato de consumo).
 *
 * - `getBrandContext`: contrato estável consumido por outros módulos.
 * - `getBrandAssetAccess`: acesso temporário (signed URL) a um asset ativo.
 *   TTL sob controle do servidor; nunca persistimos a URL.
 *
 * Nenhuma dessas funções está integrada a Marketing IA, Render Engine ou
 * qualquer consumidor nesta fase — apenas expõe a superfície segura.
 */

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { resolveBrandContext } from "./brand-resolver";
import { BrandRepository, loadBrandResolverInput } from "./brand.repository";
import type { BrandAssetType, BrandContext } from "./brand.types";

type AuthCtx = { supabase: SupabaseClient<Database>; userId: string };

/** TTL permitido para signed URLs de asset (60s .. 1h). */
export const BRAND_ASSET_ACCESS_MIN_TTL = 60;
export const BRAND_ASSET_ACCESS_MAX_TTL = 60 * 60;
export const BRAND_ASSET_ACCESS_DEFAULT_TTL = 300;

async function currentCompanyId(ctx: AuthCtx): Promise<string | null> {
  const { data, error } = await ctx.supabase
    .from("profiles")
    .select("company_id")
    .eq("id", ctx.userId)
    .maybeSingle();
  if (error) throw new Error(`brand_public_profile:${error.message}`);
  return data?.company_id ?? null;
}

// ---------------------------------------------------------------------------
// getBrandContext
// ---------------------------------------------------------------------------

export const getBrandContext = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<BrandContext> => {
    const auth = context as AuthCtx;
    const companyId = await currentCompanyId(auth);
    if (!companyId) {
      return resolveBrandContext({
        companyId: "",
        profile: null,
        version: null,
        assets: [],
      });
    }
    const input = await loadBrandResolverInput(auth.supabase, companyId);
    return resolveBrandContext(input);
  });

// ---------------------------------------------------------------------------
// getBrandAssetAccess
// ---------------------------------------------------------------------------

const GetBrandAssetAccessSchema = z
  .object({
    assetId: z.string().uuid(),
    ttlSeconds: z
      .number()
      .int()
      .min(BRAND_ASSET_ACCESS_MIN_TTL)
      .max(BRAND_ASSET_ACCESS_MAX_TTL)
      .optional(),
  })
  .strict();

export interface BrandAssetAccess {
  assetId: string;
  assetType: BrandAssetType;
  mimeType: string;
  width: number | null;
  height: number | null;
  expiresAt: string;
  signedUrl: string;
}

export const getBrandAssetAccess = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => GetBrandAssetAccessSchema.parse(data))
  .handler(async ({ data, context }): Promise<BrandAssetAccess> => {
    const auth = context as AuthCtx;
    const companyId = await currentCompanyId(auth);
    if (!companyId) throw new Error("brand_asset_access_no_company");

    const asset = await BrandRepository.getAssetById(
      auth.supabase,
      data.assetId,
      companyId,
    );
    if (!asset) throw new Error("brand_asset_access_not_found");
    if (!asset.isActive) throw new Error("brand_asset_access_inactive");

    // Defesa em profundidade: mesmo com RLS + repo filtrando por company,
    // rechecamos o storage_path pertence ao tenant atual.
    if (!asset.storagePath.startsWith(`${companyId}/`)) {
      throw new Error("brand_asset_access_cross_tenant");
    }

    const ttl = data.ttlSeconds ?? BRAND_ASSET_ACCESS_DEFAULT_TTL;

    const { data: signed, error } = await auth.supabase.storage
      .from(asset.storageBucket)
      .createSignedUrl(asset.storagePath, ttl);
    if (error || !signed?.signedUrl) {
      // Nunca inclui a URL nos erros.
      throw new Error(`brand_asset_access_sign_failed:${error?.message ?? "unknown"}`);
    }

    const expiresAt = new Date(Date.now() + ttl * 1000).toISOString();
    return {
      assetId: asset.id,
      assetType: asset.assetType,
      mimeType: asset.mimeType,
      width: asset.width,
      height: asset.height,
      expiresAt,
      signedUrl: signed.signedUrl,
    };
  });
