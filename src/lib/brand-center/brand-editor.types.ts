/**
 * Tipos do editor administrativo do Brand Center.
 *
 * Contrato consumido pela tela `Identidade Visual` e pelas server functions
 * de edição. Não é reexportado como contrato público — consumidores externos
 * (Marketing IA, PDFs, etc.) devem continuar usando `BrandContext` e
 * `getBrandContext()`.
 */

import type {
  BrandAssetRef,
  BrandColors,
  BrandTokens,
  BrandTypography,
} from "./brand.types";

export type EditorAssetType = "logo_primary" | "favicon";

export const EDITOR_ASSET_TYPES: readonly EditorAssetType[] = [
  "logo_primary",
  "favicon",
] as const;

/** MIMEs aceitos nesta fase (SVG explicitamente bloqueado). */
export const ALLOWED_LOGO_MIMES = [
  "image/png",
  "image/jpeg",
  "image/webp",
] as const;

/** Extensões coerentes com os MIMEs — usadas para construir storage_path. */
export const MIME_TO_EXT: Record<(typeof ALLOWED_LOGO_MIMES)[number], string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
};

export const MAX_LOGO_BYTES = 5 * 1024 * 1024; // 5 MB

/** Fontes permitidas nesta fase (allowlist controlada — sem upload). */
export const ALLOWED_FONTS = [
  "Inter",
  "Poppins",
  "Montserrat",
  "Roboto",
  "Open Sans",
  "Lato",
  "Playfair Display",
  "Merriweather",
] as const;

export type AllowedFont = (typeof ALLOWED_FONTS)[number];

export interface BrandDraftPayload {
  name: string;
  description: string | null;
  visualStyle: string | null;
  colors: BrandColors;
  typography: BrandTypography;
  tokens: BrandTokens;
}

export interface BrandEditorProfile {
  id: string;
  name: string;
  description: string | null;
  visualStyle: string | null;
  activeVersionId: string | null;
}

export interface BrandEditorVersion {
  id: string;
  status: "draft" | "published" | "archived";
  versionNumber: number;
  colors: BrandColors;
  typography: BrandTypography;
  tokens: BrandTokens;
  publishedAt: string | null;
  updatedAt: string;
}

export interface BrandEditorState {
  companyId: string;
  isAdmin: boolean;
  profile: BrandEditorProfile | null;
  draft: BrandEditorVersion | null;
  published: BrandEditorVersion | null;
  assets: BrandAssetRef[];
}

export interface SignBrandAssetUploadResult {
  storagePath: string;
  token: string;
  bucket: "brand-assets";
}

export interface RegisterBrandAssetPayload {
  assetType: EditorAssetType;
  storagePath: string;
  mimeType: (typeof ALLOWED_LOGO_MIMES)[number];
  sizeBytes: number;
  width: number | null;
  height: number | null;
  sha256: string | null;
  originalFilename: string;
}
