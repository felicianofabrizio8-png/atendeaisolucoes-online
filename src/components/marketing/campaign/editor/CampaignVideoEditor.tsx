// ============================================================================
// CampaignVideoEditor — Editor Criativo IA (Onda 1).
//
// Redesign com preview PROTAGONISTA (ocupa a maior parte da tela) e
// controles em sidebar à direita. Preparado para futuras evoluções:
//  - Onda 2: seleção/movimentação direta no preview (canvas overlay).
//  - Onda 3: templates com efeitos exclusivos (biblioteca de elementos).
//
// A logo é consumida automaticamente do Brand Center via `useBrandLogo`.
// Se a empresa não tiver logo publicada, o preview mostra um placeholder
// clicável para upload local (session-only, não persiste).
// ============================================================================

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
import { getScene } from "@/lib/marketing/video-editor/scenes/registry";
import { useBrandLogo } from "@/hooks/useBrandLogo";
import { SceneRenderer } from "./SceneRenderer";
import { TabTexto } from "./tabs/TabTexto";
import { TabLogo } from "./tabs/TabLogo";
import { TabTextos } from "./tabs/TabTextos";
import { TabTemplate } from "./tabs/TabTemplate";

interface Props {
  campaignId: string;
  contents: MarketingContentRow[];
  previewImageUrl: string | null;
  /** Se fornecido, sobrescreve a logo do Brand Center. Default: usa hook. */
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
  const scene = getScene(savedTemplate);
  const layout = (anyRow?.video_layout as VideoLayout) ?? scene.defaultLayout;
  return { layout, template: savedTemplate };
}

export function CampaignVideoEditor({
  campaignId,
  contents,
  previewImageUrl,
  logoUrl: logoUrlOverride,
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
  const [tab, setTab] = useState("template");
  const [showSafeArea, setShowSafeArea] = useState(false);

  // Logo do Brand Center (com upload local como fallback).
  const brandLogo = useBrandLogo();
  const effectiveLogoUrl =
    logoUrlOverride !== undefined ? logoUrlOverride : brandLogo.logoUrl;

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
    const scene = getScene(id);
    setLayout({ ...scene.defaultLayout, template: id });
    toast.info(`Template “${scene.label}” aplicado.`);
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
        layout: layout as unknown as Record<string, unknown>,
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

  const sceneLabel = getScene(layout.template).label;

  return (
    <div className="rounded-xl border bg-card overflow-hidden shadow-sm">
      {/* Header */}
      <div className="px-4 py-3 border-b flex items-center justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <div className="text-sm font-semibold">Editor Criativo IA</div>
          <div className="text-xs text-muted-foreground truncate">
            Template atual: <b>{sceneLabel}</b> · edições refletem no preview em tempo real.
          </div>
        </div>
        <label className="text-xs flex items-center gap-2 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={showSafeArea}
            onChange={(e) => setShowSafeArea(e.target.checked)}
            className="accent-primary"
          />
          Safe area
        </label>
      </div>

      {/* Corpo: preview protagonista + sidebar */}
      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1.55fr)_minmax(320px,1fr)]">
        {/* PREVIEW — ocupa a maior parte da tela */}
        <div className="bg-gradient-to-br from-muted/30 to-muted/60 p-4 sm:p-6 min-h-[560px] flex items-center justify-center">
          <div
            className="w-full mx-auto"
            style={{ maxWidth: "min(100%, 520px)" }}
          >
            <SceneRenderer
              imageUrl={previewImageUrl}
              logoUrl={effectiveLogoUrl}
              onRequestLogoUpload={brandLogo.uploadLocal}
              focalPoint={focalPoint ?? null}
              headline={headline}
              subheadline={subheadline || null}
              cta={cta || null}
              layout={layout}
              showSafeArea={showSafeArea}
              fill={false}
            />
            <div className="mt-3 text-center text-[11px] text-muted-foreground">
              Prévia 9:16 · {brandLogo.isPlaceholder && !logoUrlOverride
                ? "sem logo no Brand Center (clique no placeholder para adicionar)"
                : brandLogo.isLocalOverride
                ? "logo local · não persiste"
                : "logo do Brand Center"}
              {brandLogo.isLocalOverride && (
                <>
                  {" · "}
                  <button
                    type="button"
                    className="underline hover:text-foreground"
                    onClick={brandLogo.clearLocalOverride}
                  >
                    remover
                  </button>
                </>
              )}
            </div>
          </div>
        </div>

        {/* SIDEBAR — controles */}
        <div className="border-t lg:border-t-0 lg:border-l p-4 min-w-0">
          <Tabs value={tab} onValueChange={setTab}>
            <TabsList className="grid grid-cols-4 w-full">
              <TabsTrigger value="template" className="gap-1">
                <LayoutTemplate className="h-3.5 w-3.5" /> Cena
              </TabsTrigger>
              <TabsTrigger value="texto" className="gap-1">
                <Type className="h-3.5 w-3.5" /> Texto
              </TabsTrigger>
              <TabsTrigger value="logo" className="gap-1">
                <ImageIcon className="h-3.5 w-3.5" /> Logo
              </TabsTrigger>
              <TabsTrigger value="textos" className="gap-1">
                <Layers className="h-3.5 w-3.5" /> Layout
              </TabsTrigger>
            </TabsList>
            <TabsContent value="template" className="pt-4">
              <TabTemplate
                value={layout.template}
                onChange={handleTemplateChange}
                sampleImageUrl={previewImageUrl}
                sampleLogoUrl={effectiveLogoUrl}
              />
            </TabsContent>
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
