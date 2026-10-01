// ============================================================================
// Fatos de um produto de Produtos, normalizados e tipados.
//
// Produtos é o catálogo comercial universal: campos universais fixos (nome,
// preço, promoção, SKU, categoria...) + atributos que cada empresa cria com
// rótulo, tipo e unidade em `specifications`. Nenhum atributo de segmento é
// conhecido pelo código: o significado vem do rótulo cadastrado pela empresa.
//
// Ordem de confiança: campo universal/coluna > atributo tipado > atributo
// legado (valor primitivo). Atributo com a mesma chave de um campo e valor
// diferente é conflito (não vira fato). Descrição/observações entram como
// texto livre (fonte "free_text"), para compatibilidade com cadastros antigos.
// ============================================================================

import {
  parseLocaleNumber,
  parseWholeDimensions,
  parseWholeQuantity,
  type DimensionsQuantity,
  type Quantity,
} from "./quantities";
import { canonicalUnit, sameQuantity } from "./units";

export const ATTRIBUTE_TYPES = [
  "number",
  "dimensions",
  "range",
  "text",
  "boolean",
  "list",
] as const;
export type AttributeType = (typeof ATTRIBUTE_TYPES)[number];

/** Atributo tipado salvo em `specifications[rótulo]`. */
export type TypedAttribute =
  | { type: "number"; value: number; unit?: string | null }
  | { type: "dimensions"; value: number[]; unit?: string | null }
  | { type: "range"; value: { min: number; max: number }; unit?: string | null }
  | { type: "text"; value: string }
  | { type: "boolean"; value: boolean }
  | { type: "list"; value: string[] };

export type FactValue =
  | { kind: "money"; amount: number }
  | { kind: "quantity"; value: number; unit: string | null }
  | { kind: "dimensions"; values: number[]; unit: string | null }
  | { kind: "range"; min: number; max: number; unit: string | null }
  | { kind: "boolean"; value: boolean }
  | { kind: "text"; text: string }
  | { kind: "list"; items: string[] };

export type FactSource = "field" | "attribute" | "legacy_attribute" | "free_text";

export interface CatalogFact {
  /** Chave estável no produto (vai no prompt; o LLM a cita ao afirmar o fato). */
  key: string;
  label: string;
  value: FactValue;
  source: FactSource;
}

export interface FactConflict {
  label: string;
  fieldValue: string;
  attributeValue: string;
}

export interface NormalizedProductFacts {
  facts: CatalogFact[];
  conflicts: FactConflict[];
}

/** Forma mínima de produto lida pelo normalizador (servidor e tela). */
export interface FactSourceProduct {
  name: string;
  model?: string | null;
  sku?: string | null;
  category?: string | null;
  description?: string | null;
  notes?: string | null;
  lengthM?: number | null;
  widthM?: number | null;
  depthM?: number | null;
  capacityL?: number | null;
  shape?: string | null;
  specifications?: unknown;
  includedItems?: string[];
  variants?: unknown[];
  price: number | null;
  promoPrice?: number | null;
}

// Chaves dos campos universais (fixos em toda empresa).
export const UNIVERSAL_FACT_KEYS = {
  name: "nome",
  model: "modelo",
  sku: "sku",
  category: "categoria",
  price: "preco",
  promoPrice: "preco_promocional",
  includedItems: "itens_inclusos",
  variants: "variantes",
  description: "descricao",
  notes: "observacoes",
} as const;

export function factKeyFromLabel(label: string): string {
  return (
    label
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/\([^)]*\)|\[[^\]]*\]/g, " ")
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "") || "atributo"
  );
}

export function formatFactNumber(value: number): string {
  return new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 3 }).format(value);
}

function formatMoney(value: number): string {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
    minimumFractionDigits: 2,
  })
    .format(value)
    .replace(/\s/g, " ");
}

