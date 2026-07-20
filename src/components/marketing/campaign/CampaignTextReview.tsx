// Tela de revisão de texto (approval-gate).
// A IA propõe; o usuário edita/aprova antes de qualquer renderização.
//
// Botões:
//  - "Gerar nova sugestão IA"  → regenera overlays (mesma imagem/áudio).
//  - "Restaurar original"       → volta ao snapshot da 1ª sugestão (client-side).
//  - "Aprovar e gerar vídeo"    → persiste texto aprovado + enfileira render.

import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Loader2, Sparkles, RotateCcw, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";
import {
  apiApproveCampaignAndRender,
  apiRegenerateCampaignTexts,
  type FocalPointInput,
} from "@/data/marketingRepo";
import type { MarketingContentRow } from "@/lib/marketing/marketing.types";
import { CampaignTextPreview } from "./CampaignTextPreview";

interface Props {
  campaignId: string;
  contents: MarketingContentRow[];
  previewImageUrl: string | null;
  focalPoint?: FocalPointInput | null;
  /** Chamado quando o usuário aprova e o job de render é enfileirado. */
  onApproved: (jobId: string) => void;
  /** Substitui os contents após regeneração. */
  onContentsUpdated?: (contents: MarketingContentRow[]) => void;
}

const HEADLINE_MAX = 80;
const SUB_MAX = 120;
const CTA_MAX = 60;

export function CampaignTextReview({
  campaignId,
  contents,
  previewImageUrl,
  focalPoint,
  onApproved,
  onContentsUpdated,
}: Props) {
  const feedRow = useMemo(
    () => contents.find((c) => c.campaign_role === "feed") ?? contents[0] ?? null,
    [contents],
  );

  const initialHeadline = feedRow?.overlay_headline ?? "";
  const initialSub = feedRow?.overlay_subheadline ?? "";
  const initialCta = feedRow?.overlay_cta ?? "";
  const originalHeadline = feedRow?.overlay_original_headline ?? initialHeadline;
  const originalSub = feedRow?.overlay_original_subheadline ?? initialSub;
  const originalCta = feedRow?.overlay_original_cta ?? initialCta;

  const [headline, setHeadline] = useState<string>(initialHeadline);
  const [subheadline, setSubheadline] = useState<string>(initialSub);
  const [cta, setCta] = useState<string>(initialCta);
  const [regenerating, setRegenerating] = useState(false);
  const [approving, setApproving] = useState(false);

  const canApprove = headline.trim().length > 0 && !approving && !regenerating;

  async function handleRegenerate() {
    setRegenerating(true);
    try {
      const res = await apiRegenerateCampaignTexts({ campaign_id: campaignId });
      const fresh = (res.contents ?? []) as MarketingContentRow[];
      const feed =
        fresh.find((c) => c.campaign_role === "feed") ?? fresh[0] ?? null;
      if (feed) {
        setHeadline(feed.overlay_headline ?? "");
        setSubheadline(feed.overlay_subheadline ?? "");
        setCta(feed.overlay_cta ?? "");
      }
      onContentsUpdated?.(fresh);
      toast.success("Nova sugestão de texto gerada.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao gerar nova sugestão.");
    } finally {
      setRegenerating(false);
    }
  }

  function handleRestore() {
    setHeadline(originalHeadline ?? "");
    setSubheadline(originalSub ?? "");
    setCta(originalCta ?? "");
    toast.info("Sugestão original restaurada.");
  }

  async function handleApprove() {
    if (!headline.trim()) {
      toast.error("O título é obrigatório.");
      return;
    }
    setApproving(true);
    try {
      const res = await apiApproveCampaignAndRender({
        campaign_id: campaignId,
        headline: headline.trim(),
        subheadline: subheadline.trim() ? subheadline.trim() : null,
        cta: cta.trim() ? cta.trim() : null,
      });
      toast.success("Texto aprovado. Iniciando renderização…");
      onApproved(res.job_id);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao aprovar texto.");
    } finally {
      setApproving(false);
    }
  }

  return (
    <div className="rounded-lg border bg-card p-4 space-y-4">
      <div>
        <div className="text-sm font-semibold">Revisar textos do vídeo</div>
        <div className="text-xs text-muted-foreground">
          A IA sugeriu os textos abaixo. Edite livremente e aprove — o vídeo só
          será renderizado após sua aprovação.
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-[1fr_auto] gap-4">
        {/* Editor */}
        <div className="space-y-3">
          <div>
            <div className="flex items-baseline justify-between">
              <Label htmlFor="ov-headline">Título</Label>
              <span className="text-[10px] text-muted-foreground">
                {headline.length}/{HEADLINE_MAX}
              </span>
            </div>
            <Input
              id="ov-headline"
              value={headline}
              maxLength={HEADLINE_MAX}
              onChange={(e) => setHeadline(e.target.value)}
              placeholder="Ex.: Seu verão começa aqui"
            />
          </div>
          <div>
            <div className="flex items-baseline justify-between">
              <Label htmlFor="ov-sub">Subtítulo</Label>
              <span className="text-[10px] text-muted-foreground">
                {subheadline.length}/{SUB_MAX}
              </span>
            </div>
            <Textarea
              id="ov-sub"
              value={subheadline}
              maxLength={SUB_MAX}
              rows={2}
              onChange={(e) => setSubheadline(e.target.value)}
              placeholder="Ex.: Piscinas com qualidade e instalação rápida"
            />
          </div>
          <div>
            <div className="flex items-baseline justify-between">
              <Label htmlFor="ov-cta">Chamada (CTA)</Label>
              <span className="text-[10px] text-muted-foreground">
                {cta.length}/{CTA_MAX}
              </span>
            </div>
            <Input
              id="ov-cta"
              value={cta}
              maxLength={CTA_MAX}
              onChange={(e) => setCta(e.target.value)}
              placeholder="Ex.: Fale conosco"
            />
          </div>
        </div>

        {/* Preview */}
        <div className="md:pl-2">
          <div className="text-xs font-medium text-muted-foreground mb-2">
            Prévia (9:16)
          </div>
          <CampaignTextPreview
            imageUrl={previewImageUrl}
            focalPoint={focalPoint ?? null}
            headline={headline}
            subheadline={subheadline || null}
            cta={cta || null}
          />
        </div>
      </div>

      <div className="flex flex-wrap gap-2 pt-2 border-t">
        <Button
          variant="outline"
          onClick={handleRegenerate}
          disabled={regenerating || approving}
        >
          {regenerating ? (
            <Loader2 className="h-4 w-4 animate-spin mr-1" />
          ) : (
            <Sparkles className="h-4 w-4 mr-1" />
          )}
          Gerar nova sugestão IA
        </Button>
        <Button
          variant="ghost"
          onClick={handleRestore}
          disabled={regenerating || approving}
        >
          <RotateCcw className="h-4 w-4 mr-1" />
          Restaurar original
        </Button>
        <div className="flex-1" />
        <Button onClick={handleApprove} disabled={!canApprove} size="lg">
          {approving ? (
            <Loader2 className="h-4 w-4 animate-spin mr-1" />
          ) : (
            <CheckCircle2 className="h-4 w-4 mr-1" />
          )}
          Aprovar texto e gerar vídeo
        </Button>
      </div>
    </div>
  );
}
