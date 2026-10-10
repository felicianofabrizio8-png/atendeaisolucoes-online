// Criação de publicações do Marketing IA.
//
// Três passos, começando pela mídia:
//   1. Escolher fotos ou vídeos do acervo.
//   2. Legenda e formato (e música/enquadramento quando vira vídeo).
//   3. Conferir e criar. O conteúdo vai para Publicar › Para revisar; nada é
//      publicado sem aprovação.
//
// O tipo de publicação é deduzido da seleção:
//   - 1 vídeo do acervo           → vídeo pronto (só gera a legenda);
//   - 1 foto do acervo            → foto (só gera a legenda), ou vídeo se pedido;
//   - 2+ fotos / imagem de produto → vídeo criado com música (render no worker).

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Sparkles, Loader2, Music2 } from "lucide-react";
import { toast } from "sonner";
import {
  apiListPromotions,
  apiGenerateCampaign,
  apiGenerateSimpleMarketingPost,
  apiGenerateManualCampaign,
  apiRetryCampaignRender,
  campaignMediaDeps,
  type CampaignImageInput,
  type FocalPointInput,
} from "@/data/marketingRepo";
import type { MarketingPromotionRow, MarketingContentRow } from "@/lib/marketing/marketing.types";
import { MarketingLibrary } from "../MarketingLibrary";
import { Chip, ChipRow, PhonePreview } from "../ui/MarketingUi";
import { type MediaSelection, selectionKey, sameSelection } from "@/lib/marketing/media-selection";
import { FEED_FRAME, STORY_FRAME } from "@/lib/render-engine/focal-geometry";

import { FocalImage } from "./FocalImage";
import { CampaignAudioPicker } from "./CampaignAudioPicker";
import { CampaignImageList, type CampaignImageItem } from "./CampaignImageList";
import { FocalPointEditor } from "./FocalPointEditor";
import { CampaignStickyActionBar } from "./CampaignStickyActionBar";
import { CampaignRenderProgress } from "./CampaignRenderProgress";
import { CampaignVideoEditor, type CampaignEditorImage } from "./editor/CampaignVideoEditor";
import { resolveCampaignMedia, type MediaLoadError } from "@/lib/marketing/campaign-media";
import { CampaignManualForm, type ManualSubmitPayload } from "./CampaignManualForm";
import type { CampaignFormatSelection } from "@/lib/marketing/campaign-formats";
import { AiUnavailableNotice } from "./AiUnavailableNotice";
import { classifyAiFailure, type AiFailureKind } from "@/lib/marketing/ai-failure";
import { useCampaignRenderTracker, useTrackedCampaign } from "@/lib/marketing/useCampaignRenderTracker";
import type { AudioLibraryRow } from "@/lib/audio-library/audio-library.types";
import { claimPreviewResolution, releasePreviewResolution } from "@/lib/marketing/preview-resolution";

type Duration = 8 | 10 | 15 | 30 | 60;
type Tone = "amigável" | "profissional" | "descontraído" | "urgente";
type Step = 1 | 2 | 3;
// Alinhado com MAX_CAMPAIGN_IMAGES do backend/worker (render.types.ts).
const MAX_IMAGES = 8;

const TONES: Array<[Tone, string]> = [
  ["amigável", "Amigável"],
  ["profissional", "Profissional"],
  ["descontraído", "Descontraído"],
  ["urgente", "Urgente"],
];
const FORMATS: Array<[CampaignFormatSelection, string]> = [
  ["feed_story", "Feed + Story"],
  ["feed", "Feed"],
  ["story", "Story"],
];

interface Props {
  companyId: string;
  onGenerated?: (contents: MarketingContentRow[]) => void;
  /** Mídia já escolhida (ex.: tocada no Acervo). */
  initialSelection?: MediaSelection[];
}

interface Slot {
  selection: MediaSelection;
  focal: FocalPointInput | null;
  previewUrl: string | null;
  loading: boolean;
  failed: boolean;
  error: MediaLoadError | null;
}

