// ============================================================================
// Modo Manual do Marketing IA — helpers puros (sem IA, sem rede).
//
// Estas funções são compartilhadas entre o formulário (client) e a server
// function `generateManualCampaign`. Elas apenas transformam o que o usuário
// digitou em: (a) overlays do vídeo e (b) legenda para publicação.
//
// Regra de ouro: NADA aqui chama IA, AI Gateway ou consome créditos.
// ============================================================================

export interface ManualCampaignFields {
  title: string;
  subtitle?: string | null;
  description?: string | null;
  price?: string | null;
  promo_text?: string | null;
  cta_text?: string | null;
  phone?: string | null;
  whatsapp?: string | null;
  instagram?: string | null;
  website?: string | null;
  hashtags?: string[];
}

export type ManualCampaignFormats = "feed" | "story" | "feed_story";

/**
 * Limites do texto que aparece SOBRE o vídeo. São os mesmos dos CHECKs do
 * banco em `marketing_contents` (overlay_headline ≤ 40, overlay_subheadline
 * ≤ 60, overlay_cta ≤ 40). Tudo que grava essas colunas precisa respeitá-los.
 */
export const OVERLAY_LIMITS = {
  headline: 40,
  subheadline: 60,
  cta: 40,
} as const;

/**
 * Limites dos campos do formulário manual. O título e o subtítulo completos
 * vão para a legenda; no vídeo entra a versão ajustada a `OVERLAY_LIMITS`.
 */
export const MANUAL_LIMITS = {
  headline: 80,
  subheadline: 120,
  cta: 60,
} as const;

function clean(v: string | null | undefined): string | null {
  const t = (v ?? "").trim();
  return t.length > 0 ? t : null;
}

/**
 * Ajusta um texto ao limite do overlay cortando em fim de palavra, sem
 * reticências (o texto vai grande sobre o vídeo). Palavra única maior que o
 * limite é cortada no limite.
 */
export function fitOverlayText(value: string, max: number): string {
  const text = value.replace(/\s+/g, " ").trim();
  if (Array.from(text).length <= max) return text;
  const head = Array.from(text).slice(0, max + 1).join("");
  const lastSpace = head.lastIndexOf(" ");
  const cut = lastSpace >= Math.floor(max / 2) ? head.slice(0, lastSpace) : Array.from(text).slice(0, max).join("");
  return cut.replace(/[\s,;:.\-–—]+$/u, "").trim();
}

/**
 * Overlays exibidos no vídeo. Subtítulo cai para o preço/texto promocional
 * quando o usuário não preencheu um subtítulo explícito.
 */
export function buildManualOverlay(fields: ManualCampaignFields): {
  overlay_headline: string;
  overlay_subheadline: string | null;
  overlay_cta: string | null;
} {
  const headline = fitOverlayText(clean(fields.title) ?? "", OVERLAY_LIMITS.headline);
  const subRaw =
    clean(fields.subtitle) ?? clean(fields.promo_text) ?? clean(fields.price);
  const ctaRaw = clean(fields.cta_text);
  return {
    overlay_headline: headline,
    overlay_subheadline: subRaw ? fitOverlayText(subRaw, OVERLAY_LIMITS.subheadline) || null : null,
    overlay_cta: ctaRaw ? fitOverlayText(ctaRaw, OVERLAY_LIMITS.cta) || null : null,
  };
}

/** Bloco de contatos, na ordem: WhatsApp, telefone, Instagram, site. */
export function buildContactBlock(fields: ManualCampaignFields): string[] {
  const lines: string[] = [];
  const wa = clean(fields.whatsapp);
  const phone = clean(fields.phone);
  const ig = clean(fields.instagram);
  const site = clean(fields.website);
  if (wa) lines.push(`WhatsApp: ${wa}`);
  if (phone) lines.push(`Telefone: ${phone}`);
  if (ig) lines.push(`Instagram: ${ig.startsWith("@") ? ig : `@${ig}`}`);
  if (site) lines.push(`Site: ${site}`);
  return lines;
}

/** Legenda para publicação (feed/story). Determinística e sem IA. */
export function composeManualCaption(fields: ManualCampaignFields): string {
  const parts: string[] = [];
  const title = clean(fields.title);
  const subtitle = clean(fields.subtitle);
  const description = clean(fields.description);
  const promo = clean(fields.promo_text);
  const price = clean(fields.price);
  const cta = clean(fields.cta_text);

  if (title) parts.push(title);
  if (subtitle) parts.push(subtitle);
  if (description) parts.push(description);
  if (promo) parts.push(promo);
  if (price) parts.push(`Valor: ${price}`);
  if (cta) parts.push(cta);

  const contacts = buildContactBlock(fields);
  if (contacts.length > 0) parts.push(contacts.join("\n"));

  return parts.join("\n\n").trim();
}

/** Normaliza hashtags digitadas livremente ("#a, b  #c") em lista limpa. */
export function normalizeHashtags(input: string | string[] | null | undefined): string[] {
  const raw = Array.isArray(input) ? input : (input ?? "").split(/[\s,]+/);
  const out: string[] = [];
  for (const item of raw) {
    const tag = item.replace(/^#+/, "").trim();
    if (!tag) continue;
    const normalized = `#${tag}`;
    if (!out.includes(normalized)) out.push(normalized);
    if (out.length >= 30) break;
  }
  return out;
}

export function manualFormatsToRoles(
  formats: ManualCampaignFormats,
): Array<"feed" | "story"> {
  if (formats === "feed") return ["feed"];
  if (formats === "story") return ["story"];
  return ["feed", "story"];
}
