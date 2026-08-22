export const MAX_SALES_AGENT_PRODUCT_IMAGES = 5;
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

const FIBER_SIZES = [4, 5, 6, 7, 8, 10] as const;

function normalizeText(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

function findFiberSize(value: string): number | null {
  const normalized = normalizeText(value);
  const match = /(?:^|\D)(10|[4-8])\s*(?:m|metros?)(?:\W|$)/.exec(normalized);
  const size = match ? Number(match[1]) : NaN;
  return FIBER_SIZES.includes(size as (typeof FIBER_SIZES)[number]) ? size : null;
}

export function detectFiberCatalogSize(context: ProductImageSelectionContext): number | null {
  const historyText = (context.history ?? []).map((message) => message.text).join(" ");
  const combined = normalizeText(
    [context.detectedInterest, context.detectedPoolSize, historyText].filter(Boolean).join(" "),
  );
  if (/\bvinil\b/.test(combined)) return null;
  return findFiberSize(context.detectedPoolSize ?? "") ?? findFiberSize(historyText);
}

export function resolveFiberCatalogImages(
  size: number,
  products: ProductImageCandidate[],
  companyId: string,
): ResolvedProductImage[] {
  const matchingProducts = products.filter((product) => {
    if (!normalizeText(product.category ?? "").includes("piscinas de fibra")) return false;
    return findFiberSize(
      [product.name, product.description, product.notes].filter(Boolean).join(" "),
    ) === size;
  });
  return matchingProducts.flatMap((product) => {
    if (!Array.isArray(product.images)) return [];
    for (const image of product.images) {
      if (typeof image !== "string") continue;
      const path = extractCompanyProductImagePath(image, companyId);
      if (path) {
        return [{
          productId: product.id,
          productName: product.name,
          storedImage: image,
          path,
        }];
      }
    }
    return [];
  });
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
  return normalizeRequestedProductIds(requestedIds).flatMap((productId) => {
    const product = byId.get(productId);
    if (!product || !Array.isArray(product.images)) return [];
    for (const image of product.images) {
      if (typeof image !== "string") continue;
      const path = extractCompanyProductImagePath(image, companyId);
      if (path) {
        return [{ productId, productName: product.name, storedImage: image, path }];
      }
    }
    return [];
  });
}
