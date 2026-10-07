// Imagem posicionada com o mesmo corte que o worker aplica no vídeo final.
// Enquanto as dimensões reais não são conhecidas, mostra a imagem centralizada.

import { useEffect, useState, type CSSProperties } from "react";
import type { FocalPointInput } from "@/data/marketingRepo";
import {
  computeFocalCrop,
  type FrameSize,
  type ImageSize,
} from "@/lib/render-engine/focal-geometry";

/** Dimensões reais (naturalWidth/naturalHeight) da imagem em `url`. */
export function useImageNaturalSize(url: string | null | undefined): ImageSize | null {
  const [loaded, setLoaded] = useState<{ url: string; size: ImageSize } | null>(null);

  useEffect(() => {
    if (!url || typeof Image === "undefined") return;
    let cancelled = false;
    const probe = new Image();
    probe.onload = () => {
      if (cancelled || !(probe.naturalWidth > 0) || !(probe.naturalHeight > 0)) return;
      setLoaded({ url, size: { width: probe.naturalWidth, height: probe.naturalHeight } });
    };
    probe.src = url;
    return () => {
      cancelled = true;
      probe.onload = null;
    };
  }, [url]);

  return loaded && loaded.url === url ? loaded.size : null;
}

export function focalImageStyle(
  size: ImageSize | null | undefined,
  frame: FrameSize,
  focalPoint?: FocalPointInput | null,
): CSSProperties | null {
  const crop = computeFocalCrop(size, frame, focalPoint);
  if (!crop) return null;
  return {
    left: `${crop.leftPct.toFixed(4)}%`,
    top: `${crop.topPct.toFixed(4)}%`,
    width: `${crop.widthPct.toFixed(4)}%`,
    height: `${crop.heightPct.toFixed(4)}%`,
    maxWidth: "none",
    maxHeight: "none",
  };
}

interface Props {
  src: string;
  alt: string;
  frame: FrameSize;
  focalPoint?: FocalPointInput | null;
  /** Dimensões já conhecidas pelo componente pai; evita medir de novo. */
  imageSize?: ImageSize | null;
  className?: string;
  style?: CSSProperties;
}

export function FocalImage({ src, alt, frame, focalPoint, imageSize, className, style }: Props) {
  const measured = useImageNaturalSize(imageSize === undefined ? src : null);
  const cropStyle = focalImageStyle(imageSize ?? measured, frame, focalPoint);
  return (
    <img
      src={src}
      alt={alt}
      draggable={false}
      className={`absolute ${cropStyle ? "" : "inset-0 h-full w-full object-cover"} ${className ?? ""}`}
      style={{ ...style, ...(cropStyle ?? {}) }}
    />
  );
}
