// ============================================================================
// Grandezas cadastradas de um produto e grandezas pedidas pelo cliente.
//
// Mesma camada de fatos normalizados que valida as respostas: qualquer
// atributo da empresa (tipado, legado ou coluna) participa da busca por
// grandeza, comparado por família de unidade — sem saber o que o atributo
// significa no segmento.
// ============================================================================

import {
  factQuantities,
  formatFactNumber,
  normalizeProductFacts,
  renderFactValue,
  type FactSourceProduct,
} from "./normalize";
import { extractQuantities, type Quantity } from "./quantities";
import { sameQuantity, unitFamily } from "./units";

// Prazo e percentual pertencem a condições comerciais, não ao produto.
const NON_PRODUCT_FAMILIES = new Set(["time", "percent"]);

/** Grandezas do cadastro: atributos/colunas + texto livre (fallback legado). */
export function productRegisteredQuantities(product: FactSourceProduct): Quantity[] {
  const { facts } = normalizeProductFacts(product);
  return facts.flatMap((fact) => {
    if (fact.value.kind !== "text") return factQuantities(fact.value);
    const extracted = extractQuantities(fact.value.text, { knownOnly: true });
    return [
      ...extracted.quantities,
      ...extracted.dimensions.flatMap((tuple) =>
        tuple.values.map((value) => ({ value, unit: tuple.unit })),
      ),
    ];
  });
}

/** Grandezas físicas (unidade conhecida) pedidas numa mensagem. */
export function requestedQuantities(text: string): Quantity[] {
  const extracted = extractQuantities(text, { knownOnly: true });
  return [
    ...extracted.quantities,
    ...extracted.dimensions.flatMap((tuple) =>
      tuple.values.map((value) => ({ value, unit: tuple.unit })),
    ),
  ].filter((quantity) => !NON_PRODUCT_FAMILIES.has(unitFamily(quantity.unit) ?? ""));
}

/** O produto tem TODAS as grandezas pedidas (mesma família, valor convertido). */
export function productHasQuantities(
  product: FactSourceProduct,
  requested: readonly Quantity[],
): boolean {
  if (requested.length === 0) return false;
  const registered = productRegisteredQuantities(product).filter(
    (quantity) => quantity.unit != null,
  );
  return requested.every((quantity) =>
    registered.some((candidate) => sameQuantity(quantity, candidate)),
  );
}

/**
 * Texto de busca dos fatos: rótulo, valor formatado e o número cru
 * ("Potência 1.200 W 1200"), para o cliente achar o item como escrever.
 */
export function productFactsSearchText(product: FactSourceProduct): string {
  return normalizeProductFacts(product)
    .facts.map((fact) => {
      const raw = factQuantities(fact.value)
        .map((quantity) => String(quantity.value))
        .filter((value) => value !== formatFactNumber(Number(value)));
      return [fact.label, renderFactValue(fact.value), ...raw].join(" ");
    })
    .join(" ");
}
