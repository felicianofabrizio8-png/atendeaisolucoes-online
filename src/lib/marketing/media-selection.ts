// Unified media selection type for the Marketing Media Center.
// A selected item is either a Marketing Library media (owned by marketing_media)
// or a Product image (read-only, sourced from products.images).
//
// This lets the UI treat the two origins as a single acervo, without
// duplicating files or requiring schema changes to marketing_media.

export type MediaSelection =
  | { origin: "marketing"; id: string; storagePath?: string }
  | { origin: "product"; productId: string; productName: string; imagePath: string };

export function selectionKey(sel: MediaSelection): string {
  return sel.origin === "marketing"
    ? `m:${sel.id}`
    : `p:${sel.productId}:${sel.imagePath}`;
}

export function sameSelection(a: MediaSelection, b: MediaSelection): boolean {
  return selectionKey(a) === selectionKey(b);
}
