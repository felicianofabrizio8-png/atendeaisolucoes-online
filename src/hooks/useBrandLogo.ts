// ============================================================================
// useBrandLogo — hook client-side que resolve a logo primária do Brand Center
// para uso no preview do Editor Criativo IA.
//
// Fluxo:
//   1) Busca BrandContext via server function `getBrandContext`.
//   2) Se houver `assets.byType.logo_primary`, solicita signed URL via
//      `getBrandAssetAccess` (TTL default) e devolve como `logoUrl`.
//   3) Se não houver logo publicada, retorna `logoUrl = null` e
//      `isPlaceholder = true` para o preview mostrar o placeholder.
//   4) Também expõe `uploadLocal(file)` para o usuário adicionar uma logo
//      apenas para a sessão de edição atual (não persiste no Brand Center;
//      persistência é responsabilidade da tela de Marca — mantemos separação).
// ============================================================================

import { useCallback, useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import {
  getBrandContext,
  getBrandAssetAccess,
} from "@/lib/brand-center/brand.functions";

interface UseBrandLogoResult {
  logoUrl: string | null;
  loading: boolean;
  isPlaceholder: boolean;
  /** Substitui a logo apenas para esta sessão (não persiste). */
  uploadLocal: (file: File) => void;
  /** True quando `logoUrl` veio de upload local (session-only). */
  isLocalOverride: boolean;
  /** Volta a logo publicada do Brand Center (se houver). */
  clearLocalOverride: () => void;
}

export function useBrandLogo(): UseBrandLogoResult {
  const ctxFn = useServerFn(getBrandContext);
  const accessFn = useServerFn(getBrandAssetAccess);

  const [remoteUrl, setRemoteUrl] = useState<string | null>(null);
  const [localUrl, setLocalUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const ctx = await ctxFn();
        if (!mounted) return;
        const primary = ctx.assets.byType.logo_primary;
        if (!primary) {
          setRemoteUrl(null);
          return;
        }
        const access = await accessFn({ data: { assetId: primary.id } });
        if (!mounted) return;
        setRemoteUrl(access.signedUrl);
      } catch {
        // Silencioso: preview cai no placeholder.
        if (mounted) setRemoteUrl(null);
      } finally {
        if (mounted) setLoading(false);
      }
    })();
    return () => {
      mounted = false;
    };
  }, [ctxFn, accessFn]);

  // Revoga objectURL local ao desmontar / trocar arquivo.
  useEffect(() => {
    return () => {
      if (localUrl) URL.revokeObjectURL(localUrl);
    };
  }, [localUrl]);

  const uploadLocal = useCallback((file: File) => {
    setLocalUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return URL.createObjectURL(file);
    });
  }, []);

  const clearLocalOverride = useCallback(() => {
    setLocalUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return null;
    });
  }, []);

  const effectiveUrl = localUrl ?? remoteUrl;

  return {
    logoUrl: effectiveUrl,
    loading,
    isPlaceholder: !effectiveUrl,
    uploadLocal,
    isLocalOverride: Boolean(localUrl),
    clearLocalOverride,
  };
}
