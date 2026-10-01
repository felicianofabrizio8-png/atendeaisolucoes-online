// ============================================================================
// Leitura de números, valores monetários e grandezas (número + unidade) em
// texto pt-BR. É só aritmética de formato ("12.900,00", "1/2", "4 x 2,5 m"),
// sem interpretar a frase: a qual atributo uma grandeza se refere é decidido
// pela interpretação semântica (LLM), não aqui.
// ============================================================================

import { canonicalUnit, isKnownUnit, normalizeUnitText } from "./units";

export interface Quantity {
  value: number;
  unit: string | null;
}

export interface DimensionsQuantity {
  values: number[];
  unit: string | null;
}

export interface ExtractedQuantities {
  quantities: Quantity[];
  dimensions: DimensionsQuantity[];
}

/** "12.900,00" → 12900; "2,5" → 2.5; "1.4" → 1.4; "1/2" → 0.5. */
export function parseLocaleNumber(raw: string): number | null {
  const value = raw.replace(/\s/g, "");
  const fraction = value.match(/^(\d+)\/(\d+)$/);
  if (fraction) {
    const denominator = Number(fraction[2]);
    return denominator > 0 ? Number(fraction[1]) / denominator : null;
  }
  const parsed = value.includes(",")
    ? Number(value.replace(/\./g, "").replace(",", "."))
    : Number(value.replace(/\.(?=\d{3}(?:\D|$))/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
}

const NUMBER = String.raw`\d+\/\d+|\d+(?:[.,]\d+)*`;
// Unidade: letras/símbolos colados ou após espaço; até duas palavras
// ("metros quadrados"). A conferência com a tabela decide se é unidade.
// O "x" isolado é o separador de medidas, nunca unidade.
const UNIT = String.raw`(?![x×](?![a-zà-ü]))[°º]?[a-zà-ü²³%][a-zà-ü²³/]*(?:\s+[a-zà-ü]+)?`;
const QUANTITY_PATTERN = new RegExp(String.raw`(?<![\w.,$])(${NUMBER})(\s*)(${UNIT}|%)?`, "giu");
const DIMENSIONS_PATTERN = new RegExp(
  String.raw`(?<![\w.,$])(${NUMBER})\s*(${UNIT})?\s*[x×]\s*(${NUMBER})\s*(${UNIT})?(?:\s*[x×]\s*(${NUMBER})\s*(${UNIT})?)?`,
  "giu",
);

function readUnit(
  raw: string | undefined,
  attached: boolean,
  knownOnly: boolean,
): { unit: string | null; consumed: string } {
  if (!raw) return { unit: null, consumed: "" };
  const words = raw.trim().split(/\s+/);
  // Tenta a forma de duas palavras ("metros quadrados") antes da de uma.
  for (const size of [2, 1]) {
    if (words.length < size) continue;
    const candidate = words.slice(0, size).join(" ");
    const unit = canonicalUnit(candidate, attached && size === 1);
    if (unit && isKnownUnit(unit)) return { unit, consumed: candidate };
  }
  if (knownOnly) return { unit: null, consumed: "" };
  const first = normalizeUnitText(words[0]);
  return first ? { unit: first, consumed: words[0] } : { unit: null, consumed: "" };
}

/**
 * Grandezas do texto. `knownOnly`: só número com unidade da tabela (para
 * cobrir o que uma resposta afirma); caso contrário, unidade desconhecida
 * ("3 lugares") é mantida como escrita.
 */
export function extractQuantities(
  text: string,
  options: { knownOnly?: boolean } = {},
): ExtractedQuantities {
  const knownOnly = options.knownOnly ?? true;
  const dimensions: DimensionsQuantity[] = [];
  let rest = text;
  for (const match of text.matchAll(DIMENSIONS_PATTERN)) {
    const parts = [
      [match[1], match[2]],
      [match[3], match[4]],
      [match[5], match[6]],
    ].filter(([value]) => Boolean(value)) as Array<[string, string | undefined]>;
    const units = parts.map(([, unit]) => readUnit(unit, false, true).unit);
    const declared = units.filter((unit): unit is string => unit != null);
    if (declared.some((unit) => unit !== declared[0])) continue;
    const values = parts
      .map(([value]) => parseLocaleNumber(value))
      .filter((value): value is number => value != null);
    if (values.length !== parts.length) continue;
    const unit = declared[0] ?? null;
    if (knownOnly && unit == null) continue;
    dimensions.push({ values, unit });
    rest = rest.replace(match[0], " ");
  }
  const quantities: Quantity[] = [];
  for (const match of rest.matchAll(QUANTITY_PATTERN)) {
    const value = parseLocaleNumber(match[1]);
    if (value == null) continue;
    const { unit } = readUnit(match[3], match[2] === "", knownOnly);
    if (unit == null) continue;
    quantities.push({ value, unit });
  }
  return { quantities, dimensions };
}

/** Texto inteiro como uma grandeza ("1,40 m", "220V", "9.500 litros", "3"). */
export function parseWholeQuantity(text: string): Quantity | null {
  const trimmed = text.trim();
  const match = trimmed.match(new RegExp(String.raw`^(${NUMBER})(\s*)(${UNIT}|%)?$`, "iu"));
  if (!match) return null;
  const value = parseLocaleNumber(match[1]);
  if (value == null) return null;
  if (!match[3]) return { value, unit: null };
  const { unit, consumed } = readUnit(match[3], match[2] === "", false);
  return unit != null && consumed.length === match[3].trim().length ? { value, unit } : null;
}

/** Texto inteiro como medidas compostas ("4 x 2,5 x 1,40 m"). */
export function parseWholeDimensions(text: string): DimensionsQuantity | null {
  const trimmed = text.trim();
  const found = extractQuantities(trimmed, { knownOnly: false }).dimensions;
  if (found.length !== 1) return null;
  const match = trimmed.match(DIMENSIONS_PATTERN);
  return match && match[0].trim().length === trimmed.length ? found[0] : null;
}

const MONEY_PATTERN =
  /r\$\s*([\d.]+(?:,\d{1,2})?)(?:\s*(mil|k)\b)?|(?<![\d.,])([\d.]+(?:,\d{1,2})?)\s*(mil|k|reais)\b|^\s*([\d.]+(?:,\d{1,2})?)\s*$/gi;

/** Valores monetários de um texto ("R$ 12.900,00", "12,9 mil", "12900"). */
export function parseMoneyValues(text: string): number[] {
  const values: number[] = [];
  for (const match of text.matchAll(MONEY_PATTERN)) {
    const raw = match[1] ?? match[3] ?? match[5];
    const multiplier = /^(?:mil|k)$/i.test(match[2] ?? match[4] ?? "") ? 1000 : 1;
    const parsed = raw ? parseLocaleNumber(raw) : null;
    if (parsed != null) values.push(parsed * multiplier);
  }
  return values;
}
