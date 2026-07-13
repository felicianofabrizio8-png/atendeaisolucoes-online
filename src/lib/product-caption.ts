// Helpers de apresentação de produto para a Biblioteca (card + preview) e
// para a legenda enviada ao cliente via WhatsApp.
//
// Regras rígidas:
// - NUNCA expor preço, promoção ou desconto (nem no card, nem na legenda).
// - Usar apenas campos já existentes do Produto (name, description, notes,
//   category) — sem alterar cadastro/banco.
// - Se não houver informação útil, cai para fallback (só nome, ou vazio).

import type { Product } from "@/data/products";

// Remove linhas/trechos que possam vazar preço/promoção/desconto ou o próprio
// símbolo monetário. Também elimina "undefined"/"null" literais e caminhos.
const PRICE_LINE_RE =
  /(r\$|us\$|reais?\b|pre[cç]o|promo[cç]?[aã]o|desconto|à\s*vista|parcela|entrada|de\s*r?\$|por\s*r?\$)/i;

const JUNK_TOKEN_RE = /\b(undefined|null|NaN)\b/gi;

function sanitizeLine(raw: string): string {
  const trimmed = raw.replace(JUNK_TOKEN_RE, "").trim();
  if (!trimmed) return "";
  if (PRICE_LINE_RE.test(trimmed)) return "";
  // Não expor UUIDs ou caminhos de storage
  if (/^[0-9a-f-]{20,}$/i.test(trimmed)) return "";
  if (/^https?:\/\//i.test(trimmed) || trimmed.includes("/")) {
    // Permite frases com "/" (ex.: "6x3/1,40"), mas descarta se parecer path
    if (/\.(jpg|jpeg|png|webp|gif|mp4|mov|pdf)(\?|$)/i.test(trimmed)) return "";
  }
  return trimmed;
}

function splitLines(text: string | undefined | null): string[] {
  if (!text) return [];
  return text
    .split(/\r?\n|·|•|\|/g)
    .map(sanitizeLine)
    .filter(Boolean);
}

/**
 * Linhas de informação prontas para exibição (card + preview + legenda).
 * Deriva de description e notes; nunca inclui preço.
 * No máximo 4 linhas — o suficiente para "Medidas / Litragem / detalhes".
 */
export function buildProductInfoLines(p: Product): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const line of [...splitLines(p.description), ...splitLines(p.notes)]) {
    const key = line.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(line);
    if (out.length >= 4) break;
  }
  return out;
}

/**
 * Subtítulo curto para o card da biblioteca (1 linha, ~80 chars).
 * Junta as 2 primeiras linhas de info com " · " ou devolve "" se não houver.
 */
export function buildProductCardSubtitle(p: Product): string {
  const info = buildProductInfoLines(p);
  if (info.length === 0) return "";
  return info.slice(0, 2).join(" · ").slice(0, 100);
}

/**
 * Legenda que vai no image.caption do WhatsApp.
 * Formato:
 *   *Nome do produto*
 *   Linha 1
 *   Linha 2
 * Sem preço. Se só houver nome, devolve "*Nome*". Se nem nome, devolve "".
 */
export function buildProductCaption(p: Product): string {
  const name = (p.name ?? "").trim();
  const info = buildProductInfoLines(p);
  if (!name && info.length === 0) return "";
  const header = name ? `*${name}*` : "";
  return [header, ...info].filter(Boolean).join("\n");
}
