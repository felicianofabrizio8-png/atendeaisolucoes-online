import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { RotateCcw } from "lucide-react";
import type { FocalPointInput } from "@/data/marketingRepo";
import { focalPointObjectPosition, focalPointTransform, normalizeFocalPoint } from "@/lib/render-engine/focal-geometry";

interface Props {
  open: boolean;
  imageUrl: string | null;
  initialFocal?: FocalPointInput | null;
  onCancel: () => void;
  onSave: (focal: FocalPointInput | null) => void;
}

const FRAMES = [
  { key: "feed", label: "Feed 4:5", ratio: 4 / 5 },
  { key: "story", label: "Story 9:16", ratio: 9 / 16 },
] as const;
const DEFAULT: FocalPointInput = { x: 0.5, y: 0.5, zoom: 1 };

export function FocalPointEditor({ open, imageUrl, initialFocal, onCancel, onSave }: Props) {
  const [focal, setFocal] = useState<FocalPointInput>(() => normalizeFocalPoint(initialFocal));
  const [activeFrame, setActiveFrame] = useState<(typeof FRAMES)[number]["key"]>("story");
  const imageRef = useRef(imageUrl);

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
  const objectPosition = useMemo(() => focalPointObjectPosition(focal), [focal]);
  const transform = useMemo(() => focalPointTransform(focal), [focal]);


  const handlePointer = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (e.buttons !== 1 && e.type !== "pointerdown") return;
    const rect = e.currentTarget.getBoundingClientRect();
    setFocal((prev) => ({
      ...prev,
      x: Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width)),
      y: Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height)),
    }));
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
                onPointerDown={(event) => {
                  event.currentTarget.setPointerCapture?.(event.pointerId);
                  handlePointer(event);
                }}
                onPointerMove={handlePointer}
                onPointerUp={(event) => event.currentTarget.releasePointerCapture?.(event.pointerId)}
                onPointerCancel={(event) => event.currentTarget.releasePointerCapture?.(event.pointerId)}
              >
                <img
                  src={imageUrl}
                  alt={`Ajuste de enquadramento para ${active.label}`}
                  className="absolute inset-0 h-full w-full object-cover pointer-events-none transition-transform"
                  style={{ objectPosition, transform, transformOrigin: objectPosition }}
                  draggable={false}
                />
                <div
                  className="absolute pointer-events-none"
                  style={{ left: `${focal.x * 100}%`, top: `${focal.y * 100}%`, transform: "translate(-50%, -50%)" }}
                >
                  <div className="h-8 w-8 rounded-full border-2 border-primary bg-primary/20 shadow-lg" />
                  <div className="absolute left-1/2 top-1/2 h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-primary" />
                </div>
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
                      imageUrl={imageUrl}
                      objectPosition={objectPosition}
                      transform={transform}
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

function FramePreview({ label, ratio, imageUrl, objectPosition, transform }: { label: string; ratio: number; imageUrl: string; objectPosition: string; transform?: string }) {
  return (
    <div className="min-w-0 space-y-1">
      <div className="truncate text-[11px] font-medium text-muted-foreground">{label}</div>
      <div className="relative overflow-hidden rounded-md border bg-muted" style={{ aspectRatio: String(ratio) }}>
        <img
          src={imageUrl}
          alt={`Prévia ${label}`}
          className="absolute inset-0 h-full w-full object-cover"
          style={{ objectPosition, transform, transformOrigin: objectPosition }}
        />
      </div>
    </div>
  );
}