export function renderFactValue(value: FactValue): string {
  const withUnit = (text: string, unit: string | null) => (unit ? `${text} ${unit}` : text);
  switch (value.kind) {
    case "money":
      return formatMoney(value.amount);
    case "quantity":
      return withUnit(formatFactNumber(value.value), value.unit);
    case "dimensions":
      return withUnit(value.values.map(formatFactNumber).join(" x "), value.unit);
    case "range":
      return withUnit(
        `${formatFactNumber(value.min)} a ${formatFactNumber(value.max)}`,
        value.unit,
      );
    case "boolean":
      return value.value ? "sim" : "não";
    case "text":
      return value.text;
    case "list":
      return value.items.join(", ");
  }
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/** Unidade escrita no próprio rótulo legado: "Profundidade (m)", "Peso [kg]". */
function unitFromLabel(label: string): { label: string; unit: string | null } {
  const match = label.match(/^(.*?)\s*[([]\s*([^)\]]+?)\s*[)\]]\s*$/);
  if (!match) return { label: label.trim(), unit: null };
  return { label: match[1].trim() || label.trim(), unit: canonicalUnit(match[2]) };
}

export function isTypedAttribute(value: unknown): value is TypedAttribute {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const row = value as Record<string, unknown>;
  if (!ATTRIBUTE_TYPES.includes(row.type as AttributeType) || !("value" in row)) return false;
  switch (row.type as AttributeType) {
    case "number":
      return isFiniteNumber(row.value);
    case "dimensions":
      return Array.isArray(row.value) && row.value.length >= 2 && row.value.every(isFiniteNumber);
    case "range": {
      const range = row.value as Record<string, unknown> | null;
      return Boolean(range) && isFiniteNumber(range?.min) && isFiniteNumber(range?.max);
    }
    case "text":
      return typeof row.value === "string" && row.value.trim().length > 0;
    case "boolean":
      return typeof row.value === "boolean";
    case "list":
      return Array.isArray(row.value) && row.value.every((item) => typeof item === "string");
  }
}

export function typedAttributeValue(attribute: TypedAttribute): FactValue {
  const unit = "unit" in attribute ? canonicalUnit(attribute.unit ?? null) : null;
  switch (attribute.type) {
    case "number":
      return { kind: "quantity", value: attribute.value, unit };
    case "dimensions":
      return { kind: "dimensions", values: [...attribute.value], unit };
    case "range":
      return { kind: "range", min: attribute.value.min, max: attribute.value.max, unit };
    case "text":
      return { kind: "text", text: attribute.value.trim() };
    case "boolean":
      return { kind: "boolean", value: attribute.value };
    case "list":
      return {
        kind: "list",
        items: attribute.value.map((item) => item.trim()).filter(Boolean),
      };
  }
}

const YES = new Set(["sim", "yes", "true"]);
const NO = new Set(["nao", "não", "no", "false"]);

/**
 * Valor legado (primitivo) → fato tipado, quando o formato é inequívoco.
 * Unidade vem do valor ("1,40 m") ou do rótulo ("Profundidade (m)").
 */
export function legacyAttributeValue(raw: unknown, labelUnit: string | null): FactValue | null {
  if (raw == null) return null;
  if (typeof raw === "boolean") return { kind: "boolean", value: raw };
  if (isFiniteNumber(raw)) return { kind: "quantity", value: raw, unit: labelUnit };
  if (Array.isArray(raw)) {
    const items = raw
      .filter((item) => typeof item === "string" || isFiniteNumber(item))
      .map((item) => String(item).trim())
      .filter(Boolean);
    return items.length > 0 ? { kind: "list", items } : null;
  }
  if (typeof raw === "object") {
    // Objeto não tipado: preservado como texto "chave: valor" para não perder
    // a informação que já ia ao prompt (a auditoria aponta para tipar).
    const text = Object.entries(raw as Record<string, unknown>)
      .filter(([, value]) => value != null && typeof value !== "object")
      .map(([key, value]) => `${key}: ${String(value)}`)
      .join("; ");
    return text ? { kind: "text", text } : null;
  }
  const text = String(raw).trim();
  if (!text) return null;
  const lowered = text.toLowerCase();
  if (YES.has(lowered)) return { kind: "boolean", value: true };
  if (NO.has(lowered)) return { kind: "boolean", value: false };
  const dimensions = parseWholeDimensions(text);
  if (dimensions) {
    return { kind: "dimensions", values: dimensions.values, unit: dimensions.unit ?? labelUnit };
  }
  const quantity = parseWholeQuantity(text);
  if (quantity)
    return { kind: "quantity", value: quantity.value, unit: quantity.unit ?? labelUnit };
  return { kind: "text", text };
}

