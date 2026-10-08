// Miniaturas reais dos conteúdos de marketing (foto, vídeo ou imagem de
// produto usada no conteúdo). Usa as mesmas funções de acesso já existentes,
// portanto respeita o isolamento por empresa do backend.

import { useEffect, useMemo, useState } from "react";
import { apiListMedia, urlForMarketingPath } from "@/data/marketingRepo";
import { getSignedImageUrl } from "@/lib/storage";
import type { MarketingContentRow, MarketingMediaRow } from "@/lib/marketing/marketing.types";

export interface ContentPreview {
  url: string;
  kind: "image" | "video";
}

type Source =
  | { key: string; type: "media"; mediaId: string }
  | { key: string; type: "product"; imagePath: string };

/** De onde vem a imagem que representa um conteúdo. `null` quando não há mídia. */
export function contentPreviewSource(row: Pick<MarketingContentRow, "media_ids" | "ai_prompt"> & {
  primary_image_media_id?: string | null;
  primary_image_product_ref?: { product_id: string; image_path: string } | null;
}): Source | null {
  const mediaId = row.primary_image_media_id ?? row.media_ids?.[0] ?? null;
  if (mediaId) return { key: `m:${mediaId}`, type: "media", mediaId };
  const productPath =
    row.primary_image_product_ref?.image_path ??
    (row.ai_prompt && typeof row.ai_prompt === "object" && !Array.isArray(row.ai_prompt)
      ? ((row.ai_prompt as { product_media_refs?: Array<{ image_path?: unknown }> }).product_media_refs?.[0]?.image_path as string | undefined)
      : undefined);
  if (typeof productPath === "string" && productPath.length > 0) {
    return { key: `p:${productPath}`, type: "product", imagePath: productPath };
  }
  return null;
}

let mediaIndexPromise: Promise<Record<string, MarketingMediaRow>> | null = null;
let mediaIndexCompany: string | null = null;

function loadMediaIndex(companyId: string): Promise<Record<string, MarketingMediaRow>> {
  if (!mediaIndexPromise || mediaIndexCompany !== companyId) {
    mediaIndexCompany = companyId;
    mediaIndexPromise = apiListMedia()
      .then((list) => Object.fromEntries(list.map((m) => [m.id, m])))
      .catch(() => {
        mediaIndexPromise = null;
        return {};
      });
  }
  return mediaIndexPromise;
}

/** Descarta o índice em memória (após enviar ou remover mídia). */
export function invalidateContentPreviews(): void {
  mediaIndexPromise = null;
}

export function useContentPreviews(
  companyId: string,
  rows: MarketingContentRow[],
): Record<string, ContentPreview | null> {
  const [byKey, setByKey] = useState<Record<string, ContentPreview | null>>({});

  const sources = useMemo(() => {
    const map = new Map<string, Source | null>();
    for (const row of rows) map.set(row.id, contentPreviewSource(row));
    return map;
  }, [rows]);

  useEffect(() => {
    let cancelled = false;
    const pending = new Map<string, Source>();
    for (const src of sources.values()) {
      if (src && !(src.key in byKey)) pending.set(src.key, src);
    }
    if (pending.size === 0) return;
    void (async () => {
      const index = [...pending.values()].some((s) => s.type === "media") ? await loadMediaIndex(companyId) : {};
      const entries = await Promise.all(
        [...pending.values()].map(async (src): Promise<[string, ContentPreview | null]> => {
          try {
            if (src.type === "media") {
              const media = index[src.mediaId];
              if (!media?.storage_path) return [src.key, null];
              const url = await urlForMarketingPath(media.storage_path);
              return [src.key, url ? { url, kind: media.media_type === "video" ? "video" : "image" } : null];
            }
            const url = await getSignedImageUrl(src.imagePath);
            return [src.key, url ? { url, kind: "image" } : null];
          } catch {
            return [src.key, null];
          }
        }),
      );
      if (!cancelled) setByKey((cur) => ({ ...cur, ...Object.fromEntries(entries) }));
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sources, companyId]);

  return useMemo(() => {
    const out: Record<string, ContentPreview | null> = {};
    for (const [id, src] of sources) out[id] = src ? (byKey[src.key] ?? null) : null;
    return out;
  }, [sources, byKey]);
}
