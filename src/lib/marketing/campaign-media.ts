// ============================================================================
// Imagens de uma campanha de vídeo — de onde vêm e como viram prévia.
//
// `campaignImageRefs` aplica a MESMA regra do servidor ao montar o render
// (`resolveRenderImages` em marketing-campaign.functions.ts): a sequência
// salva em `ai_prompt.image_sequence`; sem ela, a imagem principal do conteúdo
// (foto do acervo ou foto de produto). Assim o que a prévia mostra é o que o
// vídeo usa — nunca uma imagem escolhida por outro critério.
//
// A resolução da URL tem limite de tempo e devolve um erro explícito por
// imagem, para a tela poder oferecer "tentar novamente" em vez de ficar
// carregando para sempre ou mostrar "sem imagem" sem explicação.
// ============================================================================

import type { FocalPoint } from "@/lib/render-engine/render.types";
import { readStoredSequence } from "./campaign-image-sequence";

export type CampaignImageRef =
  | { key: string; origin: "marketing"; mediaId: string; focalPoint: FocalPoint | null }
  | { key: string; origin: "product"; productId: string; imagePath: string; focalPoint: FocalPoint | null };

export type MediaLoadError =
  /** A mídia não existe mais no acervo da empresa (ou foi removida). */
  | "not_found"
  /** O storage não entregou um link de acesso. */
  | "url_failed"
  /** Passou do tempo limite. */
  | "timeout"
  /** O link foi gerado, mas o navegador não conseguiu abrir a imagem. */
  | "image_failed";

export const MEDIA_ERROR_MESSAGE: Record<MediaLoadError, string> = {
  not_found: "Esta imagem não está mais no acervo da empresa.",
  url_failed: "Não foi possível obter o acesso à imagem.",
  timeout: "A imagem demorou demais para carregar.",
  image_failed: "O navegador não conseguiu abrir a imagem.",
};

/** Tempo máximo para obter o link de uma imagem. */
export const MEDIA_URL_TIMEOUT_MS = 12_000;
/** Tempo máximo para o navegador baixar e abrir a imagem. */
export const MEDIA_IMAGE_TIMEOUT_MS = 20_000;

export class MediaTimeoutError extends Error {
  constructor() {
    super("media_timeout");
  }
}

/** Rejeita com `MediaTimeoutError` se a promessa não terminar em `ms`. */
export function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new MediaTimeoutError()), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

interface CampaignImageRow {
  ai_prompt?: unknown;
  primary_image_media_id?: string | null;
  primary_image_product_ref?: { product_id: string; image_path: string } | null;
}

function legacyFocal(aiPrompt: unknown): FocalPoint | null {
  const fp = aiPrompt && typeof aiPrompt === "object" ? (aiPrompt as { focal_point?: Partial<FocalPoint> | null }).focal_point : null;
  if (!fp || typeof fp.x !== "number" || typeof fp.y !== "number") return null;
  return { x: fp.x, y: fp.y, zoom: typeof fp.zoom === "number" ? fp.zoom : 1 };
}

/**
 * Imagens que o render vai usar para este conteúdo, na ordem do vídeo.
 * `sequenceInvalid` = a sequência salva está corrompida (o servidor também a
 * recusa ao gerar o vídeo); a prévia cai na imagem principal.
 */
export function campaignImageRefs(row: CampaignImageRow): { refs: CampaignImageRef[]; sequenceInvalid: boolean } {
  let sequenceInvalid = false;
  try {
    const stored = readStoredSequence(row.ai_prompt);
    if (stored.length > 0) {
      return {
        sequenceInvalid,
        refs: stored.map((item, index) =>
          item.origin === "marketing"
            ? { key: `marketing:${item.media_id}`, origin: "marketing", mediaId: item.media_id, focalPoint: item.focal_point }
            : { key: `product:${item.product_id}:${index}`, origin: "product", productId: item.product_id, imagePath: item.image_path, focalPoint: item.focal_point },
        ),
      };
    }
  } catch {
    sequenceInvalid = true;
  }
  const focalPoint = legacyFocal(row.ai_prompt);
  if (row.primary_image_media_id) {
    return { sequenceInvalid, refs: [{ key: `marketing:${row.primary_image_media_id}`, origin: "marketing", mediaId: row.primary_image_media_id, focalPoint }] };
  }
  const product = row.primary_image_product_ref;
  if (product?.product_id && product.image_path) {
    return { sequenceInvalid, refs: [{ key: `product:${product.product_id}:0`, origin: "product", productId: product.product_id, imagePath: product.image_path, focalPoint }] };
  }
  return { sequenceInvalid, refs: [] };
}

export interface MediaResolverDeps {
  /** storage_path das mídias do acervo, por id (só as da empresa logada). */
  mediaPaths: (ids: string[]) => Promise<Record<string, string>>;
  /** Link assinado de um arquivo do acervo de marketing. */
  signMarketing: (storagePath: string, fresh: boolean) => Promise<string | null>;
  /** Link assinado de uma foto de produto. */
  signProduct: (imagePath: string, fresh: boolean) => Promise<string | null>;
  timeoutMs?: number;
}

export interface ResolvedMedia {
  previewUrl: string | null;
  error: MediaLoadError | null;
}

/**
 * Resolve as URLs de prévia de várias imagens em paralelo. Nunca lança e nunca
 * fica pendurada: cada imagem termina com URL ou com um erro identificado.
 * `fresh` ignora links em cache (usado no "tentar novamente").
 */
export async function resolveCampaignMedia(
  refs: Array<Pick<CampaignImageRef, "key" | "origin"> & { mediaId?: string; imagePath?: string; storagePath?: string }>,
  deps: MediaResolverDeps,
  options: { fresh?: boolean } = {},
): Promise<Record<string, ResolvedMedia>> {
  const timeoutMs = deps.timeoutMs ?? MEDIA_URL_TIMEOUT_MS;
  const fresh = !!options.fresh;
  const fail = (e: unknown): MediaLoadError => (e instanceof MediaTimeoutError ? "timeout" : "url_failed");

  // Caminhos das mídias do acervo que ainda não vieram com o `storagePath`.
  const missing = refs.filter((r) => r.origin === "marketing" && !r.storagePath && r.mediaId).map((r) => r.mediaId!);
  let paths: Record<string, string> = {};
  let pathsError: MediaLoadError | null = null;
  if (missing.length > 0) {
    try {
      paths = await withTimeout(deps.mediaPaths(Array.from(new Set(missing))), timeoutMs);
    } catch (e) {
      pathsError = fail(e);
    }
  }

  const entries = await Promise.all(
    refs.map(async (ref): Promise<[string, ResolvedMedia]> => {
      try {
        let url: string | null;
        if (ref.origin === "marketing") {
          const storagePath = ref.storagePath ?? (ref.mediaId ? paths[ref.mediaId] : undefined);
          if (!storagePath) return [ref.key, { previewUrl: null, error: pathsError ?? "not_found" }];
          url = await withTimeout(deps.signMarketing(storagePath, fresh), timeoutMs);
        } else {
          if (!ref.imagePath) return [ref.key, { previewUrl: null, error: "not_found" }];
          url = await withTimeout(deps.signProduct(ref.imagePath, fresh), timeoutMs);
        }
        return [ref.key, url ? { previewUrl: url, error: null } : { previewUrl: null, error: "url_failed" }];
      } catch (e) {
        return [ref.key, { previewUrl: null, error: fail(e) }];
      }
    }),
  );
  return Object.fromEntries(entries);
}
