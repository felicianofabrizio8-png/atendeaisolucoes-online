/**
 * Server functions do editor administrativo do Brand Center.
 *
 * Regras invioláveis:
 *  - Autenticação obrigatória via `requireSupabaseAuth`.
 *  - `company_id` derivado do profile do usuário — nunca vem do cliente.
 *  - Papel `admin` verificado antes de qualquer escrita.
 *  - Payloads validados com Zod (`.strict()`).
 *  - `signBrandAssetUpload` gera URL temporária — jamais persistida ou logada.
 *  - `publishBrandVersion` delega à RPC `publish_brand_version` (transacional).
 *  - `registerBrandAsset` REVALIDA no servidor: existência, tamanho e MIME
 *    são lidos do próprio Storage (via RPC SECURITY DEFINER). Metadados
 *    enviados pelo cliente são apenas expectativa para comparação.
 *  - `sha256` é obrigatório e comparado contra deduplicação por
 *    `(company_id, asset_type, sha256)` — duplicatas são idempotentes.
 */

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  ALLOWED_LOGO_MIMES,
  MAX_LOGO_BYTES,
  MIME_TO_EXT,
} from "./brand-editor.types";
import type {
  BrandEditorProfile,
  BrandEditorState,
  BrandEditorVersion,
  SignBrandAssetUploadResult,
} from "./brand-editor.types";
import type { BrandAssetRef } from "./brand.types";
import {
  DEFAULT_COLORS,
  DEFAULT_TOKENS,
  DEFAULT_TYPOGRAPHY,
} from "./brand-defaults";
import {
  BrandDraftPayloadSchema,
  DeactivateBrandAssetSchema,
  PublishBrandVersionSchema,
  RegisterBrandAssetSchema,
  SignBrandAssetUploadSchema,
  assertStoragePathOwnership,
} from "./brand-editor-schema";
import {
  BrandRepository,
  toBrandAssetRef,
  type BrandVersionDTO,
} from "./brand.repository";
import { CURRENT_BRAND_SCHEMA_VERSION } from "./brand-schema-migration";

const BRAND_BUCKET = "brand-assets" as const;
const DEFAULT_PROFILE_NAME = "Identidade principal";
/** Tolerância entre o tamanho declarado pelo cliente e o real no Storage. */
const SIZE_TOLERANCE_BYTES = 1024;

type AuthCtx = { supabase: SupabaseClient<Database>; userId: string };

// ---------------------------------------------------------------------------
// Autorização
// ---------------------------------------------------------------------------

async function resolveCompanyAndRole(ctx: AuthCtx): Promise<{
  companyId: string;
  isAdmin: boolean;
}> {
  const { data: profileRow, error: pErr } = await ctx.supabase
    .from("profiles")
    .select("company_id")
    .eq("id", ctx.userId)
    .maybeSingle();
  if (pErr) throw new Error(`brand_editor_profile_error:${pErr.message}`);
  const companyId = profileRow?.company_id;
  if (!companyId) throw new Error("brand_editor_no_company");

  const { data: isAdmin, error: rErr } = await ctx.supabase.rpc("has_role", {
    _user_id: ctx.userId,
    _company_id: companyId,
    _role: "admin",
  });
  if (rErr) throw new Error(`brand_editor_role_error:${rErr.message}`);
  return { companyId, isAdmin: Boolean(isAdmin) };
}

function requireAdmin(isAdmin: boolean): void {
  if (!isAdmin) throw new Error("brand_editor_forbidden");
}

async function ensureBrandProfile(
  ctx: AuthCtx,
  companyId: string,
): Promise<BrandEditorProfile> {
  const existing = await BrandRepository.getProfileForCompany(
    ctx.supabase,
    companyId,
  );
  if (existing) {
    return {
      id: existing.id,
      name: existing.name,
      description: existing.description,
      visualStyle: existing.visualStyle,
      activeVersionId: existing.activeVersionId,
    };
  }
  const created = await BrandRepository.createDefaultProfile(ctx.supabase, {
    companyId,
    name: DEFAULT_PROFILE_NAME,
    userId: ctx.userId,
  });
  return {
    id: created.id,
    name: created.name,
    description: created.description,
    visualStyle: created.visualStyle,
    activeVersionId: created.activeVersionId,
  };
}

function toEditorVersion(v: BrandVersionDTO): BrandEditorVersion {
  return {
    id: v.id,
    status: v.status,
    versionNumber: v.versionNumber,
    colors: { ...DEFAULT_COLORS, ...((v.colors as object) ?? {}) },
    typography: {
      ...DEFAULT_TYPOGRAPHY,
      ...((v.typography as object) ?? {}),
    },
    tokens: { ...DEFAULT_TOKENS, ...((v.tokens as object) ?? {}) },
    publishedAt: v.publishedAt,
    updatedAt: v.updatedAt,
  };
}

