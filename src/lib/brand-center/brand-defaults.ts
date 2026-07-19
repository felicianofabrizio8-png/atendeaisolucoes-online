/**
 * Defaults neutros e profissionais do Brand Center.
 *
 * Aplicados quando a empresa ainda não configurou identidade visual ou
 * quando um campo específico está ausente/ inválido. Devem servir para
 * qualquer segmento — nunca conter referências a piscina, moda, buffet,
 * ou a qualquer empresa específica (ex.: Solário).
 */

import type {
  BrandAssetType,
  BrandColors,
  BrandTokens,
  BrandTypography,
} from "./brand.types";

export const DEFAULT_COLORS: BrandColors = {
  primary: "#111827",       // slate-900 — neutro escuro
  secondary: "#374151",     // slate-700
  accent: "#2563EB",        // blue-600 — CTA neutro
  background: "#FFFFFF",
  surface: "#F9FAFB",       // slate-50
  text: "#111827",
  textInverse: "#FFFFFF",
};

export const DEFAULT_TYPOGRAPHY: BrandTypography = {
  body: "Inter",
  heading: "Inter",
  display: "Inter",
  weights: [400, 500, 600, 700],
  fallback:
    "system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif",
};

export const DEFAULT_TOKENS: BrandTokens = {
  radius: 8,
  shadowIntensity: 0.15,
  spacingBase: 8,
  overlayOpacity: 0.4,
  logoPosition: "bottom-right",
  logoSafeMargin: 24,
  imageStyle: "photographic",
  gradientStyle: "subtle",
};

export const ASSET_TYPES: readonly BrandAssetType[] = [
  "logo_primary",
  "logo_light",
  "logo_dark",
  "symbol",
  "favicon",
  "watermark",
  "decorative_element",
  "texture",
  "background_pattern",
] as const;
