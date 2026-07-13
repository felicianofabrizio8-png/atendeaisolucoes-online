// ============================================================================
// Upload Security — magic byte + MIME + size + sha256.
// Nenhum consumidor operacional na Fase 1. Utilitário puro para uso futuro.
// ============================================================================

export interface UploadValidationInput {
  bytes: Uint8Array;
  declaredMime?: string;
  maxBytes?: number;
  allowedFamilies?: MagicFamily[];
}

export interface UploadValidationResult {
  ok: boolean;
  reason?: string;
  sha256: string;
  byteSize: number;
  magicFamily: MagicFamily | null;
  mime: string | null;
}

export type MagicFamily =
  | "image"
  | "audio"
  | "video"
  | "pdf"
  | "text"
  | "unknown";

interface MagicRule {
  family: MagicFamily;
  mime: string;
  signature: number[];
  offset?: number;
}

const MAGIC_RULES: MagicRule[] = [
  { family: "image", mime: "image/jpeg", signature: [0xff, 0xd8, 0xff] },
  { family: "image", mime: "image/png", signature: [0x89, 0x50, 0x4e, 0x47] },
  { family: "image", mime: "image/gif", signature: [0x47, 0x49, 0x46, 0x38] },
  { family: "image", mime: "image/webp", signature: [0x52, 0x49, 0x46, 0x46], offset: 0 },
  { family: "pdf", mime: "application/pdf", signature: [0x25, 0x50, 0x44, 0x46] },
  { family: "audio", mime: "audio/mpeg", signature: [0xff, 0xfb] },
  { family: "audio", mime: "audio/mpeg", signature: [0x49, 0x44, 0x33] },
  { family: "audio", mime: "audio/ogg", signature: [0x4f, 0x67, 0x67, 0x53] },
  { family: "audio", mime: "audio/wav", signature: [0x52, 0x49, 0x46, 0x46] },
  { family: "video", mime: "video/mp4", signature: [0x66, 0x74, 0x79, 0x70], offset: 4 },
  { family: "video", mime: "video/webm", signature: [0x1a, 0x45, 0xdf, 0xa3] },
];

function matches(bytes: Uint8Array, rule: MagicRule): boolean {
  const off = rule.offset ?? 0;
  if (bytes.length < off + rule.signature.length) return false;
  for (let i = 0; i < rule.signature.length; i += 1) {
    if (bytes[off + i] !== rule.signature[i]) return false;
  }
  return true;
}

export function detectMagic(bytes: Uint8Array): { family: MagicFamily; mime: string } | null {
  for (const rule of MAGIC_RULES) {
    if (matches(bytes, rule)) return { family: rule.family, mime: rule.mime };
  }
  return null;
}

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const view = new Uint8Array(bytes.byteLength);
  view.set(bytes);
  const buf = await crypto.subtle.digest("SHA-256", view.buffer as ArrayBuffer);
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function validateUpload(input: UploadValidationInput): Promise<UploadValidationResult> {
  const size = input.bytes.byteLength;
  const sha256 = await sha256Hex(input.bytes);
  const detected = detectMagic(input.bytes);
  const family = detected?.family ?? "unknown";
  const mime = detected?.mime ?? input.declaredMime ?? null;
  const result: UploadValidationResult = {
    ok: true,
    sha256,
    byteSize: size,
    magicFamily: family,
    mime,
  };
  const max = input.maxBytes ?? 25 * 1024 * 1024;
  if (size > max) {
    result.ok = false;
    result.reason = `file_too_large:${size}>${max}`;
    return result;
  }
  if (input.allowedFamilies && !input.allowedFamilies.includes(family)) {
    result.ok = false;
    result.reason = `family_not_allowed:${family}`;
    return result;
  }
  if (input.declaredMime && detected && input.declaredMime !== detected.mime) {
    result.ok = false;
    result.reason = `mime_mismatch:declared=${input.declaredMime},detected=${detected.mime}`;
    return result;
  }
  return result;
}
