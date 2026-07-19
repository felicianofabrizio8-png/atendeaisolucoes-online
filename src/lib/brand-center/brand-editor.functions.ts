/**
 * Server functions do editor administrativo do Brand Center.
 *
 * Regras invioláveis:
 *  - Autenticação obrigatória via `requireSupabaseAuth`.
 *  - `company_id` derivado do `profiles.company_id` do usuário (nunca do cliente).
 *  - Papel `admin` verificado explicitamente antes de qualquer escrita.
 *  - Payloads validados com Zod; extras rejeitados (`.strict()`).
 *  - `signBrandAssetUpload` retorna URL temporária; jamais é persistida.
 *  - `publishBrandVersion` delega à RPC `publish_brand_version` (transacional).
 *
 * IMPORTANTE: este arquivo NÃO integra consumidores atuais (Marketing IA,
 * Render, Publisher, etc.). Apenas fornece a superfície do editor.
 */

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  ALLOWED_LOGO_MIMES,
  MAX_LOGO_BYTES,
  MIME_TO_EXT,
} from "./brand-editor.types";
import type {
  BrandEditorState,
  BrandEditorVersion,
  BrandEditorProfile,
  SignBrandAssetUploadResult,
} from "./brand-editor.types";
import type { BrandAssetRef } from "./brand.types";
import { DEFAULT_COLORS, DEFAULT_TOKENS, DEFAULT_TYPOGRAPHY } from "./brand-defaults";
import {
  BrandDraftPayloadSchema,
  DeactivateBrandAssetSchema,
  PublishBrandVersionSchema,
  RegisterBrandAssetSchema,
  SignBrandAssetUploadSchema,
  assertStoragePathOwnership,
} from "./brand-editor-schema";

const BRAND_BUCKET = "brand-assets" as const;
const DEFAULT_PROFILE_NAME = "Identidade principal";

// -------------------------------------------------------------------------
// Helpers internos
// -------------------------------------------------------------------------

type AuthCtx = { supabase: any; userId: string };

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
  const companyId = profileRow?.company_id as string | undefined;
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

function mapVersion(row: any): BrandEditorVersion {
  return {
    id: row.id,
    status: row.status,
    versionNumber: row.version_number,
    colors: { ...DEFAULT_COLORS, ...(row.colors ?? {}) },
    typography: { ...DEFAULT_TYPOGRAPHY, ...(row.typography ?? {}) },
    tokens: { ...DEFAULT_TOKENS, ...(row.tokens ?? {}) },
    publishedAt: row.published_at,
    updatedAt: row.updated_at,
  };
}

function mapAsset(row: any): BrandAssetRef {
  return {
    id: row.id,
    type: row.asset_type,
    storageBucket: row.storage_bucket,
    storagePath: row.storage_path,
    mimeType: row.mime_type,
    width: row.width,
    height: row.height,
  };
}

async function ensureBrandProfile(
  ctx: AuthCtx,
  companyId: string,
): Promise<BrandEditorProfile> {
  const { data: existing } = await ctx.supabase
    .from("brand_profiles")
    .select("id, name, description, visual_style, active_version_id")
    .eq("company_id", companyId)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (existing) {
    return {
      id: existing.id,
      name: existing.name,
      description: existing.description,
      visualStyle: existing.visual_style,
      activeVersionId: existing.active_version_id,
    };
  }
  const { data: inserted, error } = await ctx.supabase
    .from("brand_profiles")
    .insert({
      company_id: companyId,
      name: DEFAULT_PROFILE_NAME,
      status: "active",
      created_by: ctx.userId,
    })
    .select("id, name, description, visual_style, active_version_id")
    .single();
  if (error) throw new Error(`brand_profile_insert_failed:${error.message}`);
  return {
    id: inserted.id,
    name: inserted.name,
    description: inserted.description,
    visualStyle: inserted.visual_style,
    activeVersionId: inserted.active_version_id,
  };
}

// -------------------------------------------------------------------------
// getBrandEditorState
// -------------------------------------------------------------------------

