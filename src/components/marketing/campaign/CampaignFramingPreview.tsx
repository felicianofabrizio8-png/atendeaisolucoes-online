// Pré-visualização de enquadramento para Feed (4:5) e Story (9:16).
//
// Fase C.2:
// - Mostra a imagem principal (primeira do array) já com o focal point aplicado
//   via `object-position`. O worker FFmpeg aplica exatamente o mesmo crop, então
//   o preview é WYSIWYG.
// - Aceita zoom via `focalPoint.zoom` — reproduzido com `scale()` sobre a img
//   dentro da moldura.
// - Suporta lista completa (para prévia do slideshow futuramente); por ora
//   exibe só a principal em cada moldura.

import type { FocalPointInput } from "@/data/marketingRepo";

interface Props {
  imageUrl: string | null;
  focalPoint?: FocalPointInput | null;
  className?: string;
}

export function CampaignFramingPreview({ imageUrl, focalPoint, className }: Props) {
  return (
    <div className={`grid grid-cols-2 gap-3 ${className ?? ""}`}>
      <FrameBox
        label="Feed 4:5 (1080×1350)"
        aspect="4 / 5"
        imageUrl={imageUrl}
        focalPoint={focalPoint}
      />
      <FrameBox
        label="Story 9:16 (1080×1920)"
        aspect="9 / 16"
        imageUrl={imageUrl}
        focalPoint={focalPoint}
      />
    </div>
  );
}

function FrameBox({
  label,
  aspect,
  imageUrl,
  focalPoint,
}: {
  label: string;
  aspect: string;
  imageUrl: string | null;
  focalPoint?: FocalPointInput | null;
}) {
  const objectPosition = focalPoint
    ? `${(focalPoint.x * 100).toFixed(1)}% ${(focalPoint.y * 100).toFixed(1)}%`
    : "50% 50%";
  const zoom = focalPoint?.zoom && focalPoint.zoom > 1 ? focalPoint.zoom : 1;
  return (
    <div className="space-y-1">
      <div className="text-[11px] font-medium text-muted-foreground">{label}</div>
      <div
        className="relative overflow-hidden rounded-md border bg-muted"
        style={{ aspectRatio: aspect }}
        data-testid={`framing-${aspect.replace(/\s/g, "")}`}
      >
        {imageUrl ? (
          <img
            src={imageUrl}
            alt={`Enquadramento ${label}`}
            className="absolute inset-0 h-full w-full object-cover transition-all"
            style={{
              objectPosition,
              transform: zoom !== 1 ? `scale(${zoom})` : undefined,
              transformOrigin: objectPosition,
            }}
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
