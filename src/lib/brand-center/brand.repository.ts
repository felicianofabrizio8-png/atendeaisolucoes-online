/**
 * Brand Center — Repository central.
 *
 * TODOS os acessos às tabelas `brand_*` passam por este módulo. Server functions
 * (editor e consumo) atuam como orquestradores; consumidores externos usam
 * apenas o contrato público `BrandContext` via `getBrandContext()`.
 *
 * Este módulo é puro (não lê env, não gera signed URLs, não valida auth).
 * Recebe um `SupabaseClient<Database>` tipado — o cliente já traz o escopo
 * de RLS do usuário autenticado.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import type {
  BrandAssetRef,
  BrandAssetType,
  BrandResolverInput,
} from "./brand.types";

export type BrandSupabase = SupabaseClient<Database>;

type BrandProfileRow = Database["public"]["Tables"]["brand_profiles"]["Row"];
type BrandVersionRow = Database["public"]["Tables"]["brand_versions"]["Row"];
type BrandAssetRow = Database["public"]["Tables"]["brand_assets"]["Row"];

export interface BrandProfileDTO {
  id: string;
  companyId: string;
  name: string;
  description: string | null;
  visualStyle: string | null;
  activeVersionId: string | null;
  status: string;
}

export interface BrandVersionDTO {
  id: string;
  profileId: string;
  companyId: string;
  status: "draft" | "published" | "archived";
  versionNumber: number;
  schemaVersion: number;
  colors: unknown;
  typography: unknown;
  tokens: unknown;
  publishedAt: string | null;
  updatedAt: string;
}

export interface BrandAssetDTO {
  id: string;
  companyId: string;
  profileId: string;
  assetType: BrandAssetType;
  storageBucket: string;
  storagePath: string;
  mimeType: string;
  fileSizeBytes: number;
  width: number | null;
  height: number | null;
  sha256: string;
  isActive: boolean;
}

// ---------------------------------------------------------------------------
// Mapeadores tipados (sem `any`).
// ---------------------------------------------------------------------------

function mapProfile(row: BrandProfileRow): BrandProfileDTO {
  return {
    id: row.id,
    companyId: row.company_id,
    name: row.name,
    description: row.description,
    visualStyle: row.visual_style,
    activeVersionId: row.active_version_id,
    status: row.status,
  };
}

function mapVersion(
  row: Pick<
    BrandVersionRow,
    | "id"
    | "profile_id"
    | "company_id"
    | "status"
    | "version_number"
    | "schema_version"
    | "colors"
    | "typography"
    | "tokens"
    | "published_at"
    | "updated_at"
  >,
): BrandVersionDTO {
  return {
    id: row.id,
    profileId: row.profile_id,
    companyId: row.company_id,
    status: row.status as BrandVersionDTO["status"],
    versionNumber: row.version_number,
    schemaVersion: row.schema_version ?? 1,
    colors: row.colors,
    typography: row.typography,
    tokens: row.tokens,
    publishedAt: row.published_at,
    updatedAt: row.updated_at,
  };
}

function isBrandAssetType(v: string): v is BrandAssetType {
  return [
    "logo_primary",
    "logo_light",
    "logo_dark",
    "symbol",
    "favicon",
    "watermark",
    "decorative_element",
    "texture",
    "background_pattern",
  ].includes(v);
}

function mapAsset(row: BrandAssetRow): BrandAssetDTO {
  const type = isBrandAssetType(row.asset_type)
    ? row.asset_type
    : "logo_primary";
  return {
    id: row.id,
    companyId: row.company_id,
    profileId: row.profile_id,
    assetType: type,
    storageBucket: row.storage_bucket,
    storagePath: row.storage_path,
    mimeType: row.mime_type,
    fileSizeBytes: row.file_size_bytes,
    width: row.width,
    height: row.height,
    sha256: row.sha256,
    isActive: row.is_active,
  };
}

export function toBrandAssetRef(a: BrandAssetDTO): BrandAssetRef {
  return {
    id: a.id,
    type: a.assetType,
    storageBucket: a.storageBucket,
    storagePath: a.storagePath,
    mimeType: a.mimeType,
    width: a.width,
    height: a.height,
  };
}

// ---------------------------------------------------------------------------
// Repository — leituras
// ---------------------------------------------------------------------------

export const BrandRepository = {
  async getProfileForCompany(
    supabase: BrandSupabase,
    companyId: string,
  ): Promise<BrandProfileDTO | null> {
    const { data, error } = await supabase
      .from("brand_profiles")
      .select("*")
      .eq("company_id", companyId)
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();
    if (error) throw new Error(`brand_repo_profile_read:${error.message}`);
    return data ? mapProfile(data) : null;
  },

  async getActiveProfileForCompany(
    supabase: BrandSupabase,
    companyId: string,
  ): Promise<BrandProfileDTO | null> {
    const { data, error } = await supabase
      .from("brand_profiles")
      .select("*")
      .eq("company_id", companyId)
      .eq("status", "active")
      .limit(1)
      .maybeSingle();
    if (error) throw new Error(`brand_repo_active_profile_read:${error.message}`);
    return data ? mapProfile(data) : null;
  },

  async createDefaultProfile(
    supabase: BrandSupabase,
    input: { companyId: string; name: string; userId: string | null },
  ): Promise<BrandProfileDTO> {
    // Idempotente: se um perfil ativo já existir (índice único parcial), retorna
    // o existente em vez de duplicar.
    const { data, error } = await supabase
      .from("brand_profiles")
      .insert({
        company_id: input.companyId,
        name: input.name,
        status: "active",
        created_by: input.userId,
      })
      .select("*")
      .single();
    if (error) {
      // 23505 = unique_violation → outra requisição já criou. Relê.
      if (error.code === "23505") {
        const existing = await this.getActiveProfileForCompany(
          supabase,
          input.companyId,
        );
        if (existing) return existing;
      }
      throw new Error(`brand_repo_profile_insert:${error.message}`);
    }
    return mapProfile(data);
  },

  async updateProfileMetadata(
    supabase: BrandSupabase,
    profileId: string,
    companyId: string,
    input: {
      name: string;
      description: string | null;
      visualStyle: string | null;
    },
  ): Promise<void> {
    const { error } = await supabase
      .from("brand_profiles")
      .update({
        name: input.name,
        description: input.description,
        visual_style: input.visualStyle,
      })
      .eq("id", profileId)
      .eq("company_id", companyId);
    if (error) throw new Error(`brand_repo_profile_update:${error.message}`);
  },

  async getDraftForProfile(
    supabase: BrandSupabase,
    profileId: string,
    companyId: string,
  ): Promise<BrandVersionDTO | null> {
    const { data, error } = await supabase
      .from("brand_versions")
      .select(
        "id, profile_id, company_id, status, version_number, schema_version, colors, typography, tokens, published_at, updated_at",
      )
      .eq("profile_id", profileId)
      .eq("company_id", companyId)
      .eq("status", "draft")
      .maybeSingle();
    if (error) throw new Error(`brand_repo_draft_read:${error.message}`);
    return data ? mapVersion(data) : null;
  },

  async getLatestPublishedForProfile(
    supabase: BrandSupabase,
    profileId: string,
    companyId: string,
  ): Promise<BrandVersionDTO | null> {
    const { data, error } = await supabase
      .from("brand_versions")
      .select(
        "id, profile_id, company_id, status, version_number, schema_version, colors, typography, tokens, published_at, updated_at",
      )
      .eq("profile_id", profileId)
      .eq("company_id", companyId)
      .eq("status", "published")
      .order("published_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw new Error(`brand_repo_published_read:${error.message}`);
    return data ? mapVersion(data) : null;
  },

  async getVersionById(
    supabase: BrandSupabase,
    versionId: string,
    companyId: string,
  ): Promise<BrandVersionDTO | null> {
    const { data, error } = await supabase
      .from("brand_versions")
      .select(
        "id, profile_id, company_id, status, version_number, schema_version, colors, typography, tokens, published_at, updated_at",
      )
      .eq("id", versionId)
      .eq("company_id", companyId)
      .maybeSingle();
    if (error) throw new Error(`brand_repo_version_read:${error.message}`);
    return data ? mapVersion(data) : null;
  },

  async getNextVersionNumber(
    supabase: BrandSupabase,
    profileId: string,
  ): Promise<number> {
    const { data, error } = await supabase
      .from("brand_versions")
      .select("version_number")
      .eq("profile_id", profileId)
      .order("version_number", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw new Error(`brand_repo_next_version:${error.message}`);
    return (data?.version_number ?? 0) + 1;
  },

  async upsertDraft(
    supabase: BrandSupabase,
    input: {
      profileId: string;
      companyId: string;
      userId: string;
      colors: unknown;
      typography: unknown;
      tokens: unknown;
      schemaVersion: number;
    },
  ): Promise<{ versionId: string }> {
    const existing = await this.getDraftForProfile(
      supabase,
      input.profileId,
      input.companyId,
    );
    if (existing) {
      const { error } = await supabase
        .from("brand_versions")
        .update({
          colors: input.colors as never,
          typography: input.typography as never,
          tokens: input.tokens as never,
          schema_version: input.schemaVersion,
        })
        .eq("id", existing.id)
        .eq("company_id", input.companyId)
        .eq("status", "draft");
      if (error) throw new Error(`brand_repo_draft_update:${error.message}`);
      return { versionId: existing.id };
    }

    const nextVersion = await this.getNextVersionNumber(supabase, input.profileId);
    const { data, error } = await supabase
      .from("brand_versions")
      .insert({
        profile_id: input.profileId,
        company_id: input.companyId,
        version_number: nextVersion,
        status: "draft",
        schema_version: input.schemaVersion,
        colors: input.colors as never,
        typography: input.typography as never,
        tokens: input.tokens as never,
        created_by: input.userId,
      })
      .select("id")
      .single();
    if (error) {
      // Corrida com outra requisição salvando draft: relê e retorna.
      if (error.code === "23505") {
        const again = await this.getDraftForProfile(
          supabase,
          input.profileId,
          input.companyId,
        );
        if (again) return { versionId: again.id };
      }
      throw new Error(`brand_repo_draft_insert:${error.message}`);
    }
    return { versionId: data.id };
  },

  async publishDraft(
    supabase: BrandSupabase,
    versionId: string,
  ): Promise<{ versionId: string; publishedAt: string }> {
    const { data, error } = await supabase.rpc("publish_brand_version", {
      _version_id: versionId,
    });
    if (error) throw new Error(`brand_repo_publish:${error.message}`);
    const row = Array.isArray(data) ? data[0] : data;
    if (!row) throw new Error("brand_repo_publish_no_result");
    return {
      versionId: (row as { version_id: string }).version_id,
      publishedAt: (row as { published_at: string }).published_at,
    };
  },

  async listActiveAssets(
    supabase: BrandSupabase,
    profileId: string,
    companyId: string,
  ): Promise<BrandAssetDTO[]> {
    const { data, error } = await supabase
      .from("brand_assets")
      .select("*")
      .eq("company_id", companyId)
      .eq("profile_id", profileId)
      .eq("is_active", true)
      .order("created_at", { ascending: true });
    if (error) throw new Error(`brand_repo_assets_read:${error.message}`);
    return (data ?? []).map(mapAsset);
  },

  async getAssetById(
    supabase: BrandSupabase,
    assetId: string,
    companyId: string,
  ): Promise<BrandAssetDTO | null> {
    const { data, error } = await supabase
      .from("brand_assets")
      .select("*")
      .eq("id", assetId)
      .eq("company_id", companyId)
      .maybeSingle();
    if (error) throw new Error(`brand_repo_asset_read:${error.message}`);
    return data ? mapAsset(data) : null;
  },

  async findAssetByHash(
    supabase: BrandSupabase,
    input: { companyId: string; assetType: string; sha256: string },
  ): Promise<BrandAssetDTO | null> {
    const { data, error } = await supabase
      .from("brand_assets")
      .select("*")
      .eq("company_id", input.companyId)
      .eq("asset_type", input.assetType)
      .eq("sha256", input.sha256)
      .maybeSingle();
    if (error) throw new Error(`brand_repo_asset_hash_read:${error.message}`);
    return data ? mapAsset(data) : null;
  },

  async deactivateAssetsOfType(
    supabase: BrandSupabase,
    input: {
      profileId: string;
      companyId: string;
      assetType: string;
      exceptId?: string;
    },
  ): Promise<void> {
    let q = supabase
      .from("brand_assets")
      .update({ is_active: false })
      .eq("company_id", input.companyId)
      .eq("profile_id", input.profileId)
      .eq("asset_type", input.assetType)
      .eq("is_active", true);
    if (input.exceptId) q = q.neq("id", input.exceptId);
    const { error } = await q;
    if (error) throw new Error(`brand_repo_asset_deact:${error.message}`);
  },

  async deactivateAssetById(
    supabase: BrandSupabase,
    assetId: string,
    companyId: string,
  ): Promise<void> {
    const { error } = await supabase
      .from("brand_assets")
      .update({ is_active: false })
      .eq("id", assetId)
      .eq("company_id", companyId);
    if (error) throw new Error(`brand_repo_asset_deact:${error.message}`);
  },

  async insertAsset(
    supabase: BrandSupabase,
    input: {
      profileId: string;
      companyId: string;
      userId: string;
      assetType: string;
      storageBucket: string;
      storagePath: string;
      mimeType: string;
      fileSizeBytes: number;
      width: number | null;
      height: number | null;
      sha256: string;
      originalFilename: string;
    },
  ): Promise<{ assetId: string }> {
    const { data, error } = await supabase
      .from("brand_assets")
      .insert({
        company_id: input.companyId,
        profile_id: input.profileId,
        asset_type: input.assetType,
        storage_bucket: input.storageBucket,
        storage_path: input.storagePath,
        original_filename: input.originalFilename,
        mime_type: input.mimeType,
        file_size_bytes: input.fileSizeBytes,
        width: input.width,
        height: input.height,
        sha256: input.sha256,
        is_active: true,
        created_by: input.userId,
      })
      .select("id")
      .single();
    if (error) throw new Error(`brand_repo_asset_insert:${error.message}`);
    return { assetId: data.id };
  },

  /**
   * Consulta metadados reais do objeto no Storage via RPC SECURITY DEFINER.
   * O servidor confia apenas nestes dados (não em size/mime enviados pelo cliente).
   */
  async getStorageObjectMetadata(
    supabase: BrandSupabase,
    bucket: string,
    path: string,
  ): Promise<{ exists: boolean; sizeBytes: number | null; mimetype: string | null }> {
    const { data, error } = await supabase.rpc("brand_asset_storage_metadata", {
      _bucket: bucket,
      _path: path,
    });
    if (error) throw new Error(`brand_repo_storage_meta:${error.message}`);
    const row = Array.isArray(data) ? data[0] : data;
    if (!row) return { exists: false, sizeBytes: null, mimetype: null };
    const r = row as { exists_flag: boolean; size_bytes: number | null; mimetype: string | null };
    return {
      exists: Boolean(r.exists_flag),
      sizeBytes: r.size_bytes ?? null,
      mimetype: r.mimetype ?? null,
    };
  },
} as const;

