/**
 * Static Brand Composer — Fase 4 do Brand Center.
 *
 * Compositor determinístico e ISOMÓRFICO (sem IO). Recebe uma imagem-base,
 * o contrato `MarketingBrandContext` e as dimensões finais, e devolve um
 * PLANO de composição:
 *  - posicionamento da logo (com preservação de proporção + safe area)
 *  - camadas de overlay (cor + gradiente) para legibilidade
 *  - resolução tipográfica com fallback determinístico
 *  - regiões de texto (headline/subheadline/preço/CTA) alinhadas fora
 *    da silhueta da logo
 *  - um SVG overlay opcional pronto para composição via `<canvas>` no
 *    cliente ou via SVG-rasterizer server-side no futuro.
 *
 * RESPONSABILIDADES NEGATIVAS
 *  - NÃO consulta tabelas brand_*.
 *  - NÃO acessa storage.
 *  - NÃO chama IA.
 *  - NÃO faz upload.
 *  - NÃO retorna signed URLs no snapshot persistente.
 *  - NÃO publica em redes sociais.
 *
 * O consumidor decide onde executar a rasterização final (canvas do
 * browser hoje; futuramente um worker gráfico dedicado).
 */

import type {
  MarketingBrandContext,
  MarketingBrandLogo,
} from "./brand-context-adapter";
import type {
  BrandColors,
  BrandGradientStyle,
  BrandLogoPosition,
  BrandTypography,
} from "@/lib/brand-center/brand.types";

// ---------------------------------------------------------------------------
// Contrato
// ---------------------------------------------------------------------------

export type StaticCanvasFormat = "feed_1_1" | "feed_4_5" | "story_9_16";

/** Referência à imagem-base já resguardada (mime/tamanho conhecidos). */
export interface StaticBaseImage {
  /**
   * Referência da imagem-base. Nunca persistir junto com signed URL —
   * o consumidor decide se é dataURL, URL pública ou signed transitório.
   */
  href: string;
  mimeType: string;
  width: number;
  height: number;
}

export interface StaticBrandCompositionCanvas {
  width: number;
  height: number;
  format: StaticCanvasFormat;
}

export interface StaticBrandCompositionContent {
  headline?: string | null;
  subheadline?: string | null;
  price?: string | null;
  callToAction?: string | null;
}

export interface StaticBrandCompositionInput {
  baseImage: StaticBaseImage;
  canvas: StaticBrandCompositionCanvas;
  brand: MarketingBrandContext;
  content?: StaticBrandCompositionContent;
}

export interface LogoPlacement {
  /** URL efêmera; presente apenas no plano em memória — nunca serializar. */
  href: string;
  mimeType: string;
  position: BrandLogoPosition;
  /** Coordenadas finais no canvas. */
  x: number;
  y: number;
  width: number;
  height: number;
  /** Fração do canvas ocupada em largura, para auditoria. */
  widthFraction: number;
  /** Margem segura aplicada (px no canvas). */
  safeMargin: number;
}

export interface OverlayLayer {
  kind: "solid" | "linearGradient";
  /** Opacidade global aplicada à camada. */
  opacity: number;
  colorStops: Array<{ offset: number; color: string }>;
  /** Ângulo do gradiente (0-360). Para solid é ignorado. */
  angle: number;
}

export interface TextRegion {
  role: "headline" | "subheadline" | "price" | "cta";
  text: string;
  x: number;
  y: number;
  maxWidth: number;
  fontFamily: string;
  fontWeight: number;
  fontSizePx: number;
  color: string;
  textAlign: "left" | "center" | "right";
}

export interface ResolvedTypography {
  headingFamily: string;
  bodyFamily: string;
  displayFamily: string;
  fallbackFamily: string;
  weights: number[];
  usedFallback: boolean;
  /** Fontes originalmente pedidas que não passaram na allowlist. */
  unavailable: string[];
}

export interface StaticBrandCompositionPlan {
  canvas: StaticBrandCompositionCanvas;
  logo: LogoPlacement | null;
  overlays: OverlayLayer[];
  textRegions: TextRegion[];
  typography: ResolvedTypography;
  colors: BrandColors;
  /** Elementos efetivamente aplicados no plano. Ordem estável. */
  appliedElements: string[];
  /** Avisos sanitizados (sem URLs, sem paths). */
  warnings: string[];
  /**
   * SVG overlay sem a imagem-base (para compor via <canvas> ou stack SVG).
   * NÃO contém a signed URL da logo — logo é referenciada por placeholder
   * `data-logo-slot` para o rasterizador injetar o binário localmente.
   */
  svgOverlay: string;
}

