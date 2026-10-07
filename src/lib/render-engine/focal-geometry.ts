import type { FocalPointInput } from "@/data/marketingRepo";

export const DEFAULT_FOCAL_POINT: FocalPointInput = { x: 0.5, y: 0.5, zoom: 1 };

export function normalizeFocalPoint(focal?: FocalPointInput | null): FocalPointInput {
  return {
    x: clamp(Number(focal?.x ?? 0.5), 0, 1),
    y: clamp(Number(focal?.y ?? 0.5), 0, 1),
    zoom: clamp(Number(focal?.zoom ?? 1), 1, 3),
  };
}

export function focalPointObjectPosition(focal?: FocalPointInput | null): string {
  const value = normalizeFocalPoint(focal);
  return `${(value.x * 100).toFixed(1)}% ${(value.y * 100).toFixed(1)}%`;
}

export function focalPointTransform(focal?: FocalPointInput | null): string | undefined {
  const value = normalizeFocalPoint(focal);
  return value.zoom > 1 ? `scale(${value.zoom})` : undefined;
}

function clamp(value: number, min: number, max: number): number {
  return Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : min;
}
