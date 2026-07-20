// ============================================================================
// Aba TEMPLATE — biblioteca visual de cenas.
//
// Renderiza um mini SceneRenderer por template para que a diferença visual
// entre as cenas (gradiente, molduras, cortes diagonais, etc.) fique óbvia
// antes de escolher. Extensível: qualquer cena adicionada ao registry
// aparece aqui automaticamente.
// ============================================================================

import { Check } from "lucide-react";
import { SCENE_LIST } from "@/lib/marketing/video-editor/scenes/registry";
import type { TemplateId } from "@/lib/marketing/video-editor/layout.types";
import { SceneRenderer } from "../SceneRenderer";

interface Props {
  value: TemplateId;
  onChange: (id: TemplateId) => void;
  /** URL de imagem para as miniaturas (opcional). */
  sampleImageUrl?: string | null;
  /** Logo real para as miniaturas (opcional). */
  sampleLogoUrl?: string | null;
}

export function TabTemplate({
  value,
  onChange,
  sampleImageUrl,
  sampleLogoUrl,
}: Props) {
  return (
    <div className="grid grid-cols-2 gap-3">
      {SCENE_LIST.map((scene) => {
        const active = value === scene.id;
        return (
          <button
            key={scene.id}
            type="button"
            onClick={() => onChange(scene.id)}
            className={`relative text-left rounded-lg border p-2 transition ${
              active
                ? "border-primary ring-2 ring-primary/40"
                : "border-border hover:border-primary/60"
            }`}
          >
            {active && (
              <span className="absolute top-2 right-2 z-30 h-5 w-5 rounded-full bg-primary text-primary-foreground grid place-items-center">
                <Check className="h-3 w-3" />
              </span>
            )}
            <div className="w-full">
              <SceneRenderer
                imageUrl={sampleImageUrl ?? null}
                logoUrl={sampleLogoUrl ?? null}
                headline="Título"
                subheadline="Subtítulo elegante"
                cta="Saiba mais"
                layout={scene.defaultLayout}
              />
            </div>
            <div className="mt-2 text-xs font-semibold">{scene.label}</div>
            <div className="text-[10.5px] text-muted-foreground leading-tight line-clamp-2">
              {scene.description}
            </div>
          </button>
        );
      })}
    </div>
  );
}