// ---------------------------------------------------------------------------
// Allowlist de fontes suportadas na renderização estática
// ---------------------------------------------------------------------------

/**
 * Allowlist determinística. Fase 4 não baixa fontes dinamicamente — apenas
 * fontes desta lista podem ser referenciadas no arquivo final. O restante
 * cai no fallback declarado do BrandContext e, em última instância, no
 * fallback seguro do sistema.
 */
export const STATIC_FONT_ALLOWLIST: ReadonlySet<string> = new Set([
  "Inter",
  "Roboto",
  "Poppins",
  "Montserrat",
  "Lato",
  "Open Sans",
  "Nunito",
  "Playfair Display",
  "Merriweather",
  "Oswald",
  "Bebas Neue",
  "Raleway",
  "Source Sans 3",
  "System UI",
  "Arial",
  "Helvetica",
]);

export const SYSTEM_FALLBACK_FONT =
  "system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif";

// ---------------------------------------------------------------------------
// Regras proporcionais da logo
// ---------------------------------------------------------------------------

/**
 * Largura da logo em relação ao canvas:
 *  - Feed 1:1  → 18%
 *  - Feed 4:5  → 18%
 *  - Story 9:16 → 22% (formato mais estreito precisa de logo visualmente maior)
 * Regra: clamp entre 15% e 25% da MENOR dimensão do canvas.
 */
export const LOGO_WIDTH_FRACTION_BY_FORMAT: Record<StaticCanvasFormat, number> = {
  feed_1_1: 0.18,
  feed_4_5: 0.18,
  story_9_16: 0.22,
};
export const LOGO_MIN_FRACTION = 0.15;
export const LOGO_MAX_FRACTION = 0.25;

/**
 * Safe area extra para Instagram/Facebook Story (topo/rodapé cobertos pela UI).
 * Valores absolutos em fração do canvas.
 */
export const STORY_TOP_SAFE_FRACTION = 0.13;
export const STORY_BOTTOM_SAFE_FRACTION = 0.19;

// ---------------------------------------------------------------------------
// Limites de segurança (image bomb, memória)
// ---------------------------------------------------------------------------

export const MAX_CANVAS_DIMENSION = 4096;
export const MAX_CANVAS_PIXELS = 4096 * 4096;

// ---------------------------------------------------------------------------
// Erros controlados
// ---------------------------------------------------------------------------

export class StaticCompositionError extends Error {
  constructor(public code: string, message?: string) {
    super(message ?? code);
    this.name = "StaticCompositionError";
  }
}

// ---------------------------------------------------------------------------
// API principal
// ---------------------------------------------------------------------------

export function planStaticBrandComposition(
  input: StaticBrandCompositionInput,
): StaticBrandCompositionPlan {
  validateCanvas(input.canvas);
  validateBaseImage(input.baseImage);

  const warnings: string[] = [];
  const appliedElements: string[] = [];

  const typography = resolveTypography(input.brand.typography, warnings);
  const overlays = buildOverlays(input.brand, input.canvas.format);
  if (overlays.length > 0) appliedElements.push("overlay");

  const logo = input.brand.logo
    ? placeLogo(input.brand.logo, input.canvas, input.brand.tokens.logoPosition, input.brand.tokens.logoSafeMargin)
    : null;
  if (logo) appliedElements.push("logo");

  const textRegions = layoutTextRegions(
    input.content ?? {},
    input.canvas,
    input.brand.colors,
    typography,
    logo,
  );
  if (textRegions.length > 0) appliedElements.push("text");

  const svgOverlay = renderSvgOverlay({
    canvas: input.canvas,
    overlays,
    logo,
    textRegions,
  });

  return {
    canvas: input.canvas,
    logo,
    overlays,
    textRegions,
    typography,
    colors: input.brand.colors,
    appliedElements,
    warnings,
    svgOverlay,
  };
}

// ---------------------------------------------------------------------------
// Snapshot sanitizado para ai_prompt
// ---------------------------------------------------------------------------

