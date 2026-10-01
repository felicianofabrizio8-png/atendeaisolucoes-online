// ============================================================================
// Fatos objetivos afirmados numa resposta, validados campo a campo.
//
// Cada fato numérico (preço, dimensões, medida, capacidade) é extraído com o
// seu tipo e validado contra o campo estruturado correspondente do produto em
// Produtos — ou, se o campo estiver vazio, contra o mesmo fato escrito no
// próprio cadastro do produto (descrição/observações/especificações). A
// redação ao redor ("está saindo por", "medidas externas") não é comparada
// com o catálogo.
//
// Os fatos do produto vêm do normalizador de Produtos (campos universais +
// atributos tipados/legados de cada empresa); números são comparados por
// família de unidade, nunca por coincidência de dígitos.
// ============================================================================

import {
  extractQuantities,
  factQuantities,
  normalizeProductFacts,
  productFactsText,
  sameQuantity,
  unitFamily,
  type Quantity,
} from "./catalog-facts";

export interface FactProduct {
  name: string;
  model?: string | null;
  description?: string | null;
  notes?: string | null;
  specifications?: unknown;
  includedItems?: string[];
  lengthM?: number | null;
  widthM?: number | null;
  depthM?: number | null;
  capacityL?: number | null;
  category?: string | null;
  shape?: string | null;
  sku?: string | null;
  variants?: unknown[];
  price: number | null;
  promoPrice: number | null;
}

export interface PriceFact {
  value: number;
  /** Rotulado como promocional na própria oração (e único preço dela). */
  promo: boolean;
}

export interface NumericFacts {
  prices: PriceFact[];
  dimensions: number[][];
  measures: number[];
  capacities: number[];
  /** Demais grandezas físicas (massa, potência, tensão, área...). */
  quantities: Quantity[];
}

const EPSILON = 0.001;

