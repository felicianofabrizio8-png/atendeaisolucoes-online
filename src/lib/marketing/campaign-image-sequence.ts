import {
  isValidFocalPoint,
  type FocalPoint,
  type RenderImageSequenceItem,
} from "@/lib/render-engine/render.types";

export const MAX_STORED_SEQUENCE_IMAGES = 8;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type StoredCampaignImage =
  | { origin: "marketing"; media_id: string; focal_point: FocalPoint | null; position: number; primary: boolean }
  | { origin: "product"; product_id: string; image_path: string; focal_point: FocalPoint | null; position: number; primary: boolean };

export function invalidCampaignImageSequence(reason: string): Error {
  return new Error(`campaign_image_sequence_invalid:${reason}`);
}

function assertSequenceItem(item: unknown, index: number, length: number): asserts item is RenderImageSequenceItem {
  if (!item || typeof item !== "object" || Array.isArray(item)) throw invalidCampaignImageSequence(`item_${index}`);
  const entry = item as Record<string, unknown>;
  if (!Number.isInteger(entry.position) || entry.position !== index) throw invalidCampaignImageSequence("positions");
  if (typeof entry.primary !== "boolean") throw invalidCampaignImageSequence("primary_flag");
  if (entry.focal_point !== null && entry.focal_point !== undefined && !isValidFocalPoint(entry.focal_point)) {
    throw invalidCampaignImageSequence(`focal_point_${index}`);
  }
  if (entry.source === "marketing_media") {
    if (typeof entry.image_id !== "string" || !UUID.test(entry.image_id)) throw invalidCampaignImageSequence(`marketing_image_${index}`);
  } else if (entry.source === "product_image") {
    if (typeof entry.product_id !== "string" || !UUID.test(entry.product_id) || typeof entry.product_image_path !== "string" || entry.product_image_path.length < 1 || entry.product_image_path.length > 500) {
      throw invalidCampaignImageSequence(`product_image_${index}`);
    }
  } else {
    throw invalidCampaignImageSequence(`source_${index}`);
  }
  if (index === 0 && entry.primary !== true) throw invalidCampaignImageSequence("primary_first");
  if (index > 0 && entry.primary === true) throw invalidCampaignImageSequence("multiple_primary");
}

export function validateStoredSequence(raw: unknown): RenderImageSequenceItem[] {
  if (!Array.isArray(raw) || raw.length < 1 || raw.length > MAX_STORED_SEQUENCE_IMAGES) throw invalidCampaignImageSequence("length");
  raw.forEach((item, index) => assertSequenceItem(item, index, raw.length));
  return raw as RenderImageSequenceItem[];
}

export function sequenceToStore(items: RenderImageSequenceItem[]): RenderImageSequenceItem[] | null {
  const bounded = validateStoredSequence(items);
  const hasFocal = bounded.some((item) => item.focal_point && isValidFocalPoint(item.focal_point));
  return bounded.length > 1 || hasFocal ? bounded : null;
}

/** Lê a sequência persistida estritamente; dados inválidos não podem ser descartados silenciosamente. */
export function readStoredSequence(aiPrompt: unknown): StoredCampaignImage[] {
  const raw = aiPrompt && typeof aiPrompt === "object" && !Array.isArray(aiPrompt)
    ? (aiPrompt as { image_sequence?: unknown }).image_sequence
    : null;
  if (raw === undefined || raw === null) return [];
  const sequence = validateStoredSequence(raw);
  return sequence.map((entry) => {
    const focal = isValidFocalPoint(entry.focal_point) ? entry.focal_point : null;
    if (entry.source === "marketing_media") {
      return { origin: "marketing", media_id: entry.image_id!, focal_point: focal, position: entry.position, primary: entry.primary };
    }
    return { origin: "product", product_id: entry.product_id!, image_path: entry.product_image_path!, focal_point: focal, position: entry.position, primary: entry.primary };
  });
}

export function matchesPrimary(
  first: StoredCampaignImage,
  primary: { source: "marketing_media"; image_id: string } | { source: "product_image"; product_id: string; product_image_path: string },
): boolean {
  if (first.origin === "marketing") return primary.source === "marketing_media" && first.media_id === primary.image_id;
  return primary.source === "product_image" && first.product_id === primary.product_id && first.image_path === primary.product_image_path;
}