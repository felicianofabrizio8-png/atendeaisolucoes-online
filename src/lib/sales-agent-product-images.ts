export const MAX_SALES_AGENT_PRODUCT_IMAGES = 10;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface ProductImageCandidate {
  id: string;
  name: string;
  images: unknown;
  category?: string | null;
  description?: string | null;
  notes?: string | null;
}

export interface ResolvedProductImage {
  productId: string;
  productName: string;
  storedImage: string;
  path: string;
}

export interface ProductImageSelectionContext {
  history?: Array<{ role: "lead" | "agent" | "system"; text: string }>;
  detectedPoolSize?: string | null;
  detectedInterest?: string | null;
}

function resolveUniqueProductImages(
  products: ProductImageCandidate[],
  companyId: string,
): ResolvedProductImage[] {
  const resolved: ResolvedProductImage[] = [];
  const seenPaths = new Set<string>();
  for (const product of products) {
    if (!Array.isArray(product.images)) continue;
    for (const image of product.images) {
      if (typeof image !== "string") continue;
      const path = extractCompanyProductImagePath(image, companyId);
      if (path && !seenPaths.has(path)) {
        seenPaths.add(path);
        resolved.push({
          productId: product.id,
          productName: product.name,
          storedImage: image,
          path,
        });
        break;
      }
    }
    if (resolved.length === MAX_SALES_AGENT_PRODUCT_IMAGES) break;
  }
  return resolved;
}

export function normalizeRequestedProductIds(ids: unknown): string[] {
  if (!Array.isArray(ids)) return [];
  const unique: string[] = [];
  for (const value of ids) {
    if (typeof value !== "string") continue;
    const id = value.trim();
    if (!UUID_PATTERN.test(id) || unique.includes(id)) continue;
    unique.push(id);
    if (unique.length === MAX_SALES_AGENT_PRODUCT_IMAGES) break;
  }
  return unique;
}

export function extractCompanyProductImagePath(
  storedImage: string,
  companyId: string,
): string | null {
  let path = storedImage.trim();
  if (!path) return null;
  if (/^https?:\/\//i.test(path)) {
    const markers = ["/object/public/product-images/", "/object/sign/product-images/"];
    const marker = markers.find((candidate) => path.includes(candidate));
    if (!marker) return null;
    path = path.split(marker)[1]?.split("?")[0] ?? "";
  }
  try {
    path = decodeURIComponent(path).replace(/^\/+/, "");
  } catch {
    return null;
  }
  return path.startsWith(`${companyId}/`) ? path : null;
}

export function resolveProductImages(
  requestedIds: unknown,
  products: ProductImageCandidate[],
  companyId: string,
): ResolvedProductImage[] {
  const byId = new Map(products.map((product) => [product.id, product]));
  const orderedProducts = normalizeRequestedProductIds(requestedIds).flatMap((productId) => {
    const product = byId.get(productId);
    return product ? [product] : [];
  });
  return resolveUniqueProductImages(orderedProducts, companyId);
}
