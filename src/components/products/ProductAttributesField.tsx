// Características do produto como linhas tipadas (rótulo, tipo, valor e
// unidade). Cada empresa cria os rótulos que fazem sentido para o que vende;
// a tela sugere os rótulos/tipos/unidades já usados no próprio catálogo.
import { Plus, Trash2 } from "lucide-react";
import {
  ATTRIBUTE_TYPES,
  KNOWN_UNIT_SYMBOLS,
  factKeyFromLabel,
  type AttributeRow,
  type AttributeRowError,
  type AttributeType,
} from "@/lib/catalog-facts";

const ATTRIBUTE_TYPE_LABELS: Record<AttributeType, string> = {
  number: "Número",
  dimensions: "Medidas (A x B x C)",
  range: "Faixa (de/até)",
  text: "Texto",
  boolean: "Sim/Não",
  list: "Lista",
};

const ATTRIBUTE_ROW_ERROR_MESSAGES: Record<AttributeRowError, string> = {
  label_required: "Informe o nome da característica.",
  label_duplicate: "Característica repetida.",
  value_required: "Informe o valor.",
  number_invalid: "Use só o número (ex.: 1,40); a unidade vai no campo ao lado.",
  dimensions_invalid: "Use o formato 4 x 2,5 x 1,40.",
  range_invalid: "Use o formato 10 a 20 (mínimo a máximo).",
  boolean_invalid: "Use sim ou não.",
  unit_in_value: "A unidade do valor difere da unidade informada.",
};

const UNIT_TYPES: AttributeType[] = ["number", "dimensions", "range"];

const PLACEHOLDERS: Record<AttributeType, string> = {
  number: "1,40",
  dimensions: "4 x 2,5 x 1,40",
  range: "10 a 20",
  text: "Linho bege",
  boolean: "sim",
  list: "Azul, Branco",
};

/** Rótulo → tipo/unidade mais usados no catálogo da empresa. */
export interface AttributeSuggestion {
  label: string;
  type: AttributeType;
  unit: string;
}

const inputClass =
  "w-full h-11 md:h-9 px-2 text-base md:text-sm rounded-md border border-border bg-background focus:outline-none focus:ring-1 focus:ring-ring";

export function ProductAttributesField({
  rows,
  onChange,
  errors,
  suggestions,
}: {
  rows: AttributeRow[];
  onChange: (rows: AttributeRow[]) => void;
  errors: Partial<Record<number, AttributeRowError>>;
  suggestions: AttributeSuggestion[];
}) {
  const update = (index: number, patch: Partial<AttributeRow>) => {
    onChange(rows.map((row, current) => (current === index ? { ...row, ...patch } : row)));
  };
  const changeLabel = (index: number, label: string) => {
    const row = rows[index];
    const known = suggestions.find(
      (suggestion) => factKeyFromLabel(suggestion.label) === factKeyFromLabel(label),
    );
    // Mesmo rótulo de outro produto: reaproveita tipo e unidade (consistência).
    const adopt = known && !row.value.trim() && !row.unit.trim();
    update(index, adopt ? { label, type: known.type, unit: known.unit } : { label });
  };
  return (
    <div>
      <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">
        Características (opcional)
      </p>
      <p className="text-[10px] text-muted-foreground mb-2">
        Tudo o que a Vendedora pode afirmar sobre o produto: medidas, material, potência, tamanho,
        duração… A IA só usa o que estiver aqui ou nos campos acima.
      </p>
      <datalist id="product-attribute-labels">
        {suggestions.map((suggestion) => (
          <option key={suggestion.label} value={suggestion.label} />
        ))}
      </datalist>
      <datalist id="product-attribute-units">
        {KNOWN_UNIT_SYMBOLS.map((unit) => (
          <option key={unit} value={unit} />
        ))}
      </datalist>
      <div className="space-y-2">
        {rows.map((row, index) => (
          <div key={index} className="rounded-md border border-border p-2 space-y-2">
            <div className="grid grid-cols-1 md:grid-cols-[1.4fr_1fr] gap-2">
              <input
                type="text"
                list="product-attribute-labels"
                aria-label="Característica"
                value={row.label}
                onChange={(e) => changeLabel(index, e.target.value)}
                placeholder="Ex.: Largura, Material, Voltagem"
                className={inputClass}
              />
              <select
                aria-label="Tipo"
                value={row.type}
                onChange={(e) => update(index, { type: e.target.value as AttributeType })}
                className={inputClass}
              >
                {ATTRIBUTE_TYPES.map((type) => (
                  <option key={type} value={type}>
                    {ATTRIBUTE_TYPE_LABELS[type]}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex gap-2">
              <input
                type="text"
                aria-label="Valor"
                value={row.value}
                onChange={(e) => update(index, { value: e.target.value })}
                placeholder={PLACEHOLDERS[row.type]}
                className={inputClass}
              />
              {UNIT_TYPES.includes(row.type) && (
                <input
                  type="text"
                  list="product-attribute-units"
                  aria-label="Unidade"
                  value={row.unit}
                  onChange={(e) => update(index, { unit: e.target.value })}
                  placeholder="Unidade"
                  className={`${inputClass} max-w-[7rem]`}
                />
              )}
              <button
                type="button"
                onClick={() => onChange(rows.filter((_, current) => current !== index))}
                aria-label="Remover característica"
                className="h-11 md:h-9 w-11 md:w-9 shrink-0 inline-flex items-center justify-center rounded-md border border-border text-muted-foreground hover:text-destructive"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
            {errors[index] && (
              <p className="text-[11px] text-destructive">
                {ATTRIBUTE_ROW_ERROR_MESSAGES[errors[index] as AttributeRowError]}
              </p>
            )}
          </div>
        ))}
      </div>
      <button
        type="button"
        onClick={() => onChange([...rows, { label: "", type: "text", value: "", unit: "" }])}
        className="mt-2 inline-flex items-center gap-1.5 text-xs font-semibold rounded-md border border-border px-3 py-1.5 hover:bg-accent"
      >
        <Plus className="h-3.5 w-3.5" /> Adicionar característica
      </button>
    </div>
  );
}
