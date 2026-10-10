// ============================================================================
// Enquadramento da imagem — FONTE ÚNICA da conta, usada pela prévia do app e
// pelo worker (que a traduz para expressões do FFmpeg em `ffmpeg.ts`).
//
// Dois modos:
//   - "contain": a imagem aparece INTEIRA dentro da área livre do modelo (um
//     celular não perde o topo, um carro não perde a frente). O que sobra do
//     quadro é preenchido com um desfoque da própria foto ou com a cor do
//     modelo. `zoom` amplia a partir do ajuste; `x`/`y` posicionam.
//   - "cover": a imagem cobre a área (pode cortar). `x`/`y` são o ponto de foco
//     mantido no centro; `zoom` amplia. É o comportamento histórico.
//
// Puro: sem IO.
// ============================================================================

export type ImageFit = "contain" | "cover";
export type ImageFill = "blur" | "color";

export interface ImageFraming {
  /** 0..1 — alinhamento (contain) ou ponto de foco (cover). */
  x: number;
  y: number;
  /** 1..3 */
  zoom: number;
  fit: ImageFit;
  /** Como preencher o que a imagem não cobre. */
  fill: ImageFill;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export const IMAGE_FITS: readonly ImageFit[] = ["contain", "cover"];
export const IMAGE_FILLS: readonly ImageFill[] = ["blur", "color"];

function clamp(v: unknown, min: number, max: number, fallback: number): number {
  const n = typeof v === "number" ? v : Number.NaN;
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
}

/**
 * Normaliza o enquadramento salvo.
 *  - Sem nada salvo → o padrão do modelo (seguro: "contain").
 *  - Salvo sem `fit` (formato antigo, só x/y/zoom) → "cover": era um corte
 *    escolhido à mão e continua valendo como estava.
 */
export function normalizeFraming(
  raw: unknown,
  defaults: { fit: ImageFit; fill: ImageFill },
): ImageFraming {
  if (!raw || typeof raw !== "object") return { x: 0.5, y: 0.5, zoom: 1, fit: defaults.fit, fill: defaults.fill };
  const o = raw as Record<string, unknown>;
  return {
    x: clamp(o.x, 0, 1, 0.5),
    y: clamp(o.y, 0, 1, 0.5),
    zoom: clamp(o.zoom, 1, 3, 1),
    fit: IMAGE_FITS.includes(o.fit as ImageFit) ? (o.fit as ImageFit) : "cover",
    fill: IMAGE_FILLS.includes(o.fill as ImageFill) ? (o.fill as ImageFill) : defaults.fill,
  };
}

export interface ImageAreas {
  /** Onde a imagem inteira deve caber no modo "contain". */
  contain: Rect;
  /** O que a imagem deve cobrir no modo "cover". */
  cover: Rect;
}

/** Retângulo (px do quadro) onde a imagem é desenhada. Pode exceder o quadro. */
export function placeImage(image: { width: number; height: number }, areas: ImageAreas, framing: ImageFraming): Rect {
  const { width: iw, height: ih } = image;
  if (framing.fit === "contain") {
    const a = areas.contain;
    const scale = Math.min(a.width / iw, a.height / ih) * framing.zoom;
    const width = iw * scale;
    const height = ih * scale;
    return { x: a.x + (a.width - width) * framing.x, y: a.y + (a.height - height) * framing.y, width, height };
  }
  const a = areas.cover;
  const scale = Math.max(a.width / iw, a.height / ih) * framing.zoom;
  const width = iw * scale;
  const height = ih * scale;
  const offsetX = Math.min(Math.max(framing.x * width - a.width / 2, 0), Math.max(0, width - a.width));
  const offsetY = Math.min(Math.max(framing.y * height - a.height / 2, 0), Math.max(0, height - a.height));
  return { x: a.x - offsetX, y: a.y - offsetY, width, height };
}

/** A imagem aparece inteira dentro do quadro? (prova do "produto não cortado") */
export function isFullyVisible(rect: Rect, frame: { width: number; height: number }, tolerance = 0.5): boolean {
  return (
    rect.x >= -tolerance &&
    rect.y >= -tolerance &&
    rect.x + rect.width <= frame.width + tolerance &&
    rect.y + rect.height <= frame.height + tolerance
  );
}

/**
 * O worker precisa montar o quadro da imagem antes do render? Só o caso
 * histórico (cobrir o quadro inteiro) segue pelo filtro antigo, intocado.
 */
export function needsPreparedFrame(framing: ImageFraming, areas: ImageAreas, frame: { width: number; height: number }): boolean {
  if (framing.fit === "contain") return true;
  const c = areas.cover;
  return !(c.x === 0 && c.y === 0 && c.width === frame.width && c.height === frame.height);
}
