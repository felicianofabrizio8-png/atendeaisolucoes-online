// Operações de layout usadas pelo estúdio (puras): troca de modelo, posição
// do texto e cores. As mesmas regras valem para vídeo, carrossel e arte.

import type { Anchor, ColorMode, ScenePalette, VideoLayout } from "../video-editor/layout.types";
import type { SceneDefinition } from "../video-editor/scene.types";
import { brandPalette, fitPaletteToScene, themePalette, type BrandColorsInput } from "../video-editor/palette";
import { getScene } from "../video-editor/scenes/registry";

/** Paleta que `target` deve usar para manter a escolha de cores de `layout`. */
export function paletteForScene(layout: Pick<VideoLayout, "colorMode" | "colors">, brand: BrandColorsInput | null | undefined, target: SceneDefinition): ScenePalette {
  if (layout.colorMode === "brand") return brandPalette(brand, target) ?? target.palette;
  if (layout.colorMode === "template" || !layout.colors) return target.palette;
  return fitPaletteToScene(layout.colors, target);
}

/** Troca o modelo mantendo cores, transição e a escolha de exibir a logo. */
export function applyTemplate(cur: VideoLayout, next: SceneDefinition, brand: BrandColorsInput | null | undefined): VideoLayout {
  return {
    ...next.defaultLayout,
    template: next.id,
    colors: paletteForScene(cur, brand, next),
    colorMode: cur.colorMode,
    transition: cur.transition,
    logo: { ...next.defaultLayout.logo, visible: cur.logo.visible, opacity: cur.logo.opacity },
  };
}

/** Texto no topo, meio ou base; a logo sai da borda onde o texto entrou. */
export function applyAnchor(cur: VideoLayout, anchor: Anchor): VideoLayout {
  const collides = anchor !== "center" && cur.logo.vAnchor === anchor;
  return {
    ...cur,
    title: { ...cur.title, vAnchor: anchor },
    subtitle: { ...cur.subtitle, vAnchor: anchor },
    cta: { ...cur.cta, vAnchor: anchor },
    offsetY: 0,
    logo: collides ? { ...cur.logo, vAnchor: anchor === "top" ? "bottom" : "top" } : cur.logo,
  };
}

/** Deslocamento do bloco de texto ao arrastar (limitado e em passos de 0,5%). */
export function dragOffset(base: { x: number; y: number }, dx: number, dy: number): { offsetX: number; offsetY: number } {
  const clamp = (v: number) => Math.round(Math.max(-50, Math.min(50, v)) * 2) / 2;
  return { offsetX: clamp(base.x + dx), offsetY: clamp(base.y + dy) };
}

export type ColorChoice =
  | { mode: "brand" | "template" }
  | { mode: "theme"; themeId: string }
  | { mode: "custom"; palette: ScenePalette };

/** Aplica uma escolha de cores a um layout, respeitando os papéis do modelo dele. */
export function applyColors(cur: VideoLayout, choice: ColorChoice, brand: BrandColorsInput | null | undefined): VideoLayout {
  const scene = getScene(cur.template);
  let colors: ScenePalette | null;
  let colorMode: ColorMode = choice.mode;
  switch (choice.mode) {
    case "brand":
      colors = brandPalette(brand, scene);
      if (!colors) colorMode = "template";
      break;
    case "theme":
      colors = themePalette(choice.themeId, scene);
      if (!colors) return cur;
      break;
    case "custom":
      colors = fitPaletteToScene(choice.palette, scene);
      break;
    default:
      colors = null;
  }
  return { ...cur, colors: colors ?? scene.palette, colorMode };
}
