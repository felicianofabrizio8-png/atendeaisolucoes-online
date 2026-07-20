// ============================================================================
// Marketing IA — Fase M2
//
// Resolve o `content` enviado ao snapshot de marca (video_brand.content) a
// partir de uma linha de `marketing_contents`.
//
// Regras (Fase M2):
//  - Prioridade: overlay_headline / overlay_subheadline / overlay_cta.
//  - Fallback determinístico p/ campanhas antigas usando title / body /
//    cta_text — sempre reescrito com fitWords / summarizeBodyForSubheadline.
//  - Nunca truncar palavras. Nunca terminar em conectivo. Não usar reticências.
//  - Retorna telemetria com fonte usada e campos que caíram no fallback.
//
// Este módulo é puro (sem I/O). É consumido pelo caminho de enfileiramento de
// jobs em `marketing-campaign.functions.ts`.
// ============================================================================

import {
  fitWords,
  summarizeBodyForSubheadline,
} from "./overlay-texts";

/** Limites duros da Fase M2 (espelham a spec do overlay visual). */
export const OVERLAY_LIMITS = {
  headline: { maxWords: 5, maxChars: 28 },
  subheadline: { maxWords: 8, maxChars: 45 },
  cta: { maxWords: 4, maxChars: 40 },
} as const;

export interface MarketingRowOverlaySource {
  title: string | null;
  body: string | null;
  cta_text: string | null;
  overlay_headline: string | null;
  overlay_subheadline: string | null;
  overlay_cta: string | null;
}

export interface RenderContentPayload {
  headline: string | null;
  supportingText: string | null;
  ctaText: string | null;
}

export interface ResolvedOverlayContent {
  content: RenderContentPayload;
  telemetry: {
    /** overlay_fields → todos os campos usados vieram de overlay_*. */
    /** legacy_fallback → pelo menos um campo caiu no title/body/cta_text. */
    source: "overlay_fields" | "legacy_fallback";
    overlay_fields: {
      headline: "overlay" | "legacy_title" | "empty";
      subheadline: "overlay" | "legacy_body" | "empty";
      cta: "overlay" | "legacy_cta_text" | "empty";
    };
    legacy_fallback: boolean;
    fallbacks: string[];
    lengths: {
      headline: number;
      supportingText: number;
      ctaText: number;
    };
  };
}

function safeString(v: string | null | undefined): string {
  return (v ?? "").trim();
}

/**
 * Reescreve valor legado (title/body/cta_text) respeitando limites de palavras
 * e caracteres, sem truncar palavras. Retorna string vazia quando não sobrar
 * nada válido.
 */
function fitLegacy(
  raw: string,
  kind: "headline" | "subheadline" | "cta",
): string {
  const limits = OVERLAY_LIMITS[kind];
  if (kind === "subheadline") return summarizeBodyForSubheadline(raw);
  return fitWords(raw, limits.maxWords, limits.maxChars);
}

/**
 * Ponto único de leitura de textos visuais para o Render Engine.
 * Aceita rows tanto do fluxo novo (Fase M1) quanto legado.
 */
export function resolveOverlayContentFromRow(
  row: MarketingRowOverlaySource,
): ResolvedOverlayContent {
  const fallbacks: string[] = [];
  const fieldsSource: ResolvedOverlayContent["telemetry"]["overlay_fields"] = {
    headline: "empty",
    subheadline: "empty",
    cta: "empty",
  };

  // ---------- headline ----------
  let headline: string | null = null;
  const ov = safeString(row.overlay_headline);
  if (ov) {
    // valor já normalizado pela Fase M1. Passar por fitLegacy garante
    // segurança defensiva (caso algum legado ultrapasse o limite).
    const fitted = fitLegacy(ov, "headline");
    headline = fitted || null;
    if (headline) {
      fieldsSource.headline = "overlay";
      if (fitted !== ov) fallbacks.push("headline_overlay_refitted");
    }
  }
  if (!headline) {
    const legacyTitle = safeString(row.title);
    if (legacyTitle) {
      const fitted = fitLegacy(legacyTitle, "headline");
      if (fitted) {
        headline = fitted;
        fieldsSource.headline = "legacy_title";
        fallbacks.push("headline_from_title");
      }
    }
  }

  // ---------- subheadline ----------
  let supportingText: string | null = null;
  const osub = safeString(row.overlay_subheadline);
  if (osub) {
    const fitted = fitLegacy(osub, "subheadline");
    supportingText = fitted || null;
    if (supportingText) {
      fieldsSource.subheadline = "overlay";
      if (fitted !== osub) fallbacks.push("subheadline_overlay_refitted");
    }
  }
  if (!supportingText) {
    const legacyBody = safeString(row.body);
    if (legacyBody) {
      const fitted = fitLegacy(legacyBody, "subheadline");
      if (fitted) {
        supportingText = fitted;
        fieldsSource.subheadline = "legacy_body";
        fallbacks.push("subheadline_from_body");
      }
    }
  }

  // ---------- cta ----------
  let ctaText: string | null = null;
  const octa = safeString(row.overlay_cta);
  if (octa) {
    const fitted = fitLegacy(octa, "cta");
    ctaText = fitted || null;
    if (ctaText) {
      fieldsSource.cta = "overlay";
      if (fitted !== octa) fallbacks.push("cta_overlay_refitted");
    }
  }
  if (!ctaText) {
    const legacyCta = safeString(row.cta_text);
    if (legacyCta) {
      const fitted = fitLegacy(legacyCta, "cta");
      if (fitted) {
        ctaText = fitted;
        fieldsSource.cta = "legacy_cta_text";
        fallbacks.push("cta_from_cta_text");
      }
    }
  }

  const legacyFallback =
    fieldsSource.headline === "legacy_title" ||
    fieldsSource.subheadline === "legacy_body" ||
    fieldsSource.cta === "legacy_cta_text";

  return {
    content: { headline, supportingText, ctaText },
    telemetry: {
      source: legacyFallback ? "legacy_fallback" : "overlay_fields",
      overlay_fields: fieldsSource,
      legacy_fallback: legacyFallback,
      fallbacks,
      lengths: {
        headline: headline?.length ?? 0,
        supportingText: supportingText?.length ?? 0,
        ctaText: ctaText?.length ?? 0,
      },
    },
  };
}
