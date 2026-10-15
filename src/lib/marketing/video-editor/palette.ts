// ============================================================================
// Paletas do editor — de onde vêm as cores aplicadas a uma cena.
//
//   - "brand":    cores da marca da empresa (Brand Center), por company_id.
//   - "template": cores nativas da cena.
//   - "theme":    um tema da biblioteca de ocasiões.
//   - "custom":   o usuário mexeu em alguma cor.
//
// A paleta resolvida vai dentro de `VideoLayout.colors`; o servidor a converte
// no `ThemeSnapshot` enviado ao worker. `fitPaletteToScene` aplica aqui as
// mesmas correções de legibilidade que o worker aplica, para a prévia mostrar
// exatamente a cor que será renderizada.
// ============================================================================

import {
  contrastRatio,
  isValidHexColor,
  readableTextOn,
  relativeLuminance,
  type ThemeSnapshot,
} from "../theme-snapshot";
import type { ScenePalette } from "./layout.types";
import type { ColorRole, SceneColor, SceneDefinition } from "./scene.types";
import { getThemePreset } from "./theme-presets";

export interface BrandColorsInput {
  primary: string;
  secondary: string;
  accent: string;
}

/** Garante que o texto continue legível sobre a superfície da cena. */
export function fitPaletteToScene(palette: ScenePalette, scene: SceneDefinition): ScenePalette {
  const out = { ...palette };
  // Em cenas de painel sólido não existe sombra separada: as duas cores andam juntas.
  if (scene.textSurface === "background") out.overlay = out.background;
  const surface = scene.textSurface === "background" ? out.background : out.overlay;
  if (contrastRatio(out.text, surface) < 3) out.text = readableTextOn(surface);
  return out;
}

/** Paleta da marca para uma cena. Null quando a marca não tem cores válidas. */
export function brandPalette(colors: BrandColorsInput | null | undefined, scene: SceneDefinition): ScenePalette | null {
  if (!colors || !isValidHexColor(colors.primary)) return null;
  const primary = colors.primary.toUpperCase();
  const candidates = [colors.accent, colors.secondary].filter(isValidHexColor).map((c) => c.toUpperCase());
  // O destaque precisa se distinguir do fundo; senão usa a segunda cor ou um neutro.
  const accent = candidates.find((c) => contrastRatio(c, primary) >= 1.6) ?? readableTextOn(primary);
  // Sombra sobre a foto: a cor da marca só quando é escura o bastante.
  const overlay = relativeLuminance(primary) < 0.2 ? primary : "#0B0B0F";
  const surface = scene.textSurface === "background" ? primary : overlay;
  return fitPaletteToScene(
    { background: primary, overlay, accent, text: readableTextOn(surface), cta: accent, ctaText: readableTextOn(accent) },
    scene,
  );
}

/** Paleta de um tema da biblioteca aplicada a uma cena. */
export function themePalette(themeId: string | null | undefined, scene: SceneDefinition): ScenePalette | null {
  const preset = getThemePreset(themeId ?? null);
  if (!preset) return null;
  const { primary, accent, foreground } = preset.colors;
  return fitPaletteToScene(
    { background: primary, overlay: primary, accent, text: foreground, cta: accent, ctaText: readableTextOn(accent) },
    scene,
  );
}

/** Cena com a paleta do layout (ou a nativa, quando não há cores escolhidas). */
export function sceneWithPalette(scene: SceneDefinition, colors: ScenePalette | null | undefined): SceneDefinition {
  return colors ? { ...scene, palette: fitPaletteToScene(colors, scene) } : scene;
}

/** Converte a paleta do editor no snapshot de tema entendido pelo worker. */
export function paletteToThemeInput(palette: ScenePalette, id: string | null): ThemeSnapshot {
  return {
    id,
    accentColor: palette.accent,
    backgroundColor: palette.background,
    textColor: palette.text,
    overlayColor: palette.overlay,
    ctaColor: palette.cta,
    ctaTextColor: palette.ctaText,
  };
}

/** Papéis de cor que a cena realmente usa — só eles viram controle no editor. */
export function usedColorRoles(scene: SceneDefinition): ColorRole[] {
  const used = new Set<ColorRole>();
  const add = (c: SceneColor | undefined) => {
    if (c && !c.startsWith("#")) used.add(c as ColorRole);
  };
  for (const layer of scene.layers) {
    if ("fill" in layer) add(layer.fill);
    if ("stroke" in layer) add(layer.stroke?.color);
    if (layer.kind === "gradient") layer.stops.forEach((s) => add(s.color));
    if (layer.kind === "glow") add(layer.color);
    if (layer.kind === "stripes") {
      add(layer.a);
      add(layer.b);
    }
  }
  for (const style of [scene.text.title, scene.text.subtitle]) {
    add(style.color);
    add(style.accent?.color);
    add(style.gradient?.to);
    add(style.outline?.color);
    add(style.shadow?.color);
    add(style.plate?.fill);
  }
  // Preenchimento "cor do modelo" atrás da imagem usa a cor de fundo.
  if (scene.image.fill === "color") used.add("background");
  const cta = scene.text.cta;
  if (cta.variant === "underline") {
    add(cta.color);
    used.add("accent");
  } else {
    used.add("cta");
    if (cta.variant === "pill") used.add("ctaText");
  }
  if (scene.textSurface === "background") used.delete("overlay");
  const order: ColorRole[] = ["background", "overlay", "accent", "text", "cta", "ctaText"];
  return order.filter((r) => used.has(r));
}