export interface StaticBrandCompositionSnapshot {
  schemaVersion: 1;
  canvas: StaticBrandCompositionCanvas;
  visualStyle: string | null;
  colors: BrandColors;
  typography: {
    heading: string;
    body: string;
    display: string;
    fallback: string;
    weights: number[];
    usedFallback: boolean;
    unavailable: string[];
  };
  tokens: {
    logoPosition: BrandLogoPosition;
    logoSafeMargin: number;
    overlayOpacity: number;
    gradientStyle: BrandGradientStyle;
  };
  logo: {
    present: boolean;
    mimeType: string | null;
    width: number | null;
    height: number | null;
    widthFraction: number | null;
    position: BrandLogoPosition | null;
  };
  appliedElements: string[];
  warnings: string[];
}

/**
 * Snapshot seguro para persistência em `ai_prompt` (drafts / snapshots).
 * Estritamente NÃO inclui signed URLs, storage paths, expiresAt, buffers
 * ou o próprio SVG overlay (que carrega o slot de logo).
 */
export function buildCompositionSnapshot(
  input: StaticBrandCompositionInput,
  plan: StaticBrandCompositionPlan,
): StaticBrandCompositionSnapshot {
  return {
    schemaVersion: 1,
    canvas: plan.canvas,
    visualStyle: input.brand.visualStyle,
    colors: plan.colors,
    typography: {
      heading: plan.typography.headingFamily,
      body: plan.typography.bodyFamily,
      display: plan.typography.displayFamily,
      fallback: plan.typography.fallbackFamily,
      weights: plan.typography.weights,
      usedFallback: plan.typography.usedFallback,
      unavailable: plan.typography.unavailable,
    },
    tokens: {
      logoPosition: input.brand.tokens.logoPosition,
      logoSafeMargin: input.brand.tokens.logoSafeMargin,
      overlayOpacity: input.brand.tokens.overlayOpacity,
      gradientStyle: input.brand.tokens.gradientStyle,
    },
    logo: plan.logo
      ? {
          present: true,
          mimeType: plan.logo.mimeType,
          width: plan.logo.width,
          height: plan.logo.height,
          widthFraction: plan.logo.widthFraction,
          position: plan.logo.position,
        }
      : {
          present: false,
          mimeType: null,
          width: null,
          height: null,
          widthFraction: null,
          position: null,
        },
    appliedElements: plan.appliedElements,
    warnings: plan.warnings,
  };
}

// ---------------------------------------------------------------------------
// Validação
// ---------------------------------------------------------------------------

function validateCanvas(canvas: StaticBrandCompositionCanvas): void {
  if (!Number.isFinite(canvas.width) || !Number.isFinite(canvas.height)) {
    throw new StaticCompositionError("canvas_invalid_dimensions");
  }
  if (canvas.width <= 0 || canvas.height <= 0) {
    throw new StaticCompositionError("canvas_invalid_dimensions");
  }
  if (canvas.width > MAX_CANVAS_DIMENSION || canvas.height > MAX_CANVAS_DIMENSION) {
    throw new StaticCompositionError("canvas_too_large");
  }
  if (canvas.width * canvas.height > MAX_CANVAS_PIXELS) {
    throw new StaticCompositionError("canvas_too_large");
  }
}

function validateBaseImage(img: StaticBaseImage): void {
  if (!img || typeof img.href !== "string" || img.href.length === 0) {
    throw new StaticCompositionError("base_image_missing");
  }
  if (!img.mimeType || !img.mimeType.startsWith("image/")) {
    throw new StaticCompositionError("base_image_invalid_mime");
  }
  if (!Number.isFinite(img.width) || !Number.isFinite(img.height)) {
    throw new StaticCompositionError("base_image_invalid_dimensions");
  }
  if (img.width <= 0 || img.height <= 0) {
    throw new StaticCompositionError("base_image_invalid_dimensions");
  }
  if (img.width > MAX_CANVAS_DIMENSION || img.height > MAX_CANVAS_DIMENSION) {
    throw new StaticCompositionError("base_image_too_large");
  }
  if (img.width * img.height > MAX_CANVAS_PIXELS) {
    throw new StaticCompositionError("base_image_too_large");
  }
}

// ---------------------------------------------------------------------------
// Tipografia
// ---------------------------------------------------------------------------

