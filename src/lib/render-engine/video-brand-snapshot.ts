// ============================================================================
// Render Engine — Video Brand Snapshot (Fase 5.A)
//
// Contrato imutável e versionado que trava a identidade visual da empresa
// no momento em que o job de render é criado. Persistido em
// `video_render_jobs.video_brand` (jsonb).
//
// REGRAS:
//   - schemaVersion é obrigatório para futura evolução compatível.
//   - NUNCA persistir signed URL da logo aqui. A URL temporária é assinada
//     na bridge (`/api/public/render/claim`) a cada tentativa a partir do
//     `logoAssetId` + `brandVersionId`.
//   - NUNCA persistir service role, tokens ou dados desnecessários.
//   - Snapshot fica fixo para o job: retry não muda de versão de marca.
// ============================================================================

import type { BrandContext, BrandLogoPosition } from "@/lib/brand-center/brand.types";

export const VIDEO_BRAND_SCHEMA_VERSION = 1 as const;

export interface VideoBrandLogoSnapshot {
  /** ID do asset em `brand_assets`. Usado pela bridge para reassinar acesso. */
  assetId: string;
  mimeType: string;
  width: number | null;
  height: number | null;
}

export interface VideoBrandColorsSnapshot {
  primary: string;
  secondary: string;
  accent: string;
  text: string;
  textInverse: string;
  background: string;
}

export interface VideoBrandTokensSnapshot {
  /** Posição da logo — mapeada para overlay x/y no FFmpeg. */
  logoPosition: BrandLogoPosition;
  /** Margem segura da logo, em px de referência (é convertida em fração do frame). */
  logoSafeMargin: number;
  /** Opacidade do overlay (0..1). */
  overlayOpacity: number;
  /** Estilo de gradiente reservado para intro/outro (Fase 5.B). */
  gradientStyle: "none" | "subtle" | "vibrant";
}

export interface VideoBrandWatermarkSnapshot {
  enabled: boolean;
  /** Opacidade final da logo (0..1). Clampado 0.75-0.90 nesta fase. */
  opacity: number;
  /** Largura máxima da logo como fração do frame (0..1). Clampado 0.10-0.18. */
  maxWidthRatio: number;
}

/**
 * Contrato completo do snapshot. Campos `intro`/`outro` estão presentes no
 * schemaVersion:1 mas ficam `enabled:false` na Fase 5.A — serão ativados na
 * Fase 5.B sem quebrar o contrato.
 */
export interface VideoBrandSnapshot {
  schemaVersion: typeof VIDEO_BRAND_SCHEMA_VERSION;
  brandVersionId: string;
  enabled: boolean;
  logo: VideoBrandLogoSnapshot | null;
  colors: VideoBrandColorsSnapshot;
  tokens: VideoBrandTokensSnapshot;
  watermark: VideoBrandWatermarkSnapshot;
  intro: { enabled: false; durationSeconds: number };
  outro: { enabled: false; durationSeconds: number; headline: null; callToAction: null };
}

// ---------------------------------------------------------------------------
// Builder
// ---------------------------------------------------------------------------

const WATERMARK_OPACITY_MIN = 0.75;
const WATERMARK_OPACITY_MAX = 0.9;
const WATERMARK_WIDTH_MIN = 0.1;
const WATERMARK_WIDTH_MAX = 0.18;
const WATERMARK_WIDTH_DEFAULT_REELS = 0.14;
const WATERMARK_WIDTH_DEFAULT_FEED = 0.16;

/**
 * Constrói o snapshot a partir do contexto de marca do Marketing IA.
 * Retorna `null` quando a empresa não tem versão publicada — o job será
 * criado sem `video_brand` e renderizado exatamente como antes.
 *
 * Pura: sem IO. `logoAssetId` deve vir do BrandContext original (é o
 * `assets.byType.logo_primary?.id`, que o adapter descarta ao criar
 * `MarketingBrandContext` — por isso este builder recebe o id à parte).
 */
export function buildVideoBrandSnapshot(params: {
  brandContext: MarketingBrandContext;
  brandVersionId: string | null;
  logoAssetId: string | null;
  videoFormat: "story" | "reels" | "feed_square" | "feed_4_5";
}): VideoBrandSnapshot | null {
  const { brandContext, brandVersionId, logoAssetId, videoFormat } = params;

  // Sem versão publicada → sem snapshot (fallback: renderiza como antes).
  if (brandContext.isFallback || !brandVersionId) return null;

  const isVertical = videoFormat === "story" || videoFormat === "reels";
  const defaultWidthRatio = isVertical
    ? WATERMARK_WIDTH_DEFAULT_REELS
    : WATERMARK_WIDTH_DEFAULT_FEED;

  const logo: VideoBrandLogoSnapshot | null =
    brandContext.logo && logoAssetId
      ? {
          assetId: logoAssetId,
          mimeType: brandContext.logo.mimeType,
          width: brandContext.logo.width,
          height: brandContext.logo.height,
        }
      : null;

  const overlayOpacityClamped = clamp(
    brandContext.tokens.overlayOpacity,
    WATERMARK_OPACITY_MIN,
    WATERMARK_OPACITY_MAX,
  );

  return {
    schemaVersion: VIDEO_BRAND_SCHEMA_VERSION,
    brandVersionId,
    enabled: !!logo, // Sem logo, watermark desabilita — cores ficam para 5.B.
    logo,
    colors: {
      primary: brandContext.colors.primary,
      secondary: brandContext.colors.secondary,
      accent: brandContext.colors.accent,
      text: brandContext.colors.text,
      textInverse: brandContext.colors.textInverse,
      background: brandContext.colors.background,
    },
    tokens: {
      logoPosition: brandContext.tokens.logoPosition,
      logoSafeMargin: brandContext.tokens.logoSafeMargin,
      overlayOpacity: overlayOpacityClamped,
      gradientStyle: brandContext.tokens.gradientStyle,
    },
    watermark: {
      enabled: !!logo,
      opacity: overlayOpacityClamped,
      maxWidthRatio: clamp(defaultWidthRatio, WATERMARK_WIDTH_MIN, WATERMARK_WIDTH_MAX),
    },
    intro: { enabled: false, durationSeconds: 1.2 },
    outro: { enabled: false, durationSeconds: 2.0, headline: null, callToAction: null },
  };
}

function clamp(v: number, min: number, max: number): number {
  if (!Number.isFinite(v)) return min;
  return Math.max(min, Math.min(max, v));
}

// ---------------------------------------------------------------------------
// Runtime validation (bridge + worker usam para revalidar o snapshot)
// ---------------------------------------------------------------------------

export function isVideoBrandSnapshot(v: unknown): v is VideoBrandSnapshot {
  if (!v || typeof v !== "object") return false;
  const o = v as Record<string, unknown>;
  return (
    o.schemaVersion === VIDEO_BRAND_SCHEMA_VERSION &&
    typeof o.brandVersionId === "string" &&
    typeof o.enabled === "boolean" &&
    typeof o.colors === "object" &&
    typeof o.tokens === "object" &&
    typeof o.watermark === "object"
  );
}