// ---------------------------------------------------------------------------
// getBrandEditorState
// ---------------------------------------------------------------------------

export const getBrandEditorState = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<BrandEditorState> => {
    const auth = context as AuthCtx;
    const { companyId, isAdmin } = await resolveCompanyAndRole(auth);

    const profileDto = await BrandRepository.getProfileForCompany(
      auth.supabase,
      companyId,
    );

    const profile: BrandEditorProfile | null = profileDto
      ? {
          id: profileDto.id,
          name: profileDto.name,
          description: profileDto.description,
          visualStyle: profileDto.visualStyle,
          activeVersionId: profileDto.activeVersionId,
        }
      : null;

    let draft: BrandEditorVersion | null = null;
    let published: BrandEditorVersion | null = null;
    let assets: BrandAssetRef[] = [];

    if (profile) {
      const [d, p, list] = await Promise.all([
        BrandRepository.getDraftForProfile(auth.supabase, profile.id, companyId),
        BrandRepository.getLatestPublishedForProfile(
          auth.supabase,
          profile.id,
          companyId,
        ),
        BrandRepository.listActiveAssets(auth.supabase, profile.id, companyId),
      ]);
      if (d) draft = toEditorVersion(d);
      if (p) published = toEditorVersion(p);
      assets = list.map(toBrandAssetRef);
    }

    return { companyId, isAdmin, profile, draft, published, assets };
  });

// ---------------------------------------------------------------------------
// saveBrandDraft
// ---------------------------------------------------------------------------

export const saveBrandDraft = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => BrandDraftPayloadSchema.parse(data))
  .handler(async ({ data, context }): Promise<{ versionId: string }> => {
    const auth = context as AuthCtx;
    const { companyId, isAdmin } = await resolveCompanyAndRole(auth);
    requireAdmin(isAdmin);

    const profile = await ensureBrandProfile(auth, companyId);

    await BrandRepository.updateProfileMetadata(
      auth.supabase,
      profile.id,
      companyId,
      {
        name: data.name,
        description: data.description,
        visualStyle: data.visualStyle,
      },
    );

    return BrandRepository.upsertDraft(auth.supabase, {
      profileId: profile.id,
      companyId,
      userId: auth.userId,
      colors: data.colors,
      typography: data.typography,
      tokens: data.tokens,
      schemaVersion: CURRENT_BRAND_SCHEMA_VERSION,
    });
  });

// ---------------------------------------------------------------------------
// publishBrandVersion
// ---------------------------------------------------------------------------

export const publishBrandVersion = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => PublishBrandVersionSchema.parse(data))
  .handler(
    async (
      { data, context },
    ): Promise<{ versionId: string; publishedAt: string }> => {
      const auth = context as AuthCtx;
      const { isAdmin } = await resolveCompanyAndRole(auth);
      requireAdmin(isAdmin);
      return BrandRepository.publishDraft(auth.supabase, data.versionId);
    },
  );

// ---------------------------------------------------------------------------
// signBrandAssetUpload
// ---------------------------------------------------------------------------

export const signBrandAssetUpload = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => SignBrandAssetUploadSchema.parse(data))
  .handler(
    async ({ data, context }): Promise<SignBrandAssetUploadResult> => {
      const auth = context as AuthCtx;
      const { companyId, isAdmin } = await resolveCompanyAndRole(auth);
      requireAdmin(isAdmin);
      if (data.sizeBytes > MAX_LOGO_BYTES) throw new Error("brand_asset_too_large");
      if (!ALLOWED_LOGO_MIMES.includes(data.mimeType)) {
        throw new Error("brand_asset_mime_forbidden");
      }

      const ext = MIME_TO_EXT[data.mimeType];
      const uuid = crypto.randomUUID();
      const storagePath = `${companyId}/brand/${data.assetType}/${uuid}.${ext}`;

      const { data: signed, error } = await auth.supabase.storage
        .from(BRAND_BUCKET)
        .createSignedUploadUrl(storagePath);
      if (error || !signed) {
        throw new Error(
          `brand_asset_sign_failed:${error?.message ?? "unknown"}`,
        );
      }
      return { storagePath, token: signed.token, bucket: BRAND_BUCKET };
    },
  );

// ---------------------------------------------------------------------------
// registerBrandAsset — revalidação server-side + dedup por sha256
// ---------------------------------------------------------------------------