function sameFactValue(left: FactValue, right: FactValue): boolean {
  if (left.kind === "quantity" && right.kind === "quantity") return sameQuantity(left, right);
  if (left.kind === "dimensions" && right.kind === "dimensions") {
    return (
      left.values.length === right.values.length &&
      left.values.every((value, index) =>
        sameQuantity({ value, unit: left.unit }, { value: right.values[index], unit: right.unit }),
      )
    );
  }
  return renderFactValue(left).trim().toLowerCase() === renderFactValue(right).trim().toLowerCase();
}

function positive(value: number | null | undefined): number | null {
  return value != null && Number.isFinite(value) && value > 0 ? value : null;
}

/** Fatos tipados de um produto (campos universais + atributos da empresa). */
export function normalizeProductFacts(product: FactSourceProduct): NormalizedProductFacts {
  const facts: CatalogFact[] = [];
  const conflicts: FactConflict[] = [];
  const usedKeys = new Set<string>();
  const push = (key: string, label: string, value: FactValue, source: FactSource) => {
    let unique = key;
    for (let index = 2; usedKeys.has(unique); index += 1) unique = `${key}_${index}`;
    usedKeys.add(unique);
    facts.push({ key: unique, label, value, source });
  };
  const text = (value: string | null | undefined) => value?.trim() || null;

  push(UNIVERSAL_FACT_KEYS.name, "Nome", { kind: "text", text: product.name }, "field");
  const model = text(product.model);
  if (model) push(UNIVERSAL_FACT_KEYS.model, "Modelo", { kind: "text", text: model }, "field");
  const sku = text(product.sku);
  if (sku) push(UNIVERSAL_FACT_KEYS.sku, "SKU", { kind: "text", text: sku }, "field");
  const category = text(product.category);
  if (category)
    push(UNIVERSAL_FACT_KEYS.category, "Categoria", { kind: "text", text: category }, "field");
  const price = positive(product.price);
  if (price != null)
    push(UNIVERSAL_FACT_KEYS.price, "Preço", { kind: "money", amount: price }, "field");
  const promo = positive(product.promoPrice);
  if (promo != null) {
    push(
      UNIVERSAL_FACT_KEYS.promoPrice,
      "Preço promocional",
      { kind: "money", amount: promo },
      "field",
    );
  }

  // Colunas legadas de medida: atributos como quaisquer outros, já tipados.
  const columnFacts: Array<[string, number | null | undefined, string]> = [
    ["Comprimento", product.lengthM, "m"],
    ["Largura", product.widthM, "m"],
    ["Profundidade", product.depthM, "m"],
    ["Capacidade", product.capacityL, "L"],
  ];
  for (const [label, value, unit] of columnFacts) {
    if (value != null && Number.isFinite(value)) {
      push(factKeyFromLabel(label), label, { kind: "quantity", value, unit }, "field");
    }
  }
  const columnDimensions = [product.lengthM, product.widthM, product.depthM];
  if (
    columnDimensions.filter((value) => value != null && Number.isFinite(value)).length >= 2 &&
    product.lengthM != null &&
    product.widthM != null
  ) {
    push(
      "medidas",
      "Medidas (C x L x P)",
      {
        kind: "dimensions",
        values: columnDimensions.filter(
          (value): value is number => value != null && Number.isFinite(value),
        ),
        unit: "m",
      },
      "field",
    );
  }
  const shape = text(product.shape);
  if (shape) push("formato", "Formato", { kind: "text", text: shape }, "field");
  const fieldByKey = new Map(facts.map((fact) => [fact.key, fact]));

  const specifications =
    product.specifications &&
    typeof product.specifications === "object" &&
    !Array.isArray(product.specifications)
      ? (product.specifications as Record<string, unknown>)
      : {};
  for (const [rawLabel, raw] of Object.entries(specifications)) {
    const { label, unit: labelUnit } = unitFromLabel(rawLabel);
    if (!label) continue;
    const typed = isTypedAttribute(raw);
    const value = typed ? typedAttributeValue(raw) : legacyAttributeValue(raw, labelUnit);
    if (!value) continue;
    const key = factKeyFromLabel(label);
    const field = fieldByKey.get(key);
    if (field) {
      // Mesmo atributo do campo: igual é duplicata; diferente é conflito.
      if (!sameFactValue(field.value, value)) {
        conflicts.push({
          label,
          fieldValue: renderFactValue(field.value),
          attributeValue: renderFactValue(value),
        });
      }
      continue;
    }
    push(key, label, value, typed ? "attribute" : "legacy_attribute");
  }

  const includedItems = (product.includedItems ?? []).map((item) => item.trim()).filter(Boolean);
  if (includedItems.length > 0) {
    push(
      UNIVERSAL_FACT_KEYS.includedItems,
      "Itens inclusos",
      { kind: "list", items: includedItems },
      "field",
    );
  }
  const variants = (product.variants ?? [])
    .flatMap((variant) => {
      if (typeof variant === "string") return [variant.trim()];
      if (!variant || typeof variant !== "object" || Array.isArray(variant)) return [];
      return [
        Object.values(variant as Record<string, unknown>)
          .filter((value) => typeof value === "string" || isFiniteNumber(value))
          .map(String)
          .filter((value) => value.trim())
          .filter(
            (value, index, all) =>
              all.findIndex((item) => item.toLowerCase() === value.toLowerCase()) === index,
          )
          .join("/"),
      ];
    })
    .filter(Boolean);
  if (variants.length > 0) {
    push(UNIVERSAL_FACT_KEYS.variants, "Variantes", { kind: "list", items: variants }, "field");
  }
  // Fallback legado temporário: descrição/observações ainda valem como fato
  // (texto livre) até as empresas tiparem as características; a auditoria
  // sinaliza grandezas que só existem aqui (fact_only_in_free_text).
  const description = text(product.description);
  if (description) {
    push(
      UNIVERSAL_FACT_KEYS.description,
      "Descrição",
      { kind: "text", text: description },
      "free_text",
    );
  }
  const notes = text(product.notes);
  if (notes)
    push(UNIVERSAL_FACT_KEYS.notes, "Observações", { kind: "text", text: notes }, "free_text");
  return { facts, conflicts };
}

