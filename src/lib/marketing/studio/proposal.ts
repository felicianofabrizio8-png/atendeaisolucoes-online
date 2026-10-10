// ============================================================================
// Proposta de carrossel a partir dos dados da empresa (produto e promoção).
//
// Regra central: NADA é inventado. Cada texto da proposta sai de um campo do
// banco; se o campo não existe, o texto não existe (a página fica só com a
// foto, ou em branco para o usuário escrever). Em especial:
//   - sem preço cadastrado, não aparece preço;
//   - sem desconto cadastrado, não aparece desconto;
//   - sem data de término, não aparece validade.
//
// `groundText` é a mesma trava para qualquer texto escrito por um modelo de
// IA: números que não estão nos fatos derrubam o texto.
// ============================================================================

import { OVERLAY_LIMITS } from "../manual-campaign";
import type { SceneFormat } from "../video-editor/scenes/registry";
import { buildCarousel, type CarouselRecipe } from "./carousel-recipes";
import { updatePage, type PageImageRef, type PageRole, type PageText, type StudioDocument } from "./document";

export interface ProposalProduct {
  id: string;
  name: string;
  description: string | null;
  price: number | null;
  promo_price: number | null;
  included_items: string[];
  images: string[];
}

export interface ProposalPromotion {
  id: string;
  title: string;
  description: string | null;
  price_original: number | null;
  price_promo: number | null;
  discount_percent: number | null;
  ends_at: string | null;
  whatsapp_cta_text: string | null;
  cover_media_id: string | null;
}

/** Fatos disponíveis, já limpos. Campo ausente = null (nunca um valor padrão). */
export interface ProposalFacts {
  title: string | null;
  productName: string | null;
  productDescription: string | null;
  promotionDescription: string | null;
  priceFrom: number | null;
  priceNow: number | null;
  discountPercent: number | null;
  validUntil: string | null;
  cta: string | null;
  includedItems: string[];
  images: PageImageRef[];
}

const clean = (value: string | null | undefined): string | null => {
  const text = (value ?? "").replace(/\s+/g, " ").trim();
  return text ? text : null;
};
const money = (value: number | null | undefined): number | null => (typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null);

export function buildFacts(product: ProposalProduct | null, promotion: ProposalPromotion | null): ProposalFacts {
  // Preço: o da promoção tem prioridade; senão, o do produto.
  const promoNow = money(promotion?.price_promo);
  const promoFrom = money(promotion?.price_original);
  const productNow = money(product?.promo_price) ?? money(product?.price);
  const productFrom = money(product?.promo_price) ? money(product?.price) : null;
  const priceNow = promoNow ?? (promotion && promoFrom ? null : productNow);
  const priceFrom = promoNow ? promoFrom : promotion && promoFrom ? promoFrom : productFrom;
  const discount = promotion?.discount_percent;
  const images: PageImageRef[] = [];
  if (promotion?.cover_media_id) images.push({ origin: "marketing", mediaId: promotion.cover_media_id });
  for (const path of product?.images ?? []) if (typeof path === "string" && path) images.push({ origin: "product", productId: product!.id, imagePath: path });
  return {
    title: clean(promotion?.title) ?? clean(product?.name),
    productName: clean(product?.name),
    productDescription: clean(product?.description),
    promotionDescription: clean(promotion?.description),
    priceFrom: priceFrom && priceNow && priceFrom > priceNow ? priceFrom : priceNow ? null : priceFrom,
    priceNow,
    discountPercent: typeof discount === "number" && Number.isFinite(discount) && discount > 0 && discount < 100 ? discount : null,
    validUntil: promotion?.ends_at && !Number.isNaN(Date.parse(promotion.ends_at)) ? promotion.ends_at : null,
    cta: clean(promotion?.whatsapp_cta_text),
    includedItems: (product?.included_items ?? []).map((item) => clean(item)).filter((item): item is string => !!item),
    images,
  };
}

export function formatBRL(value: number): string {
  const [int, cents] = value.toFixed(2).split(".");
  return `R$ ${int.replace(/\B(?=(\d{3})+(?!\d))/g, ".")},${cents}`;
}

/** Corta no limite sem partir palavra; null se nada couber. */
export function fitWords(text: string | null, max: number): string {
  if (!text) return "";
  if (text.length <= max) return text;
  const cut = text.slice(0, max + 1);
  const at = cut.lastIndexOf(" ");
  return at > 0 ? cut.slice(0, at).replace(/[\s,;:–-]+$/, "") : "";
}

/** Primeira frase de um texto, se couber no limite. */
function firstSentence(text: string | null, max: number): string {
  if (!text) return "";
  const sentence = text.split(/(?<=[.!?])\s+/)[0] ?? "";
  return fitWords(sentence, max);
}

