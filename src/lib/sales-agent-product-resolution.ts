export type CatalogProductReference = {
  name: string;
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
