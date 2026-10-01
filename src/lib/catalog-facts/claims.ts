// ============================================================================
// Validação de fatos afirmados numa resposta, contra os fatos de Produtos.
//
// Flexibilidade para entender linguagem, rigidez para validar fatos:
//   1. A interpretação semântica (o LLM, que escreveu a resposta) declara cada
//      fato afirmado: produto, chave do fato no catálogo e valor como escrito.
//      A redação do cliente/LLM é livre — não há rótulos repetidos nem
//      listas de sinônimos.
//   2. O sistema valida deterministicamente tipo, valor e unidade da
//      declaração contra o fato normalizado daquele produto.
//   3. Toda grandeza física da resposta (número + unidade conhecida) precisa
//      estar coberta por uma declaração validada (ou pela identidade do
//      produto / texto das políticas): número sem declaração não sai.
// ============================================================================

import {
  factQuantities,
  normalizeProductFacts,
  type CatalogFact,
  type FactSourceProduct,
  type FactValue,
} from "./normalize";
import {
  extractQuantities,
  parseLocaleNumber,
  parseMoneyValues,
  type Quantity,
} from "./quantities";
import { sameQuantity, unitFamily } from "./units";

export interface DeclaredFactClaim {
  productId: string;
  /** Chave do fato no catálogo (mostrada no prompt ao lado de cada fato). */
  fact: string;
  /** Valor exatamente como afirmado na mensagem. */
  stated: string;
  /** A mensagem NEGA o fato ("não inclui X", "não tem Y"). */
  denies: boolean;
}

/**
 * Declarações do tool call. `null` = o LLM não enviou o campo (contrato
 * antigo): a validação segue o caminho textual legado.
 */
export function parseDeclaredFactClaims(raw: unknown): DeclaredFactClaim[] | null {
  if (!Array.isArray(raw)) return null;
  return raw.flatMap((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return [];
    const row = entry as Record<string, unknown>;
    const productId = typeof row.product_id === "string" ? row.product_id.trim() : "";
    const fact = typeof row.fact === "string" ? row.fact.trim() : "";
    const stated =
      typeof row.stated === "string" || typeof row.stated === "number"
        ? String(row.stated).trim()
        : "";
    if (!productId || !fact || !stated) return [];
    return [{ productId, fact, stated, denies: row.denies === true }];
  });
}

export type FactClaimFailure =
  | "product_not_in_turn"
  | "fact_not_registered"
  | "value_unreadable"
  | "value_mismatch";

export type FactClaimsResult =
  | { ok: true }
  | {
      ok: false;
      check: "fact_claim";
      reason: FactClaimFailure;
      claim: DeclaredFactClaim;
    }
  | { ok: false; check: "undeclared_fact"; quantity: string };

const STOPWORDS = new Set([
  "a",
  "o",
  "as",
  "os",
  "um",
  "uma",
  "uns",
  "umas",
  "de",
  "da",
  "do",
  "das",
  "dos",
  "e",
  "ou",
  "em",
  "no",
  "na",
  "nos",
  "nas",
  "com",
  "para",
  "por",
  "the",
  "of",
  "and",
]);

export function contentTokens(value: string): string[] {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/(\d),(\d)/g, "$1.$2")
    .replace(/[^a-z0-9.]+/g, " ")
    .split(" ")
    .map((token) => token.replace(/^\.+|\.+$/g, ""))
    .filter((token) => token && !STOPWORDS.has(token))
    .map((token) => (token.length > 3 && /[a-z]s$/.test(token) ? token.slice(0, -1) : token));
}

function tokensContained(stated: string, registered: string[]): boolean {
  const statedTokens = contentTokens(stated);
  if (statedTokens.length === 0) return false;
  const available = new Set(registered.flatMap(contentTokens));
  return statedTokens.every((token) => available.has(token));
}

/** Grandezas lidas do valor afirmado (com unidade; senão números soltos). */
function statedQuantities(stated: string): { quantities: Quantity[]; tuples: Quantity[][] } {
  const extracted = extractQuantities(stated, { knownOnly: false });
  const tuples = extracted.dimensions.map((tuple) =>
    tuple.values.map((value) => ({ value, unit: tuple.unit })),
  );
  if (extracted.quantities.length > 0 || tuples.length > 0) {
    return { quantities: extracted.quantities, tuples };
  }
  const numbers = [...stated.matchAll(/\d+\/\d+|\d+(?:[.,]\d+)*/g)]
    .map((match) => parseLocaleNumber(match[0]))
    .filter((value): value is number => value != null)
    .map((value) => ({ value, unit: null }));
  return { quantities: numbers, tuples: [] };
}