/** Linha de preço — só com valores cadastrados. Sem valor, string vazia. */
export function priceLine(facts: ProposalFacts): string {
  if (facts.priceFrom && facts.priceNow) return `De ${formatBRL(facts.priceFrom)} por ${formatBRL(facts.priceNow)}`;
  if (facts.priceNow) return formatBRL(facts.priceNow);
  if (facts.discountPercent) return `${String(facts.discountPercent).replace(".", ",")}% de desconto`;
  return "";
}

function validityLine(facts: ProposalFacts): string {
  if (!facts.validUntil) return "";
  const d = new Date(facts.validUntil);
  const two = (n: number) => String(n).padStart(2, "0");
  return `Válido até ${two(d.getUTCDate())}/${two(d.getUTCMonth() + 1)}/${d.getUTCFullYear()}`;
}

/** Texto de cada papel, tirado dos fatos. O que não existe fica vazio. */
export function proposalTexts(facts: ProposalFacts): Record<Exclude<PageRole, "livre">, PageText> {
  const H = OVERLAY_LIMITS.headline;
  const S = OVERLAY_LIMITS.subheadline;
  const items = fitWords(facts.includedItems.join(", "), S);
  const showsProductName = !!facts.productName && facts.productName !== facts.title;
  return {
    impacto: { headline: fitWords(facts.title, H), subheadline: fitWords(priceLine(facts), S), cta: "" },
    apresentacao: {
      headline: showsProductName ? fitWords(facts.productName, H) : "",
      subheadline: firstSentence(facts.productDescription, S),
      cta: "",
    },
    // "Inclui" é rótulo; a lista vem do cadastro do produto.
    beneficio: { headline: items ? "Inclui" : "", subheadline: items, cta: "" },
    diferencial: { headline: "", subheadline: firstSentence(facts.promotionDescription, S), cta: "" },
    cta: { headline: "", subheadline: validityLine(facts), cta: fitWords(facts.cta, OVERLAY_LIMITS.cta) },
  };
}

/** Carrossel proposto: sequência narrativa + textos e fotos dos fatos. */
export function proposeCarousel(facts: ProposalFacts, recipe: CarouselRecipe, format: SceneFormat = "portrait"): StudioDocument {
  const texts = proposalTexts(facts);
  let doc = buildCarousel({ recipe, format, images: facts.images });
  for (const page of doc.pages) {
    const text = page.role === "livre" ? null : texts[page.role];
    if (text) doc = updatePage(doc, page.id, (p) => ({ ...p, text: { ...text } }));
  }
  return doc;
}

// ------------------------------ Trava para texto de IA ----------------------

/** Números (com vírgula/ponto) que aparecem em um texto, normalizados. */
function numbersIn(text: string): string[] {
  return (text.match(/\d+(?:[.,]\d+)*/g) ?? []).map((n) => n.replace(/\./g, "").replace(",", ".")).map((n) => String(Number(n)));
}

/** Todos os números que os fatos autorizam (preços, desconto, datas, e os que já estão nos textos cadastrados). */
export function allowedNumbers(facts: ProposalFacts): Set<string> {
  const out = new Set<string>();
  for (const value of [facts.priceFrom, facts.priceNow, facts.discountPercent]) if (value) out.add(String(Number(value)));
  for (const text of [facts.title, facts.productName, facts.productDescription, facts.promotionDescription, facts.cta, validityLine(facts), ...facts.includedItems]) {
    if (text) for (const n of numbersIn(text)) out.add(n);
  }
  return out;
}

export type GroundingResult = { ok: true; text: string } | { ok: false; reason: "too_long" | "unknown_number" | "price_without_fact" | "empty" };

/**
 * Aceita um texto escrito por IA só se ele não trouxer número, preço ou
 * percentual que não esteja nos fatos. Texto recusado NÃO é corrigido: é
 * descartado, e a página fica sem ele.
 */
export function groundText(text: string, facts: ProposalFacts, max: number): GroundingResult {
  const value = text.replace(/\s+/g, " ").trim();
  if (!value) return { ok: false, reason: "empty" };
  if (value.length > max) return { ok: false, reason: "too_long" };
  const hasPriceFact = !!(facts.priceNow || facts.priceFrom);
  if (/R\$|\breais\b|\bgr[aá]tis\b/i.test(value) && !hasPriceFact) return { ok: false, reason: "price_without_fact" };
  if (/%|por cento|\bdesconto\b|\boff\b/i.test(value) && !facts.discountPercent && !(facts.priceFrom && facts.priceNow)) return { ok: false, reason: "price_without_fact" };
  const allowed = allowedNumbers(facts);
  if (numbersIn(value).some((n) => !allowed.has(n))) return { ok: false, reason: "unknown_number" };
  return { ok: true, text: value };
}
