// ============================================================================
// Unidades físicas universais (não dependem de segmento).
//
// Cada unidade pertence a uma família e tem fator para a unidade-base da
// família, o que permite comparar "140 cm" com "1,4 m". Unidade fora desta
// tabela é preservada como escrita e só é igual a ela mesma.
// ============================================================================

export type UnitFamily =
  | "length"
  | "area"
  | "volume"
  | "mass"
  | "power"
  | "voltage"
  | "current"
  | "energy"
  | "temperature"
  | "pressure"
  | "frequency"
  | "data"
  | "time"
  | "percent";

interface UnitDefinition {
  symbol: string;
  family: UnitFamily;
  factor: number;
  aliases: string[];
  /** Só vale colado ao número ("10A"), para não confundir com palavras. */
  attachedAliases?: string[];
}

const UNIT_DEFINITIONS: UnitDefinition[] = [
  { symbol: "mm", family: "length", factor: 0.001, aliases: ["mm", "milimetro", "milimetros"] },
  { symbol: "cm", family: "length", factor: 0.01, aliases: ["cm", "centimetro", "centimetros"] },
  { symbol: "m", family: "length", factor: 1, aliases: ["m", "mt", "mts", "metro", "metros"] },
  { symbol: "km", family: "length", factor: 1000, aliases: ["km", "quilometro", "quilometros"] },
  { symbol: "pol", family: "length", factor: 0.0254, aliases: ["pol", "polegada", "polegadas"] },
  { symbol: "cm²", family: "area", factor: 0.0001, aliases: ["cm2", "cm²"] },
  {
    symbol: "m²",
    family: "area",
    factor: 1,
    aliases: ["m2", "m²", "metro quadrado", "metros quadrados"],
  },
  { symbol: "ml", family: "volume", factor: 0.001, aliases: ["ml", "mililitro", "mililitros"] },
  { symbol: "L", family: "volume", factor: 1, aliases: ["l", "lt", "lts", "litro", "litros"] },
  {
    symbol: "m³",
    family: "volume",
    factor: 1000,
    aliases: ["m3", "m³", "metro cubico", "metros cubicos"],
  },
  { symbol: "g", family: "mass", factor: 0.001, aliases: ["g", "grama", "gramas"] },
  {
    symbol: "kg",
    family: "mass",
    factor: 1,
    aliases: ["kg", "quilo", "quilos", "kilo", "kilos", "quilograma", "quilogramas"],
  },
  {
    symbol: "t",
    family: "mass",
    factor: 1000,
    aliases: ["ton", "tonelada", "toneladas"],
    attachedAliases: ["t"],
  },
  { symbol: "W", family: "power", factor: 1, aliases: ["w", "watt", "watts"] },
  { symbol: "kW", family: "power", factor: 1000, aliases: ["kw", "quilowatt", "quilowatts"] },
  { symbol: "cv", family: "power", factor: 735.5, aliases: ["cv"] },
  { symbol: "hp", family: "power", factor: 745.7, aliases: ["hp"] },
  { symbol: "BTU/h", family: "power", factor: 0.29307, aliases: ["btu", "btus", "btu/h"] },
  { symbol: "V", family: "voltage", factor: 1, aliases: ["v", "volt", "volts"] },
  {
    symbol: "A",
    family: "current",
    factor: 1,
    aliases: ["amp", "ampere", "amperes"],
    attachedAliases: ["a"],
  },
  { symbol: "Wh", family: "energy", factor: 1, aliases: ["wh"] },
  { symbol: "kWh", family: "energy", factor: 1000, aliases: ["kwh"] },
  { symbol: "°C", family: "temperature", factor: 1, aliases: ["°c", "ºc"] },
  { symbol: "bar", family: "pressure", factor: 1, aliases: ["bar"] },
  { symbol: "psi", family: "pressure", factor: 0.0689476, aliases: ["psi"] },
  { symbol: "Hz", family: "frequency", factor: 1, aliases: ["hz"] },
  { symbol: "kHz", family: "frequency", factor: 1000, aliases: ["khz"] },
  { symbol: "MB", family: "data", factor: 1, aliases: ["mb"] },
  { symbol: "GB", family: "data", factor: 1024, aliases: ["gb"] },
  { symbol: "TB", family: "data", factor: 1024 * 1024, aliases: ["tb"] },
  {
    symbol: "s",
    family: "time",
    factor: 1,
    aliases: ["seg", "segundo", "segundos"],
    attachedAliases: ["s"],
  },
  { symbol: "min", family: "time", factor: 60, aliases: ["min", "minuto", "minutos"] },
  { symbol: "h", family: "time", factor: 3600, aliases: ["h", "hora", "horas"] },
  { symbol: "dia", family: "time", factor: 86400, aliases: ["dia", "dias"] },
  { symbol: "semana", family: "time", factor: 604800, aliases: ["semana", "semanas"] },
  { symbol: "mês", family: "time", factor: 2592000, aliases: ["mes", "meses"] },
  { symbol: "ano", family: "time", factor: 31536000, aliases: ["ano", "anos"] },
  { symbol: "%", family: "percent", factor: 1, aliases: ["%"] },
];

