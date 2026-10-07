// Pré-visualização de enquadramento para Story (9:16) e Feed.
// A campanha gera um único vídeo 9:16; no Feed aparece a área central 4:5 dele.
//
// Fase C.2:
// - Mostra a imagem principal (primeira do array) com o mesmo corte que o
//   worker FFmpeg aplica: escala para cobrir × zoom, com o ponto de foco
//   centralizado e limitado às bordas (ver `focal-geometry.ts`).
// - Suporta lista completa (para prévia do slideshow futuramente); por ora
//   exibe só a principal em cada moldura.

import type { FocalPointInput } from "@/data/marketingRepo";
import { FEED_FRAME, STORY_FRAME, type FrameSize } from "@/lib/render-engine/focal-geometry";
import { FocalImage, useImageNaturalSize } from "./FocalImage";

interface Props {
  imageUrl: string | null;
  focalPoint?: FocalPointInput | null;
  className?: string;
  compact?: boolean;
}

export function CampaignFramingPreview({ imageUrl, focalPoint, className, compact = false }: Props) {
  const imageSize = useImageNaturalSize(imageUrl);
  return (
    <div className={`${compact ? "grid grid-cols-1 items-start gap-2 sm:grid-cols-2" : "grid grid-cols-2 gap-3"} ${className ?? ""}`}>
      <FrameBox
        label="Feed (área central 4:5 do vídeo)"
        aspect="4 / 5"
        frame={FEED_FRAME}
        imageSize={imageSize}
        imageUrl={imageUrl}
        focalPoint={focalPoint}
        compact={compact}
      />
      <FrameBox
        label="Story 9:16 (1080×1920)"
        aspect="9 / 16"
        frame={STORY_FRAME}
        imageSize={imageSize}
        imageUrl={imageUrl}
        focalPoint={focalPoint}
        compact={compact}
      />
    </div>
  );
}

function FrameBox({
  label,
  aspect,
  frame,
  imageSize,
  imageUrl,
  focalPoint,
  compact = false,
}: {
  label: string;
  aspect: string;
  frame: FrameSize;
  imageSize: { width: number; height: number } | null;
  imageUrl: string | null;
  focalPoint?: FocalPointInput | null;
  compact?: boolean;
}) {
  const frameClassName = compact ? "mx-auto h-[150px] w-auto max-w-full sm:h-[180px]" : "w-full";
  return (
    <div className="space-y-1">
      <div className="text-[11px] font-medium text-muted-foreground">{label}</div>
      <div
        className={`relative overflow-hidden rounded-md border bg-muted ${frameClassName}`}
        style={{ aspectRatio: aspect }}
        data-testid={`framing-${aspect.replace(/\s/g, "")}`}
      >
        {imageUrl ? (
          <FocalImage
            src={imageUrl}
            alt={`Enquadramento ${label}`}
            frame={frame}
            focalPoint={focalPoint}
            imageSize={imageSize}
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-xs text-muted-foreground">
            Selecione uma imagem
          </div>
        )}
      </div>
    </div>
  );
}
