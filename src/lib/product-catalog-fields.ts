import type { Json } from "@/integrations/supabase/types";

export type ProductSpecifications = { [key: string]: Json | undefined };
export type ProductVariant = { [key: string]: Json | undefined };

export function parseOptionalCatalogNumber(value: string): number | undefined {
  const normalized = value.trim().replace(",", ".");
  if (!normalized) return undefined;
  const parsed = Number(normalized);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error("catalog_number_invalid");
  }
  return parsed;
}

export function parseIncludedItems(value: string): string[] {
  return value
    .split(/\r?\n/)
    .map((item) => item.trim())
    .filter(Boolean);
}

export function parseSpecifications(value: string): ProductSpecifications {
  const normalized = value.trim();
  if (!normalized) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(normalized);
  } catch {
    throw new Error("catalog_specifications_invalid");
  }
  if (!parsed || Array.isArray(parsed) || typeof parsed !== "object") {
    throw new Error("catalog_specifications_invalid");
  }
  return parsed as ProductSpecifications;
}

export function parseVariants(value: string): ProductVariant[] {
  const normalized = value.trim();
  if (!normalized) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(normalized);
  } catch {
    throw new Error("catalog_variants_invalid");
  }
  if (
    !Array.isArray(parsed) ||
    parsed.some((item) => !item || typeof item !== "object" || Array.isArray(item))
  ) {
    throw new Error("catalog_variants_invalid");
  }
  return parsed as ProductVariant[];
}
