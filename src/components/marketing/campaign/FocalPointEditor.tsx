// Editor visual de focal point. Recebe uma imagem e um valor {x,y,zoom} e
// permite reposicionar arrastando + ajustar o zoom via slider.
// Salva coordenadas normalizadas ∈ [0,1] (x,y) e zoom ∈ [1,3].
//
// O crop final é aplicado pelo worker FFmpeg (mesmas coordenadas), então o
// preview aqui é WYSIWYG dentro da moldura escolhida (Feed 4:5 ou Story 9:16).

import { useCallback, useMemo, useRef, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { RotateCcw } from "lucide-react";
import type { FocalPointInput } from "@/data/marketingRepo";

interface Props {
  open: boolean;
  imageUrl: string | null;
  initialFocal?: FocalPointInput | null;
  onCancel: () => void;
  onSave: (focal: FocalPointInput | null) => void;
}

const FRAMES = [
  { label: "Feed 4:5", ratio: 4 / 5 },
  { label: "Story 9:16", ratio: 9 / 16 },
];

export function FocalPointEditor({
  open,
  imageUrl,
  initialFocal,
  onCancel,
  onSave,
}: Props) {
  const [focal, setFocal] = useState<FocalPointInput>(
    initialFocal ?? { x: 0.5, y: 0.5, zoom: 1 },
  );

  // reset quando muda a imagem
  const keyRef = useRef(imageUrl);
  if (keyRef.current !== imageUrl) {
    keyRef.current = imageUrl;
    setFocal(initialFocal ?? { x: 0.5, y: 0.5, zoom: 1 });
  }

  const objectPosition = useMemo(
    () => `${(focal.x * 100).toFixed(1)}% ${(focal.y * 100).toFixed(1)}%`,
    [focal.x, focal.y],
  );

  const handlePointer = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (e.buttons !== 1 && e.type !== "pointerdown") return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const y = Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height));
    setFocal((prev) => ({ ...prev, x, y }));
  }, []);

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onCancel()}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Ajustar enquadramento</DialogTitle>
          <DialogDescription>
            Clique e arraste sobre a imagem para escolher o ponto de foco. O
            corte respeita esse ponto em todos os formatos.
          </DialogDescription>
        </DialogHeader>

        {imageUrl ? (
          <div className="space-y-4">
            <div
              className="relative w-full max-h-[50vh] rounded-md overflow-hidden border bg-muted select-none touch-none"
              onPointerDown={handlePointer}
              onPointerMove={handlePointer}
            >
              {/* imagem "solta" no fundo */}
              <img
                src={imageUrl}
                alt="Ajuste de enquadramento"
                className="block w-full h-auto max-h-[50vh] object-contain pointer-events-none"
                draggable={false}
              />
              {/* crosshair */}
              <div
                className="absolute pointer-events-none"
                style={{
                  left: `${focal.x * 100}%`,
                  top: `${focal.y * 100}%`,
                  transform: "translate(-50%, -50%)",
                }}
              >
                <div className="h-8 w-8 rounded-full border-2 border-primary bg-primary/20 shadow-lg" />
                <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 h-2 w-2 rounded-full bg-primary" />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <Label className="mb-2 block">
                  Zoom: <span className="text-primary font-semibold">{focal.zoom.toFixed(2)}x</span>
                </Label>
                <input
                  type="range"
                  min={1}
                  max={3}
                  step={0.05}
                  value={focal.zoom}
                  onChange={(e) => setFocal((p) => ({ ...p, zoom: Number(e.target.value) }))}
                  className="w-full accent-primary"
                />
              </div>
              <div className="grid grid-cols-2 gap-2">
                {FRAMES.map((f) => (
                  <FramePreview
                    key={f.label}
                    label={f.label}
                    ratio={f.ratio}
                    imageUrl={imageUrl}
                    objectPosition={objectPosition}
                  />
                ))}
              </div>
            </div>
          </div>
        ) : (
          <div className="p-8 text-center text-sm text-muted-foreground">
            Nenhuma imagem carregada.
          </div>
        )}

        <DialogFooter className="gap-2">
          <Button
            type="button"
            variant="ghost"
            onClick={() => {
              setFocal({ x: 0.5, y: 0.5, zoom: 1 });
              onSave(null);
            }}
          >
            <RotateCcw className="h-4 w-4 mr-1" /> Voltar ao centro
          </Button>
          <div className="flex-1" />
          <Button type="button" variant="outline" onClick={onCancel}>
            Cancelar
          </Button>
          <Button type="button" onClick={() => onSave(focal)}>
            Salvar enquadramento
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function FramePreview({
  label,
  ratio,
  imageUrl,
  objectPosition,
}: {
  label: string;
  ratio: number;
  imageUrl: string;
  objectPosition: string;
}) {
  return (
    <div className="space-y-1">
      <div className="text-[11px] font-medium text-muted-foreground">{label}</div>
      <div
        className="relative overflow-hidden rounded-md border bg-muted"
        style={{ aspectRatio: String(ratio) }}
      >
        <img
          src={imageUrl}
          alt={`Prévia ${label}`}
          className="absolute inset-0 h-full w-full object-cover"
          style={{ objectPosition }}
        />
      </div>
    </div>
  );
}
