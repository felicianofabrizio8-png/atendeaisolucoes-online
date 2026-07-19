/**
 * Brand Center — Contrato público do domínio.
 *
 * O `BrandContext` é a única representação estável consumida por outros
 * módulos (Marketing IA, PDFs, Landing Pages, etc). A modelagem interna
 * (tabelas, colunas, JSONB) pode evoluir sem quebrar consumidores desde
 * que este contrato seja preservado.
 *
 * IMPORTANTE
 * - Não incluir campos específicos de segmento (piscina, moda, buffet…).
 * - Nunca conter signed URLs. Assets são retornados como referência estável
 *   (`storage_bucket` + `storage_path`) — o consumidor gera signed URL sob
 *   demanda no seu próprio contexto (SSR / worker / edge).
 */

export type BrandStatus = "active" | "archived";
export type BrandVersionStatus = "draft" | "published" | "archived";

export type BrandAssetType =
  | "logo_primary"
  | "logo_light"
  | "logo_dark"
  | "symbol"
  | "favicon"
  | "watermark"
  | "decorative_element"
  | "texture"
  | "background_pattern";

export interface BrandColors {
  primary: string;
  secondary: string;
  accent: string;
  background: string;
  surface: string;
  text: string;
  textInverse: string;
}

export interface BrandTypography {
  body: string;
  heading: string;
  display: string;
  weights: number[];
  fallback: string;
}

export type BrandLogoPosition =
  | "top-left"
  | "top-right"
  | "top-center"
  | "bottom-left"
  | "bottom-right"
  | "bottom-center"
  | "center";

export type BrandImageStyle = "photographic" | "illustrated" | "minimal" | "mixed";
export type BrandGradientStyle = "none" | "subtle" | "vibrant";

export interface BrandTokens {
  radius: number;               // em px, aplicado como base
  shadowIntensity: number;      // 0..1
  spacingBase: number;          // em px
  overlayOpacity: number;       // 0..1
  logoPosition: BrandLogoPosition;
  logoSafeMargin: number;       // em px
  imageStyle: BrandImageStyle;
  gradientStyle: BrandGradientStyle;
}

/**
 * Referência estável a um asset de marca. NÃO contém signed URL.
 * Consumidores geram signed URL sob demanda via `supabase.storage`.
 */
export interface BrandAssetRef {
  id: string;
  type: BrandAssetType;
  storageBucket: string;
  storagePath: string;
  mimeType: string;
  width: number | null;
  height: number | null;
}

/**
 * Contrato público consumido por qualquer módulo do sistema.
 */
export interface BrandContext {
  companyId: string;
  profileId: string | null;
  versionId: string | null;
  status: BrandVersionStatus;
  visualStyle: string | null;
  colors: BrandColors;
  typography: BrandTypography;
  tokens: BrandTokens;
  assets: {
    /** Assets ativos e resolvidos, indexados por tipo (ausência = null). */
    byType: Record<BrandAssetType, BrandAssetRef | null>;
    /** Lista bruta em ordem estável (útil para iteração). */
    all: BrandAssetRef[];
  };
  /** True quando não há identidade configurada e todos os campos vieram de defaults. */
  isFallback: boolean;
}

/**
 * Entrada bruta do repositório para o resolver puro.
 * Mantida separada do BrandContext para permitir evolução do schema.
 */
export interface BrandResolverInput {
  companyId: string;
  profile: {
    id: string;
    visualStyle: string | null;
  } | null;
  version: {
    id: string;
    status: BrandVersionStatus;
    /** schema_version persistido junto do JSONB. Ausente = legado (=1). */
    schemaVersion?: number | null;
    colors: unknown;
    typography: unknown;
    tokens: unknown;
  } | null;
  assets: Array<{
    id: string;
    type: string;
    storageBucket: string;
    storagePath: string;
    mimeType: string;
    width: number | null;
    height: number | null;
  }>;
}
