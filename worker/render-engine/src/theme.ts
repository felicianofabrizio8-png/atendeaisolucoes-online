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

import type { SceneDefinition, SceneLayer, TextStyle } from "./scenes.js";

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

function alphaOf(color: string): number | null {
  const m = color.match(/rgba?\([^)]*?,\s*([0-9.]+)\s*\)/);
  if (!m) return null;
  const v = Number(m[1]);
  return Number.isFinite(v) ? v : null;
}

function themeLayer(layer: SceneLayer, theme: ThemeSnapshot): SceneLayer {
  switch (layer.kind) {
    case "gradient":
      return {
        ...layer,
        stops: layer.stops.map((s) => ({
          ...s,
          color: withAlpha(theme.overlayColor, alphaOf(s.color) ?? 1),
        })),
      };
    case "solid":
      // Faixas finas (<= 1.5% da altura) são réguas de destaque → accent.
      return {
        ...layer,
        color: (layer.height ?? 30) <= 1.5 ? theme.accentColor : theme.backgroundColor,
      };
    case "angular":
      return { ...layer, color: theme.accentColor };
    case "frame":
      return { ...layer, color: theme.accentColor };
    default:
      return layer;
  }
}

function themeText(style: TextStyle, theme: ThemeSnapshot, isCta: boolean): TextStyle {
  if (isCta) {
    return {
      ...style,
      color: style.pill ? theme.ctaTextColor : theme.textColor,
      pill: style.pill
        ? { ...style.pill, background: theme.ctaColor, foreground: theme.ctaTextColor }
        : null,
      underline: style.underline
        ? { ...style.underline, color: theme.accentColor }
        : style.underline ?? null,
    };
  }
  return { ...style, color: theme.textColor };
}

/**
 * Aplica o snapshot de tema sobre uma cena, devolvendo uma NOVA cena.
 * Não muda geometria, tipografia, âncoras nem a lógica de logo — apenas cores.
 */
export function applyThemeToScene(
  scene: SceneDefinition,
  theme: ThemeSnapshot | null,
): SceneDefinition {
  if (!theme) return scene;
  return {
    ...scene,
    layers: scene.layers.map((l) => themeLayer(l, theme)),
    text: {
      ...scene.text,
      title: themeText(scene.text.title, theme, false),
      subtitle: themeText(scene.text.subtitle, theme, false),
      cta: themeText(scene.text.cta, theme, true),
    },
  };
}
