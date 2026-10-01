// ============================================================================
// Auditoria (somente leitura) dos fatos do catálogo de uma empresa.
//
// Aponta o que impede a Vendedora de usar um fato com segurança e sugere a
// forma tipada quando a conversão é inequívoca. Nada é gravado aqui: a
// sugestão só vale depois que um administrador a aplica em Produtos.
// ============================================================================

import { extractQuantities } from "./quantities";
import {
  factQuantities,
  isTypedAttribute,
  legacyAttributeValue,
  normalizeProductFacts,
  renderFactValue,
  type FactSourceProduct,
  type FactValue,
  type TypedAttribute,
} from "./normalize";
import { sameQuantity, unitFamily } from "./units";

export type CatalogAuditIssueCode =
  | "price_missing"
  | "promo_not_lower"
  | "specifications_invalid"
  | "attribute_untyped"
  | "attribute_missing_unit"
  | "attribute_conflict"
  | "fact_only_in_free_text"
  | "possible_duplicate";

export interface CatalogAuditIssue {
  code: CatalogAuditIssueCode;
  /** Rótulo do atributo ou trecho envolvido. */
  subject?: string;
  detail?: string;
}

export interface CatalogAuditSuggestion {
  label: string;
  attribute: TypedAttribute;
}

export interface CatalogAuditProductReport {
  productId: string;
  productName: string;
  issues: CatalogAuditIssue[];
  /** Conversões inequívocas de atributos legados (aplicação exige aprovação). */
  suggestions: CatalogAuditSuggestion[];
}

export interface CatalogAuditProduct extends FactSourceProduct {
  id: string;
}

function typedFromValue(value: FactValue): TypedAttribute | null {
  switch (value.kind) {
    case "quantity":
      return value.unit ? { type: "number", value: value.value, unit: value.unit } : null;
    case "dimensions":
      return value.unit ? { type: "dimensions", value: value.values, unit: value.unit } : null;
    case "range":
      return value.unit
        ? { type: "range", value: { min: value.min, max: value.max }, unit: value.unit }
        : null;
    case "boolean":
      return { type: "boolean", value: value.value };
    case "list":
      return { type: "list", value: value.items };
    case "text":
      return { type: "text", value: value.text };
    case "money":
      return null;
  }
}

function comparableName(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\((?:copia|copy)[^)]*\)/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function auditProductFacts(product: CatalogAuditProduct): CatalogAuditProductReport {
  const issues: CatalogAuditIssue[] = [];
  const suggestions: CatalogAuditSuggestion[] = [];
  if (product.price == null || !(product.price > 0)) issues.push({ code: "price_missing" });
  if (
    product.price != null &&
    product.promoPrice != null &&
    product.promoPrice > 0 &&
    product.promoPrice >= product.price
  ) {
    issues.push({ code: "promo_not_lower" });
  }
  if (
    product.specifications != null &&
    (typeof product.specifications !== "object" || Array.isArray(product.specifications))
  ) {
    issues.push({ code: "specifications_invalid" });
  }
  const { facts, conflicts } = normalizeProductFacts(product);
  for (const conflict of conflicts) {
    issues.push({
      code: "attribute_conflict",
      subject: conflict.label,
      detail: `${conflict.fieldValue} ≠ ${conflict.attributeValue}`,
    });
  }
  const specifications =
    product.specifications &&
    typeof product.specifications === "object" &&
    !Array.isArray(product.specifications)
      ? (product.specifications as Record<string, unknown>)
      : {};
  for (const [label, raw] of Object.entries(specifications)) {
    if (isTypedAttribute(raw)) continue;
    const value = legacyAttributeValue(raw, null);
    if (!value) continue;
    const fact = facts.find(
      (candidate) => candidate.label === label.replace(/\s*[([].*$/, "").trim(),
    );
    // Mesmo atributo de um campo: duplicata (ou conflito, já apontado acima).
    if (fact?.source === "field") continue;
    const resolved = fact?.value ?? value;
    if ((resolved.kind === "quantity" || resolved.kind === "dimensions") && resolved.unit == null) {
      issues.push({
        code: "attribute_missing_unit",
        subject: label,
        detail: renderFactValue(resolved),
      });
      continue;
    }
    issues.push({ code: "attribute_untyped", subject: label, detail: renderFactValue(resolved) });
    const typed = typedFromValue(resolved);
    if (typed && fact) suggestions.push({ label: fact.label, attribute: typed });
  }
  // Grandeza escrita só na descrição/observações: a Vendedora não tem campo
  // para validá-la com segurança.
  const structured = facts
    .filter((fact) => fact.source !== "free_text")
    .flatMap((fact) => factQuantities(fact.value));
  for (const fact of facts.filter((candidate) => candidate.source === "free_text")) {
    const extracted = extractQuantities(fact.value.kind === "text" ? fact.value.text : "", {
      knownOnly: true,
    });
    const quantities = [
      ...extracted.quantities,
      ...extracted.dimensions.flatMap((tuple) =>
        tuple.values.map((value) => ({ value, unit: tuple.unit })),
      ),
    ].filter((quantity) => !["time", "percent"].includes(unitFamily(quantity.unit) ?? ""));
    for (const quantity of quantities) {
      if (
        structured.some(
          (registered) => registered.unit != null && sameQuantity(quantity, registered),
        )
      ) {
        continue;
      }
      issues.push({
        code: "fact_only_in_free_text",
        subject: fact.label,
        detail: `${quantity.value} ${quantity.unit ?? ""}`.trim(),
      });
    }
  }
  return { productId: product.id, productName: product.name, issues, suggestions };
}

/** Relatório da empresa: apenas produtos com pendência. */
export function auditCatalogFacts(
  products: readonly CatalogAuditProduct[],
): CatalogAuditProductReport[] {
  const byName = new Map<string, string[]>();
  for (const product of products) {
    const key = comparableName(product.name);
    byName.set(key, [...(byName.get(key) ?? []), product.id]);
  }
  return products
    .map((product) => {
      const report = auditProductFacts(product);
      const sameName = byName.get(comparableName(product.name)) ?? [];
      if (sameName.length > 1) {
        report.issues.push({
          code: "possible_duplicate",
          detail: `${sameName.length} produtos com o mesmo nome`,
        });
      }
      return report;
    })
    .filter((report) => report.issues.length > 0);
}

/** `specifications` com as sugestões aplicadas (o restante fica igual). */
export function applyAuditSuggestions(
  specifications: unknown,
  suggestions: readonly CatalogAuditSuggestion[],
): Record<string, unknown> {
  const current =
    specifications && typeof specifications === "object" && !Array.isArray(specifications)
      ? { ...(specifications as Record<string, unknown>) }
      : {};
  for (const suggestion of suggestions) {
    // Rótulo legado pode carregar a unidade ("Profundidade (m)"): substitui
    // a entrada original pela forma tipada com o rótulo limpo.
    const original = Object.keys(current).find(
      (label) =>
        label === suggestion.label || label.replace(/\s*[([].*$/, "").trim() === suggestion.label,
    );
    if (original) delete current[original];
    current[suggestion.label] = suggestion.attribute;
  }
  return current;
}