function resolveTypography(
  typography: BrandTypography,
  warnings: string[],
): ResolvedTypography {
  const unavailable: string[] = [];
  const pick = (requested: string): string => {
    if (STATIC_FONT_ALLOWLIST.has(requested)) return requested;
    unavailable.push(requested);
    return "";
  };
  const heading = pick(typography.heading);
  const body = pick(typography.body);
  const display = pick(typography.display);

  const brandFallback = typography.fallback?.trim() || "";
  const safeFallback = brandFallback.length > 0 ? brandFallback : SYSTEM_FALLBACK_FONT;
  const usedFallback = !heading || !body || !display;

  if (usedFallback) {
    warnings.push("typography_fallback_applied");
  }

  return {
    headingFamily: heading || safeFallback,
    bodyFamily: body || safeFallback,
    displayFamily: display || safeFallback,
    fallbackFamily: safeFallback,
    weights: (typography.weights ?? []).filter((w) => Number.isFinite(w) && w >= 100 && w <= 900),
    usedFallback,
    unavailable,
  };
}

// ---------------------------------------------------------------------------
// Overlays / gradiente
// ---------------------------------------------------------------------------

function buildOverlays(
  brand: MarketingBrandContext,
  format: StaticCanvasFormat,
): OverlayLayer[] {
  const layers: OverlayLayer[] = [];
  const opacity = clamp(brand.tokens.overlayOpacity ?? 0, 0, 1);
  if (opacity > 0) {
    layers.push({
      kind: "solid",
      opacity,
      colorStops: [{ offset: 0, color: brand.colors.background }],
      angle: 0,
    });
  }
  const gradient = brand.tokens.gradientStyle;
  if (gradient !== "none") {
    const isVibrant = gradient === "vibrant";
    const gradOpacity = isVibrant ? 0.55 : 0.32;
    // Gradiente para a base de texto: mais escuro embaixo em stories,
    // mais equilibrado em feed.
    const angle = format === "story_9_16" ? 180 : 200;
    layers.push({
      kind: "linearGradient",
      opacity: gradOpacity,
      colorStops: [
        { offset: 0, color: withAlpha(brand.colors.background, 0) },
        { offset: 1, color: brand.colors.primary },
      ],
      angle,
    });
  }
  return layers;
}

// ---------------------------------------------------------------------------
// Logo
// ---------------------------------------------------------------------------

function placeLogo(
  logo: MarketingBrandLogo,
  canvas: StaticBrandCompositionCanvas,
  position: BrandLogoPosition,
  tokenSafeMargin: number,
): LogoPlacement {
  const baseFraction = LOGO_WIDTH_FRACTION_BY_FORMAT[canvas.format] ?? 0.18;
  const fraction = clamp(baseFraction, LOGO_MIN_FRACTION, LOGO_MAX_FRACTION);
  const minDim = Math.min(canvas.width, canvas.height);
  const targetWidth = Math.round(minDim * fraction);

  const ratio =
    logo.width && logo.height && logo.width > 0 && logo.height > 0
      ? logo.width / logo.height
      : 1;
  const width = targetWidth;
  const height = Math.max(1, Math.round(width / ratio));

  // Safe margin final: max(token, 3% da menor dimensão, story safe area).
  const safeMarginBase = Math.max(tokenSafeMargin, Math.round(minDim * 0.03));
  const storyTopExtra =
    canvas.format === "story_9_16" ? Math.round(canvas.height * STORY_TOP_SAFE_FRACTION) : 0;
  const storyBottomExtra =
    canvas.format === "story_9_16"
      ? Math.round(canvas.height * STORY_BOTTOM_SAFE_FRACTION)
      : 0;

  const { x, y } = anchorPosition({
    position,
    canvas,
    width,
    height,
    marginX: safeMarginBase,
    marginTop: safeMarginBase + storyTopExtra,
    marginBottom: safeMarginBase + storyBottomExtra,
  });

  return {
    href: logo.url,
    mimeType: logo.mimeType,
    position,
    x,
    y,
    width,
    height,
    widthFraction: width / canvas.width,
    safeMargin: safeMarginBase,
  };
}

function anchorPosition(args: {
  position: BrandLogoPosition;
  canvas: StaticBrandCompositionCanvas;
  width: number;
  height: number;
  marginX: number;
  marginTop: number;
  marginBottom: number;
}): { x: number; y: number } {
  const { position, canvas, width, height, marginX, marginTop, marginBottom } = args;
  const cx = Math.round((canvas.width - width) / 2);
  const cy = Math.round((canvas.height - height) / 2);
  const right = canvas.width - width - marginX;
  const bottom = canvas.height - height - marginBottom;
  switch (position) {
    case "top-left":
      return { x: marginX, y: marginTop };
    case "top-center":
      return { x: cx, y: marginTop };
    case "top-right":
      return { x: right, y: marginTop };
    case "bottom-left":
      return { x: marginX, y: bottom };
    case "bottom-center":
      return { x: cx, y: bottom };
    case "bottom-right":
      return { x: right, y: bottom };
    case "center":
      return { x: cx, y: cy };
    default:
      return { x: marginX, y: marginTop };
  }
}

