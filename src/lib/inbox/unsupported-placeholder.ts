/**
 * Pure helper used by the inbox to render a friendly placeholder for
 * WhatsApp / Meta message types that don't have dedicated UI yet
 * (document without asset, location, contacts, poll, reaction, order,
 * system, ephemeral, sticker, unknown types...).
 *
 * The literal "[unsupported]" (or any other "[type]" fallback that may
 * have been produced by older versions of the webhook) must never reach
 * the end user — we always translate it into a friendly label.
 */

export const UNSUPPORTED_LABELS: Record<string, string> = {
  document: "📎 Documento",
  location: "📍 Localização",
  contacts: "👤 Contato",
  contact: "👤 Contato",
  sticker: "🌟 Sticker",
  reaction: "💬 Reação",
  interactive: "🔘 Resposta interativa",
  button: "🔘 Botão",
  order: "🛒 Pedido",
  poll: "📊 Enquete",
  system: "ℹ️ Mensagem do sistema",
  ephemeral: "⏳ Mensagem temporária",
  unknown: "✉️ Mensagem não suportada",
  unsupported: "✉️ Mensagem não suportada",
};

export const LEGACY_BRACKET_TEXT: Record<string, { label: string; rawType: string }> = {
  "[unsupported]": { label: "✉️ Mensagem não suportada", rawType: "unsupported" },
  "[unknown]": { label: "✉️ Mensagem não suportada", rawType: "unknown" },
  "[mensagem]": { label: "✉️ Mensagem não suportada", rawType: "unknown" },
  "[localização]": { label: "📍 Localização", rawType: "location" },
  "[localizacao]": { label: "📍 Localização", rawType: "location" },
  "[location]": { label: "📍 Localização", rawType: "location" },
  "[contacts]": { label: "👤 Contato", rawType: "contacts" },
  "[contact]": { label: "👤 Contato", rawType: "contacts" },
  "[contato]": { label: "👤 Contato", rawType: "contacts" },
  "[reaction]": { label: "💬 Reação", rawType: "reaction" },
  "[interactive]": { label: "🔘 Resposta interativa", rawType: "interactive" },
  "[order]": { label: "🛒 Pedido", rawType: "order" },
  "[poll]": { label: "📊 Enquete", rawType: "poll" },
  "[system]": { label: "ℹ️ Mensagem do sistema", rawType: "system" },
  "[ephemeral]": { label: "⏳ Mensagem temporária", rawType: "ephemeral" },
  "[sticker]": { label: "🌟 Sticker", rawType: "sticker" },
};

// A media message that already renders through the media pipeline
// must not be replaced by a placeholder.
const MEDIA_KINDS = new Set(["image", "video", "audio"]);

export interface UnsupportedMessageInput {
  text?: string | null;
  sourceSubtype?: string | null;
}

export function getUnsupportedPlaceholder(
  message: UnsupportedMessageInput,
  text: string,
): { label: string; rawType: string } | null {
  const trimmed = (text ?? "").trim();
  const legacy = LEGACY_BRACKET_TEXT[trimmed.toLowerCase()];
  if (legacy) return legacy;

  const sub = (message.sourceSubtype ?? "").toLowerCase();
  if (sub && UNSUPPORTED_LABELS[sub] && !MEDIA_KINDS.has(sub)) {
    return { label: UNSUPPORTED_LABELS[sub], rawType: sub };
  }

  const bracketMatch = /^\[([a-z0-9_\- ]{1,32})\]$/i.exec(trimmed);
  if (bracketMatch) {
    const raw = bracketMatch[1].toLowerCase();
    return {
      label: UNSUPPORTED_LABELS[raw] ?? "✉️ Mensagem não suportada",
      rawType: raw,
    };
  }
  return null;
}
