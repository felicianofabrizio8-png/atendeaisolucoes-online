// ============================================================================
// Theme (worker) — espelho do contrato `ThemeSnapshot` do frontend
// (`src/lib/marketing/theme-snapshot.ts`).
//
// O worker recebe VALORES resolvidos (hex), nunca o nome do tema. Qualquer
// valor fora de `#RRGGBB` é descartado e substituído por fallback seguro:
// isso impede CSS/atributo arbitrário dentro do SVG rasterizado.
//
// Puro: sem IO.
// ============================================================================

import type { SceneDefinition, ScenePalette } from "./scenes.js";

export interface ThemeSnapshot {
  id: string | null;
  accentColor: string;
  backgroundColor: string;
  textColor: string;
  overlayColor: string;
  ctaColor: string;
  ctaTextColor: string;
}

const HEX_COLOR_RE = /^#[0-9a-fA-F]{6}$/;

export const THEME_FALLBACK: ThemeSnapshot = {
  id: null,
  accentColor: "#FFFFFF",
  backgroundColor: "#000000",
  textColor: "#FFFFFF",
  overlayColor: "#000000",
  ctaColor: "#FFFFFF",
  ctaTextColor: "#000000",
};

export function isValidHexColor(v: unknown): v is string {
  return typeof v === "string" && HEX_COLOR_RE.test(v.trim());
}

function safeColor(v: unknown, fallback: string): string {
  return isValidHexColor(v) ? v.trim().toUpperCase() : fallback;
}

function relativeLuminance(hex: string): number {
  const n = parseInt(hex.slice(1), 16);
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
}

export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const [hi, lo] = la >= lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

export function readableTextOn(background: string): string {
  return contrastRatio(background, "#000000") >= contrastRatio(background, "#FFFFFF")
    ? "#000000"
    : "#FFFFFF";
}

/** Valida o snapshot recebido no `video_brand.content.theme`. */
export function sanitizeThemeSnapshot(input: unknown): ThemeSnapshot | null {
  if (!input || typeof input !== "object") return null;
  const o = input as Record<string, unknown>;
  const backgroundColor = safeColor(o.backgroundColor, THEME_FALLBACK.backgroundColor);
  const accentColor = safeColor(o.accentColor, THEME_FALLBACK.accentColor);
  const overlayColor = safeColor(o.overlayColor, THEME_FALLBACK.overlayColor);
  const ctaColor = safeColor(o.ctaColor, accentColor);
  let textColor = safeColor(o.textColor, THEME_FALLBACK.textColor);
  if (contrastRatio(textColor, overlayColor) < 3) textColor = readableTextOn(overlayColor);
  return {
    id: typeof o.id === "string" ? o.id.slice(0, 40) : null,
    accentColor,
    backgroundColor,
    textColor,
    overlayColor,
    ctaColor,
    ctaTextColor: safeColor(o.ctaTextColor, readableTextOn(ctaColor)),
  };
}

/** `#RRGGBB` + alpha → `rgba(r,g,b,a)` (usado nos gradientes da cena). */
export function withAlpha(hex: string, alpha: number): string {
  const n = parseInt(hex.slice(1), 16);
  const a = Math.max(0, Math.min(1, alpha));
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

/**
 * Paleta da cena a partir do snapshot de tema. Quando o texto da cena fica
 * sobre um painel sólido (e não sobre a sombra da foto), a legibilidade é
 * conferida contra a cor do painel.
 */
export function paletteFromTheme(theme: ThemeSnapshot, scene: SceneDefinition): ScenePalette {
  const surface = scene.textSurface === "background" ? theme.backgroundColor : theme.overlayColor;
  const text = contrastRatio(theme.textColor, surface) < 3 ? readableTextOn(surface) : theme.textColor;
  return {
    accent: theme.accentColor,
    background: theme.backgroundColor,
    overlay: theme.overlayColor,
    text,
    cta: theme.ctaColor,
    ctaText: theme.ctaTextColor,
  };
}

/**
 * Aplica o snapshot de tema sobre uma cena, devolvendo uma NOVA cena.
 * Não muda geometria, tipografia, âncoras nem a lógica de logo — apenas a
 * paleta, que as camadas e os textos consultam pelos papéis de cor.
 */
export function applyThemeToScene(
  scene: SceneDefinition,
  theme: ThemeSnapshot | null,
): SceneDefinition {
  if (!theme) return scene;
  return { ...scene, palette: paletteFromTheme(theme, scene) };
}