// ---------------------------------------------------------------------------
// Texto
// ---------------------------------------------------------------------------

function layoutTextRegions(
  content: StaticBrandCompositionContent,
  canvas: StaticBrandCompositionCanvas,
  colors: BrandColors,
  typography: ResolvedTypography,
  logo: LogoPlacement | null,
): TextRegion[] {
  const regions: TextRegion[] = [];
  const paddingX = Math.round(canvas.width * 0.06);
  const bottomBase = canvas.height - Math.round(canvas.height * 0.08);
  const maxWidth = canvas.width - paddingX * 2;
  const headlineSize = Math.round(canvas.width * 0.06);
  const subheadlineSize = Math.round(canvas.width * 0.035);
  const priceSize = Math.round(canvas.width * 0.07);
  const ctaSize = Math.round(canvas.width * 0.032);

  // Área que a logo ocupa (aproximada) para evitar sobreposição no bottom.
  let yCursor = bottomBase;

  const pushTop = (region: TextRegion, sizePx: number) => {
    region.y = yCursor;
    yCursor -= Math.round(sizePx * 1.35);
    regions.push(region);
  };

  if (content.callToAction && content.callToAction.trim()) {
    pushTop(
      makeRegion({
        role: "cta",
        text: clip(content.callToAction, 40),
        x: Math.round(canvas.width / 2),
        maxWidth,
        fontFamily: typography.bodyFamily,
        fontWeight: 700,
        fontSizePx: ctaSize,
        color: colors.textInverse,
        textAlign: "center",
      }),
      ctaSize,
    );
  }
  if (content.price && content.price.trim()) {
    pushTop(
      makeRegion({
        role: "price",
        text: clip(content.price, 24),
        x: Math.round(canvas.width / 2),
        maxWidth,
        fontFamily: typography.displayFamily,
        fontWeight: 800,
        fontSizePx: priceSize,
        color: colors.accent,
        textAlign: "center",
      }),
      priceSize,
    );
  }
  if (content.subheadline && content.subheadline.trim()) {
    pushTop(
      makeRegion({
        role: "subheadline",
        text: clip(content.subheadline, 90),
        x: Math.round(canvas.width / 2),
        maxWidth,
        fontFamily: typography.bodyFamily,
        fontWeight: 500,
        fontSizePx: subheadlineSize,
        color: colors.textInverse,
        textAlign: "center",
      }),
      subheadlineSize,
    );
  }
  if (content.headline && content.headline.trim()) {
    pushTop(
      makeRegion({
        role: "headline",
        text: clip(content.headline, 60),
        x: Math.round(canvas.width / 2),
        maxWidth,
        fontFamily: typography.headingFamily,
        fontWeight: 800,
        fontSizePx: headlineSize,
        color: colors.textInverse,
        textAlign: "center",
      }),
      headlineSize,
    );
  }

  // Anti-sobreposição da logo: se a logo estiver no rodapé, empurra textos
  // para cima.
  if (logo) {
    const logoTop = logo.y;
    const logoBottom = logo.y + logo.height;
    for (const r of regions) {
      const yTop = r.y - r.fontSizePx;
      const yBottom = r.y;
      const overlaps =
        yBottom >= logoTop - r.fontSizePx * 0.4 && yTop <= logoBottom + r.fontSizePx * 0.4;
      if (overlaps) {
        r.y = logoTop - Math.round(r.fontSizePx * 0.6);
      }
    }
  }
  return regions;
}

function makeRegion(args: {
  role: TextRegion["role"];
  text: string;
  x: number;
  maxWidth: number;
  fontFamily: string;
  fontWeight: number;
  fontSizePx: number;
  color: string;
  textAlign: TextRegion["textAlign"];
}): TextRegion {
  return {
    role: args.role,
    text: args.text,
    x: args.x,
    y: 0,
    maxWidth: args.maxWidth,
    fontFamily: args.fontFamily,
    fontWeight: args.fontWeight,
    fontSizePx: args.fontSizePx,
    color: args.color,
    textAlign: args.textAlign,
  };
}

