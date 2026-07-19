// ============================================================================
// Render Engine — Video Brand Snapshot (Fase 5.A + 5.B1)
//
// Contrato imutável e versionado da identidade visual usada em um render job.
// Persistido em `video_render_jobs.video_brand` (jsonb).
//
// Evolução de schema:
//   - v1 (Fase 5.A): watermark apenas. `intro`/`outro` presentes mas desligados.
//   - v2 (Fase 5.B1): adiciona `content` (headline/supportingText/ctaText/
//     companyName) usado pelo Brand Composer do worker para gerar camadas
//     visuais (painel inferior com texto + tela final de marca).
//
// Regras invioláveis:
//   - Snapshot fica fixo para o job. Retry NÃO muda de versão de marca.
//   - Nunca persistir signed URL da logo. A bridge assina no claim.
//   - Nunca persistir service role, tokens ou dados desnecessários.
//   - Runtime validation aceita v1 E v2 (compatibilidade retroativa).
// ============================================================================

import type { BrandContext, BrandLogoPosition } from "@/lib/brand-center/brand.types";

/** Versão atual do schema. Bump apenas quando adicionar campos NÃO opcionais. */
export const VIDEO_BRAND_SCHEMA_VERSION = 2 as const;

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
  logoPosition: BrandLogoPosition;
  logoSafeMargin: number;
  overlayOpacity: number;
  gradientStyle: "none" | "subtle" | "vibrant";
}

export interface VideoBrandWatermarkSnapshot {
  enabled: boolean;
  opacity: number;
  maxWidthRatio: number;
}

/**
 * Conteúdo textual determinístico (Fase 5.B1). Cada campo é opcional; o
 * composer só desenha as camadas para campos presentes. Limites de tamanho
 * são aplicados aqui — o worker confia no input.
 *
 * Campos:
 *  - headline: título curto exibido no painel inferior durante o vídeo
 *              (fonte serif, alto contraste). Ex.: título do conteúdo.
 *  - supportingText: subtítulo opcional logo abaixo da headline.
 *  - ctaText: chamada para ação (fonte sans-serif, botão pill). Aparece no
 *             painel inferior e reutilizada na tela final.
 *  - companyName: nome exibido na tela final ao lado da logo.
 */
export interface VideoBrandContentSnapshot {
  headline: string | null;
  supportingText: string | null;
  ctaText: string | null;
  companyName: string | null;
}

export interface VideoBrandSnapshot {
  /** 1 = Fase 5.A (só watermark). 2 = Fase 5.B1 (com content + intro/outro). */
  schemaVersion: 1 | 2;
  brandVersionId: string;
  enabled: boolean;
  logo: VideoBrandLogoSnapshot | null;
  colors: VideoBrandColorsSnapshot;
  tokens: VideoBrandTokensSnapshot;
  watermark: VideoBrandWatermarkSnapshot;
  intro: { enabled: boolean; durationSeconds: number };
  outro: {
    enabled: boolean;
    durationSeconds: number;
    headline: string | null;
    callToAction: string | null;
  };
  /** Somente v2. Ausente em snapshots v1 legados. */
  content?: VideoBrandContentSnapshot;
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

const HEADLINE_MAX = 90;
const SUPPORTING_MAX = 140;
const CTA_MAX = 32;
const COMPANY_NAME_MAX = 60;
const OUTRO_DURATION_DEFAULT = 2.0;

/**
 * Sanitiza texto vindo do banco antes de persistir no snapshot:
 * - trim
 * - remove control chars e quebras exageradas
 * - trunca com respeito a whitespace
 * - retorna null quando o resultado é vazio
 */
function sanitizeText(input: string | null | undefined, max: number): string | null {
  if (typeof input !== "string") return null;
  const cleaned = input
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001F\u007F]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned) return null;
  if (cleaned.length <= max) return cleaned;
  const cut = cleaned.slice(0, max);
  const lastSpace = cut.lastIndexOf(" ");
  return (lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut).trimEnd() + "…";
}

/**
 * Constrói o snapshot a partir do BrandContext bruto do Brand Center + textos
 * opcionais resolvidos server-side no fluxo do Marketing IA.
 *
 * Retorna `null` quando a empresa não tem versão publicada — job segue sem
 * `video_brand` e o render mantém o comportamento antigo.
 *
 * Pura: sem IO.
 */
export function buildVideoBrandSnapshot(params: {
  brandContext: BrandContext;
  videoFormat: "story" | "reels" | "feed_square" | "feed_4_5";
  content?: {
    headline?: string | null;
    supportingText?: string | null;
    ctaText?: string | null;
    companyName?: string | null;
  } | null;
}): VideoBrandSnapshot | null {
  const { brandContext, videoFormat, content } = params;

  if (brandContext.isFallback || !brandContext.versionId) return null;

  const isVertical = videoFormat === "story" || videoFormat === "reels";
  const defaultWidthRatio = isVertical
    ? WATERMARK_WIDTH_DEFAULT_REELS
    : WATERMARK_WIDTH_DEFAULT_FEED;

  const logoAsset = brandContext.assets.byType.logo_primary;
  const logo: VideoBrandLogoSnapshot | null = logoAsset
    ? {
        assetId: logoAsset.id,
        mimeType: logoAsset.mimeType,
        width: logoAsset.width,
        height: logoAsset.height,
      }
    : null;

  const overlayOpacityClamped = clamp(
    brandContext.tokens.overlayOpacity,
    WATERMARK_OPACITY_MIN,
    WATERMARK_OPACITY_MAX,
  );

  const contentSnap: VideoBrandContentSnapshot = {
    headline: sanitizeText(content?.headline, HEADLINE_MAX),
    supportingText: sanitizeText(content?.supportingText, SUPPORTING_MAX),
    ctaText: sanitizeText(content?.ctaText, CTA_MAX),
    companyName: sanitizeText(content?.companyName, COMPANY_NAME_MAX),
  };

  const hasAnyText = !!(
    contentSnap.headline ||
    contentSnap.supportingText ||
    contentSnap.ctaText ||
    contentSnap.companyName
  );

  return {
    schemaVersion: VIDEO_BRAND_SCHEMA_VERSION,
    brandVersionId: brandContext.versionId,
    enabled: !!logo || hasAnyText,
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
    // Outro é habilitado quando há qualquer texto/logo para exibir na tela final.
    outro: {
      enabled: !!logo || !!contentSnap.companyName || !!contentSnap.ctaText,
      durationSeconds: OUTRO_DURATION_DEFAULT,
      headline: contentSnap.headline,
      callToAction: contentSnap.ctaText,
    },
    content: contentSnap,
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
  const sv = o.schemaVersion;
  const svOk = sv === 1 || sv === 2;
  return (
    svOk &&
    typeof o.brandVersionId === "string" &&
    typeof o.enabled === "boolean" &&
    typeof o.colors === "object" &&
    typeof o.tokens === "object" &&
    typeof o.watermark === "object"
  );
}