export function normalizeUnitText(value: string): string {
  return value.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
}

const BY_ALIAS = new Map<string, UnitDefinition>();
const BY_ATTACHED_ALIAS = new Map<string, UnitDefinition>();
const BY_SYMBOL = new Map<string, UnitDefinition>();
for (const unit of UNIT_DEFINITIONS) {
  BY_SYMBOL.set(unit.symbol, unit);
  for (const alias of unit.aliases) BY_ALIAS.set(normalizeUnitText(alias), unit);
  for (const alias of unit.attachedAliases ?? [])
    BY_ATTACHED_ALIAS.set(normalizeUnitText(alias), unit);
}

/**
 * Unidade canônica de um texto de unidade. `attached` indica que o texto veio
 * colado ao número. Desconhecida → o próprio texto normalizado.
 */
export function canonicalUnit(raw: string | null | undefined, attached = false): string | null {
  if (raw == null) return null;
  const normalized = normalizeUnitText(raw).replace(/\.$/, "");
  if (!normalized) return null;
  if (BY_SYMBOL.has(raw.trim())) return raw.trim();
  const known =
    BY_ALIAS.get(normalized) ?? (attached ? BY_ATTACHED_ALIAS.get(normalized) : undefined);
  return known ? known.symbol : normalized;
}

export function isKnownUnit(unit: string | null | undefined): boolean {
  return unit != null && BY_SYMBOL.has(unit);
}

export function unitFamily(unit: string | null | undefined): UnitFamily | null {
  return unit ? (BY_SYMBOL.get(unit)?.family ?? null) : null;
}

/** Valor na unidade-base da família (null se a unidade não é conhecida). */
export function toBaseUnit(value: number, unit: string | null | undefined): number | null {
  const definition = unit ? BY_SYMBOL.get(unit) : undefined;
  return definition ? value * definition.factor : null;
}

/** Unidades da tabela, para sugestões na tela de Produtos. */
export const KNOWN_UNIT_SYMBOLS: readonly string[] = UNIT_DEFINITIONS.map((unit) => unit.symbol);

/**
 * Mesma grandeza? Unidades conhecidas: mesma família e valor igual após
 * conversão. Desconhecidas: mesmo texto de unidade e mesmo valor. Sem unidade
 * em um dos lados: compara o número na unidade do outro.
 */
export function sameQuantity(
  left: { value: number; unit: string | null },
  right: { value: number; unit: string | null },
): boolean {
  if (left.unit == null || right.unit == null || left.unit === right.unit) {
    return closeEnough(left.value, right.value);
  }
  const leftFamily = unitFamily(left.unit);
  const rightFamily = unitFamily(right.unit);
  if (!leftFamily || leftFamily !== rightFamily) return false;
  const leftBase = toBaseUnit(left.value, left.unit);
  const rightBase = toBaseUnit(right.value, right.unit);
  return leftBase != null && rightBase != null && closeEnough(leftBase, rightBase);
}

function closeEnough(left: number, right: number): boolean {
  const scale = Math.max(Math.abs(left), Math.abs(right), 1);
  return Math.abs(left - right) <= Math.max(0.001, scale * 1e-6);
}