// ---------------------------------------------------------------------------
// SVG overlay
// ---------------------------------------------------------------------------

function renderSvgOverlay(args: {
  canvas: StaticBrandCompositionCanvas;
  overlays: OverlayLayer[];
  logo: LogoPlacement | null;
  textRegions: TextRegion[];
}): string {
  const { canvas, overlays, logo, textRegions } = args;
  const defs: string[] = [];
  const body: string[] = [];

  overlays.forEach((layer, i) => {
    if (layer.kind === "solid") {
      body.push(
        `<rect x="0" y="0" width="${canvas.width}" height="${canvas.height}" fill="${escapeAttr(layer.colorStops[0]?.color ?? "#000000")}" opacity="${layer.opacity.toFixed(3)}"/>`,
      );
    } else {
      const id = `grad-${i}`;
      const stops = layer.colorStops
        .map(
          (s) =>
            `<stop offset="${(s.offset * 100).toFixed(1)}%" stop-color="${escapeAttr(s.color)}"/>`,
        )
        .join("");
      const rad = (layer.angle * Math.PI) / 180;
      const x1 = 50 - Math.cos(rad) * 50;
      const y1 = 50 - Math.sin(rad) * 50;
      const x2 = 50 + Math.cos(rad) * 50;
      const y2 = 50 + Math.sin(rad) * 50;
      defs.push(
        `<linearGradient id="${id}" x1="${x1}%" y1="${y1}%" x2="${x2}%" y2="${y2}%">${stops}</linearGradient>`,
      );
      body.push(
        `<rect x="0" y="0" width="${canvas.width}" height="${canvas.height}" fill="url(#${id})" opacity="${layer.opacity.toFixed(3)}"/>`,
      );
    }
  });

  for (const r of textRegions) {
    body.push(
      `<text x="${r.x}" y="${r.y}" text-anchor="${textAnchor(r.textAlign)}" font-family="${escapeAttr(r.fontFamily)}" font-weight="${r.fontWeight}" font-size="${r.fontSizePx}" fill="${escapeAttr(r.color)}" data-role="${r.role}">${escapeText(r.text)}</text>`,
    );
  }

  if (logo) {
    // Placeholder slot: rasterizador substitui `data-logo-slot` pela imagem
    // binária local. NÃO embutimos a signed URL diretamente aqui para
    // permitir cache/rasterização segura.
    body.push(
      `<rect data-logo-slot="1" x="${logo.x}" y="${logo.y}" width="${logo.width}" height="${logo.height}" fill="none"/>`,
    );
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${canvas.width}" height="${canvas.height}" viewBox="0 0 ${canvas.width} ${canvas.height}">${defs.length ? `<defs>${defs.join("")}</defs>` : ""}${body.join("")}</svg>`;
}

// ---------------------------------------------------------------------------
// Utilitários
// ---------------------------------------------------------------------------

function clamp(v: number, lo: number, hi: number): number {
  if (!Number.isFinite(v)) return lo;
  return Math.max(lo, Math.min(hi, v));
}

function clip(s: string, max: number): string {
  const t = s.trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max - 1);
  const sp = cut.lastIndexOf(" ");
  return (sp > max / 2 ? cut.slice(0, sp) : cut) + "…";
}

function textAnchor(a: TextRegion["textAlign"]): string {
  return a === "left" ? "start" : a === "right" ? "end" : "middle";
}

function escapeAttr(s: string): string {
  return String(s).replace(/[<>&"']/g, (c) =>
    c === "<"
      ? "&lt;"
      : c === ">"
        ? "&gt;"
        : c === "&"
          ? "&amp;"
          : c === '"'
            ? "&quot;"
            : "&#39;",
  );
}
function escapeText(s: string): string {
  return String(s).replace(/[<>&]/g, (c) =>
    c === "<" ? "&lt;" : c === ">" ? "&gt;" : "&amp;",
  );
}

function withAlpha(hex: string, alpha: number): string {
  // Aceita #RRGGBB, senão devolve como está — o SVG usa `opacity` da camada.
  const m = /^#([0-9a-fA-F]{6})$/.exec(hex);
  if (!m) return hex;
  const a = clamp(alpha, 0, 1);
  const aa = Math.round(a * 255)
    .toString(16)
    .padStart(2, "0");
  return `#${m[1]}${aa}`;
}