function valueHolds(stated: string, fact: FactValue): boolean | null {
  switch (fact.kind) {
    case "money": {
      const values = parseMoneyValues(stated);
      const fallback =
        values.length > 0 ? values : statedQuantities(stated).quantities.map((q) => q.value);
      if (fallback.length === 0) return null;
      return fallback.every((value) => Math.abs(value - fact.amount) < 0.01);
    }
    case "quantity":
    case "range": {
      const { quantities, tuples } = statedQuantities(stated);
      const all = [...quantities, ...tuples.flat()];
      if (all.length === 0) return null;
      if (fact.kind === "range") {
        return all.every(
          (quantity) =>
            sameQuantity(quantity, { value: fact.min, unit: fact.unit }) ||
            sameQuantity(quantity, { value: fact.max, unit: fact.unit }),
        );
      }
      if (tuples.length > 0) return false;
      return quantities.every((quantity) => sameQuantity(quantity, fact));
    }
    case "dimensions": {
      const { quantities, tuples } = statedQuantities(stated);
      if (quantities.length === 0 && tuples.length === 0) return null;
      const components = fact.values.map((value) => ({ value, unit: fact.unit }));
      const tuplesHold = tuples.every(
        (tuple) =>
          tuple.length <= components.length &&
          tuple.every((quantity, index) => sameQuantity(quantity, components[index])),
      );
      const singlesHold = quantities.every((quantity) =>
        components.some((component) => sameQuantity(quantity, component)),
      );
      return tuplesHold && singlesHold;
    }
    case "boolean":
      return true;
    case "text":
      return contentTokens(stated).length === 0 ? null : tokensContained(stated, [fact.text]);
    case "list":
      return contentTokens(stated).length === 0 ? null : tokensContained(stated, fact.items);
  }
}

export interface FactProduct extends FactSourceProduct {
  id: string;
}

export function validateFactClaim(
  claim: DeclaredFactClaim,
  factsByProduct: ReadonlyMap<string, readonly CatalogFact[]>,
): { ok: true } | { ok: false; reason: FactClaimFailure } {
  const facts = factsByProduct.get(claim.productId);
  if (!facts) return { ok: false, reason: "product_not_in_turn" };
  const fact = facts.find((candidate) => candidate.key === claim.fact);
  if (!fact) return { ok: false, reason: "fact_not_registered" };
  if (fact.value.kind === "boolean") {
    return fact.value.value === !claim.denies
      ? { ok: true }
      : { ok: false, reason: "value_mismatch" };
  }
  const holds = valueHolds(claim.stated, fact.value);
  if (holds == null) return { ok: false, reason: "value_unreadable" };
  return holds !== claim.denies ? { ok: true } : { ok: false, reason: "value_mismatch" };
}

// Famílias que a cobertura exige declarar. Prazo e percentual pertencem a
// políticas/condições (validados pela camada institucional).
const COVERAGE_EXCLUDED_FAMILIES = new Set(["time", "percent"]);

function messageQuantities(message: string): Array<{ quantity: Quantity; text: string }> {
  const extracted = extractQuantities(message, { knownOnly: true });
  return [
    ...extracted.quantities.map((quantity) => ({
      quantity,
      text: `${quantity.value} ${quantity.unit ?? ""}`.trim(),
    })),
    ...extracted.dimensions.flatMap((tuple) =>
      tuple.values.map((value) => ({
        quantity: { value, unit: tuple.unit },
        text: `${tuple.values.join(" x ")} ${tuple.unit ?? ""}`.trim(),
      })),
    ),
  ].filter(({ quantity }) => !COVERAGE_EXCLUDED_FAMILIES.has(unitFamily(quantity.unit) ?? ""));
}

function quantitiesIn(text: string): Quantity[] {
  const extracted = extractQuantities(text, { knownOnly: false });
  return [
    ...extracted.quantities,
    ...extracted.dimensions.flatMap((tuple) =>
      tuple.values.map((value) => ({ value, unit: tuple.unit })),
    ),
  ];
}

/**
 * Valida as declarações e a cobertura das grandezas da resposta.
 * `coverageTexts`: textos cadastrados que também podem originar números
 * (políticas oficiais da empresa).
 */
export function validateDeclaredFactClaims(params: {
  message: string;
  claims: readonly DeclaredFactClaim[];
  products: readonly FactProduct[];
  coverageTexts?: readonly string[];
}): FactClaimsResult {
  const factsByProduct = new Map(
    params.products.map((product) => [product.id, normalizeProductFacts(product).facts]),
  );
  const validated: DeclaredFactClaim[] = [];
  for (const claim of params.claims) {
    const result = validateFactClaim(claim, factsByProduct);
    if (!result.ok) return { ok: false, check: "fact_claim", reason: result.reason, claim };
    validated.push(claim);
  }
  const affirmed = validated.filter((claim) => !claim.denies);
  // Números de uma afirmação validada valem com ou sem unidade (o LLM disse
  // a que atributo se referem); os demais só com unidade, para nunca casar
  // um número solto por coincidência.
  const fromClaims = affirmed.flatMap((claim) => quantitiesIn(claim.stated));
  const fromRegistered = [
    ...affirmed.flatMap((claim) => {
      const fact = factsByProduct
        .get(claim.productId)
        ?.find((candidate) => candidate.key === claim.fact);
      return fact ? factQuantities(fact.value) : [];
    }),
    ...params.products.flatMap((product) =>
      quantitiesIn([product.name, product.model, product.sku].filter(Boolean).join(" ")),
    ),
    ...(params.coverageTexts ?? []).flatMap(quantitiesIn),
  ].filter((quantity) => quantity.unit != null);
  for (const { quantity, text } of messageQuantities(params.message)) {
    const isCovered = [...fromClaims, ...fromRegistered].some((candidate) =>
      sameQuantity(quantity, candidate),
    );
    if (!isCovered) return { ok: false, check: "undeclared_fact", quantity: text };
  }
  return { ok: true };
}