/** Atributos (não universais) do produto, na ordem cadastrada. */
export function attributeFacts(facts: readonly CatalogFact[]): CatalogFact[] {
  const universal = new Set<string>(Object.values(UNIVERSAL_FACT_KEYS));
  return facts.filter((fact) => !universal.has(fact.key));
}

/** Texto "Rótulo: valor" de todos os fatos (busca e validação textual legada). */
export function productFactsText(product: FactSourceProduct): string {
  return normalizeProductFacts(product)
    .facts.map((fact) => `${fact.label}: ${renderFactValue(fact.value)}`)
    .join(". ");
}

/** "Rótulo valor" dos atributos de `specifications` (busca textual). */
export function specificationsSearchText(specifications: unknown): string {
  return attributeRowsFromSpecifications(specifications)
    .map((row) => [row.label, row.value, row.unit].filter(Boolean).join(" "))
    .join(" ");
}

/** Grandezas numéricas de um fato (para cobrir números de uma resposta). */
export function factQuantities(value: FactValue): Quantity[] {
  switch (value.kind) {
    case "quantity":
      return [{ value: value.value, unit: value.unit }];
    case "dimensions":
      return value.values.map((entry) => ({ value: entry, unit: value.unit }));
    case "range":
      return [
        { value: value.min, unit: value.unit },
        { value: value.max, unit: value.unit },
      ];
    default:
      return [];
  }
}

export function factDimensions(value: FactValue): DimensionsQuantity | null {
  return value.kind === "dimensions" ? { values: value.values, unit: value.unit } : null;
}

// ----------------------------------------------------------------------------
// Atributos editáveis (tela de Produtos)
// ----------------------------------------------------------------------------

export interface AttributeRow {
  label: string;
  type: AttributeType;
  /** Valor como digitado ("1,40", "4 x 2,5 x 1,40", "sim", "Azul, Branco"). */
  value: string;
  unit: string;
}

/** Linhas editáveis a partir de `specifications` (tipado ou legado). */
export function attributeRowsFromSpecifications(specifications: unknown): AttributeRow[] {
  if (!specifications || typeof specifications !== "object" || Array.isArray(specifications)) {
    return [];
  }
  return Object.entries(specifications as Record<string, unknown>).flatMap(([rawLabel, raw]) => {
    const { label, unit: labelUnit } = unitFromLabel(rawLabel);
    const value = isTypedAttribute(raw)
      ? typedAttributeValue(raw)
      : legacyAttributeValue(raw, labelUnit);
    if (!value) return [];
    return [rowFromFactValue(label, value)];
  });
}

