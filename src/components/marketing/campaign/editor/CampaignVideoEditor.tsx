// Container do Editor Visual do Vídeo IA.
// Substitui a tela antiga de "aprovar texto" — mesma lógica de backend
// (regenerateCampaignTexts + approveCampaignAndRender), UX de editor de vídeo.
//
// Fluxo:
//  1) IA já gerou textos (pendingReview → contents).
//  2) Usuário edita textos/logo/textos/template com preview 9:16 ao vivo.
//  3) Ao clicar "GERAR VÍDEO", chamamos approveCampaignAndRender enviando
//     texto aprovado + layout + template. Só então o job é enfileirado.

import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { CheckCircle2, Loader2, Layers, Type, ImageIcon, LayoutTemplate } from "lucide-react";
import { toast } from "sonner";
import {
  apiApproveCampaignAndRender,
  apiRegenerateCampaignTexts,
  type FocalPointInput,
} from "@/data/marketingRepo";
import type { MarketingContentRow } from "@/lib/marketing/marketing.types";
import type {
  TemplateId,
  VideoLayout,
} from "@/lib/marketing/video-editor/layout.types";
import { DEFAULT_TEMPLATE } from "@/lib/marketing/video-editor/layout.types";
import { getTemplate } from "@/lib/marketing/video-editor/templates";
import { EditorPreview } from "./EditorPreview";
import { TabTexto } from "./tabs/TabTexto";
import { TabLogo } from "./tabs/TabLogo";
import { TabTextos } from "./tabs/TabTextos";
import { TabTemplate } from "./tabs/TabTemplate";

interface Props {
  campaignId: string;
  contents: MarketingContentRow[];
  previewImageUrl: string | null;
  logoUrl?: string | null;
  focalPoint?: FocalPointInput | null;
  onApproved: (jobId: string) => void;
  onContentsUpdated?: (contents: MarketingContentRow[]) => void;
}

function readSavedLayout(
  row: MarketingContentRow | null | undefined,
): { layout: VideoLayout; template: TemplateId } {
  const anyRow = row as unknown as {
    video_layout?: VideoLayout | null;
    video_template?: TemplateId | null;
  } | null;
  const savedTemplate = (anyRow?.video_template as TemplateId) ?? DEFAULT_TEMPLATE;
  const preset = getTemplate(savedTemplate);
  const layout = (anyRow?.video_layout as VideoLayout) ?? preset.layout;
  return { layout, template: savedTemplate };
}

