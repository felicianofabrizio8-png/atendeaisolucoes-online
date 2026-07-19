/**
 * Orquestrador client-only — Fase 4.1 do Brand Center.
 *
 * Une a geração de imagem-base (Marketing IA) com o compositor determinístico
 * de identidade visual. Chamado logo após receber o `b64_json` da API de
 * geração e ANTES de exibir/salvar/aprovar a imagem.
 *
 * Contrato:
 *   1. Recebe uma imagem-base (dataURL ou signed URL) e o formato do fluxo
 *      atual (`feed_1080` | `story_1920` | `whatsapp_status` | `facebook_feed`).
 *   2. Se o formato não mapeia para um formato suportado pelo compositor
 *      (ex.: facebook_feed 16:9), devolve a imagem original — fallback puro.
 *   3. Consulta o servidor via `prepareBrandComposition`. Quando não há marca
 *      publicada, devolve original.
 *   4. Rasteriza no browser via `rasterizeStaticBrandComposition` e devolve
 *      um novo dataURL (image/jpeg qualidade 0,92 por padrão).
 *   5. Qualquer falha (network, canvas, CORS de logo) usa a imagem-base como
 *      fallback e registra warning sanitizado — nunca quebra a UX.
 *
 * REGRAS
 *  - Nunca persiste signed URL da logo. O plano trafega apenas em memória
 *    do request. O snapshot devolvido (sanitizado) pode ser salvo.
 *  - Não acessa storage, tabelas brand_* nem executa lógica de marca.
 *  - Idempotente: chamar duas vezes com o mesmo input produz mesmo plano
 *    (o compositor é determinístico).
 */

import { rasterizeStaticBrandComposition } from "./static-brand-composer.client";
import type { StaticBrandCompositionSnapshot } from "./static-brand-composer";
import { prepareBrandComposition as defaultPrepareBrandComposition } from "./static-brand-composer.functions";

export type CreativeFormat =
  | "feed_1080"
  | "story_1920"
  | "facebook_feed"
  | "whatsapp_status";

export interface ApplyBrandCompositionInput {
  dataUrl: string;
  format: CreativeFormat;
  content?: {
    headline?: string | null;
    subheadline?: string | null;
    price?: string | null;
    callToAction?: string | null;
  };
}

export interface ApplyBrandCompositionResult {
  dataUrl: string;
  applied: boolean;
  snapshot: StaticBrandCompositionSnapshot | null;
  warnings: string[];
  /** Código sanitizado do motivo do fallback, quando applicable. */
  fallbackReason?: string;
}

interface Deps {
  prepareBrandComposition?: typeof defaultPrepareBrandComposition;
  /** Injetável para teste em Node (sem DOM). */
  measureImage?: (
    dataUrl: string,
  ) => Promise<{ width: number; height: number; mimeType: string }>;
  /** Injetável para teste. Recebe href e devolve blob. */
  rasterize?: typeof rasterizeStaticBrandComposition;
}

const FORMAT_MAP: Record<
  CreativeFormat,
  | { supported: true; format: "feed_1_1" | "story_9_16"; width: number; height: number }
  | { supported: false }
> = {
  feed_1080: { supported: true, format: "feed_1_1", width: 1080, height: 1080 },
  story_1920: { supported: true, format: "story_9_16", width: 1080, height: 1920 },
  whatsapp_status: { supported: true, format: "story_9_16", width: 1080, height: 1920 },
  // Facebook Feed 16:9 não faz parte do escopo estático do Brand Center Fase 4.
  facebook_feed: { supported: false },
};

export async function applyBrandCompositionToDataUrl(
  input: ApplyBrandCompositionInput,
  deps: Deps = {},
): Promise<ApplyBrandCompositionResult> {
  const mapping = FORMAT_MAP[input.format];
  if (!mapping.supported) {
    return {
      dataUrl: input.dataUrl,
      applied: false,
      snapshot: null,
      warnings: [],
      fallbackReason: "format_unsupported",
    };
  }

  const measure = deps.measureImage ?? measureImageFromDataUrl;
  const prepare = deps.prepareBrandComposition ?? defaultPrepareBrandComposition;
  const rasterize = deps.rasterize ?? rasterizeStaticBrandComposition;

  let baseMeta: { width: number; height: number; mimeType: string };
  try {
    baseMeta = await measure(input.dataUrl);
  } catch {
    return {
      dataUrl: input.dataUrl,
      applied: false,
      snapshot: null,
      warnings: [],
      fallbackReason: "base_image_measure_failed",
    };
  }

  let result: Awaited<ReturnType<typeof prepare>>;
  try {
    result = await prepare({
      data: {
        format: mapping.format,
        canvas: { width: mapping.width, height: mapping.height },
        baseImage: baseMeta,
        content: input.content ?? undefined,
      },
    });
  } catch {
    return {
      dataUrl: input.dataUrl,
      applied: false,
      snapshot: null,
      warnings: ["brand_prepare_failed"],
      fallbackReason: "prepare_failed",
    };
  }

  if (!result.applied || !result.plan) {
    return {
      dataUrl: input.dataUrl,
      applied: false,
      snapshot: result.snapshot,
      warnings: result.warnings,
      fallbackReason: result.reason ?? "no_brand",
    };
  }

  try {
    const raster = await rasterize(input.dataUrl, result.plan, {
      mimeType: "image/jpeg",
      quality: 0.92,
    });
    const dataUrl = await blobToDataUrl(raster.blob);
    return {
      dataUrl,
      applied: true,
      snapshot: result.snapshot,
      warnings: [...result.warnings, ...raster.warnings],
    };
  } catch {
    return {
      dataUrl: input.dataUrl,
      applied: false,
      snapshot: result.snapshot,
      warnings: [...result.warnings, "rasterize_failed"],
      fallbackReason: "rasterize_failed",
    };
  }
}

// ---------------------------------------------------------------------------
// Helpers (browser-only). Substituíveis em testes via `deps.measureImage`.
// ---------------------------------------------------------------------------

async function measureImageFromDataUrl(
  href: string,
): Promise<{ width: number; height: number; mimeType: string }> {
  if (typeof document === "undefined") throw new Error("no_dom");
  const img = new Image();
  img.crossOrigin = "anonymous";
  const loaded = new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = () => reject(new Error("image_load_error"));
  });
  img.src = href;
  await loaded;
  const mimeType = href.startsWith("data:")
    ? href.slice(5, href.indexOf(";"))
    : "image/png";
  return {
    width: img.naturalWidth || img.width,
    height: img.naturalHeight || img.height,
    mimeType: mimeType || "image/png",
  };
}

async function blobToDataUrl(blob: Blob): Promise<string> {
  if (typeof FileReader !== "undefined") {
    return await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result ?? ""));
      reader.onerror = () => reject(new Error("blob_read_failed"));
      reader.readAsDataURL(blob);
    });
  }
  // Fallback ambiente Node (testes): usa arrayBuffer + base64.
  const buf = await blob.arrayBuffer();
  const b64 = Buffer.from(buf).toString("base64");
  return `data:${blob.type || "application/octet-stream"};base64,${b64}`;
}
