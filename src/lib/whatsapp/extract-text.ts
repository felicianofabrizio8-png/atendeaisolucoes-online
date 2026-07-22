/**
 * Pure helpers to convert a WhatsApp Cloud API message payload into the
 * short text stored in `messages.text`. Kept in its own module so the
 * webhook route and the test suite import the exact same logic.
 *
 * Never return `[unsupported]` or other literal `[type]` markers here —
 * the inbox renders these values directly to end users.
 */

export interface WhatsAppMediaPart {
  id: string;
  mime_type?: string;
  caption?: string;
  filename?: string;
}

export interface WhatsAppMessage {
  id: string;
  from: string;
  timestamp?: string;
  type: string;
  text?: { body: string };
  button?: { text: string; payload?: string };
  interactive?: {
    button_reply?: { id: string; title: string };
    list_reply?: { id: string; title: string };
  };
  image?: WhatsAppMediaPart;
  audio?: WhatsAppMediaPart;
  video?: WhatsAppMediaPart;
  document?: WhatsAppMediaPart;
  sticker?: WhatsAppMediaPart;
}

export function extractText(m: WhatsAppMessage): string {
  if (m.type === "text" && m.text?.body) return m.text.body;
  if (m.type === "button" && m.button?.text) return m.button.text;
  if (m.type === "interactive") {
    const i = m.interactive;
    if (i?.button_reply?.title) return i.button_reply.title;
    if (i?.list_reply?.title) return i.list_reply.title;
    return "🔘 Resposta interativa";
  }
  if (m.type === "image") return m.image?.caption ?? "📷 Foto";
  if (m.type === "audio") return "🎤 Áudio";
  if (m.type === "video") return m.video?.caption ?? "🎥 Vídeo";
  if (m.type === "document")
    return m.document?.caption ?? (m.document?.filename ? `📎 ${m.document.filename}` : "📎 Documento");
  if (m.type === "sticker") return "🌟 Sticker";
  if (m.type === "location") return "📍 Localização";
  if (m.type === "contacts") return "👤 Contato";
  if (m.type === "reaction") return "💬 Reação";
  if (m.type === "order") return "🛒 Pedido";
  if (m.type === "poll") return "📊 Enquete";
  if (m.type === "system") return "ℹ️ Mensagem do sistema";
  if (m.type === "ephemeral") return "⏳ Mensagem temporária";
  if (m.type === "unknown") return "✉️ Mensagem não suportada";
  if (m.type === "unsupported") return "✉️ Mensagem não suportada";
  return "✉️ Mensagem não suportada";
}