export function CampaignVideoEditor({
  campaignId,
  contents,
  previewImageUrl,
  logoUrl,
  focalPoint,
  onApproved,
  onContentsUpdated,
}: Props) {
  const feedRow = useMemo(
    () => contents.find((c) => c.campaign_role === "feed") ?? contents[0] ?? null,
    [contents],
  );

  const [headline, setHeadline] = useState(feedRow?.overlay_headline ?? "");
  const [subheadline, setSubheadline] = useState(feedRow?.overlay_subheadline ?? "");
  const [cta, setCta] = useState(feedRow?.overlay_cta ?? "");

  const saved = useMemo(() => readSavedLayout(feedRow), [feedRow]);
  const [layout, setLayout] = useState<VideoLayout>(saved.layout);

  const [regenerating, setRegenerating] = useState(false);
  const [approving, setApproving] = useState(false);
  const [tab, setTab] = useState("texto");

  // Se `contents` for substituído (após regenerate), sincroniza os campos
  // de texto — mas preserva o layout que o usuário estava editando.
  useEffect(() => {
    if (!feedRow) return;
    setHeadline(feedRow.overlay_headline ?? "");
    setSubheadline(feedRow.overlay_subheadline ?? "");
    setCta(feedRow.overlay_cta ?? "");
  }, [feedRow]);

  const originalHeadline = feedRow?.overlay_original_headline ?? headline;
  const originalSub = feedRow?.overlay_original_subheadline ?? subheadline;
  const originalCta = feedRow?.overlay_original_cta ?? cta;

  async function handleRegenerate() {
    setRegenerating(true);
    try {
      const res = await apiRegenerateCampaignTexts({ campaign_id: campaignId });
      const fresh = (res.contents ?? []) as MarketingContentRow[];
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

  function handleTemplateChange(id: TemplateId) {
    const preset = getTemplate(id);
    setLayout({ ...preset.layout, template: id });
    toast.info(`Template “${preset.label}” aplicado.`);
  }

  async function handleApprove() {
    if (!headline.trim()) {
      toast.error("O título é obrigatório.");
      setTab("texto");
      return;
    }
    setApproving(true);
    try {
      const res = await apiApproveCampaignAndRender({
        campaign_id: campaignId,
        headline: headline.trim(),
        subheadline: subheadline.trim() ? subheadline.trim() : null,
        cta: cta.trim() ? cta.trim() : null,
        layout,
        template: layout.template,
      });
      toast.success("Aprovado! Iniciando renderização…");
      onApproved(res.job_id);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao aprovar.");
    } finally {
      setApproving(false);
    }
  }

  return (
    <div className="rounded-lg border bg-card overflow-hidden">
      <div className="px-4 py-3 border-b flex items-center justify-between gap-2 flex-wrap">
        <div>
          <div className="text-sm font-semibold">Editor de vídeo</div>
          <div className="text-xs text-muted-foreground">
            Ajuste texto, logo e template. O vídeo só é gerado ao clicar em “Gerar vídeo”.
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] gap-4 p-4">
        {/* Preview grande 9:16 — ocupa a maior parte da tela */}
        <div className="lg:sticky lg:top-4 self-start">
          <div className="mx-auto" style={{ maxWidth: 420 }}>
            <EditorPreview
              imageUrl={previewImageUrl}
              logoUrl={logoUrl ?? null}
              focalPoint={focalPoint ?? null}
              headline={headline}
              subheadline={subheadline || null}
              cta={cta || null}
              layout={layout}
            />
            <div className="mt-2 text-center text-[11px] text-muted-foreground">
              Prévia · 9:16 · atualiza em tempo real
            </div>
          </div>
        </div>

        {/* Abas */}
        <div className="min-w-0">
          <Tabs value={tab} onValueChange={setTab}>
            <TabsList className="grid grid-cols-4 w-full">
              <TabsTrigger value="texto" className="gap-1">
                <Type className="h-3.5 w-3.5" /> Texto
              </TabsTrigger>
              <TabsTrigger value="logo" className="gap-1">
                <ImageIcon className="h-3.5 w-3.5" /> Logo
              </TabsTrigger>
              <TabsTrigger value="textos" className="gap-1">
                <Layers className="h-3.5 w-3.5" /> Textos
              </TabsTrigger>
              <TabsTrigger value="template" className="gap-1">
                <LayoutTemplate className="h-3.5 w-3.5" /> Template
              </TabsTrigger>
            </TabsList>
            <TabsContent value="texto" className="pt-4">
              <TabTexto
                headline={headline}
                subheadline={subheadline}
                cta={cta}
                onHeadline={setHeadline}
                onSubheadline={setSubheadline}
                onCta={setCta}
                onRegenerate={handleRegenerate}
                onRestore={handleRestore}
                regenerating={regenerating}
                disabled={approving}
              />
            </TabsContent>
            <TabsContent value="logo" className="pt-4">
              <TabLogo
                value={layout.logo}
                onChange={(logo) => setLayout({ ...layout, logo })}
              />
            </TabsContent>
            <TabsContent value="textos" className="pt-4">
              <TabTextos layout={layout} onChange={setLayout} />
            </TabsContent>
            <TabsContent value="template" className="pt-4">
              <TabTemplate value={layout.template} onChange={handleTemplateChange} />
            </TabsContent>
          </Tabs>
        </div>
      </div>

      {/* Footer — botão único que dispara o render */}
      <div className="border-t bg-muted/30 px-4 py-3 flex items-center justify-between gap-3 flex-wrap">
        <div className="text-xs text-muted-foreground">
          Nenhum vídeo é criado até você clicar em <b>Gerar vídeo</b>.
        </div>
        <Button
          size="lg"
          onClick={handleApprove}
          disabled={approving || regenerating || !headline.trim()}
          className="min-w-[180px]"
        >
          {approving ? (
            <Loader2 className="h-4 w-4 animate-spin mr-2" />
          ) : (
            <CheckCircle2 className="h-4 w-4 mr-2" />
          )}
          Gerar vídeo
        </Button>
      </div>
    </div>
  );
}
