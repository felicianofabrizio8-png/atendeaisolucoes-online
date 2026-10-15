// ============================================================================
// Seleção de formatos da campanha — componente ÚNICO, usado pelo modo IA e
// pelo modo manual. Não existe outra fonte de rótulos/opções na UI.
//
// O valor é a seleção canônica de `campaign-formats.ts`, exatamente o mesmo
// contrato persistido em `ai_prompt.formats`.
// ============================================================================

import { Label } from "@/components/ui/label";
import {
  CAMPAIGN_FORMAT_LABELS,
  CAMPAIGN_FORMAT_SELECTIONS,
  type CampaignFormatSelection,
} from "@/lib/marketing/campaign-formats";

export interface CampaignFormatsFieldProps {
  value: CampaignFormatSelection;
  onChange: (value: CampaignFormatSelection) => void;
  disabled?: boolean;
  label?: string;
  /** Texto auxiliar exibido abaixo do controle. */
  hint?: string;
  id?: string;
}

export function CampaignFormatsField({
  value,
  onChange,
  disabled = false,
  label = "Formato da campanha",
  hint,
  id = "campaign-formats",
}: CampaignFormatsFieldProps) {
  return (
    <div className="mkt-format-field space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <select
        id={id}
        aria-label={label}
        className="w-full h-9 rounded-md border bg-background px-2 text-sm disabled:opacity-50"
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value as CampaignFormatSelection)}
      >
        {/* Ordem fixa: combinado primeiro (padrão histórico). */}
        {["feed_story", ...CAMPAIGN_FORMAT_SELECTIONS.filter((s) => s !== "feed_story")].map(
          (option) => (
            <option key={option} value={option}>
              {CAMPAIGN_FORMAT_LABELS[option as CampaignFormatSelection]}
            </option>
          ),
        )}
      </select>
      {/* Mouse shortcut for the select above (which stays the accessible control):
          each tile toggles its format, and at least one always stays selected. */}
      <div className="mkt-format-visuals" aria-hidden="true">
        {(["feed", "story"] as const).map((format) => {
          const selected = value === "feed_story" || value === format;
          const other = format === "feed" ? "story" : "feed";
          return (
            <span
              key={format}
              className={selected ? "is-selected" : ""}
              onClick={() => {
                if (disabled) return;
                if (!selected) onChange(value === other ? "feed_story" : format);
                else if (value === "feed_story") onChange(other);
              }}
            >
              <i className={format === "feed" ? "mkt-ratio-feed" : "mkt-ratio-story"} />
              <b>{format === "feed" ? "Feed" : "Story"}</b>
              <small>{format === "feed" ? "4:5 · na sua página" : "9:16 · tela inteira"}</small>
            </span>
          );
        })}
      </div>
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}