export const getBrandEditorState = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<BrandEditorState> => {
    const auth = context as AuthCtx;
    const { companyId, isAdmin } = await resolveCompanyAndRole(auth);

    // Sem admin: retornamos estado read-only (sem criar profile automaticamente).
    const { data: profileRow } = await auth.supabase
      .from("brand_profiles")
      .select("id, name, description, visual_style, active_version_id")
      .eq("company_id", companyId)
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();

    const profile: BrandEditorProfile | null = profileRow
      ? {
          id: profileRow.id,
          name: profileRow.name,
          description: profileRow.description,
          visualStyle: profileRow.visual_style,
          activeVersionId: profileRow.active_version_id,
        }
      : null;

    let draft: BrandEditorVersion | null = null;
    let published: BrandEditorVersion | null = null;
    let assets: BrandAssetRef[] = [];

    if (profile) {
      const { data: versions } = await auth.supabase
        .from("brand_versions")
        .select(
          "id, status, version_number, colors, typography, tokens, published_at, updated_at",
        )
        .eq("profile_id", profile.id)
        .eq("company_id", companyId)
        .in("status", ["draft", "published"])
        .order("updated_at", { ascending: false });
      for (const v of versions ?? []) {
        if (v.status === "draft" && !draft) draft = mapVersion(v);
        if (v.status === "published" && !published) published = mapVersion(v);
      }
      const { data: assetRows } = await auth.supabase
        .from("brand_assets")
        .select(
          "id, asset_type, storage_bucket, storage_path, mime_type, width, height",
        )
        .eq("company_id", companyId)
        .eq("profile_id", profile.id)
        .eq("is_active", true);
      assets = (assetRows ?? []).map(mapAsset);
    }

    return { companyId, isAdmin, profile, draft, published, assets };
  });

// -------------------------------------------------------------------------
// saveBrandDraft
// -------------------------------------------------------------------------

export const saveBrandDraft = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => BrandDraftPayloadSchema.parse(data))
  .handler(async ({ data, context }): Promise<{ versionId: string }> => {
    const auth = context as AuthCtx;
    const { companyId, isAdmin } = await resolveCompanyAndRole(auth);
    requireAdmin(isAdmin);

    const profile = await ensureBrandProfile(auth, companyId);

    // Atualiza metadados do profile no mesmo save (nome/descrição/estilo).
    const { error: updProfileErr } = await auth.supabase
      .from("brand_profiles")
      .update({
        name: data.name,
        description: data.description,
        visual_style: data.visualStyle,
      })
      .eq("id", profile.id)
      .eq("company_id", companyId);
    if (updProfileErr) throw new Error(`brand_profile_update_failed:${updProfileErr.message}`);

    // Localiza draft existente (um por profile).
    const { data: existingDraft } = await auth.supabase
      .from("brand_versions")
      .select("id, version_number")
      .eq("profile_id", profile.id)
      .eq("company_id", companyId)
      .eq("status", "draft")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    const payload = {
      colors: data.colors,
      typography: data.typography,
      tokens: data.tokens,
    };

    if (existingDraft) {
      const { error } = await auth.supabase
        .from("brand_versions")
        .update(payload)
        .eq("id", existingDraft.id)
        .eq("company_id", companyId)
        .eq("status", "draft");
      if (error) throw new Error(`brand_draft_update_failed:${error.message}`);
      return { versionId: existingDraft.id };
    }

    // Descobre próximo version_number para o profile.
    const { data: last } = await auth.supabase
      .from("brand_versions")
      .select("version_number")
      .eq("profile_id", profile.id)
      .order("version_number", { ascending: false })
      .limit(1)
      .maybeSingle();
    const nextVersion = (last?.version_number ?? 0) + 1;

    const { data: inserted, error } = await auth.supabase
      .from("brand_versions")
      .insert({
        profile_id: profile.id,
        company_id: companyId,
        version_number: nextVersion,
        status: "draft",
        ...payload,
        created_by: auth.userId,
      })
      .select("id")
      .single();
    if (error) throw new Error(`brand_draft_insert_failed:${error.message}`);
    return { versionId: inserted.id };
  });

// -------------------------------------------------------------------------
// publishBrandVersion  (delega à RPC transacional)
// -------------------------------------------------------------------------

