// Geometria do enquadramento usada pelas prévias.
//
// Reproduz a conta de `buildFocalVideoFilter` (worker/render-engine/src/ffmpeg.ts):
//   1. escala a imagem para cobrir o quadro e multiplica pelo zoom;
//   2. corta o quadro centralizando o ponto de foco, limitado às bordas.
// A conta depende da proporção real da imagem, por isso exige suas dimensões.
//
// A campanha gera UM vídeo master 9:16 (1080×1920), usado em Feed e Story.
// No Feed as redes exibem a área central 4:5 desse mesmo vídeo; por isso a
// prévia de Feed é uma janela sobre o quadro do Story, não um corte próprio.

import type { FocalPointInput } from "@/data/marketingRepo";

export interface ImageSize {
  width: number;
  height: number;
}

export interface FrameSize {
  /** Quadro renderizado pelo worker. */
  width: number;
  height: number;
  /** Parte do quadro renderizado que a prévia mostra (padrão: o quadro todo). */
  window?: { x: number; y: number; width: number; height: number };
}

export const STORY_FRAME: FrameSize = { width: 1080, height: 1920 };
/** Área central 4:5 do master 9:16, como o vídeo aparece no Feed. */
export const FEED_FRAME: FrameSize = {
  width: 1080,
  height: 1920,
  window: { x: 0, y: (1920 - 1350) / 2, width: 1080, height: 1350 },
};

export const DEFAULT_FOCAL_POINT: FocalPointInput = { x: 0.5, y: 0.5, zoom: 1 };

export interface FocalCrop {
  /** Posição e tamanho da imagem escalada, em % da área exibida. */
  leftPct: number;
  topPct: number;
  widthPct: number;
  heightPct: number;
  /** Fração da imagem que cabe no quadro renderizado em cada eixo (1 = sem sobra). */
  visibleX: number;
  visibleY: number;
  /** Centro efetivo do corte, em fração da imagem (já limitado às bordas). */
  centerX: number;
  centerY: number;
  /** Quanto do foco (fração da imagem) corresponde a arrastar 100% da área exibida. */
  panScaleX: number;
  panScaleY: number;
  /** Onde o ponto de foco aparece dentro da área exibida, em % (pode sair de 0–100). */
  markerXPct: number;
  markerYPct: number;
}

export function normalizeFocalPoint(focal?: FocalPointInput | null): FocalPointInput {
  return {
    x: clamp(Number(focal?.x ?? 0.5), 0, 1),
    y: clamp(Number(focal?.y ?? 0.5), 0, 1),
    zoom: clamp(Number(focal?.zoom ?? 1), 1, 3),
  };
}

export function isUsableSize(size?: ImageSize | FrameSize | null): size is ImageSize {
  return (
    !!size &&
    Number.isFinite(size.width) &&
    Number.isFinite(size.height) &&
    size.width > 0 &&
    size.height > 0
  );
}

/** Corte que o worker aplica para esta imagem, quadro e foco. `null` sem dimensões válidas. */
export function computeFocalCrop(
  image: ImageSize | null | undefined,
  frame: FrameSize,
  focal?: FocalPointInput | null,
): FocalCrop | null {
  if (!isUsableSize(image) || !isUsableSize(frame)) return null;
  const view = frame.window ?? { x: 0, y: 0, width: frame.width, height: frame.height };
  if (!isUsableSize(view)) return null;
  const { x, y, zoom } = normalizeFocalPoint(focal);
  const scale = Math.max(frame.width / image.width, frame.height / image.height) * zoom;
  const scaledW = image.width * scale;
  const scaledH = image.height * scale;
  const offsetX = clamp(x * scaledW - frame.width / 2, 0, Math.max(0, scaledW - frame.width));
  const offsetY = clamp(y * scaledH - frame.height / 2, 0, Math.max(0, scaledH - frame.height));
  return {
    // `0 - n` evita -0 quando não há deslocamento.
    leftPct: 0 - ((offsetX + view.x) / view.width) * 100,
    topPct: 0 - ((offsetY + view.y) / view.height) * 100,
    widthPct: (scaledW / view.width) * 100,
    heightPct: (scaledH / view.height) * 100,
    visibleX: Math.min(1, frame.width / scaledW),
    visibleY: Math.min(1, frame.height / scaledH),
    centerX: (offsetX + frame.width / 2) / scaledW,
    centerY: (offsetY + frame.height / 2) / scaledH,
    panScaleX: view.width / scaledW,
    panScaleY: view.height / scaledH,
    markerXPct: ((x * scaledW - offsetX - view.x) / view.width) * 100,
    markerYPct: ((y * scaledH - offsetY - view.y) / view.height) * 100,
  };
}

/**
 * Novo foco após arrastar a imagem dentro da área exibida. `dxFrame`/`dyFrame`
 * são o deslocamento do cursor em fração dessa área (positivo = direita/baixo).
 * Eixo sem sobra no quadro renderizado, ou sem movimento, mantém o valor salvo.
 */
export function panFocalPoint(
  image: ImageSize | null | undefined,
  frame: FrameSize,
  focal: FocalPointInput | null | undefined,
  dxFrame: number,
  dyFrame: number,
): FocalPointInput {
  const current = normalizeFocalPoint(focal);
  const crop = computeFocalCrop(image, frame, current);
  if (!crop) return current;
  return {
    x: panAxis(current.x, crop.centerX, crop.visibleX, crop.panScaleX, dxFrame),
    y: panAxis(current.y, crop.centerY, crop.visibleY, crop.panScaleY, dyFrame),
    zoom: current.zoom,
  };
}

function panAxis(saved: number, center: number, visible: number, panScale: number, delta: number): number {
  if (!Number.isFinite(delta) || delta === 0 || visible >= 1 - 1e-9) return saved;
  const next = clamp(center - delta * panScale, visible / 2, 1 - visible / 2);
  return Math.round(next * 10000) / 10000;
}

function clamp(value: number, min: number, max: number): number {
  return Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : min;
}
