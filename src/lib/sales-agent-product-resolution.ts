export type CatalogProductReference = {
  name: string;
  id?: string;
  model?: string | null;
  sku?: string | null;
  description?: string | null;
};

export type CatalogProductResolution<T extends CatalogProductReference> = {
  product: T | null;
  ambiguous: boolean;
};

function normalizeTokens(value: string): string[] {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

function significantTokens(value: string): string[] {
  return normalizeTokens(value).filter((token) => token.length >= 2);
}

function isNumericToken(token: string): boolean {
  return /^\d+(?:[.,]\d+)?$/.test(token);
}

function containsTokenSequence(tokens: string[], sequence: string[]): boolean {
  if (sequence.length === 0 || sequence.length > tokens.length) return false;
  return tokens.some((_, index) =>
    index + sequence.length <= tokens.length &&
    sequence.every((token, offset) => tokens[index + offset] === token),
  );
}

function nameSequences(name: string): string[][] {
  const tokens = normalizeTokens(name);
  const sequences: string[][] = [];
  for (let start = 0; start < tokens.length; start += 1) {
    for (let end = start + 2; end <= tokens.length; end += 1) {
      const sequence = tokens.slice(start, end);
      if (sequence.some(isNumericToken)) sequences.push(sequence);
    }
  }
  return sequences;
}

function containsExactSequence(tokens: string[], sequence: string[]): boolean {
  if (sequence.length === 0 || sequence.length > tokens.length) return false;
  return tokens.some((_, index) =>
    index + sequence.length <= tokens.length &&
    sequence.every((token, offset) => tokens[index + offset] === token),
  );
}

function safePartialSequences(value: string): string[][] {
  const tokens = significantTokens(value);
  const sequences: string[][] = [];
  for (let start = 0; start < tokens.length; start += 1) {
    for (let end = start + 1; end <= tokens.length; end += 1) {
      const sequence = tokens.slice(start, end);
      const hasNumber = sequence.some(isNumericToken);
      const hasMeaningfulWord = sequence.some((token) => !isNumericToken(token) && token.length >= 4);
      if (sequence.length >= 2 || hasNumber || hasMeaningfulWord) sequences.push(sequence);
    }
  }
  return sequences;
}

function productContextSequences<T extends CatalogProductReference>(product: T): string[][] {
  return [
    product.name,
    product.model ?? null,
    product.sku ?? null,
    product.description ?? null,
  ].filter((value): value is string => Boolean(value?.trim())).flatMap(safePartialSequences);
}

function positionIndex(text: string, size: number): number | null {
  const tokens = normalizeTokens(text);
  if (tokens.some((token) => token === "primeira" || token === "primeiro" || token === "1" || token === "1a")) return 0;
  if (tokens.some((token) => token === "segunda" || token === "segundo" || token === "2" || token === "2a")) return 1;
  if (tokens.some((token) => token === "ultima" || token === "ultimo")) return size - 1;
  return null;
}

export type ProductReferenceHistory = Array<{
  role: "lead" | "agent" | "system";
  text: string;
  productIds?: string[];
}>;

export function getPresentedProductIds(history: ProductReferenceHistory): string[] {
  const lastLeadIndex = [...history].map((item) => item.role).lastIndexOf("lead");
  const end = lastLeadIndex >= 0 ? lastLeadIndex : history.length;
  const ids: string[] = [];
  for (let index = end - 1; index >= 0; index -= 1) {
    const item = history[index];
    if (item.role === "lead") break;
    if (item.role !== "agent") continue;
    const newIds = (item.productIds ?? []).filter((id) => !ids.includes(id));
    ids.unshift(...newIds);
  }
  return ids;
}

export function resolvePresentedCatalogProductReference<T extends CatalogProductReference>(
  text: string,
  presentedProducts: T[],
): CatalogProductResolution<T> {
  if (presentedProducts.length === 0) return { product: null, ambiguous: false };

  const positionTokens = normalizeTokens(text).filter((token) =>
    ["primeira", "primeiro", "segunda", "segundo", "ultima", "ultimo", "1", "2", "1a", "2a"].includes(token),
  );
  if (positionTokens.length > 1) return { product: null, ambiguous: true };
  const index = positionIndex(text, presentedProducts.length);
  if (index != null && index >= 0 && index < presentedProducts.length) {
    return { product: presentedProducts[index], ambiguous: false };
  }

  const messageTokens = normalizeTokens(text);
  const matches = presentedProducts.filter((product) =>
    productContextSequences(product).some((sequence) => containsExactSequence(messageTokens, sequence)),
  );
  if (matches.length === 1) return { product: matches[0], ambiguous: false };
  return { product: null, ambiguous: matches.length > 1 };
}

export function resolveCatalogProductReferenceWithContext<T extends CatalogProductReference>(
  text: string,
  products: T[],
  presentedProducts: T[],
): CatalogProductResolution<T> {
  const contextual = resolvePresentedCatalogProductReference(text, presentedProducts);
  if (contextual.product || contextual.ambiguous) return contextual;
  return resolveCatalogProductReference(text, products);
}

export function resolveCatalogProductReference<T extends CatalogProductReference>(
  text: string,
  products: T[],
): CatalogProductResolution<T> {
  const messageTokens = normalizeTokens(text);
  if (messageTokens.length === 0 || products.length === 0) {
    return { product: null, ambiguous: false };
  }

  const exactNameMatches = products.filter((product) =>
    containsTokenSequence(messageTokens, normalizeTokens(product.name)),
  );
  if (exactNameMatches.length === 1) {
    return { product: exactNameMatches[0], ambiguous: false };
  }
  if (exactNameMatches.length > 1) {
    return { product: null, ambiguous: true };
  }

  const aliasMatches = products.filter((product) =>
    nameSequences(product.name).some((sequence) => containsTokenSequence(messageTokens, sequence)),
  );
  if (aliasMatches.length === 1) {
    return { product: aliasMatches[0], ambiguous: false };
  }
  return { product: null, ambiguous: aliasMatches.length > 1 };
}
