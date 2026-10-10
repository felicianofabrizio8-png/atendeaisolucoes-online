// Faixa de páginas do carrossel/arte: miniatura real de cada página (o mesmo
// desenho da prévia), com adicionar, duplicar, mover e remover.

import { Button } from "@/components/ui/button";
import { ArrowLeft, ArrowRight, Copy, Plus, Trash2 } from "lucide-react";
import { SCENE_FORMATS, normalizeFraming, type SceneFormat } from "@/lib/marketing/video-editor/scenes/registry";
import { getScene } from "@/lib/marketing/video-editor/scenes/registry";
import { PAGE_ROLES, type StudioPage } from "@/lib/marketing/studio/document";
import { SceneRenderer } from "../campaign/editor/SceneRenderer";

interface Props {
  pages: StudioPage[];
  format: SceneFormat;
  selectedId: string;
  logoUrl: string | null;
  urlFor: (page: StudioPage) => string | null;
  onSelect: (id: string) => void;
  /** Ausentes = operação indisponível (ex.: arte tem uma página só). */
  onAdd?: () => void;
  onDuplicate?: (id: string) => void;
  onRemove?: (id: string) => void;
  onMove?: (id: string, delta: -1 | 1) => void;
}

const THUMB_H = 64;

export function PageStrip({ pages, format, selectedId, logoUrl, urlFor, onSelect, onAdd, onDuplicate, onRemove, onMove }: Props) {
  const size = SCENE_FORMATS[format];
  const thumbW = Math.round((THUMB_H * size.width) / size.height);
  const index = pages.findIndex((p) => p.id === selectedId);
  const single = pages.length === 1 && !onAdd;

  return (
    <div className="flex shrink-0 items-center gap-2 border-t bg-muted/20 px-3 py-2" data-testid="page-strip">
      <ol className="flex min-w-0 flex-1 items-center gap-2 overflow-x-auto py-0.5" aria-label="Páginas">
        {pages.map((page, i) => {
          const active = page.id === selectedId;
          const scene = getScene(page.layout.template);
          return (
            <li key={page.id} className="shrink-0">
              <button
                type="button"
                aria-label={`Página ${i + 1}`}
                aria-current={active ? "true" : undefined}
                onClick={() => onSelect(page.id)}
                className={`relative block overflow-hidden rounded-md outline-offset-1 ${active ? "outline outline-2 outline-primary" : "outline outline-1 outline-border hover:outline-primary/60"}`}
                style={{ width: thumbW }}
                title={`Página ${i + 1} · ${PAGE_ROLES[page.role]}`}
              >
                <SceneRenderer
                  compact
                  format={format}
                  imageUrl={urlFor(page)}
                  focalPoint={page.image ? normalizeFraming(page.image.framing, { fit: "contain", fill: scene.image.fill }) : null}
                  logoUrl={logoUrl}
                  headline={page.text.headline}
                  subheadline={page.text.subheadline || null}
                  cta={page.text.cta || null}
                  layout={page.layout}
                  emptyLabel={null}
                  photoWhenEmpty
                />
                <span className="absolute left-0.5 top-0.5 z-30 rounded bg-black/65 px-1 text-[10px] font-semibold leading-4 text-white">{i + 1}</span>
              </button>
            </li>
          );
        })}
        {onAdd && (
          <li className="shrink-0">
            <button
              type="button"
              onClick={onAdd}
              aria-label="Adicionar página"
              className="grid place-items-center rounded-md border border-dashed text-muted-foreground hover:border-primary hover:text-foreground"
              style={{ width: thumbW, height: THUMB_H }}
            >
              <Plus className="h-4 w-4" />
            </button>
          </li>
        )}
      </ol>

      {!single && (
        <div className="flex shrink-0 items-center gap-0.5" role="group" aria-label="Página selecionada">
          <span className="mr-1 hidden text-xs text-muted-foreground sm:inline">
            Página {index + 1} de {pages.length}
          </span>
          <Button size="icon" variant="ghost" className="h-8 w-8" aria-label="Mover página para antes" disabled={!onMove || index <= 0} onClick={() => onMove?.(selectedId, -1)}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <Button size="icon" variant="ghost" className="h-8 w-8" aria-label="Mover página para depois" disabled={!onMove || index >= pages.length - 1} onClick={() => onMove?.(selectedId, 1)}>
            <ArrowRight className="h-4 w-4" />
          </Button>
          <Button size="icon" variant="ghost" className="h-8 w-8" aria-label="Duplicar página" disabled={!onDuplicate} onClick={() => onDuplicate?.(selectedId)}>
            <Copy className="h-4 w-4" />
          </Button>
          <Button size="icon" variant="ghost" className="h-8 w-8" aria-label="Remover página" disabled={!onRemove} onClick={() => onRemove?.(selectedId)}>
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      )}
    </div>
  );
}