/**
 * Monta a entrada canônica do resolver a partir do repository.
 * Se houver versão publicada, ela vence. Rascunho NÃO vira identidade ativa.
 */
export async function loadBrandResolverInput(
  supabase: BrandSupabase,
  companyId: string,
): Promise<BrandResolverInput> {
  const profile = await BrandRepository.getActiveProfileForCompany(
    supabase,
    companyId,
  );
  if (!profile) {
    return { companyId, profile: null, version: null, assets: [] };
  }

  let published: BrandVersionDTO | null = null;
  if (profile.activeVersionId) {
    const v = await BrandRepository.getVersionById(
      supabase,
      profile.activeVersionId,
      companyId,
    );
    if (v && v.status === "published") published = v;
  }
  if (!published) {
    published = await BrandRepository.getLatestPublishedForProfile(
      supabase,
      profile.id,
      companyId,
    );
  }

  const assets = await BrandRepository.listActiveAssets(
    supabase,
    profile.id,
    companyId,
  );

  return {
    companyId,
    profile: { id: profile.id, visualStyle: profile.visualStyle },
    version: published
      ? {
          id: published.id,
          status: "published",
          colors: published.colors,
          typography: published.typography,
          tokens: published.tokens,
        }
      : null,
    assets: assets.map((a) => ({
      id: a.id,
      type: a.assetType,
      storageBucket: a.storageBucket,
      storagePath: a.storagePath,
      mimeType: a.mimeType,
      width: a.width,
      height: a.height,
    })),
  };
}
