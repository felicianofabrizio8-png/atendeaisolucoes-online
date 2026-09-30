import type { Product } from "@/data/products";
import { buildProductCaption } from "@/lib/product-caption";
import type { LibraryPick } from "@/lib/inbox/types";

export function buildLibraryPicks(selected: string[], products: Product[]): LibraryPick[] {
  const imageToProduct = new Map<string, Product>();
  for (const product of products) {
    for (const image of product.images ?? []) {
      if (!imageToProduct.has(image)) imageToProduct.set(image, product);
    }
  }
  const captionedProducts = new Set<string>();
  return selected.map((path) => {
    const product = imageToProduct.get(path);
    const productId = product?.id ?? "";
    const includeCaption = Boolean(product) && !captionedProducts.has(productId);
    if (product) captionedProducts.add(productId);
    return { path, productId, caption: includeCaption && product ? buildProductCaption(product) : "" };
  });
}