export const publishBrandVersion = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => PublishBrandVersionSchema.parse(data))
  .handler(async ({ data, context }): Promise<{ versionId: string; publishedAt: string }> => {
    const auth = context as AuthCtx;
    const { isAdmin } = await resolveCompanyAndRole(auth);
    requireAdmin(isAdmin);

    const { data: rows, error } = await auth.supabase.rpc(
      "publish_brand_version",
      { _version_id: data.versionId },
    );
    if (error) throw new Error(`brand_publish_failed:${error.message}`);
    const row = Array.isArray(rows) ? rows[0] : rows;
    if (!row) throw new Error("brand_publish_no_result");
    return { versionId: row.version_id, publishedAt: row.published_at };
  });

// -------------------------------------------------------------------------
// signBrandAssetUpload  (URL temporária — nunca persistida)
// -------------------------------------------------------------------------

export const signBrandAssetUpload = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => SignBrandAssetUploadSchema.parse(data))
  .handler(async ({ data, context }): Promise<SignBrandAssetUploadResult> => {
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
      throw new Error(`brand_asset_sign_failed:${error?.message ?? "unknown"}`);
    }
    // NUNCA logamos ou retornamos a signed URL completa em banco/logs.
    return { storagePath, token: signed.token, bucket: BRAND_BUCKET };
  });

// -------------------------------------------------------------------------
// registerBrandAsset
// -------------------------------------------------------------------------

export const registerBrandAsset = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => RegisterBrandAssetSchema.parse(data))
  .handler(async ({ data, context }): Promise<{ assetId: string }> => {
    const auth = context as AuthCtx;
    const { companyId, isAdmin } = await resolveCompanyAndRole(auth);
    requireAdmin(isAdmin);

    const ownership = assertStoragePathOwnership(
      data.storagePath,
      companyId,
      data.assetType,
    );
    if (!ownership.ok) throw new Error(`brand_asset_path_forbidden:${ownership.reason}`);

    const profile = await ensureBrandProfile(auth, companyId);

    // Desativa qualquer asset ativo anterior do mesmo tipo (preserva histórico).
    const { error: deactErr } = await auth.supabase
      .from("brand_assets")
      .update({ is_active: false })
      .eq("company_id", companyId)
      .eq("profile_id", profile.id)
      .eq("asset_type", data.assetType)
      .eq("is_active", true);
    if (deactErr) throw new Error(`brand_asset_deact_failed:${deactErr.message}`);

    const { data: inserted, error } = await auth.supabase
      .from("brand_assets")
      .insert({
        company_id: companyId,
        profile_id: profile.id,
        asset_type: data.assetType,
        storage_bucket: BRAND_BUCKET,
        storage_path: data.storagePath,
        original_filename: data.originalFilename,
        mime_type: data.mimeType,
        file_size_bytes: data.sizeBytes,
        width: data.width,
        height: data.height,
        sha256: data.sha256,
        is_active: true,
        created_by: auth.userId,
      })
      .select("id")
      .single();
    if (error) throw new Error(`brand_asset_insert_failed:${error.message}`);
    return { assetId: inserted.id };
  });

// -------------------------------------------------------------------------
// deactivateBrandAsset  (desativação lógica — nunca apaga arquivo do storage)
// -------------------------------------------------------------------------

export const deactivateBrandAsset = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => DeactivateBrandAssetSchema.parse(data))
  .handler(async ({ data, context }): Promise<{ ok: true }> => {
    const auth = context as AuthCtx;
    const { companyId, isAdmin } = await resolveCompanyAndRole(auth);
    requireAdmin(isAdmin);
    const { error } = await auth.supabase
      .from("brand_assets")
      .update({ is_active: false })
      .eq("id", data.assetId)
      .eq("company_id", companyId);
    if (error) throw new Error(`brand_asset_deact_failed:${error.message}`);
    return { ok: true };
  });

// Reexport para uso em testes internos.
export const __editorInternal = {
  ensureBrandProfile,
  resolveCompanyAndRole,
  BRAND_BUCKET,
};

// Consumido silenciosamente para manter o tipo `z` importado como valor.
export type __RuntimeCheck = z.ZodTypeAny;
