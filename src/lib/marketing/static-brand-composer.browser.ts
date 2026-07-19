/**
 * Static Brand Composer — helper client-only.
 *
 * Rasteriza um `StaticBrandCompositionPlan` sobre a imagem-base usando o
 * `<canvas>` do navegador. Este arquivo NÃO deve ser importado por
 * server functions — depende de APIs de DOM.
 *
 * Fluxo:
 *   1. Carrega a imagem-base numa `HTMLImageElement`.
 *   2. Desenha em canvas na resolução alvo.
 *   3. Pinta os overlays (solid + gradient).
 *   4. Desenha as regiões de texto com as fontes já resolvidas.
 *   5. Desenha a logo (se presente), preservando proporção.
 *   6. Exporta como Blob (image/jpeg por padrão).
 *
 * Fallbacks:
 *  - Falha ao baixar/decodificar logo → segue sem logo e emite warning.
 *  - Falha ao baixar imagem-base → lança erro controlado.
 */

import type {
  LogoPlacement,
  OverlayLayer,
  StaticBrandCompositionPlan,
  TextRegion,
} from "./static-brand-composer";

export interface RasterizeOptions {
  /** MIME final. Default: image/jpeg. */
  mimeType?: "image/jpeg" | "image/png" | "image/webp";
  /** Qualidade (0..1). Default 0.92. */
  quality?: number;
}

export interface RasterizeResult {
  blob: Blob;
  width: number;
  height: number;
  mimeType: string;
  warnings: string[];
}

export async function rasterizeStaticBrandComposition(
  baseImageHref: string,
  plan: StaticBrandCompositionPlan,
  opts: RasterizeOptions = {},
): Promise<RasterizeResult> {
  if (typeof document === "undefined") {
    throw new Error("rasterize_requires_browser");
  }
  const warnings = [...plan.warnings];
  const canvas = document.createElement("canvas");
  canvas.width = plan.canvas.width;
  canvas.height = plan.canvas.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("canvas_context_unavailable");

  // 1. Base image
  const base = await loadImage(baseImageHref).catch(() => {
    throw new Error("base_image_load_failed");
  });
  ctx.drawImage(base, 0, 0, canvas.width, canvas.height);

  // 2. Overlays
  for (const layer of plan.overlays) drawOverlay(ctx, layer, canvas.width, canvas.height);

  // 3. Text
  for (const r of plan.textRegions) drawText(ctx, r);

  // 4. Logo (best-effort)
  if (plan.logo) {
    try {
      const logoImg = await loadImage(plan.logo.href);
      drawLogo(ctx, logoImg, plan.logo);
    } catch {
      warnings.push("logo_load_failed");
    }
  }

  const mimeType = opts.mimeType ?? "image/jpeg";
  const quality = opts.quality ?? 0.92;
  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error("canvas_export_failed"))),
      mimeType,
      quality,
    );
  });
  return { blob, width: canvas.width, height: canvas.height, mimeType, warnings };
}

// ---------------------------------------------------------------------------
// Internos
// ---------------------------------------------------------------------------

function loadImage(href: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("image_load_error"));
    img.src = href;
  });
}

function drawOverlay(
  ctx: CanvasRenderingContext2D,
  layer: OverlayLayer,
  w: number,
  h: number,
): void {
  ctx.save();
  ctx.globalAlpha = layer.opacity;
  if (layer.kind === "solid") {
    ctx.fillStyle = layer.colorStops[0]?.color ?? "#000000";
    ctx.fillRect(0, 0, w, h);
  } else {
    const rad = (layer.angle * Math.PI) / 180;
    const x1 = w / 2 - (Math.cos(rad) * w) / 2;
    const y1 = h / 2 - (Math.sin(rad) * h) / 2;
    const x2 = w / 2 + (Math.cos(rad) * w) / 2;
    const y2 = h / 2 + (Math.sin(rad) * h) / 2;
    const grad = ctx.createLinearGradient(x1, y1, x2, y2);
    for (const s of layer.colorStops) grad.addColorStop(s.offset, s.color);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);
  }
  ctx.restore();
}

function drawText(ctx: CanvasRenderingContext2D, r: TextRegion): void {
  ctx.save();
  ctx.font = `${r.fontWeight} ${r.fontSizePx}px ${r.fontFamily}`;
  ctx.fillStyle = r.color;
  ctx.textAlign = r.textAlign;
  ctx.textBaseline = "alphabetic";
  ctx.shadowColor = "rgba(0,0,0,0.35)";
  ctx.shadowBlur = Math.round(r.fontSizePx * 0.15);
  ctx.fillText(r.text, r.x, r.y, r.maxWidth);
  ctx.restore();
}

function drawLogo(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  placement: LogoPlacement,
): void {
  ctx.save();
  ctx.drawImage(img, placement.x, placement.y, placement.width, placement.height);
  ctx.restore();
}
