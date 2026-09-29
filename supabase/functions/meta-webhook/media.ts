/** Pure attachment normalization, shared by the webhook and legacy inbox rendering. */
export type MetaMedia = { media_kind: "image" | "video" | "audio" | "document"; media_url: string };

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export function extractMetaMedia(message: unknown): MetaMedia | null {
  const attachments = record(message).attachments;
  if (!Array.isArray(attachments)) return null;
  for (const attachment of attachments) {
    const item = record(attachment);
    const kind = item.type === "file" ? "document" : item.type;
    if (kind !== "image" && kind !== "video" && kind !== "audio" && kind !== "document") continue;
    const url = record(item.payload).url;
    if (typeof url !== "string") continue;
    try {
      const parsed = new URL(url);
      if (parsed.protocol !== "https:" && parsed.protocol !== "http:") continue;
      return { media_kind: kind, media_url: url };
    } catch {
      // A missing or invalid reference cannot be turned into a downloadable file.
    }
  }
  return null;
}

export function extractLegacyMetaMedia(metadata: unknown): MetaMedia | null {
  const meta = record(metadata);
  const raw = record(meta.raw);
  return (
    extractMetaMedia(raw.message) ??
    extractMetaMedia(meta.message) ??
    extractMetaMedia(raw) ??
    extractMetaMedia(meta)
  );
}