export const registerBrandAsset = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => RegisterBrandAssetSchema.parse(data))
  .handler(async ({ data, context }): Promise<{ assetId: string; deduped: boolean }> => {
    const auth = context as AuthCtx;
    const { companyId, isAdmin } = await resolveCompanyAndRole(auth);
    requireAdmin(isAdmin);

    // 1) Ownership do path por prefixo (defensivo — RLS já protege).
    const ownership = assertStoragePathOwnership(
      data.storagePath,
      companyId,
      data.assetType,
    );
    if (!ownership.ok) throw new Error(`brand_asset_path_forbidden:${ownership.reason}`);

    // 2) REVALIDAÇÃO SERVER-SIDE: consulta metadados reais no Storage.
    //    Dados enviados pelo cliente são apenas expectativa — o servidor
    //    aceita como fonte de verdade somente o que o Storage reporta.
    const meta = await BrandRepository.getStorageObjectMetadata(
      auth.supabase,
      BRAND_BUCKET,
      data.storagePath,
    );
    if (!meta.exists) throw new Error("brand_asset_object_missing");
    if (meta.sizeBytes == null) throw new Error("brand_asset_size_unavailable");
    if (meta.sizeBytes > MAX_LOGO_BYTES) throw new Error("brand_asset_too_large");
    if (Math.abs(meta.sizeBytes - data.sizeBytes) > SIZE_TOLERANCE_BYTES) {
      throw new Error("brand_asset_size_mismatch");
    }
    // MIME reportado pelo Storage deve estar na allowlist e coincidir com o
    // declarado — Supabase Storage grava exatamente o Content-Type do upload.
    if (
      meta.mimetype &&
      meta.mimetype.toLowerCase() !== data.mimeType.toLowerCase()
    ) {
      throw new Error("brand_asset_mime_mismatch");
    }
    if (
      meta.mimetype &&
      !ALLOWED_LOGO_MIMES.includes(
        meta.mimetype as (typeof ALLOWED_LOGO_MIMES)[number],
      )
    ) {
      throw new Error("brand_asset_mime_forbidden");
    }

    const profile = await ensureBrandProfile(auth, companyId);

    // 3) Deduplicação por (company_id, asset_type, sha256).
    //    Se já existir, apenas reativa e retorna — idempotente.
    const duplicate = await BrandRepository.findAssetByHash(auth.supabase, {
      companyId,
      assetType: data.assetType,
      sha256: data.sha256,
    });
    if (duplicate) {
      await BrandRepository.deactivateAssetsOfType(auth.supabase, {
        profileId: profile.id,
        companyId,
        assetType: data.assetType,
        exceptId: duplicate.id,
      });
      if (!duplicate.isActive) {
        // Reativa o histórico existente sem gerar linha nova.
        const { error } = await auth.supabase
          .from("brand_assets")
          .update({ is_active: true })
          .eq("id", duplicate.id)
          .eq("company_id", companyId);
        if (error) throw new Error(`brand_asset_reactivate:${error.message}`);
      }
      return { assetId: duplicate.id, deduped: true };
    }

    // 4) Desativa quaisquer assets ativos anteriores do mesmo tipo.
    await BrandRepository.deactivateAssetsOfType(auth.supabase, {
      profileId: profile.id,
      companyId,
      assetType: data.assetType,
    });

    try {
      const inserted = await BrandRepository.insertAsset(auth.supabase, {
        profileId: profile.id,
        companyId,
        userId: auth.userId,
        assetType: data.assetType,
        storageBucket: BRAND_BUCKET,
        storagePath: data.storagePath,
        mimeType: data.mimeType,
        fileSizeBytes: meta.sizeBytes, // ← real, não declarado
        width: data.width,
        height: data.height,
        sha256: data.sha256,
        originalFilename: data.originalFilename,
      });
      return { assetId: inserted.assetId, deduped: false };
    } catch (e) {
      // Corrida com outra requisição inserindo o mesmo hash: retorna existente.
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes("23505") || msg.includes("duplicate")) {
        const again = await BrandRepository.findAssetByHash(auth.supabase, {
          companyId,
          assetType: data.assetType,
          sha256: data.sha256,
        });
        if (again) return { assetId: again.id, deduped: true };
      }
      throw e;
    }
  });

// ---------------------------------------------------------------------------
// deactivateBrandAsset
// ---------------------------------------------------------------------------

export const deactivateBrandAsset = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => DeactivateBrandAssetSchema.parse(data))
  .handler(async ({ data, context }): Promise<{ ok: true }> => {
    const auth = context as AuthCtx;
    const { companyId, isAdmin } = await resolveCompanyAndRole(auth);
    requireAdmin(isAdmin);
    await BrandRepository.deactivateAssetById(
      auth.supabase,
      data.assetId,
      companyId,
    );
    return { ok: true };
  });

// Uso interno apenas para testes. Mantém superfície pública limpa.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
type __RuntimeCheck = z.ZodTypeAny;