const isVideoSelection = (sel: MediaSelection) => sel.origin === "marketing" && sel.mediaType === "video";
const newSlot = (selection: MediaSelection): Slot => ({ selection, focal: null, previewUrl: null, loading: false, failed: false, error: null });

export function MarketingCampaignGenerator({ companyId, onGenerated, initialSelection = [] }: Props) {
  const [promotions, setPromotions] = useState<MarketingPromotionRow[]>([]);
  const [promotionId, setPromotionId] = useState<string>("");
  const [tone, setTone] = useState<Tone>("amigável");
  const [audience, setAudience] = useState("");
  const [extra, setExtra] = useState("");
  const [aiFormats, setAiFormats] = useState<CampaignFormatSelection>("feed_story");

  const [slots, setSlots] = useState<Slot[]>(() => initialSelection.slice(0, MAX_IMAGES).map(newSlot));
  const [editingKey, setEditingKey] = useState<string | null>(null);
  // Com uma única foto do acervo o padrão é publicar a foto; isto pede o vídeo.
  const [asVideo, setAsVideo] = useState(false);

  const [audio, setAudio] = useState<AudioLibraryRow | null>(null);
  const [audioOpen, setAudioOpen] = useState(false);
  const [audioStart, setAudioStart] = useState<number>(0);
  const [duration, setDuration] = useState<Duration>(15);

  const [generating, setGenerating] = useState(false);
  // Textos do vídeo: IA (padrão) ou escritos à mão (sem IA, sem créditos).
  const [mode, setMode] = useState<"ai" | "manual">("ai");
  const [aiFailure, setAiFailure] = useState<AiFailureKind | null>(null);
  const [step, setStep] = useState<Step>(initialSelection.length > 0 ? 2 : 1);
  const [previewFormat, setPreviewFormat] = useState<"feed" | "story">("feed");
  const [campaignId, setCampaignId] = useState<string | null>(null);
  // Approval-gate: quando existe, mostra a revisão em vez do progresso.
  const [pendingReview, setPendingReview] = useState<{ campaignId: string; contents: MarketingContentRow[] } | null>(null);

  const { trackCampaign } = useCampaignRenderTracker();
  const tracked = useTrackedCampaign(campaignId);

  useEffect(() => {
    void apiListPromotions().then(setPromotions).catch(() => {});
  }, [companyId]);

  // Resolve a URL de prévia de cada mídia escolhida, uma única vez por item.
  // A resolução tem tempo limite e sempre termina (link ou erro): o item nunca
  // fica "carregando" para sempre, e uma falha pode ser tentada de novo.
  const previewResolutionsRef = useRef(new Set<string>());
  const resolveSlotPreview = useCallback((selection: MediaSelection, fresh: boolean) => {
    const key = selectionKey(selection);
    if (!claimPreviewResolution(previewResolutionsRef.current, key)) return;
    // Marca pelo próprio item (não pela posição): a lista pode ter sido reordenada.
    setSlots((cur) => cur.map((s) => (sameSelection(s.selection, selection) ? { ...s, loading: true, failed: false, error: null } : s)));
    const ref =
      selection.origin === "marketing"
        ? { key, origin: "marketing" as const, mediaId: selection.id, storagePath: selection.storagePath }
        : { key, origin: "product" as const, imagePath: selection.imagePath };
    void resolveCampaignMedia([ref], campaignMediaDeps, { fresh })
      .then((resolved) => resolved[key] ?? { previewUrl: null, error: "url_failed" as const })
      .catch(() => ({ previewUrl: null, error: "url_failed" as const }))
      .then((result) => {
        setSlots((cur) =>
          cur.map((s) =>
            sameSelection(s.selection, selection)
              ? { ...s, previewUrl: result.previewUrl, loading: false, failed: !result.previewUrl, error: result.error }
              : s,
          ),
        );
        releasePreviewResolution(previewResolutionsRef.current, key);
      });
  }, []);
  useEffect(() => {
    for (const slot of slots) {
      if (slot.previewUrl || slot.loading || slot.failed) continue;
      resolveSlotPreview(slot.selection, false);
    }
  }, [slots, resolveSlotPreview]);
  const retryPreviewByKey = useCallback(
    (key: string) => {
      const slot = slots.find((s) => selectionKey(s.selection) === key);
      if (slot) resolveSlotPreview(slot.selection, true);
    },
    [slots, resolveSlotPreview],
  );

  const selections = useMemo(() => slots.map((s) => s.selection), [slots]);
  const primarySlot = slots[0] ?? null;
  const hasVideo = slots.some((s) => isVideoSelection(s.selection));
  const singleLibraryPhoto = slots.length === 1 && !hasVideo && slots[0].selection.origin === "marketing";
  const mediaMode: "photo" | "uploaded_video" | "generated_video" = hasVideo
    ? "uploaded_video"
    : singleLibraryPhoto && !asVideo
      ? "photo"
      : "generated_video";
  const isSimpleMode = mediaMode !== "generated_video";
  const isManual = !isSimpleMode && mode === "manual";

  const toggleSelection = useCallback((sel: MediaSelection) => {
    setSlots((cur) => {
      if (cur.some((s) => sameSelection(s.selection, sel))) return cur.filter((s) => !sameSelection(s.selection, sel));
      if (isVideoSelection(sel)) {
        if (cur.length > 0) toast.info("Vídeo pronto usa um único vídeo; a seleção anterior foi substituída.");
        return [newSlot(sel)];
      }
      const photos = cur.filter((s) => !isVideoSelection(s.selection));
      if (photos.length !== cur.length) toast.info("Fotos e vídeo pronto não se misturam; o vídeo foi removido da seleção.");
      if (photos.length >= MAX_IMAGES) {
        toast.error(`Você pode escolher até ${MAX_IMAGES} fotos.`);
        return cur;
      }
      return [...photos, newSlot(sel)];
    });
  }, []);

  const items: CampaignImageItem[] = useMemo(
    () =>
      slots.map((s) => {
        const key = selectionKey(s.selection);
        return s.selection.origin === "marketing"
          ? { key, origin: "marketing", media_id: s.selection.id, storagePath: s.selection.storagePath, previewUrl: s.previewUrl, loadingPreview: s.loading, previewError: s.error, focal_point: s.focal }
          : { key, origin: "product", product_id: s.selection.productId, image_path: s.selection.imagePath, previewUrl: s.previewUrl, loadingPreview: s.loading, previewError: s.error, focal_point: s.focal };
      }),
    [slots],
  );

  // As mesmas imagens (e a mesma ordem) da campanha, no formato do estúdio:
  // a prévia mostra todas as cenas e a aprovação envia exatamente estas.
  const editorImages: CampaignEditorImage[] = useMemo(
    () =>
      slots
        .filter((s) => !isVideoSelection(s.selection))
        .map((s) => {
          const base = { key: selectionKey(s.selection), previewUrl: s.previewUrl, loadError: s.error, focalPoint: s.focal };
          return s.selection.origin === "marketing"
            ? { ...base, origin: "marketing" as const, mediaId: s.selection.id }
            : { ...base, origin: "product" as const, productId: s.selection.productId, imagePath: s.selection.imagePath };
        }),
    [slots],
  );
  const applyEditorImages = useCallback((next: CampaignEditorImage[]) => {
    setSlots((cur) => {
      const byKey = new Map(cur.map((s) => [selectionKey(s.selection), s]));
      return next.flatMap((item) => {
        const slot = byKey.get(item.key);
        if (slot) return [{ ...slot, focal: item.focalPoint }];
        // Imagem adicionada ou trocada dentro do estúdio.
        const selection: MediaSelection | null =
          item.origin === "marketing" && item.mediaId
            ? { origin: "marketing", id: item.mediaId, mediaType: "image" }
            : item.origin === "product" && item.productId && item.imagePath
              ? { origin: "product", productId: item.productId, productName: "", imagePath: item.imagePath }
              : null;
        if (!selection || byKey.has(selectionKey(selection))) return [];
        return [{ ...newSlot(selection), previewUrl: item.previewUrl, error: item.loadError ?? null, focal: item.focalPoint }];
      });
    });
  }, []);

  const reorder = useCallback((next: CampaignImageItem[]) => {
    setSlots((cur) => {
      const byKey = new Map(cur.map((s) => [selectionKey(s.selection), s]));
      return next.map((n) => byKey.get(n.key)!).filter(Boolean);
    });
  }, []);
  const removeByKey = useCallback((key: string) => setSlots((cur) => cur.filter((s) => selectionKey(s.selection) !== key)), []);
  const makePrimary = useCallback((key: string) => {
    setSlots((cur) => {
      const idx = cur.findIndex((s) => selectionKey(s.selection) === key);
      if (idx <= 0) return cur;
      const next = [...cur];
      const [moved] = next.splice(idx, 1);
      next.unshift(moved);
      return next;
    });
  }, []);
  const saveFocal = useCallback((key: string, focal: FocalPointInput | null) => {
    setSlots((cur) => cur.map((s) => (selectionKey(s.selection) === key ? { ...s, focal } : s)));
    setEditingKey(null);
  }, []);
  const editingSlot = useMemo(() => (editingKey ? slots.find((s) => selectionKey(s.selection) === editingKey) ?? null : null), [editingKey, slots]);

  const previewsReady = slots.length > 0 && slots.every((s) => !!s.previewUrl);
  const videoReady = previewsReady && !!audio;
  const canContinue = step === 1 ? slots.length > 0 : isSimpleMode ? previewsReady : videoReady;
  const blockedHint =
    slots.length === 0
      ? "Escolha ao menos uma foto ou um vídeo"
      : !previewsReady
        ? "Carregando a mídia escolhida…"
        : !isSimpleMode && !audio
          ? "Escolha uma música para o vídeo"
          : null;

  const buildImages = useCallback(
    (): CampaignImageInput[] =>
      slots.map((s) =>
        s.selection.origin === "marketing"
          ? { origin: "marketing", media_id: s.selection.id, focal_point: s.focal ?? null }
          : { origin: "product", product_id: s.selection.productId, image_path: s.selection.imagePath, focal_point: s.focal ?? null },
      ),
    [slots],
  );

  function assertVideoReady(): boolean {
    if (!audio || slots.length === 0) return false;
    if (audioStart + duration > Number(audio.duration_seconds ?? 0) + 0.001) {
      toast.error("O trecho da música passa do fim dela. Diminua o início ou a duração.");
      return false;
    }
    return true;
  }

  function openReview(campaign: string, contentsRet: MarketingContentRow[], msg: string) {
    setPendingReview({ campaignId: campaign, contents: contentsRet });
    toast.success(msg);
    onGenerated?.(contentsRet);
  }

  async function generateSimple() {
    if (!primarySlot || primarySlot.selection.origin !== "marketing") return;
    setGenerating(true);
    try {
      const res = await apiGenerateSimpleMarketingPost({
        media_mode: mediaMode === "photo" ? "photo" : "uploaded_video",
        media_ids: [primarySlot.selection.id],
        campaign_formats: aiFormats,
        promotion_id: promotionId || null,
        tone,
        audience: audience.trim() || null,
        extra_instructions: extra.trim() || null,
      });
      toast.success("Legenda criada. Revise antes de aprovar.");
      onGenerated?.((res.contents ?? []) as MarketingContentRow[]);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível criar a legenda.");
    } finally {
      setGenerating(false);
    }
  }

  async function generate() {
    if (!assertVideoReady() || !audio) return;
    setGenerating(true);
    setAiFailure(null);
    try {
      const res = await apiGenerateCampaign({
        promotion_id: promotionId || null,
        images: buildImages(),
        primary_audio_id: audio.id,
        audio_start_second: audioStart,
        duration_seconds: duration,
        tone,
        audience: audience.trim() || null,
        extra_instructions: extra.trim() || null,
        formats: aiFormats,
      });
      // Approval-gate: o render só começa depois da revisão.
      openReview(res.campaign_id, (res.contents ?? []) as MarketingContentRow[], "Textos sugeridos. Revise antes de gerar o vídeo.");
    } catch (e) {
      // Nunca bloquear: classificamos a falha e oferecemos escrever à mão.
      setAiFailure(classifyAiFailure(e));
    } finally {
      setGenerating(false);
    }
  }

  async function generateManual(payload: ManualSubmitPayload) {
    if (!assertVideoReady() || !audio) return;
    setGenerating(true);
    try {
      const res = await apiGenerateManualCampaign({
        promotion_id: promotionId || null,
        images: buildImages(),
        primary_audio_id: audio.id,
        audio_start_second: audioStart,
        duration_seconds: duration,
        fields: payload.fields,
        formats: payload.formats,
        theme: payload.theme,
        template: payload.template,
      });
      openReview(res.campaign_id, (res.contents ?? []) as MarketingContentRow[], "Publicação criada. Revise e gere o vídeo.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível criar a publicação.");
    } finally {
      setGenerating(false);
    }
  }

  async function handleRetry(role: "feed" | "story") {
    if (!campaignId) return;
    try {
      await apiRetryCampaignRender({ campaign_id: campaignId, role });
      toast.info("Novo render enfileirado.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao reenfileirar.");
    }
  }

  const inProgress = !!pendingReview || !!campaignId;
  const kindLabel = mediaMode === "photo" ? "Foto" : mediaMode === "uploaded_video" ? "Vídeo pronto" : "Vídeo com música";
  const effectivePreviewFormat = aiFormats === "story" ? "story" : aiFormats === "feed" ? "feed" : previewFormat;

  if (inProgress) {
    return (
      <div className="space-y-4">
        {pendingReview && !campaignId && (
          // O estúdio ocupa a altura que recebe; aqui ele vive na página, então a altura é fixada.
          <div className="h-[calc(100dvh-11rem)] min-h-[520px]">
          <CampaignVideoEditor
            campaignId={pendingReview.campaignId}
            contents={pendingReview.contents}
            previewImageUrl={primarySlot?.previewUrl ?? null}
            focalPoint={primarySlot?.focal ?? null}
            companyId={companyId}
            imageSequence={editorImages}
            onImageSequenceChange={applyEditorImages}
            onRetryImage={retryPreviewByKey}
            onContentsUpdated={(fresh: MarketingContentRow[]) => setPendingReview((cur) => (cur ? { ...cur, contents: fresh } : cur))}
            onApproved={() => {
              const id = pendingReview.campaignId;
              setPendingReview(null);
              setCampaignId(id);
              trackCampaign(id);
            }}
          />
          </div>
        )}
        {campaignId && <CampaignRenderProgress tracked={tracked} onRetry={handleRetry} />}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex gap-1.5" role="progressbar" aria-label="Etapas da criação" aria-valuemin={1} aria-valuemax={3} aria-valuenow={step}>
        {[1, 2, 3].map((n) => (
          <span key={n} className={`marketing-step h-1.5 flex-1 rounded-full ${n <= step ? "marketing-step-active" : "bg-border"}`} />
        ))}
      </div>

      <div className="marketing-create-layout grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_280px]">
        <div className="min-w-0 space-y-4 rounded-2xl border bg-card p-4">
          {step === 1 && (
            <>
              <div>
                <h3 className="text-lg font-semibold">1. Escolha fotos ou vídeos</h3>
                <p className="text-sm text-muted-foreground">Toque para selecionar. Várias fotos viram um vídeo com música.</p>
              </div>
              <MarketingLibrary companyId={companyId} selectable selected={selections} onToggleSelect={toggleSelection} />
            </>
          )}

          {step === 2 && (
            <>
              <div>
                <h3 className="text-lg font-semibold">2. Legenda e formato</h3>
                <p className="text-sm text-muted-foreground">{kindLabel} · {slots.length === 1 ? "1 mídia" : `${slots.length} fotos`}</p>
              </div>

              {singleLibraryPhoto && (
                <ChipRow label="Tipo de publicação">
                  <Chip active={!asVideo} onClick={() => setAsVideo(false)}>Publicar a foto</Chip>
                  <Chip active={asVideo} onClick={() => setAsVideo(true)}>Transformar em vídeo</Chip>
                </ChipRow>
              )}

              <div>
                <Label className="mb-2 block">Onde vai aparecer</Label>
                <ChipRow label="Formato">
                  {FORMATS.map(([id, label]) => (
                    <Chip key={id} active={aiFormats === id} onClick={() => setAiFormats(id)}>{label}</Chip>
                  ))}
                </ChipRow>
              </div>

              {!isSimpleMode && (
                <div className="space-y-3 rounded-xl border p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <Button type="button" variant="outline" size="sm" className="rounded-full" onClick={() => setAudioOpen(true)}>
                      <Music2 className="mr-2 h-4 w-4" />
                      {audio ? audio.name : "Escolher música"}
                    </Button>
                    {audio && <span className="text-xs text-muted-foreground">{duration}s de vídeo</span>}
                  </div>
                  <div>
                    <div className="mb-1 flex items-baseline justify-between gap-2 text-xs text-muted-foreground">
                      <span>Fotos do vídeo ({slots.length}/{MAX_IMAGES})</span>
                      <span>Arraste para reordenar · a 1ª é a capa</span>
                    </div>
                    <CampaignImageList items={items} onReorder={reorder} onRemove={removeByKey} onMakePrimary={makePrimary} onEditFocal={(key) => setEditingKey(key)} onRetryPreview={retryPreviewByKey} />
                  </div>
                  <ChipRow label="Textos do vídeo">
                    <Chip active={mode === "ai"} onClick={() => setMode("ai")}><Sparkles className="h-3.5 w-3.5" /> Textos com IA</Chip>
                    <Chip active={mode === "manual"} onClick={() => setMode("manual")}>Escrever eu mesmo</Chip>
                  </ChipRow>
                </div>
              )}

              <details className="group rounded-xl border" data-testid="more-options">
                <summary className="flex cursor-pointer list-none items-center justify-between px-3 py-2.5 text-sm font-medium [&::-webkit-details-marker]:hidden">
                  Mais opções
                  <span className="text-xs font-normal text-muted-foreground group-open:hidden">tom, promoção, público{!isSimpleMode ? ", duração" : ""}</span>
                </summary>
                <div className="space-y-3 border-t p-3">
                  {!isManual && (
                    <div>
                      <Label className="mb-2 block">Tom</Label>
                      <ChipRow label="Tom">
                        {TONES.map(([id, label]) => (
                          <Chip key={id} active={tone === id} onClick={() => setTone(id)}>{label}</Chip>
                        ))}
                      </ChipRow>
                    </div>
                  )}
                  {!isSimpleMode && audio && (
                    <div className="flex flex-wrap gap-3">
                      <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                        Início da música (s)
                        <Input type="number" min={0} max={Math.max(0, Math.floor(Number(audio.duration_seconds ?? 0) - 1))} value={audioStart} onChange={(e) => setAudioStart(Math.max(0, parseInt(e.target.value || "0", 10)))} className="h-8 w-20" />
                      </label>
                      <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                        Duração do vídeo
                        <select className="h-8 rounded-md border bg-background px-2 text-sm" value={duration} onChange={(e) => setDuration(Number(e.target.value) as Duration)}>
                          {[8, 10, 15, 30, 60].map((d) => <option key={d} value={d}>{d}s</option>)}
                        </select>
                      </label>
                    </div>
                  )}
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div>
                      <Label>Promoção</Label>
                      <select className="h-9 w-full rounded-md border bg-background px-2 text-sm" value={promotionId} onChange={(e) => setPromotionId(e.target.value)}>
                        <option value="">Sem promoção</option>
                        {promotions.map((p) => <option key={p.id} value={p.id}>{p.title}</option>)}
                      </select>
                    </div>
                    {!isManual && (
                      <div>
                        <Label>Público</Label>
                        <Input value={audience} onChange={(e) => setAudience(e.target.value)} placeholder="Ex.: moradores da região" />
                      </div>
                    )}
                    {!isManual && (
                      <div className="sm:col-span-2">
                        <Label>O que destacar</Label>
                        <Textarea value={extra} onChange={(e) => setExtra(e.target.value)} rows={2} placeholder="Ex.: destacar entrega grátis; mencionar 10 anos de mercado" />
                      </div>
                    )}
                  </div>
                </div>
              </details>
            </>
          )}

          {step === 3 && (
            <>
              <div>
                <h3 className="text-lg font-semibold">3. Conferir e criar</h3>
                <p className="text-sm text-muted-foreground">Depois de criar, você revisa e aprova em Publicar. Nada é publicado sem a sua aprovação.</p>
              </div>
              {aiFailure && mode === "ai" && (
                <AiUnavailableNotice
                  kind={aiFailure}
                  retrying={generating}
                  onRetry={() => void generate()}
                  onContinueManually={() => {
                    setAiFailure(null);
                    setMode("manual");
                  }}
                />
              )}
              {isManual ? (
                <CampaignManualForm submitting={generating} disabled={!videoReady} disabledReason="Escolha as fotos e uma música para continuar." onSubmit={(payload) => void generateManual(payload)} />
              ) : (
                <dl className="marketing-summary grid gap-x-4 gap-y-1.5 text-sm sm:grid-cols-2" data-testid="create-summary">
                  <SummaryRow label="Tipo" value={kindLabel} />
                  <SummaryRow label="Formato" value={FORMATS.find(([id]) => id === aiFormats)?.[1] ?? ""} />
                  <SummaryRow label="Mídia" value={slots.length === 1 ? "1 selecionada" : `${slots.length} fotos`} />
                  <SummaryRow label="Tom" value={TONES.find(([id]) => id === tone)?.[1] ?? ""} />
                  <SummaryRow label="Promoção" value={promotions.find((p) => p.id === promotionId)?.title ?? "Sem promoção"} />
                  {!isSimpleMode && <SummaryRow label="Música" value={audio ? `${audio.name} · ${duration}s a partir de ${audioStart}s` : "nenhuma"} />}
                </dl>
              )}
            </>
          )}
        </div>

        <aside className={`space-y-2 lg:sticky lg:top-4 lg:order-none ${step === 1 ? "" : "order-first"}`}>
          <p className="text-center text-xs text-muted-foreground">Prévia real</p>
          <PhonePreview format={effectivePreviewFormat} account={kindLabel} caption={mediaMode === "generated_video" && isManual ? null : "A legenda será criada no último passo e você poderá editar antes de publicar."}>
            <PreviewMedia slot={primarySlot} mediaMode={mediaMode} format={effectivePreviewFormat} />
          </PhonePreview>
          {aiFormats === "feed_story" && (
            <ChipRow label="Formato da prévia" className="justify-center">
              <Chip active={previewFormat === "feed"} onClick={() => setPreviewFormat("feed")}>Feed</Chip>
              <Chip active={previewFormat === "story"} onClick={() => setPreviewFormat("story")}>Story</Chip>
            </ChipRow>
          )}
        </aside>
      </div>

      <Dialog open={audioOpen} onOpenChange={setAudioOpen}>
        {audioOpen && (
          <DialogContent mobileFullscreen className="sm:max-w-3xl">
            <DialogHeader>
              <DialogTitle>Escolher música</DialogTitle>
              <DialogDescription>Ouça e selecione um áudio já autorizado no acervo da empresa.</DialogDescription>
            </DialogHeader>
            <CampaignAudioPicker selectedId={audio?.id ?? null} onSelect={setAudio} />
            <div className="flex justify-end">
              <Button type="button" onClick={() => setAudioOpen(false)}>Concluir seleção</Button>
            </div>
          </DialogContent>
        )}
      </Dialog>

      <FocalPointEditor
        open={!!editingSlot}
        imageUrl={editingSlot?.previewUrl ?? null}
        initialFocal={editingSlot?.focal ?? null}
        onCancel={() => setEditingKey(null)}
        onSave={(fp) => editingKey && saveFocal(editingKey, fp)}
      />

      {/* No modo manual, o último passo usa o botão do próprio formulário. */}
      {!(isManual && step === 3) || step < 3 ? (
        <CampaignStickyActionBar>
          <div className="mr-auto hidden min-w-0 truncate text-xs text-muted-foreground md:block">
            {step === 1 ? (slots.length === 0 ? "Escolha ao menos uma foto ou um vídeo" : slots.length === 1 ? "1 mídia selecionada" : `${slots.length} fotos selecionadas`) : blockedHint ?? kindLabel}
          </div>
          {step > 1 && (
            <Button variant="outline" size="lg" className="rounded-full" onClick={() => setStep((step - 1) as Step)} disabled={generating}>
              Voltar
            </Button>
          )}
          {step < 3 ? (
            <Button size="lg" className="flex-1 rounded-full md:flex-none" onClick={() => setStep((step + 1) as Step)} disabled={!canContinue}>
              Continuar
            </Button>
          ) : !isManual ? (
            <Button size="lg" className="flex-1 rounded-full md:flex-none" onClick={() => void (isSimpleMode ? generateSimple() : generate())} disabled={generating || !canContinue}>
              {generating ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Sparkles className="mr-1 h-4 w-4" />}
              {isSimpleMode ? "Criar legenda" : "Criar textos do vídeo"}
            </Button>
          ) : null}
        </CampaignStickyActionBar>
      ) : null}
    </div>
  );
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="inline text-muted-foreground">{label}: </dt>
      <dd className="inline">{value}</dd>
    </div>
  );
}

/** Mídia real na moldura do celular: foto, vídeo pronto ou o corte do vídeo a ser criado. */
function PreviewMedia({ slot, mediaMode, format }: { slot: Slot | null; mediaMode: "photo" | "uploaded_video" | "generated_video"; format: "feed" | "story" }) {
  if (!slot) return <div className="absolute inset-0 grid place-items-center px-4 text-center text-xs text-white/50">Escolha uma mídia</div>;
  if (!slot.previewUrl) {
    return <div className="absolute inset-0 grid place-items-center text-xs text-white/50">{slot.failed ? "Não foi possível carregar." : "Carregando…"}</div>;
  }
  if (mediaMode === "uploaded_video") {
    return <video src={`${slot.previewUrl}#t=0.1`} className="absolute inset-0 h-full w-full object-cover" muted playsInline controls preload="metadata" />;
  }
  if (mediaMode === "generated_video") {
    return <FocalImage src={slot.previewUrl} alt="Prévia do vídeo" frame={format === "story" ? STORY_FRAME : FEED_FRAME} focalPoint={slot.focal} />;
  }
  return <img src={slot.previewUrl} alt="Prévia da publicação" className="absolute inset-0 h-full w-full object-cover" />;
}
