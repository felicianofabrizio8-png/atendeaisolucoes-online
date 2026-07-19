/**
 * Resolver puro do Brand Center.
 *
 * Recebe dados brutos do repositório e produz um `BrandContext` normalizado.
 * NÃO acessa banco, storage ou rede — 100% testável em memória.
 *
 * Pipeline de uma versão publicada:
 *   1. `migrateBrandVersionPayload` (schema_version → pass-through ou fallback)
 *   2. `parseColors/parseTypography/parseTokens` (validação Zod defensiva)
 *   3. merge com defaults
 *
 * Se o schema for desconhecido/futuro (item 1), o resolver ignora a versão
 * silenciosamente e cai em fallback — jamais tenta interpretar dados
 * incompatíveis como se fossem válidos.
 */

import {
  ASSET_TYPES,
  DEFAULT_COLORS,
  DEFAULT_TOKENS,
  DEFAULT_TYPOGRAPHY,
} from "./brand-defaults";
import { parseColors, parseTokens, parseTypography } from "./brand-schema";
import { migrateBrandVersionPayload } from "./brand-schema-migration";
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
    if (byType[a.type] === null) byType[a.type] = ref;
  }

  return { all, byType };
}

export function resolveBrandContext(input: BrandResolverInput): BrandContext {
  const versionStatus = input.version?.status ?? "draft";
  const isPublishedCandidate =
    input.version !== null && versionStatus === "published";

  const migrated = isPublishedCandidate
    ? migrateBrandVersionPayload({
        schemaVersion: input.version!.schemaVersion ?? 1,
        colors: input.version!.colors,
        typography: input.version!.typography,
        tokens: input.version!.tokens,
      })
    : null;

  // schema desconhecido/futuro → cai em fallback completo (defaults).
  const isPublished = isPublishedCandidate && migrated !== null;

  const parsedColors = migrated ? parseColors(migrated.colors) : {};
  const parsedTypography = migrated ? parseTypography(migrated.typography) : {};
  const parsedTokens = migrated ? parseTokens(migrated.tokens) : {};

  const colors = { ...DEFAULT_COLORS, ...parsedColors };
  const typography = {
    ...DEFAULT_TYPOGRAPHY,
    ...parsedTypography,
    weights:
      Array.isArray(parsedTypography.weights) &&
      parsedTypography.weights.length > 0
        ? parsedTypography.weights
        : DEFAULT_TYPOGRAPHY.weights,
  };
  const tokens = { ...DEFAULT_TOKENS, ...parsedTokens };

  const assets = normalizeAssets(input.assets);

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
