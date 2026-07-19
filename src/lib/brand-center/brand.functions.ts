/**
 * Server function: getBrandContext.
 *
 * Consumidores futuros (Marketing IA, PDFs, Landing Pages, etc.) devem
 * chamar SOMENTE esta função — nunca acessar as tabelas brand_* diretamente.
 *
 * Fase 1: função autenticada; a empresa é derivada do usuário via
 * `current_company_id()` (RLS). Nesta fase não há tela de configuração,
 * portanto a maioria das empresas receberá o BrandContext em modo fallback
 * com defaults neutros.
 */

import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { resolveBrandContext } from "./brand-resolver";
import type { BrandContext, BrandResolverInput } from "./brand.types";

export const getBrandContext = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<BrandContext> => {
    const { supabase } = context;

    // Descobre a empresa do usuário autenticado via profile (respeita RLS).
    const { data: profileRow, error: profileErr } = await supabase
      .from("profiles")
      .select("company_id")
      .maybeSingle();
    if (profileErr) throw profileErr;

    const companyId = profileRow?.company_id ?? null;
    if (!companyId) {
      // Sem empresa: retorna contexto totalmente em fallback.
      return resolveBrandContext({
        companyId: "",
        profile: null,
        version: null,
        assets: [],
      });
    }

    // 1) Perfil ativo (pode não existir).
    const { data: brandProfile } = await supabase
      .from("brand_profiles")
      .select("id, visual_style, active_version_id")
      .eq("company_id", companyId)
      .eq("status", "active")
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();

    // 2) Versão ativa (published tem prioridade sobre draft).
    let versionRow: BrandResolverInput["version"] = null;
    if (brandProfile) {
      // Tenta primeiro a versão explicitamente ativa.
      if (brandProfile.active_version_id) {
        const { data: v } = await supabase
          .from("brand_versions")
          .select("id, status, colors, typography, tokens")
          .eq("id", brandProfile.active_version_id)
          .eq("company_id", companyId)
          .maybeSingle();
        if (v && v.status === "published") {
          versionRow = {
            id: v.id,
            status: v.status,
            colors: v.colors,
            typography: v.typography,
            tokens: v.tokens,
          };
        }
      }
      // Fallback: última publicada do perfil.
      if (!versionRow) {
        const { data: v } = await supabase
          .from("brand_versions")
          .select("id, status, colors, typography, tokens")
          .eq("profile_id", brandProfile.id)
          .eq("company_id", companyId)
          .eq("status", "published")
          .order("published_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        if (v) {
          versionRow = {
            id: v.id,
            status: v.status,
            colors: v.colors,
            typography: v.typography,
            tokens: v.tokens,
          };
        }
      }
    }

    // 3) Assets ativos do perfil.
    let assets: BrandResolverInput["assets"] = [];
    if (brandProfile) {
      const { data: rows } = await supabase
        .from("brand_assets")
        .select(
          "id, asset_type, storage_bucket, storage_path, mime_type, width, height",
        )
        .eq("company_id", companyId)
        .eq("profile_id", brandProfile.id)
        .eq("is_active", true)
        .order("created_at", { ascending: true });
      assets = (rows ?? []).map((a) => ({
        id: a.id,
        type: a.asset_type,
        storageBucket: a.storage_bucket,
        storagePath: a.storage_path,
        mimeType: a.mime_type,
        width: a.width,
        height: a.height,
      }));
    }

    return resolveBrandContext({
      companyId,
      profile: brandProfile
        ? { id: brandProfile.id, visualStyle: brandProfile.visual_style }
        : null,
      version: versionRow,
      assets,
    });
  });
