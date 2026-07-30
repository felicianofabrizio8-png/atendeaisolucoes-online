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
    <div className="space-y-1.5">
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
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}
