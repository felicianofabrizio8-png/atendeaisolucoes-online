// ============================================================================
// useBrandLogo — logo e cores da marca da empresa logada, para o Estúdio de
// Vídeo, e as ações de trocar/remover a logo NO CADASTRO DE MARCA.
//
// A logo vive no Brand Center (por company_id): é dali que o Render Engine a
// lê ao gerar o vídeo. Por isso trocar ou remover aqui altera o cadastro da
// empresa de verdade (ação restrita a administradores, validada no servidor)
// — não existe "logo só da prévia".
// ============================================================================

import { useCallback, useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { getBrandContext, getBrandAssetAccess } from "@/lib/brand-center/brand.functions";
import { deactivateBrandAsset, getBrandEditorState } from "@/lib/brand-center/brand-editor.functions";
import { brandLogoErrorMessage, uploadBrandLogo } from "@/lib/brand-center/brand-logo-upload";

export interface UseBrandLogoResult {
  logoUrl: string | null;
  loading: boolean;
  /** Não há logo no cadastro da empresa. */
  isPlaceholder: boolean;
  /** Cores da marca publicada da empresa; null se ainda não há marca. */
  brandColors: { primary: string; secondary: string; accent: string } | null;
  /** A marca tem versão publicada — sem isso o vídeo sai sem logo e sem cena. */
  brandPublished: boolean;
  /** O usuário é administrador e pode alterar a logo da empresa. */
  canManage: boolean;
  /** Envio/remoção em andamento. */
  saving: boolean;
  /** Mensagem da última falha (pronta para exibir). */
  error: string | null;
  /** Envia uma nova logo para o cadastro da empresa. */
  saveLogo: (file: File) => Promise<boolean>;
  /** Remove a logo do cadastro da empresa. */
  removeLogo: () => Promise<boolean>;
  /**
   * Novo link de acesso à logo (o atual expira em minutos). Usado por quem
   * precisa baixar o arquivo de novo, como a exportação de imagem.
   */
  freshLogoUrl?: () => Promise<string | null>;
}

export function useBrandLogo(): UseBrandLogoResult {
  const ctxFn = useServerFn(getBrandContext);
  const accessFn = useServerFn(getBrandAssetAccess);
  const editorFn = useServerFn(getBrandEditorState);
  const deactivateFn = useServerFn(deactivateBrandAsset);

  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [assetId, setAssetId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [brandColors, setBrandColors] = useState<UseBrandLogoResult["brandColors"]>(null);
  const [brandPublished, setBrandPublished] = useState(false);
  const [canManage, setCanManage] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const ctx = await ctxFn();
        if (!mounted) return;
        const published = !ctx.isFallback && !!ctx.versionId;
        setBrandPublished(published);
        // Marca de fallback não é identidade da empresa: o editor usa as cores do modelo.
        setBrandColors(published ? { primary: ctx.colors.primary, secondary: ctx.colors.secondary, accent: ctx.colors.accent } : null);
        const primary = ctx.assets.byType.logo_primary;
        setAssetId(primary?.id ?? null);
        if (!primary) {
          setLogoUrl(null);
          return;
        }
        const access = await accessFn({ data: { assetId: primary.id } });
        if (mounted) setLogoUrl(access.signedUrl);
      } catch {
        // Silencioso: a prévia cai no marcador de logo.
        if (mounted) setLogoUrl(null);
      } finally {
        if (mounted) setLoading(false);
      }
    })();
    return () => {
      mounted = false;
    };
  }, [ctxFn, accessFn, version]);

  // Papel do usuário (o servidor revalida em toda escrita).
  useEffect(() => {
    let mounted = true;
    editorFn()
      .then((state) => {
        if (mounted) setCanManage(!!state.isAdmin);
      })
      .catch(() => {
        if (mounted) setCanManage(false);
      });
    return () => {
      mounted = false;
    };
  }, [editorFn]);

  const saveLogo = useCallback(async (file: File) => {
    setSaving(true);
    setError(null);
    try {
      await uploadBrandLogo(file);
      setVersion((v) => v + 1);
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : brandLogoErrorMessage(e));
      return false;
    } finally {
      setSaving(false);
    }
  }, []);

  const removeLogo = useCallback(async () => {
    if (!assetId) return false;
    setSaving(true);
    setError(null);
    try {
      await deactivateFn({ data: { assetId } });
      setVersion((v) => v + 1);
      return true;
    } catch (e) {
      setError(brandLogoErrorMessage(e));
      return false;
    } finally {
      setSaving(false);
    }
  }, [assetId, deactivateFn]);

  const freshLogoUrl = useCallback(async () => {
    if (!assetId) return null;
    try {
      const access = await accessFn({ data: { assetId } });
      setLogoUrl(access.signedUrl);
      return access.signedUrl;
    } catch {
      return null;
    }
  }, [assetId, accessFn]);

  return { logoUrl, loading, isPlaceholder: !logoUrl, brandColors, brandPublished, canManage, saving, error, saveLogo, removeLogo, freshLogoUrl };
}