export function parseNumber(raw: string): number | null {
  const value = raw.replace(/\s/g, "");
  const parsed = value.includes(",")
    ? Number(value.replace(/\./g, "").replace(",", "."))
    : Number(value.replace(/\.(?=\d{3}(?:\D|$))/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function same(left: number, right: number): boolean {
  return Math.abs(left - right) < EPSILON;
}

/**
 * Orações da resposta. Divide por pontuação seguida de espaço, quebra de
 * linha, parênteses e vírgula/ponto-e-vírgula seguidos de espaço — nunca
 * dentro de números ("12.900,00", "2,5").
 */
export function splitClauses(text: string): string[] {
  return text
    .split(/(?<=[.!?;:])\s+|\n+|[()]|,\s+/)
    .map((clause) => clause.trim())
    .filter(Boolean);
}

const MONEY_PATTERN =
  /r\$\s*([\d.]+(?:,\d{1,2})?)(?:\s*(mil|k)\b)?|(?<![\d.,])([\d.]+(?:,\d{1,2})?)\s*(mil|k|reais)\b|\b(?:pre[cç]o|valor|custa|custam|sai\s+por|fica\s+por|est[aá]\s+por)\b[^\d%]{0,20}?([\d.]+(?:,\d{1,2})?)(?![\d.,]|\s*(?:%|x\b|vezes|parcelas?|dias?|meses|m[eê]s|horas?|h\b|anos?|m\b|metros?|cm|mm|l\b|litros?|mil\b|k\b|reais\b))/gi;

function moneyValues(clause: string): number[] {
  const values: number[] = [];
  for (const match of clause.matchAll(MONEY_PATTERN)) {
    const raw = match[1] ?? match[3] ?? match[5];
    const unit = match[2] ?? match[4];
    const parsed = raw ? parseNumber(raw) : null;
    if (parsed == null) continue;
    values.push(/^(?:mil|k)$/i.test(unit ?? "") ? parsed * 1000 : parsed);
  }
  return [...new Set(values)];
}

const DIMENSION_PATTERN =
  /(\d{1,2}(?:[.,]\d+)?)\s*[x×]\s*(\d{1,2}(?:[.,]\d+)?)(?:\s*[x×]\s*(\d{1,2}(?:[.,]\d+)?))?\s*(m|metros?)?\b/gi;
const MEASURE_PATTERN = /(?<![\d.,x×]\s?)(\d{1,2}(?:[.,]\d+)?)\s*(?:m|metros?)\b/gi;
const CAPACITY_PATTERN = /([\d.]+(?:,\d+)?)\s*(?:l|litros?)\b/gi;

/** Fatos numéricos afirmados no texto, com o tipo de cada um. */
export function extractNumericFacts(text: string): NumericFacts {
  const prices: PriceFact[] = [];
  for (const clause of splitClauses(text)) {
    const values = moneyValues(clause);
    const promo = values.length === 1 && /promo/i.test(clause);
    for (const value of values) prices.push({ value, promo });
  }
  const dimensions: number[][] = [];
  let withoutTuples = text;
  for (const match of text.matchAll(DIMENSION_PATTERN)) {
    if (!match[4]) continue;
    const tuple = [match[1], match[2], match[3]]
      .filter((value): value is string => Boolean(value))
      .map((value) => parseNumber(value))
      .filter((value): value is number => value != null);
    if (tuple.length >= 2) dimensions.push(tuple);
    withoutTuples = withoutTuples.replace(match[0], " ");
  }
  const measures = [...withoutTuples.matchAll(MEASURE_PATTERN)]
    .map((match) => parseNumber(match[1]))
    .filter((value): value is number => value != null);
  const capacities = [...text.matchAll(CAPACITY_PATTERN)]
    .map((match) => parseNumber(match[1]))
    .filter((value): value is number => value != null);
  const quantities = extractQuantities(withoutTuples).quantities.filter((quantity) => {
    const family = unitFamily(quantity.unit);
    return family != null && !["length", "volume", "time", "percent"].includes(family);
  });
  return { prices, dimensions, measures, capacities, quantities };
}

export function hasNumericFacts(facts: NumericFacts): boolean {
  return (
    facts.prices.length > 0 ||
    facts.dimensions.length > 0 ||
    facts.measures.length > 0 ||
    facts.capacities.length > 0 ||
    facts.quantities.length > 0
  );
}

/** Texto "Rótulo: valor" dos fatos do cadastro (normalizados). */
export function productFactText(product: FactProduct): string {
  return productFactsText(product);
}

/** Grandezas cadastradas do produto (campos + atributos + texto livre). */
function registeredQuantities(product: FactProduct): Quantity[] {
  const { facts } = normalizeProductFacts(product);
  const structured = facts.flatMap((fact) => factQuantities(fact.value));
  const freeText = facts
    .filter((fact) => fact.value.kind === "text")
    .flatMap((fact) => {
      const extracted = extractQuantities(fact.value.kind === "text" ? fact.value.text : "");
      return [
        ...extracted.quantities,
        ...extracted.dimensions.flatMap((tuple) =>
          tuple.values.map((value) => ({ value, unit: tuple.unit })),
        ),
      ];
    });
  return [...structured, ...freeText];
}

function registeredTuples(product: FactProduct): number[][] {
  const { facts } = normalizeProductFacts(product);
  return [
    ...facts.flatMap((fact) => (fact.value.kind === "dimensions" ? [fact.value.values] : [])),
    ...extractNumericFacts(productFactText(product)).dimensions,
  ];
}

function hasRegisteredQuantity(product: FactProduct, claimed: Quantity): boolean {
  return registeredQuantities(product).some(
    (registered) =>
      registered.unit != null &&
      unitFamily(registered.unit) === unitFamily(claimed.unit) &&
      sameQuantity(registered, claimed),
  );
}

export function validatePriceFact(fact: PriceFact, product: FactProduct): boolean {
  const promo = product.promoPrice != null && product.promoPrice > 0 ? product.promoPrice : null;
  const regular = product.price != null && product.price > 0 ? product.price : null;
  if (fact.promo) return promo != null && same(promo, fact.value);
  return [regular, promo].some((value) => value != null && same(value, fact.value));
}

export function validateDimensionFact(tuple: readonly number[], product: FactProduct): boolean {
  // Mesma sequência cadastrada (campo composto ou texto)...
  if (
    registeredTuples(product).some(
      (registered) =>
        tuple.length <= registered.length &&
        tuple.every((value, index) => same(value, registered[index])),
    )
  ) {
    return true;
  }
  // ...ou cada medida é uma grandeza de comprimento cadastrada do produto
  // (ex.: comprimento/largura em campos e profundidade em atributo).
  return tuple.every((value) => hasRegisteredQuantity(product, { value, unit: "m" }));
}

export function validateMeasureFact(value: number, product: FactProduct): boolean {
  return hasRegisteredQuantity(product, { value, unit: "m" });
}

export function validateCapacityFact(value: number, product: FactProduct): boolean {
  return hasRegisteredQuantity(product, { value, unit: "L" });
}

export function validateQuantityFact(quantity: Quantity, product: FactProduct): boolean {
  return hasRegisteredQuantity(product, quantity);
}

/** Todo fato numérico do texto é verdadeiro para ALGUM dos produtos dados. */
export function numericFactsHoldFor(
  facts: NumericFacts,
  products: readonly FactProduct[],
): boolean {
  if (products.length === 0) return !hasNumericFacts(facts);
  return (
    facts.prices.every((fact) => products.some((product) => validatePriceFact(fact, product))) &&
    facts.dimensions.every((tuple) =>
      products.some((product) => validateDimensionFact(tuple, product)),
    ) &&
    facts.measures.every((value) =>
      products.some((product) => validateMeasureFact(value, product)),
    ) &&
    facts.capacities.every((value) =>
      products.some((product) => validateCapacityFact(value, product)),
    ) &&
    facts.quantities.every((quantity) =>
      products.some((product) => validateQuantityFact(quantity, product)),
    )
  );
}
