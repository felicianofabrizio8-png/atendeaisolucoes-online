// ============================================================================
// Comparação de preços cadastrados ("qual o mais barato?", "qual tem melhor
// preço?", "o mais em conta") — NÃO é negociação.
//
// A resposta é determinística: só nomes e preços reais do catálogo da
// empresa, ordenados do menor para o maior. Pedidos de desconto, abatimento,
// "faz por", "consegue melhorar o valor" etc. continuam sendo negociação e
// vão para humano. Multissegmento: nada de produto/segmento fixo aqui.
// ============================================================================

function normalize(text: string): string {
  return text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

const COMPARISON_PATTERN =
  /\b(?:mais\s+barat[oa]s?|barat(?:inh)?[oa]s?|menor(?:es)?\s+(?:preco|valor)|melhor(?:es)?\s+(?:preco|valor)|bo[am]\s+(?:de\s+)?preco|precos?\s+(?:bom|boa|bons|melhor|menor|mais\s+baixo)|mais\s+em\s+conta|mais\s+acessive(?:l|is)|mais\s+economic[oa]s?|custo[\s-]?beneficio|mais\s+car[oa]s?|maior(?:es)?\s+(?:preco|valor)|(?:preco|valor)\s+mais\s+baixo)\b/;

// Marcadores de negociação: pedir condição diferente da cadastrada.
const NEGOTIATION_PATTERN =
  /\b(?:desconto|descont\w*|abatimento|negoci\w*|faz(?:er)?\s+por|faria\s+por|deixa(?:r)?\s+(?:por|mais)|abaix\w*|consegue\s+(?:fazer|deixar|dar|melhorar|baixar|reduzir)|melhora(?:r)?\s+(?:o|a|esse|essa|seu|sua)?\s*(?:preco|valor)|fazer\s+(?:mais\s+)?barat\w*|cobr(?:e|ir)\s+(?:a|o|essa|esse)?\s*(?:oferta|proposta|preco|valor)|pechinch\w*|chorar|preco\s+especial|condicao\s+especial|(?:melhor|menor)\s+(?:preco|valor)\s+(?:que|q)\s+(?:voce|vc|voces|vcs)\s+(?:faz|fazem|consegue|conseguem|pode|podem|da|dao))\b/;

/** Pergunta que compara preços cadastrados, sem pedir condição nova. */
export function isPriceComparisonRequest(text: string): boolean {
  const value = normalize(text);
  return COMPARISON_PATTERN.test(value) && !NEGOTIATION_PATTERN.test(value);
}

export function isPriceNegotiationRequest(text: string): boolean {
  return NEGOTIATION_PATTERN.test(normalize(text));
}

export interface PricedProduct {
  id: string;
  name: string;
  price: number | null;
  promoPrice: number | null;
}

/** Preço vigente cadastrado: promocional válido, senão o normal. */
export function effectiveCatalogPrice(
  product: Pick<PricedProduct, "price" | "promoPrice">,
): number | null {
  if (product.promoPrice != null && Number.isFinite(product.promoPrice) && product.promoPrice > 0) {
    return product.promoPrice;
  }
  if (product.price != null && Number.isFinite(product.price) && product.price > 0)
    return product.price;
  return null;
}

/** Produtos com preço cadastrado, do menor para o maior (estável por ordem do catálogo). */
export function sortByCatalogPrice<T extends PricedProduct>(products: readonly T[]): T[] {
  return products
    .map((product, index) => ({ product, index, price: effectiveCatalogPrice(product) }))
    .filter((entry): entry is { product: T; index: number; price: number } => entry.price != null)
    .sort((a, b) => a.price - b.price || a.index - b.index)
    .map((entry) => entry.product);
}

function formatBrl(value: number): string {
  return `R$ ${new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value)}`;
}

function priceLabel(product: PricedProduct): string {
  const price = effectiveCatalogPrice(product) as number;
  const isPromo =
    product.promoPrice != null && product.promoPrice > 0 && price === product.promoPrice;
  return `${product.name} (${formatBrl(price)}${isPromo ? ", promocional" : ""})`;
}

/**
 * Resposta com os preços reais: o mais em conta primeiro, depois os demais
 * (até `limit`). `null` quando nenhum produto do conjunto tem preço.
 */
export function buildPriceComparisonReply(
  products: readonly PricedProduct[],
  options: { mostExpensive?: boolean; limit?: number } = {},
): { message: string; productIds: string[] } | null {
  const sorted = sortByCatalogPrice(products);
  if (sorted.length === 0) return null;
  const ordered = options.mostExpensive ? [...sorted].reverse() : sorted;
  const shown = ordered.slice(0, Math.max(1, options.limit ?? 3));
  const [first, ...rest] = shown;
  const lead =
    sorted.length === 1
      ? `Pelos preços cadastrados, a opção disponível é ${priceLabel(first)}.`
      : options.mostExpensive
        ? `Pelos preços cadastrados, a opção de maior valor é ${priceLabel(first)}.`
        : `Pelos preços cadastrados, a opção mais em conta é ${priceLabel(first)}.`;
  const tail = rest.length > 0 ? ` Em seguida: ${rest.map(priceLabel).join("; ")}.` : "";
  return { message: `${lead}${tail}`, productIds: shown.map((product) => product.id) };
}

/** "mais caro"/"maior preço" inverte a ordem. */
export function asksForMostExpensive(text: string): boolean {
  return /\b(?:mais\s+car[oa]s?|maior(?:es)?\s+(?:preco|valor))\b/.test(normalize(text));
}
