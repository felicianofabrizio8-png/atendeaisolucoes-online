import { useCallback, useEffect, useRef, useState } from "react";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { RotateCcw } from "lucide-react";
import type { FocalPointInput } from "@/data/marketingRepo";
import {
  FEED_FRAME,
  STORY_FRAME,
  computeFocalCrop,
  normalizeFocalPoint,
  panFocalPoint,
  type FrameSize,
  type ImageSize,
} from "@/lib/render-engine/focal-geometry";
import { FocalImage, useImageNaturalSize } from "./FocalImage";

interface Props {
  open: boolean;
  imageUrl: string | null;
  initialFocal?: FocalPointInput | null;
  onCancel: () => void;
  onSave: (focal: FocalPointInput | null) => void;
}

const FRAMES = [
  { key: "feed", label: "Feed 4:5", ratio: 4 / 5, size: FEED_FRAME },
  { key: "story", label: "Story 9:16", ratio: 9 / 16, size: STORY_FRAME },
] as const;
const DEFAULT: FocalPointInput = { x: 0.5, y: 0.5, zoom: 1 };

interface DragState {
  pointerId: number;
  startX: number;
  startY: number;
  frameWidth: number;
  frameHeight: number;
  startFocal: FocalPointInput;
}

export function FocalPointEditor({ open, imageUrl, initialFocal, onCancel, onSave }: Props) {
  const [focal, setFocal] = useState<FocalPointInput>(() => normalizeFocalPoint(initialFocal));
  const [activeFrame, setActiveFrame] = useState<(typeof FRAMES)[number]["key"]>("story");
  const imageRef = useRef(imageUrl);
  const dragRef = useRef<DragState | null>(null);
  const imageSize = useImageNaturalSize(imageUrl);

  useEffect(() => {
    if (imageRef.current !== imageUrl) {
      imageRef.current = imageUrl;
      setFocal(normalizeFocalPoint(initialFocal));
      setActiveFrame("story");
    }
  }, [imageUrl, initialFocal]);

  useEffect(() => {
    if (open) setFocal(normalizeFocalPoint(initialFocal));
  }, [open, initialFocal]);

  const active = FRAMES.find((frame) => frame.key === activeFrame) ?? FRAMES[1];
  const crop = computeFocalCrop(imageSize, active.size, focal);

  // Arrastar move a imagem dentro do quadro; o foco acompanha o deslocamento.
  const startDrag = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (!imageSize) return;
      const rect = event.currentTarget.getBoundingClientRect();
      if (!(rect.width > 0) || !(rect.height > 0)) return;
      event.currentTarget.setPointerCapture?.(event.pointerId);
      dragRef.current = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        frameWidth: rect.width,
        frameHeight: rect.height,
        startFocal: focal,
      };
    },
    [focal, imageSize],
  );

  const moveDrag = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      const drag = dragRef.current;
      if (!drag || drag.pointerId !== event.pointerId) return;
      setFocal(
        panFocalPoint(
          imageSize,
          active.size,
          drag.startFocal,
          (event.clientX - drag.startX) / drag.frameWidth,
          (event.clientY - drag.startY) / drag.frameHeight,
        ),
      );
    },
    [active.size, imageSize],
  );

  const endDrag = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    event.currentTarget.releasePointerCapture?.(event.pointerId);
    dragRef.current = null;
  }, []);

  const reset = useCallback(() => setFocal(DEFAULT), []);

  return (
    <Dialog open={open} onOpenChange={(value) => !value && onCancel()}>
      <DialogContent className="flex max-h-[92vh] w-[calc(100vw-1rem)] max-w-3xl flex-col gap-0 overflow-hidden p-4 sm:w-full sm:p-6">
        <DialogHeader className="shrink-0 pb-3">
          <DialogTitle>Ajustar enquadramento</DialogTitle>
          <DialogDescription>
            Escolha Feed ou Story, arraste a imagem e ajuste o zoom. O mesmo enquadramento será usado no arquivo final.
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto pr-1">
          {imageUrl ? (
            <div className="space-y-4">
              <div className="flex flex-wrap gap-2" role="tablist" aria-label="Formato do enquadramento">
                {FRAMES.map((frame) => (
                  <Button
                    key={frame.key}
                    type="button"
                    size="sm"
                    variant={activeFrame === frame.key ? "default" : "outline"}
                    onClick={() => setActiveFrame(frame.key)}
                    role="tab"
                    aria-selected={activeFrame === frame.key}
                  >
                    {frame.label}
                  </Button>
                ))}
              </div>

              <div
                className="relative mx-auto h-[48vh] max-h-[calc(100vw-2rem)] w-auto max-w-full overflow-hidden rounded-md border bg-muted select-none touch-none cursor-move"
                style={{ aspectRatio: String(active.ratio) }}
                data-testid="focal-frame"
                onPointerDown={startDrag}
                onPointerMove={moveDrag}
                onPointerUp={endDrag}
                onPointerCancel={endDrag}
              >
                <FocalImage
                  src={imageUrl}
                  alt={`Ajuste de enquadramento para ${active.label}`}
                  frame={active.size}
                  focalPoint={focal}
                  imageSize={imageSize}
                  className="pointer-events-none"
                />
                {crop && (
                  <div
                    className="absolute pointer-events-none"
                    data-testid="focal-marker"
                    style={{
                      left: `${crop.markerXPct.toFixed(2)}%`,
                      top: `${crop.markerYPct.toFixed(2)}%`,
                      transform: "translate(-50%, -50%)",
                    }}
                  >
                    <div className="h-8 w-8 rounded-full border-2 border-primary bg-primary/20 shadow-lg" />
                    <div className="absolute left-1/2 top-1/2 h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-primary" />
                  </div>
                )}
                <div className="absolute inset-0 pointer-events-none border border-white/50" />
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <Label className="mb-2 block">
                    Zoom: <span className="font-semibold text-primary">{focal.zoom.toFixed(2)}x</span>
                  </Label>
                  <input
                    aria-label="Zoom do enquadramento"
                    type="range"
                    min={1}
                    max={3}
                    step={0.05}
                    value={focal.zoom}
                    onChange={(event) => setFocal((prev) => ({ ...prev, zoom: Number(event.target.value) }))}
                    className="h-6 w-full accent-primary"
                  />
                  <p className="mt-1 text-xs text-muted-foreground">
                    Arraste a imagem para manter o assunto dentro da área segura.
                  </p>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  {FRAMES.map((frame) => (
                    <FramePreview
                      key={frame.key}
                      label={frame.label}
                      ratio={frame.ratio}
                      frame={frame.size}
                      imageUrl={imageUrl}
                      imageSize={imageSize}
                      focal={focal}
                    />
                  ))}
                </div>
              </div>
            </div>
          ) : (
            <div className="p-8 text-center text-sm text-muted-foreground">Nenhuma imagem carregada.</div>
          )}
        </div>

        <DialogFooter className="sticky bottom-0 z-10 mt-3 shrink-0 flex-wrap gap-2 border-t bg-background pt-3 sm:justify-between">
          <Button type="button" variant="ghost" onClick={() => { reset(); onSave(null); }}>
            <RotateCcw className="mr-1 h-4 w-4" /> Redefinir
          </Button>
          <div className="flex min-w-0 flex-1 justify-end gap-2">
            <Button type="button" variant="outline" onClick={onCancel}>Cancelar</Button>
            <Button type="button" onClick={() => onSave(focal)}>Salvar enquadramento</Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function FramePreview({ label, ratio, frame, imageUrl, imageSize, focal }: { label: string; ratio: number; frame: FrameSize; imageUrl: string; imageSize: ImageSize | null; focal: FocalPointInput }) {
  return (
    <div className="min-w-0 space-y-1">
      <div className="truncate text-[11px] font-medium text-muted-foreground">{label}</div>
      <div className="relative overflow-hidden rounded-md border bg-muted" style={{ aspectRatio: String(ratio) }}>
        <FocalImage src={imageUrl} alt={`Prévia ${label}`} frame={frame} focalPoint={focal} imageSize={imageSize} />
      </div>
    </div>
  );
}
