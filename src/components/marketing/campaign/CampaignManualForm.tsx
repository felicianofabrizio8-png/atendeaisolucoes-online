// Modo Manual — formulário completo de campanha (sem IA).
//
// Preenche os mesmos campos que a IA geraria. Ao enviar, chamamos
// `apiGenerateManualCampaign`, que cria as linhas feed/story e devolve o
// controle para o MESMO editor de aprovação usado no modo IA.

import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { CampaignFormatsField } from "./CampaignFormatsField";
import { Textarea } from "@/components/ui/textarea";
import { Loader2, PencilRuler } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  THEME_PRESETS,
  getThemePreset,
  type ThemeId,
} from "@/lib/marketing/video-editor/theme-presets";
import type {
  ManualCampaignFields,
  ManualCampaignFormats,
} from "@/lib/marketing/manual-campaign";

export interface ManualSubmitPayload {
  fields: ManualCampaignFields;
  formats: ManualCampaignFormats;
  theme: ThemeId;
  template: string;
}

interface Props {
  submitting?: boolean;
  disabled?: boolean;
  disabledReason?: string | null;
  onSubmit: (payload: ManualSubmitPayload) => void;
}

const EMPTY = {
  title: "",
  subtitle: "",
  description: "",
  price: "",
  promo_text: "",
  cta_text: "",
  phone: "",
  whatsapp: "",
  instagram: "",
  website: "",
  hashtags: "",
};

export function CampaignManualForm({
  submitting = false,
  disabled = false,
  disabledReason,
  onSubmit,
}: Props) {
  const [v, setV] = useState({ ...EMPTY });
  const [theme, setTheme] = useState<ThemeId>("promocao");
  const [formats, setFormats] = useState<ManualCampaignFormats>("feed_story");

  const preset = useMemo(() => getThemePreset(theme)!, [theme]);
  const set = (k: keyof typeof EMPTY) => (e: { target: { value: string } }) =>
    setV((cur) => ({ ...cur, [k]: e.target.value }));

  const canSubmit = v.title.trim().length > 0 && !disabled && !submitting;

  function submit() {
    if (!canSubmit) return;
    const fields: ManualCampaignFields = {
      title: v.title.trim(),
      subtitle: v.subtitle.trim() || null,
      description: v.description.trim() || null,
      price: v.price.trim() || null,
      promo_text: v.promo_text.trim() || null,
      cta_text: v.cta_text.trim() || preset.suggestedCta,
      phone: v.phone.trim() || null,
      whatsapp: v.whatsapp.trim() || null,
      instagram: v.instagram.trim() || null,
      website: v.website.trim() || null,
      hashtags: v.hashtags
        .split(/[\s,]+/)
        .map((h) => h.trim())
        .filter(Boolean),
    };
    onSubmit({ fields, formats, theme, template: preset.template });
  }

  return (
    <div className="rounded-lg border bg-card p-4 space-y-4">
      <div className="flex items-center gap-2">
        <PencilRuler className="h-4 w-4 text-muted-foreground" />
        <span className="text-sm font-semibold">Criar manualmente (sem IA)</span>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div className="md:col-span-2">
          <Label>Título *</Label>
          <Input value={v.title} onChange={set("title")} maxLength={80} placeholder="Ex.: Piscina 3x2 com instalação" />
        </div>
        <div>
          <Label>Subtítulo</Label>
          <Input value={v.subtitle} onChange={set("subtitle")} maxLength={120} placeholder="Ex.: Entrega em 7 dias" />
        </div>
        <div>
          <Label>Preço (opcional)</Label>
          <Input value={v.price} onChange={set("price")} maxLength={40} placeholder="Ex.: R$ 8.990" />
        </div>
        <div className="md:col-span-2">
          <Label>Descrição</Label>
          <Textarea value={v.description} onChange={set("description")} rows={3} maxLength={2000} />
        </div>
        <div className="md:col-span-2">
          <Label>Texto promocional</Label>
          <Input value={v.promo_text} onChange={set("promo_text")} maxLength={300} placeholder="Ex.: 20% off até domingo" />
        </div>
        <div>
          <Label>Botão (CTA)</Label>
          <Input value={v.cta_text} onChange={set("cta_text")} maxLength={60} placeholder={preset.suggestedCta} />
        </div>
        <div>
          <Label>Hashtags</Label>
          <Input value={v.hashtags} onChange={set("hashtags")} placeholder="#piscina #verao" />
        </div>
        <div>
          <Label>Telefone</Label>
          <Input value={v.phone} onChange={set("phone")} maxLength={40} />
        </div>
        <div>
          <Label>WhatsApp</Label>
          <Input value={v.whatsapp} onChange={set("whatsapp")} maxLength={40} />
        </div>
        <div>
          <Label>Instagram</Label>
          <Input value={v.instagram} onChange={set("instagram")} maxLength={80} placeholder="@suaempresa" />
        </div>
        <div>
          <Label>Site</Label>
          <Input value={v.website} onChange={set("website")} maxLength={200} />
        </div>
      </div>

      <div className="space-y-2">
        <Label>Template / tema</Label>
        <div className="flex flex-wrap gap-2">
          {THEME_PRESETS.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTheme(t.id)}
              className={cn(
                "rounded-md border px-3 py-2 text-xs text-left transition-colors",
                theme === t.id ? "border-primary bg-primary/10" : "hover:bg-muted",
              )}
            >
              <span className="flex items-center gap-2">
                <span
                  className="h-3 w-3 rounded-full border"
                  style={{ background: t.colors.accent }}
                  aria-hidden
                />
                <span className="font-medium">{t.label}</span>
              </span>
              <span className="block text-muted-foreground">{t.description}</span>
            </button>
          ))}
        </div>
        <p className="text-xs text-muted-foreground">
          Logo, posição da logo e ajustes finos de cor ficam disponíveis no editor,
          na etapa seguinte.
        </p>
      </div>

      {/* Componente compartilhado com o modo IA — nenhuma duplicação. */}
      <CampaignFormatsField
        id="manual-campaign-formats"
        value={formats}
        onChange={(v) => setFormats(v as ManualCampaignFormats)}
      />

      {disabled && disabledReason && (
        <p className="text-xs text-muted-foreground">{disabledReason}</p>
      )}

      <Button onClick={submit} disabled={!canSubmit} className="w-full md:w-auto">
        {submitting ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null}
        Criar campanha manualmente
      </Button>
    </div>
  );
}
