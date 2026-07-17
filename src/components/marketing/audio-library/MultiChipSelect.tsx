import { Label } from "@/components/ui/label";

/**
 * Seletor múltiplo em formato de "chips" com toggle por clique.
 * - Reutiliza o padrão já usado no upload atual (bg-primary quando ativo).
 * - Suporta options string ou number; renderiza label customizada opcional.
 */
export function MultiChipSelect<T extends string | number>(props: {
  label: string;
  value: readonly T[];
  options: readonly T[];
  onToggle: (value: T) => void;
  renderLabel?: (v: T) => string;
  helperText?: string;
}) {
  return (
    <div>
      <Label>{props.label}</Label>
      {props.helperText ? (
        <p className="text-[11px] text-muted-foreground mb-1">{props.helperText}</p>
      ) : null}
      <div
        className="flex flex-wrap gap-2 mt-1"
        role="group"
        aria-label={props.label}
      >
        {props.options.map((v) => {
          const active = props.value.includes(v);
          const label = props.renderLabel ? props.renderLabel(v) : String(v);
          return (
            <button
              key={String(v)}
              type="button"
              onClick={() => props.onToggle(v)}
              aria-pressed={active}
              className={`text-xs px-2 py-1 rounded border transition-colors ${
                active
                  ? "bg-primary text-primary-foreground border-primary"
                  : "bg-background hover:bg-muted"
              }`}
            >
              {label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
