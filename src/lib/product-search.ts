// Shared product search matcher — used by the main Products catalog page and
// by the in-chat Products Library modal. Keep a single source of truth so
// filter behavior stays consistent across surfaces.
import { PRODUCT_CATEGORIES, type Product } from "@/data/products";
import { parseMeasureQuery, productMatchesMeasure } from "@/lib/product-measure-filter";

export function normalizeSearch(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

/**
 * Deterministic product matcher. Priority order:
 *  1. Numeric measure query (`5`, `5m`, `6 metros`) → exact principal length.
 *  2. Category name query → exact category match.
 *  3. Free-text fuzzy match on name/category/description/notes (no price).
 */
export function productMatches(product: Product, rawQuery: string): boolean {
  if (!rawQuery.trim()) return true;

  const measure = parseMeasureQuery(rawQuery);
  if (measure !== null) {
    return productMatchesMeasure(
      { name: product.name, description: product.description },
      measure,
    );
  }

  const q = normalizeSearch(rawQuery);
  const productCat = normalizeSearch(product.category ?? "");
  const isCategoryQuery = PRODUCT_CATEGORIES.some((cat) => {
    const nc = normalizeSearch(cat);
    return nc === q || nc.startsWith(q) || nc.endsWith(q);
  });
  if (isCategoryQuery) {
    return productCat === q || productCat.startsWith(q) || productCat.endsWith(q);
  }

  const haystack = normalizeSearch(
    [product.name, product.category, product.description, product.notes].join(" "),
  );
  return haystack.includes(q);
}
