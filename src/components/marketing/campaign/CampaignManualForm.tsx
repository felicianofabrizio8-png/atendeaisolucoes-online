import { LumePulse } from "../MarketingMotion";
// Modo Manual — formulário completo de campanha (sem IA).
//
// Preenche os mesmos campos que a IA geraria. Ao enviar, chamamos
// `apiGenerateManualCampaign`, que cria as linhas feed/story e devolve o
// controle para o MESMO editor de aprovação usado no modo IA.

import { OVERLAY_LIMITS, buildManualOverlay } from "@/lib/marketing/manual-campaign";
import { useId, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { CampaignFormatsField } from "./CampaignFormatsField";
import { Textarea } from "@/components/ui/textarea";
import { PencilRuler } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  THEME_PRESETS,
  getThemePreset,
  type ThemeId,
} from "@/lib/marketing/video-editor/theme-presets";
import type { ManualCampaignFields, ManualCampaignFormats } from "@/lib/marketing/manual-campaign";

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
  const fieldId = useId();
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

  const overlayPreview = buildManualOverlay({
    title: v.title,
    subtitle: v.subtitle,
    promo_text: v.promo_text,
    price: v.price,
    cta_text: v.cta_text,
  });

  return (
    <div className="mkt-manual-form rounded-lg border bg-card p-4 space-y-4">
      <header className="mkt-form-head" data-hue="violet">
        <span className="mkt-icon-chip" aria-hidden>
          <PencilRuler size={18} />
        </span>
        <div>
          <h3 className="mkt-builder-step">Escreva os textos da sua campanha</h3>
          <p>Só o título é obrigatório. O restante aparece no vídeo se você preencher.</p>
        </div>
      </header>

      <div className="mkt-form-grid">
        <div className="md:col-span-2">
          <Label htmlFor={fieldId + "-title"}>Título *</Label>
          <Input
            id={fieldId + "-title"}
            value={v.title}
            onChange={set("title")}
            maxLength={80}
            placeholder="Ex.: Produto com entrega rápida"
          />
          {overlayPreview.overlay_headline !== v.title.trim() && v.title.trim().length > 0 ? (
            <p className="mkt-hint" data-testid="overlay-headline-hint">
              No vídeo cabem até {OVERLAY_LIMITS.headline} caracteres. Vai aparecer:{" "}
              <strong>{overlayPreview.overlay_headline}</strong>. O título completo vai na legenda.
            </p>
          ) : (
            <p className="mkt-hint">
              Frase principal do vídeo. <span>{v.title.length}/80</span>
            </p>
          )}
        </div>
        <div>
          <Label htmlFor={fieldId + "-subtitle"}>Subtítulo</Label>
          <Input
            id={fieldId + "-subtitle"}
            value={v.subtitle}
            onChange={set("subtitle")}
            maxLength={120}
            placeholder="Ex.: Entrega em 7 dias"
          />
          <p className="mkt-hint">
            <span>{v.subtitle.length}/120</span>
          </p>
        </div>
        <div>
          <Label htmlFor={fieldId + "-price"}>Preço (opcional)</Label>
          <Input
            id={fieldId + "-price"}
            value={v.price}
            onChange={set("price")}
            maxLength={40}
            placeholder="Ex.: R$ 8.990"
          />
        </div>
        <div className="md:col-span-2">
          <Label htmlFor={fieldId + "-description"}>Descrição</Label>
          <Textarea
            id={fieldId + "-description"}
            value={v.description}
            onChange={set("description")}
            rows={3}
            maxLength={2000}
          />
        </div>
        <div className="md:col-span-2">
          <Label htmlFor={fieldId + "-promo_text"}>Texto promocional</Label>
          <Input
            id={fieldId + "-promo_text"}
            value={v.promo_text}
            onChange={set("promo_text")}
            maxLength={300}
            placeholder="Ex.: 20% off até domingo"
          />
        </div>
        <div>
          <Label htmlFor={fieldId + "-cta_text"}>Texto do botão</Label>
          <Input
            id={fieldId + "-cta_text"}
            value={v.cta_text}
            onChange={set("cta_text")}
            maxLength={60}
            placeholder={preset.suggestedCta}
          />
        </div>
        <div>
          <Label htmlFor={fieldId + "-hashtags"}>Hashtags</Label>
          <Input
            id={fieldId + "-hashtags"}
            value={v.hashtags}
            onChange={set("hashtags")}
            placeholder="#novidade #oferta"
          />
        </div>
        <details className="mkt-extra-fields md:col-span-2">
          <summary>Contatos e redes sociais (opcional)</summary>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <Label htmlFor={fieldId + "-phone"}>Telefone</Label>
              <Input
                id={fieldId + "-phone"}
                value={v.phone}
                onChange={set("phone")}
                maxLength={40}
              />
            </div>
            <div>
              <Label htmlFor={fieldId + "-whatsapp"}>WhatsApp</Label>
              <Input
                id={fieldId + "-whatsapp"}
                value={v.whatsapp}
                onChange={set("whatsapp")}
                maxLength={40}
              />
            </div>
            <div>
              <Label htmlFor={fieldId + "-instagram"}>Instagram</Label>
              <Input
                id={fieldId + "-instagram"}
                value={v.instagram}
                onChange={set("instagram")}
                maxLength={80}
                placeholder="@suaempresa"
              />
            </div>
            <div>
              <Label htmlFor={fieldId + "-website"}>Site</Label>
              <Input
                id={fieldId + "-website"}
                value={v.website}
                onChange={set("website")}
                maxLength={200}
              />
            </div>
          </div>
        </details>
      </div>

      <div className="space-y-2">
        <Label>Estilo do vídeo</Label>
        <div className="mkt-style-choices flex flex-wrap gap-2">
          {THEME_PRESETS.map((t) => (
            <button
              key={t.id}
              type="button"
              aria-pressed={theme === t.id}
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
          Você pode ajustar as cores e a identidade visual na próxima etapa.
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
        {submitting ? <LumePulse className="h-4 w-4 animate-spin mr-1" /> : null}
        Criar campanha manualmente
      </Button>
    </div>
  );
}
