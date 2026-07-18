// Grid de imagens da campanha com drag-and-drop nativo HTML5.
// Sem dependências extras. Suporta reorder, remover, marcar principal e
// abrir o editor de focal point.

import { useCallback, useState } from "react";
import { GripVertical, Star, StarOff, X, Crop, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { FocalPointInput } from "@/data/marketingRepo";

export interface CampaignImageItem {
  key: string; // stable id
  origin: "marketing" | "product";
  media_id?: string;
  product_id?: string;
  image_path?: string;
  storagePath?: string;
  previewUrl: string | null;
  loadingPreview?: boolean;
  focal_point?: FocalPointInput | null;
}

interface Props {
  items: CampaignImageItem[];
  onReorder: (next: CampaignImageItem[]) => void;
  onRemove: (key: string) => void;
  onMakePrimary: (key: string) => void;
  onEditFocal: (key: string) => void;
}

export function CampaignImageList({
  items,
  onReorder,
  onRemove,
  onMakePrimary,
  onEditFocal,
}: Props) {
  const [dragKey, setDragKey] = useState<string | null>(null);
  const [dragOverKey, setDragOverKey] = useState<string | null>(null);

  const handleDrop = useCallback(
    (targetKey: string) => {
      if (!dragKey || dragKey === targetKey) return;
      const fromIdx = items.findIndex((i) => i.key === dragKey);
      const toIdx = items.findIndex((i) => i.key === targetKey);
      if (fromIdx < 0 || toIdx < 0) return;
      const next = [...items];
      const [moved] = next.splice(fromIdx, 1);
      next.splice(toIdx, 0, moved);
      onReorder(next);
      setDragKey(null);
      setDragOverKey(null);
    },
    [dragKey, items, onReorder],
  );

  if (items.length === 0) {
    return (
      <div className="rounded-md border bg-muted/40 p-4 text-center text-sm text-muted-foreground">
        Selecione uma ou mais imagens abaixo para montar a campanha.
      </div>
    );
  }

  return (
    <ul
      className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3"
      aria-label="Imagens da campanha (arraste para reordenar)"
    >
      {items.map((it, idx) => {
        const primary = idx === 0;
        const isDragOver = dragOverKey === it.key;
        return (
          <li
            key={it.key}
            draggable
            onDragStart={() => setDragKey(it.key)}
            onDragEnd={() => {
              setDragKey(null);
              setDragOverKey(null);
            }}
            onDragOver={(e) => {
              e.preventDefault();
              setDragOverKey(it.key);
            }}
            onDragLeave={() => {
              if (dragOverKey === it.key) setDragOverKey(null);
            }}
            onDrop={(e) => {
              e.preventDefault();
              handleDrop(it.key);
            }}
            className={`group relative aspect-square rounded-lg border-2 overflow-hidden bg-muted transition-all ${
              primary ? "border-primary shadow-sm" : "border-transparent"
            } ${isDragOver ? "ring-2 ring-primary/60 scale-[1.02]" : ""}`}
          >
            {it.loadingPreview && !it.previewUrl ? (
              <div className="absolute inset-0 flex items-center justify-center">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            ) : it.previewUrl ? (
              <img
                src={it.previewUrl}
                alt={`Imagem ${idx + 1} da campanha`}
                className="absolute inset-0 h-full w-full object-cover"
                style={
                  it.focal_point
                    ? {
                        objectPosition: `${(it.focal_point.x * 100).toFixed(1)}% ${(it.focal_point.y * 100).toFixed(1)}%`,
                      }
                    : undefined
                }
              />
            ) : (
              <div className="absolute inset-0 flex items-center justify-center text-xs text-muted-foreground">
                Sem prévia
              </div>
            )}

            {/* Badge posição */}
            <div className="absolute top-1 left-1 flex items-center gap-1 rounded-full bg-background/85 backdrop-blur-sm px-2 py-0.5 text-[11px] font-semibold shadow-sm">
              <GripVertical className="h-3 w-3 opacity-60 cursor-grab active:cursor-grabbing" />
              {idx + 1}
              {primary && (
                <span className="ml-1 rounded-sm bg-primary/15 px-1 text-[10px] font-bold uppercase text-primary">
                  principal
                </span>
              )}
            </div>

            {/* Ações */}
            <div className="absolute inset-x-0 bottom-0 flex items-center justify-between gap-1 bg-gradient-to-t from-black/70 via-black/30 to-transparent p-1.5 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
              <div className="flex gap-1">
                {!primary && (
                  <Button
                    type="button"
                    size="icon"
                    variant="secondary"
                    className="h-7 w-7"
                    onClick={() => onMakePrimary(it.key)}
                    title="Tornar principal"
                    aria-label={`Definir imagem ${idx + 1} como principal`}
                  >
                    <Star className="h-3.5 w-3.5" />
                  </Button>
                )}
                {primary && (
                  <span
                    className="grid place-items-center h-7 w-7 rounded-md bg-primary/20 text-primary"
                    title="Imagem principal"
                  >
                    <StarOff className="h-3.5 w-3.5" />
                  </span>
                )}
                <Button
                  type="button"
                  size="icon"
                  variant="secondary"
                  className="h-7 w-7"
                  onClick={() => onEditFocal(it.key)}
                  title="Ajustar enquadramento"
                  aria-label={`Ajustar enquadramento da imagem ${idx + 1}`}
                  disabled={!it.previewUrl}
                >
                  <Crop className="h-3.5 w-3.5" />
                </Button>
              </div>
              <Button
                type="button"
                size="icon"
                variant="destructive"
                className="h-7 w-7"
                onClick={() => onRemove(it.key)}
                title="Remover"
                aria-label={`Remover imagem ${idx + 1}`}
              >
                <X className="h-3.5 w-3.5" />
              </Button>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
