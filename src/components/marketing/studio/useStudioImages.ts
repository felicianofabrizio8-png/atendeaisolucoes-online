// Links de prévia das imagens de um documento do estúdio. Cada imagem termina
// com URL ou com um erro identificado (nunca fica carregando para sempre) e
// pode ser tentada de novo.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { resolveCampaignMedia, type MediaResolverDeps, type ResolvedMedia } from "@/lib/marketing/campaign-media";
import { imageKey, type PageImageRef } from "@/lib/marketing/studio/document";

export interface StudioImages {
  /** URL de prévia por chave de imagem (ver `imageKey`). */
  get: (image: PageImageRef | null | undefined) => ResolvedMedia | null;
  /** true enquanto o link desta imagem está sendo obtido. */
  loading: (image: PageImageRef | null | undefined) => boolean;
  retry: (image: PageImageRef) => Promise<void>;
  /**
   * Pede links NOVOS para estas imagens e devolve por chave. Links assinados
   * expiram em minutos; a prévia continua mostrando a foto já carregada, mas
   * quem precisa baixar o arquivo de novo (exportação) tem de renovar antes.
   */
  refresh: (images: PageImageRef[]) => Promise<Record<string, string | null>>;
  /** Registra um link já conhecido (ex.: imagem recém-escolhida no acervo). */
  prime: (image: PageImageRef, url: string) => void;
}

export function useStudioImages(images: PageImageRef[], deps: MediaResolverDeps): StudioImages {
  const [resolved, setResolved] = useState<Record<string, ResolvedMedia>>({});
  const pending = useRef(new Set<string>());
  const [, bump] = useState(0);
  const keys = useMemo(() => images.map(imageKey).join("|"), [images]);

  const resolve = useCallback(
    async (refs: PageImageRef[], fresh: boolean): Promise<Record<string, ResolvedMedia>> => {
      if (refs.length === 0) return {};
      for (const ref of refs) pending.current.add(imageKey(ref));
      bump((n) => n + 1);
      const out = await resolveCampaignMedia(
        refs.map((ref) => (ref.origin === "marketing" ? { key: imageKey(ref), origin: ref.origin, mediaId: ref.mediaId } : { key: imageKey(ref), origin: ref.origin, imagePath: ref.imagePath })),
        deps,
        { fresh },
      );
      for (const ref of refs) pending.current.delete(imageKey(ref));
      setResolved((cur) => ({ ...cur, ...out }));
      return out;
    },
    [deps],
  );

  useEffect(() => {
    const missing = images.filter((ref) => !resolved[imageKey(ref)] && !pending.current.has(imageKey(ref)));
    void resolve(missing, false);
    // `keys` resume a lista de imagens; `resolved` é lido só para pular as já obtidas.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [keys, resolve]);

  return useMemo<StudioImages>(
    () => ({
      get: (image) => (image ? resolved[imageKey(image)] ?? null : null),
      loading: (image) => !!image && !resolved[imageKey(image)],
      retry: async (image) => {
        await resolve([image], true);
      },
      refresh: async (list) => {
        const out = await resolve(list, true);
        return Object.fromEntries(list.map((image) => [imageKey(image), out[imageKey(image)]?.previewUrl ?? null]));
      },
      prime: (image, url) => setResolved((cur) => ({ ...cur, [imageKey(image)]: { previewUrl: url, error: null } })),
    }),
    [resolved, resolve],
  );
}
