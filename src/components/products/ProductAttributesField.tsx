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

// Mesmo campo dos formulários pretos (Orçamentos, Metas): `.lq-form .quote-form-input`.
const inputClass = "quote-form-input";

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
  const unused = suggestions.filter(
    (suggestion) =>
      !rows.some((row) => factKeyFromLabel(row.label) === factKeyFromLabel(suggestion.label)),
  );
  return (
    <div className="lp-attrs">
      <p className="lq-hint lp-attrs-intro">
        Medidas, material, potência, tamanho, duração… A Vendedora só afirma o que estiver aqui ou
        nos campos das outras etapas.
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
      {rows.length > 0 && (
        <div className="lp-attr-rows">
          {rows.map((row, index) => (
            <div key={index} className="lp-attr-row" data-error={errors[index] ? true : undefined}>
              <div className="lp-attr-line">
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
              <div className="lp-attr-line lp-attr-value">
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
                    className={`${inputClass} lp-attr-unit`}
                  />
                )}
                <button
                  type="button"
                  onClick={() => onChange(rows.filter((_, current) => current !== index))}
                  aria-label="Remover característica"
                  className="lq-icon"
                  data-danger
                >
                  <Trash2 aria-hidden="true" />
                </button>
              </div>
              {errors[index] && (
                <p className="lp-attr-error">
                  {ATTRIBUTE_ROW_ERROR_MESSAGES[errors[index] as AttributeRowError]}
                </p>
              )}
            </div>
          ))}
        </div>
      )}
      <div className="lq-extra-actions lp-attr-add">
        <button
          type="button"
          onClick={() => onChange([...rows, { label: "", type: "text", value: "", unit: "" }])}
        >
          <Plus aria-hidden="true" /> Adicionar característica
        </button>
        {/* Atalhos: rótulos já usados em outros produtos, com o mesmo tipo e unidade. */}
        {unused.slice(0, 6).map((suggestion) => (
          <button
            key={suggestion.label}
            type="button"
            onClick={() =>
              onChange([
                ...rows,
                {
                  label: suggestion.label,
                  type: suggestion.type,
                  value: "",
                  unit: suggestion.unit,
                },
              ])
            }
          >
            <Plus aria-hidden="true" /> {suggestion.label}
          </button>
        ))}
      </div>
    </div>
  );
}
