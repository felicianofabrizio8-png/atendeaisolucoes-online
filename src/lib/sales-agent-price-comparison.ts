// ============================================================================
// Execução determinística da comparação de preços cadastrados.
//
// A INTENÇÃO (o cliente quer saber qual opção custa menos/mais) é entendida
// pelo LLM, que chama a tool `compare_catalog_prices` — em qualquer forma de
// linguagem, sem lista de frases no código. A partir daí tudo é
// determinístico: o conjunto comparado e os preços vêm só do catálogo ativo
// da empresa (preço promocional vigente, senão o normal). Nenhum preço é
// gerado pelo modelo. Multissegmento: nada de produto/segmento fixo aqui.
// ============================================================================

import { getPresentedProductIds } from "./sales-agent-product-resolution";

export type PriceComparisonOrder = "lowest_first" | "highest_first";

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
  if (product.price != null && Number.isFinite(product.price) && product.price > 0) {
    return product.price;
  }
  return null;
}

/** Produtos com preço cadastrado, do menor para o maior (estável pela ordem do catálogo). */
export function sortByCatalogPrice<T extends PricedProduct>(products: readonly T[]): T[] {
  return products
    .map((product, index) => ({ product, index, price: effectiveCatalogPrice(product) }))
    .filter((entry): entry is { product: T; index: number; price: number } => entry.price != null)
    .sort((a, b) => a.price - b.price || a.index - b.index)
    .map((entry) => entry.product);
}

/**
 * Conjunto comparado, sempre dentro do catálogo ativo da empresa:
 * 1) produtos que o cliente restringiu (IDs da tool, validados, 2+);
 * 2) compatíveis com a medida/capacidade pedida na mensagem;
 * 3) produtos já apresentados na conversa (2+);
 * 4) o catálogo ativo.
 */
export function resolvePriceComparisonPool<T extends PricedProduct>(params: {
  catalog: readonly T[];
  history: ReadonlyArray<{
    role: "lead" | "agent" | "system";
    text: string;
    productIds?: string[];
  }>;
  requestedProductIds?: readonly string[];
  attributeMatches?: readonly T[] | null;
}): T[] {
  const byId = new Map(params.catalog.map((product) => [product.id, product]));
  const pick = (ids: readonly string[]) =>
    [...new Set(ids)].flatMap((id) => {
      const product = byId.get(id);
      return product ? [product] : [];
    });
  const requested = pick(params.requestedProductIds ?? []);
  if (requested.length >= 2) return requested;
  if (params.attributeMatches && params.attributeMatches.length > 0) {
    return params.attributeMatches.filter((product) => byId.has(product.id));
  }
  const presented = pick(getPresentedProductIds([...params.history]));
  if (presented.length >= 2) return presented;
  return [...params.catalog];
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
 * Resposta com os preços reais do conjunto, na ordem pedida (até `limit`).
 * `null` quando nenhum produto do conjunto tem preço cadastrado.
 */
export function buildPriceComparisonReply(
  products: readonly PricedProduct[],
  options: { order?: PriceComparisonOrder; limit?: number } = {},
): { message: string; productIds: string[] } | null {
  const sorted = sortByCatalogPrice(products);
  if (sorted.length === 0) return null;
  const highestFirst = options.order === "highest_first";
  const ordered = highestFirst ? [...sorted].reverse() : sorted;
  const shown = ordered.slice(0, Math.max(1, options.limit ?? 3));
  const [first, ...rest] = shown;
  const lead =
    sorted.length === 1
      ? `Pelos preços cadastrados, a opção disponível é ${priceLabel(first)}.`
      : highestFirst
        ? `Pelos preços cadastrados, a opção de maior valor é ${priceLabel(first)}.`
        : `Pelos preços cadastrados, a opção mais em conta é ${priceLabel(first)}.`;
  const tail = rest.length > 0 ? ` Em seguida: ${rest.map(priceLabel).join("; ")}.` : "";
  return { message: `${lead}${tail}`, productIds: shown.map((product) => product.id) };
}
