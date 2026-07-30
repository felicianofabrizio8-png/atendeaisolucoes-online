// ============================================================================
// Theme Snapshot — contrato visual explícito enviado ao Render Engine.
//
// Causa do pendente anterior: `theme-presets.ts` definia cores, mas só o ID
// textual do tema chegava (quando chegava) ao worker. O worker não pode
// depender do nome do tema — ele precisa dos VALORES já resolvidos.
//
// Regras de segurança:
//   - Somente cores em `#RRGGBB` (6 dígitos hex). Nada de `rgb()`, `url()`,
//     variáveis CSS ou qualquer string arbitrária — o valor entra em atributo
//     SVG no worker.
//   - Valor inválido → fallback seguro do campo (nunca quebra o render).
//   - Contraste garantido: o texto sobre o CTA é escolhido por luminância.
//
// Puro: sem IO. Mesmo contrato replicado em `worker/render-engine/src/theme.ts`.
// ============================================================================

import { getThemePreset, THEME_PRESETS } from "./video-editor/theme-presets";

export interface ThemeSnapshot {
  /** Só rastreabilidade — o worker NUNCA decide visual pelo id. */
  id: string | null;
  accentColor: string;
  backgroundColor: string;
  textColor: string;
  overlayColor: string;
  ctaColor: string;
  /** Cor do texto dentro do CTA, derivada por contraste. */
  ctaTextColor: string;
}

export const HEX_COLOR_RE = /^#[0-9a-fA-F]{6}$/;

export const THEME_SNAPSHOT_FALLBACK: ThemeSnapshot = {
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

/** Normaliza para `#RRGGBB` maiúsculo, ou devolve o fallback informado. */
export function safeColor(v: unknown, fallback: string): string {
  return isValidHexColor(v) ? v.trim().toUpperCase() : fallback;
}

/** Luminância relativa (WCAG) de uma cor hex já validada. */
export function relativeLuminance(hex: string): number {
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

/** Preto ou branco — o que tiver melhor contraste sobre `background`. */
export function readableTextOn(background: string): string {
  return contrastRatio(background, "#000000") >= contrastRatio(background, "#FFFFFF")
    ? "#000000"
    : "#FFFFFF";
}

/**
 * Valida/normaliza um snapshot vindo do banco (jsonb) ou do cliente.
 * Nunca lança: campos inválidos usam fallback e o resultado é sempre legível.
 */
export function sanitizeThemeSnapshot(input: unknown): ThemeSnapshot | null {
  if (!input || typeof input !== "object") return null;
  const o = input as Record<string, unknown>;
  const backgroundColor = safeColor(o.backgroundColor, THEME_SNAPSHOT_FALLBACK.backgroundColor);
  const accentColor = safeColor(o.accentColor, THEME_SNAPSHOT_FALLBACK.accentColor);
  const overlayColor = safeColor(o.overlayColor, THEME_SNAPSHOT_FALLBACK.overlayColor);
  const ctaColor = safeColor(o.ctaColor, accentColor);
  let textColor = safeColor(o.textColor, THEME_SNAPSHOT_FALLBACK.textColor);
  // Preserva legibilidade: se o texto ficaria ilegível sobre o overlay,
  // troca para preto/branco por contraste.
  if (contrastRatio(textColor, overlayColor) < 3) {
    textColor = readableTextOn(overlayColor);
  }
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

/** Constrói o snapshot a partir de um tema da biblioteca. */
export function buildThemeSnapshot(themeId: string | null | undefined): ThemeSnapshot | null {
  const preset = getThemePreset(themeId ?? null);
  if (!preset) return null;
  return sanitizeThemeSnapshot({
    id: preset.id,
    accentColor: preset.colors.accent,
    backgroundColor: preset.colors.primary,
    textColor: preset.colors.foreground,
    overlayColor: preset.colors.primary,
    ctaColor: preset.colors.accent,
  });
}

/**
 * Fallback para o modo IA: o editor escolhe um TEMPLATE (cena), não um tema.
 * Mapeamos o template de volta para o primeiro tema que o utiliza, para que
 * a arte também receba cores resolvidas.
 */
export function themeIdForTemplate(template: string | null | undefined): string | null {
  if (!template) return null;
  return THEME_PRESETS.find((t) => t.template === template)?.id ?? null;
}
