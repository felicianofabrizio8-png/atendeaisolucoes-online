/**
 * Resolver puro do Brand Center.
 *
 * Recebe dados brutos do repositório (ou de um fixture em testes) e produz
 * um `BrandContext` normalizado, seguro, sem signed URLs e com defaults
 * aplicados quando necessário.
 *
 * Esta função NÃO acessa banco, storage ou rede — é testável isoladamente.
 */

import {
  ASSET_TYPES,
  DEFAULT_COLORS,
  DEFAULT_TOKENS,
  DEFAULT_TYPOGRAPHY,
} from "./brand-defaults";
import { parseColors, parseTokens, parseTypography } from "./brand-schema";
import type {
  BrandAssetRef,
  BrandAssetType,
  BrandContext,
  BrandResolverInput,
} from "./brand.types";

function isBrandAssetType(v: string): v is BrandAssetType {
  return (ASSET_TYPES as readonly string[]).includes(v);
}

function normalizeAssets(
  input: BrandResolverInput["assets"],
): { all: BrandAssetRef[]; byType: Record<BrandAssetType, BrandAssetRef | null> } {
  const byType: Record<BrandAssetType, BrandAssetRef | null> = {
    logo_primary: null,
    logo_light: null,
    logo_dark: null,
    symbol: null,
    favicon: null,
    watermark: null,
    decorative_element: null,
    texture: null,
    background_pattern: null,
  };

  const all: BrandAssetRef[] = [];
  for (const a of input) {
    if (!isBrandAssetType(a.type)) continue;
    if (!a.storagePath || !a.storageBucket) continue;
    const ref: BrandAssetRef = {
      id: a.id,
      type: a.type,
      storageBucket: a.storageBucket,
      storagePath: a.storagePath,
      mimeType: a.mimeType,
      width: a.width,
      height: a.height,
    };
    all.push(ref);
    // Primeiro asset ativo de cada tipo vence (ordem estável cabe ao repo).
    if (byType[a.type] === null) byType[a.type] = ref;
  }

  return { all, byType };
}

export function resolveBrandContext(input: BrandResolverInput): BrandContext {
  const parsedColors = parseColors(input.version?.colors);
  const parsedTypography = parseTypography(input.version?.typography);
  const parsedTokens = parseTokens(input.version?.tokens);

  const colors = { ...DEFAULT_COLORS, ...parsedColors };
  const typography = {
    ...DEFAULT_TYPOGRAPHY,
    ...parsedTypography,
    weights:
      Array.isArray(parsedTypography.weights) && parsedTypography.weights.length > 0
        ? parsedTypography.weights
        : DEFAULT_TYPOGRAPHY.weights,
  };
  const tokens = { ...DEFAULT_TOKENS, ...parsedTokens };

  const assets = normalizeAssets(input.assets);

  // Só é "published" quando o repo entregou uma versão publicada;
  // rascunhos NÃO viram identidade ativa.
  const versionStatus = input.version?.status ?? "draft";
  const isPublished = input.version !== null && versionStatus === "published";

  return {
    companyId: input.companyId,
    profileId: input.profile?.id ?? null,
    versionId: isPublished ? input.version!.id : null,
    status: isPublished ? "published" : "draft",
    visualStyle: input.profile?.visualStyle ?? null,
    colors,
    typography,
    tokens,
    assets,
    isFallback: !isPublished && assets.all.length === 0,
  };
}