function rowFromFactValue(label: string, value: FactValue): AttributeRow {
  switch (value.kind) {
    case "quantity":
      return {
        label,
        type: "number",
        value: formatFactNumber(value.value),
        unit: value.unit ?? "",
      };
    case "dimensions":
      return {
        label,
        type: "dimensions",
        value: value.values.map(formatFactNumber).join(" x "),
        unit: value.unit ?? "",
      };
    case "range":
      return {
        label,
        type: "range",
        value: `${formatFactNumber(value.min)} a ${formatFactNumber(value.max)}`,
        unit: value.unit ?? "",
      };
    case "boolean":
      return { label, type: "boolean", value: value.value ? "sim" : "não", unit: "" };
    case "list":
      return { label, type: "list", value: value.items.join(", "), unit: "" };
    case "money":
      return { label, type: "number", value: formatFactNumber(value.amount), unit: "R$" };
    case "text":
      return { label, type: "text", value: value.text, unit: "" };
  }
}

export type AttributeRowError =
  | "label_required"
  | "label_duplicate"
  | "value_required"
  | "number_invalid"
  | "dimensions_invalid"
  | "range_invalid"
  | "boolean_invalid"
  | "unit_in_value";

export interface AttributeRowIssue {
  index: number;
  error: AttributeRowError;
}

function parseNumbers(value: string): number[] | null {
  const parts = value
    .split(/\s*[x×]\s*|\s+a\s+|\s*;\s*/i)
    .map((part) => part.trim())
    .filter(Boolean);
  const numbers = parts.map((part) => (/^[\d.,/]+$/.test(part) ? parseLocaleNumber(part) : null));
  return numbers.every((entry): entry is number => entry != null) ? numbers : null;
}

/**
 * Valida as linhas digitadas e monta `specifications` tipado. Erros são
 * semânticos (número inválido, rótulo duplicado...), nunca de JSON.
 */
export function attributeRowsToSpecifications(rows: readonly AttributeRow[]): {
  specifications: Record<string, TypedAttribute>;
  issues: AttributeRowIssue[];
} {
  const specifications: Record<string, TypedAttribute> = {};
  const issues: AttributeRowIssue[] = [];
  const seen = new Set<string>();
  rows.forEach((row, index) => {
    const label = row.label.trim();
    const value = row.value.trim();
    if (!label && !value) return;
    if (!label) return issues.push({ index, error: "label_required" });
    const key = factKeyFromLabel(label);
    if (seen.has(key)) return issues.push({ index, error: "label_duplicate" });
    seen.add(key);
    if (!value) return issues.push({ index, error: "value_required" });
    const unit = row.unit.trim() ? canonicalUnit(row.unit.trim()) : null;
    switch (row.type) {
      case "number": {
        const quantity = parseWholeQuantity(value);
        if (!quantity) return issues.push({ index, error: "number_invalid" });
        if (quantity.unit && unit && quantity.unit !== unit) {
          return issues.push({ index, error: "unit_in_value" });
        }
        specifications[label] = {
          type: "number",
          value: quantity.value,
          unit: unit ?? quantity.unit,
        };
        return;
      }
      case "dimensions": {
        const parsed = parseWholeDimensions(value);
        const numbers = parsed?.values ?? parseNumbers(value);
        if (!numbers || numbers.length < 2)
          return issues.push({ index, error: "dimensions_invalid" });
        specifications[label] = {
          type: "dimensions",
          value: numbers,
          unit: unit ?? parsed?.unit ?? null,
        };
        return;
      }
      case "range": {
        const numbers = parseNumbers(value);
        if (!numbers || numbers.length !== 2 || numbers[0] > numbers[1]) {
          return issues.push({ index, error: "range_invalid" });
        }
        specifications[label] = {
          type: "range",
          value: { min: numbers[0], max: numbers[1] },
          unit,
        };
        return;
      }
      case "boolean": {
        const lowered = value.toLowerCase();
        if (!YES.has(lowered) && !NO.has(lowered))
          return issues.push({ index, error: "boolean_invalid" });
        specifications[label] = { type: "boolean", value: YES.has(lowered) };
        return;
      }
      case "list": {
        const items = value
          .split(/\s*[,;\n]\s*/)
          .map((item) => item.trim())
          .filter(Boolean);
        specifications[label] = { type: "list", value: items };
        return;
      }
      case "text":
        specifications[label] = { type: "text", value };
        return;
    }
  });
  return { specifications, issues };
}
