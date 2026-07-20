// ============================================================================
// Templates — adaptador legado sobre a nova arquitetura de Cenas.
//
// A "verdade" agora vive em `scenes/registry.ts` (SceneDefinition). Este
// arquivo continua exportando `TemplatePreset` porque componentes existentes
// (TabTemplate, EditorPreview antigo) o consomem. Deriva os campos da cena.
//
// Novos consumidores devem preferir `getScene()` / `SCENE_LIST` diretamente.
// ============================================================================

import type { TemplateId, VideoLayout } from "./layout.types";
import type { SceneDefinition, TextStyle } from "./scene.types";
import { getScene, SCENE_LIST } from "./scenes/registry";

export interface TemplatePreset {
  id: TemplateId;
  label: string;
  description: string;
  titleFontFamily: string;
  subtitleFontFamily: string;
  ctaFontFamily: string;
  titleWeight: number;
  subtitleWeight: number;
  layout: VideoLayout;
  panelDarkness: number;
  /** Referência à Scene completa (novos consumidores devem usar isto). */
  scene: SceneDefinition;
}

function derivePanelDarkness(scene: SceneDefinition): number {
  // Heurística: usa a maior opacidade final de camadas escuras no rodapé.
  let max = 0;
  for (const layer of scene.layers) {
    if (layer.kind === "gradient" && layer.y === "bottom") {
      for (const stop of layer.stops) {
        // Extrai rgba(0,0,0,X) ou define 0 para outras cores
        const m = stop.color.match(/rgba?\(\s*0\s*,\s*0\s*,\s*0\s*,\s*([\d.]+)\s*\)/);
        if (m) max = Math.max(max, Number(m[1]) * 0.4);
      }
    }
    if (layer.kind === "vignette") max = Math.max(max, layer.intensity * 0.3);
  }
  return Math.min(0.6, Number(max.toFixed(2)));
}

function toPreset(scene: SceneDefinition): TemplatePreset {
  const t = scene.text;
  const pickFamily = (style: TextStyle) => style.fontFamily;
  return {
    id: scene.id,
    label: scene.label,
    description: scene.description,
    titleFontFamily: pickFamily(t.title),
    subtitleFontFamily: pickFamily(t.subtitle),
    ctaFontFamily: pickFamily(t.cta),
    titleWeight: t.title.weight,
    subtitleWeight: t.subtitle.weight,
    layout: scene.defaultLayout,
    panelDarkness: derivePanelDarkness(scene),
    scene,
  };
}

export const TEMPLATE_LIST: TemplatePreset[] = SCENE_LIST.map(toPreset);

const TEMPLATES_MAP: Partial<Record<TemplateId, TemplatePreset>> = {};
for (const p of TEMPLATE_LIST) TEMPLATES_MAP[p.id] = p;

export const TEMPLATES = TEMPLATES_MAP as Record<TemplateId, TemplatePreset>;

export function getTemplate(id: TemplateId): TemplatePreset {
  return TEMPLATES_MAP[id] ?? toPreset(getScene(id));
}
