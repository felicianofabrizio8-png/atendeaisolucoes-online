// ============================================================================
// Âncoras de afirmação por produto.
//
// Uma resposta pode falar de vários produtos ("a A sai por X, a B por Y").
// Para validar cada fato contra o produto certo, a mensagem é segmentada
// pelas menções aos produtos do próprio catálogo do tenant (nome, modelo,
// trecho do nome com número ou número exclusivo de um produto do conjunto).
// Cada segmento pertence ao produto que o inicia. Estrutural: nenhuma lista
// de frases, nenhum produto fixo.
// ============================================================================

interface AnchorProduct {
  id: string;
  name: string;
  model?: string | null;
}

export interface ClaimSegment<T extends AnchorProduct> {
  text: string;
  product: T;
}

/** Minúsculas e sem acento, preservando o comprimento (índices 1:1 com o original). */
function fold(value: string): string {
  return value
    .split("")
    .map((ch) => (ch.normalize("NFD")[0] ?? ch).toLowerCase()[0] ?? ch)
    .join("");
}

function tokensOf(value: string): string[] {
  return fold(value)
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

function escape(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function sequencePattern(tokens: string[]): RegExp {
  return new RegExp(`(?<![a-z0-9])${tokens.map(escape).join("[^a-z0-9]+")}(?![a-z0-9])`, "g");
}

/** Número isolado (não parte de preço/medida como "15.900" ou "6,5"). */
function bareNumberPattern(token: string): RegExp {
  return new RegExp(`(?<![0-9a-z][.,]?|[$])${escape(token)}(?![.,]?[0-9a-z])`, "g");
}

/** Trechos de 2+ tokens do nome que contêm número (ex.: "alfa 401"). */
function numberedSequences(tokens: string[]): string[][] {
  const out: string[][] = [];
  for (let start = 0; start < tokens.length; start += 1) {
    for (let end = start + 2; end <= tokens.length; end += 1) {
      const sequence = tokens.slice(start, end);
      if (sequence.some((token) => /^\d+$/.test(token))) out.push(sequence);
    }
  }
  return out;
}

/**
 * Segmenta a mensagem pelas menções aos produtos do conjunto. `null` quando
 * nenhuma menção é encontrada (não há como ancorar as afirmações).
 */
export function segmentClaimsByProduct<T extends AnchorProduct>(
  message: string,
  products: readonly T[],
): ClaimSegment<T>[] | null {
  const folded = fold(message);
  const numberOwners = new Map<string, T[]>();
  for (const product of products) {
    for (const token of new Set([...tokensOf(product.name), ...tokensOf(product.model ?? "")])) {
      if (/^\d{2,}$/.test(token))
        numberOwners.set(token, [...(numberOwners.get(token) ?? []), product]);
    }
  }

  type Mention = { start: number; end: number; product: T };
  const mentions: Mention[] = [];
  const collect = (pattern: RegExp, product: T) => {
    for (const match of folded.matchAll(pattern)) {
      const start = match.index ?? 0;
      mentions.push({ start, end: start + match[0].length, product });
    }
  };
  for (const product of products) {
    const nameTokens = tokensOf(product.name);
    const modelTokens = tokensOf(product.model ?? "");
    for (const sequence of [nameTokens, modelTokens, ...numberedSequences(nameTokens)]) {
      if (sequence.length > 0) collect(sequencePattern(sequence), product);
    }
  }
  for (const [token, owners] of numberOwners) {
    if (owners.length === 1) collect(bareNumberPattern(token), owners[0]);
  }
  if (mentions.length === 0) return null;

  // Menções sobrepostas: fica a mais longa; depois, em ordem de aparição.
  mentions.sort((a, b) => a.start - b.start || b.end - b.start - (a.end - a.start));
  const kept: Mention[] = [];
  for (const mention of mentions) {
    const last = kept[kept.length - 1];
    if (last && mention.start < last.end) continue;
    kept.push(mention);
  }

  const segments: ClaimSegment<T>[] = [];
  kept.forEach((mention, index) => {
    const start = index === 0 ? 0 : mention.start;
    const end = kept[index + 1]?.start ?? message.length;
    const previous = segments[segments.length - 1];
    if (previous && previous.product === mention.product) {
      previous.text += message.slice(start, end);
      return;
    }
    segments.push({ text: message.slice(start, end), product: mention.product });
  });
  return segments;
}
