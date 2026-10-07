// Gerador de Campanha (Fase C.2).
//
// Evoluções vs. C.1:
// - Múltiplas imagens (ordenáveis) via CampaignImageList.
// - Focal point real por imagem via FocalPointEditor (aplicado no render).
// - Progresso desacoplado da tela via useCampaignRenderTracker (o polling
//   segue rodando mesmo se o usuário navegar de aba).
// - Barra de ação sticky (visível o tempo todo em mobile e desktop).
// - Preview WYSIWYG do focal point sobre Feed 4:5 e Story 9:16.
//
// Retrocompatível: se apenas 1 imagem for selecionada, o backend continua
// enviando `primary_image` no payload legado; caso contrário envia `images`.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Sparkles, Loader2, PencilRuler } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import {
  apiListPromotions,
  apiGenerateCampaign,
  apiGenerateSimpleMarketingPost,
  apiGenerateManualCampaign,
  apiRetryCampaignRender,
  urlForMarketingPath,
  type CampaignImageInput,
  type FocalPointInput,
} from "@/data/marketingRepo";
import { getSignedImageUrl } from "@/lib/storage";
import type { MarketingPromotionRow, MarketingContentRow } from "@/lib/marketing/marketing.types";
import { MarketingAssetPicker } from "../MarketingAssetPicker";
import {
  type MediaSelection,
  selectionKey,
  sameSelection,
} from "@/lib/marketing/media-selection";

import { CampaignFramingPreview } from "./CampaignFramingPreview";
import { CampaignImageList, type CampaignImageItem } from "./CampaignImageList";
import { FocalPointEditor } from "./FocalPointEditor";
import { CampaignStickyActionBar } from "./CampaignStickyActionBar";
import { CampaignRenderProgress } from "./CampaignRenderProgress";
import { CampaignVideoEditor } from "./editor/CampaignVideoEditor";
import { CampaignManualForm, type ManualSubmitPayload } from "./CampaignManualForm";
import { CampaignFormatsField } from "./CampaignFormatsField";
import type { CampaignFormatSelection } from "@/lib/marketing/campaign-formats";
import { AiUnavailableNotice } from "./AiUnavailableNotice";
import { classifyAiFailure, type AiFailureKind } from "@/lib/marketing/ai-failure";
import {
  useCampaignRenderTracker,
  useTrackedCampaign,
} from "@/lib/marketing/useCampaignRenderTracker";
import type { AudioLibraryRow } from "@/lib/audio-library/audio-library.types";
import { claimPreviewResolution, releasePreviewResolution } from "@/lib/marketing/preview-resolution";

type Duration = 8 | 10 | 15 | 30 | 60;
// Alinhado com MAX_CAMPAIGN_IMAGES do backend/worker (render.types.ts).
const MAX_IMAGES = 8;

interface Props {
  companyId: string;
  onGenerated?: (contents: MarketingContentRow[]) => void;
}

interface Slot {
  selection: MediaSelection;
  focal: FocalPointInput | null;
  previewUrl: string | null;
  loading: boolean;
  failed: boolean;
}

export function MarketingCampaignGenerator({ companyId, onGenerated }: Props) {
  const [promotions, setPromotions] = useState<MarketingPromotionRow[]>([]);
  const [promotionId, setPromotionId] = useState<string>("");
  const [tone, setTone] =
    useState<"amigável" | "profissional" | "descontraído" | "urgente">("amigável");
  const [audience, setAudience] = useState("");
  const [extra, setExtra] = useState("");
  // Seleção de formatos no modo IA — mesmo contrato canônico do modo manual.
  const [aiFormats, setAiFormats] = useState<CampaignFormatSelection>("feed_story");
  const [mediaMode, setMediaMode] = useState<"photo" | "uploaded_video" | "generated_video">("generated_video");

  const [slots, setSlots] = useState<Slot[]>([]);
  const [editingKey, setEditingKey] = useState<string | null>(null);

  const [audio, setAudio] = useState<AudioLibraryRow | null>(null);
  const [audioStart, setAudioStart] = useState<number>(0);
  const [duration, setDuration] = useState<Duration>(15);

  const [generating, setGenerating] = useState(false);
  // Modo de criação: IA (padrão) ou manual (sem IA, sem créditos).
  const [mode, setMode] = useState<"ai" | "manual">("ai");
  // Falha da IA → oferecemos o modo manual sem bloquear o usuário.
  const [aiFailure, setAiFailure] = useState<AiFailureKind | null>(null);
  const [step, setStep] = useState<"brief" | "assets" | "ready">("brief");
  const [campaignId, setCampaignId] = useState<string | null>(null);
  // Approval-gate: quando existe, renderiza a tela de revisão em vez do
  // progress. Só limpamos quando o usuário aprova (então o render começa).
  const [pendingReview, setPendingReview] = useState<{
    campaignId: string;
    contents: MarketingContentRow[];
  } | null>(null);

  const { trackCampaign } = useCampaignRenderTracker();
  const tracked = useTrackedCampaign(campaignId);

  useEffect(() => {
    void apiListPromotions().then(setPromotions).catch(() => {});
  }, [companyId]);

  // Resolve preview URL para cada slot novo. A chave em ref impede que o
  // rerender causado por loading=true cancele ou duplique a mesma resolução.
  const previewResolutionsRef = useRef(new Set<string>());

  useEffect(() => {
    slots.forEach((slot, idx) => {
      const key = selectionKey(slot.selection);
      if (slot.previewUrl || slot.loading || slot.failed) return;
      if (!claimPreviewResolution(previewResolutionsRef.current, key)) return;

      setSlots((cur) => cur.map((s, i) => (i === idx ? { ...s, loading: true } : s)));
      (async () => {
        try {
          let url: string | null = null;
          if (slot.selection.origin === "marketing" && slot.selection.storagePath) {
            url = await urlForMarketingPath(slot.selection.storagePath).catch(() => null);
          } else if (slot.selection.origin === "product") {
            url = await getSignedImageUrl(slot.selection.imagePath).catch(() => null);
          }
          setSlots((cur) =>
            cur.map((s) =>
              sameSelection(s.selection, slot.selection)
                ? { ...s, previewUrl: url, loading: false, failed: !url }
                : s,
            ),
          );
        } catch {
          setSlots((cur) =>
            cur.map((s) =>
              sameSelection(s.selection, slot.selection)
                ? { ...s, previewUrl: null, loading: false, failed: true }
                : s,
            ),
          );
        } finally {
          releasePreviewResolution(previewResolutionsRef.current, key);
        }
      })();
    });
  }, [slots]);

  const selectedMediaSelections = useMemo(() => slots.map((s) => s.selection), [slots]);

  const replaceSelections = useCallback((next: MediaSelection[]) => {
    const normalized = mediaMode === "generated_video" ? next.slice(0, MAX_IMAGES) : next.slice(-1);
    setSlots((current) => normalized.map((selection) => current.find((slot) => sameSelection(slot.selection, selection)) ?? { selection, focal: null, previewUrl: null, loading: false, failed: false }));
  }, [mediaMode]);

  const items: CampaignImageItem[] = useMemo(
    () =>
      slots.map((s) => {
        const key = selectionKey(s.selection);
        if (s.selection.origin === "marketing") {
          return {
            key,
            origin: "marketing",
            media_id: s.selection.id,
            storagePath: s.selection.storagePath,
            previewUrl: s.previewUrl,
            loadingPreview: s.loading,
            focal_point: s.focal,
          };
        }
        return {
          key,
          origin: "product",
          product_id: s.selection.productId,
          image_path: s.selection.imagePath,
          previewUrl: s.previewUrl,
          loadingPreview: s.loading,
          focal_point: s.focal,
        };
      }),
    [slots],
  );

  const toggleSelection = useCallback((sel: MediaSelection) => {
    setSlots((cur) => {
      const idx = cur.findIndex((s) => sameSelection(s.selection, sel));
      if (idx >= 0) return cur.filter((_, i) => i !== idx);
      if (cur.length >= MAX_IMAGES) {
        toast.error(`Você pode adicionar até ${MAX_IMAGES} imagens por campanha.`);
        return cur;
      }
      return [...cur, { selection: sel, focal: null, previewUrl: null, loading: false, failed: false }];
    });
  }, []);

  const reorder = useCallback((next: CampaignImageItem[]) => {
    setSlots((cur) => {
      const byKey = new Map(cur.map((s) => [selectionKey(s.selection), s]));
      return next.map((n) => byKey.get(n.key)!).filter(Boolean);
    });
  }, []);

  const removeByKey = useCallback(
    (key: string) => setSlots((cur) => cur.filter((s) => selectionKey(s.selection) !== key)),
    [],
  );

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
    setSlots((cur) =>
      cur.map((s) => (selectionKey(s.selection) === key ? { ...s, focal } : s)),
    );
    setEditingKey(null);
  }, []);

  const editingSlot = useMemo(
    () => (editingKey ? slots.find((s) => selectionKey(s.selection) === editingKey) ?? null : null),
    [editingKey, slots],
  );

  const primarySlot = slots[0] ?? null;
  const baseReady =
    slots.length > 0 && !!audio && !generating && slots.every((s) => !!s.previewUrl);
  const simpleReady =
    mediaMode !== "generated_video" && slots.length === 1 && !generating && !!slots[0]?.previewUrl;
  const canGenerate = mediaMode === "generated_video" ? baseReady : simpleReady;
  const isSimpleMode = mediaMode !== "generated_video";
  const isManual = !isSimpleMode && mode === "manual";
  const assetsLabel = isSimpleMode ? "Mídia" : "Mídia e música";
  const assetsHint =
    slots.length === 0
      ? mediaMode === "uploaded_video"
        ? "Selecione 1 vídeo do Acervo"
        : mediaMode === "photo"
          ? "Selecione 1 foto do Acervo"
          : "Selecione ao menos 1 imagem"
      : isSimpleMode
        ? "1 mídia selecionada"
        : !audio
          ? "Selecione um áudio"
          : `${slots.length} imagem(ns) · ${duration}s`;

  function changeMediaMode(next: typeof mediaMode) {
    if (next === mediaMode) return;
    // Cada modo aceita um tipo de mídia; a seleção anterior não se aplica.
    setSlots([]);
    setMediaMode(next);
    setMode("ai");
    setAiFailure(null);
  }

  /** Imagens no formato aceito pelo backend (compartilhado IA + manual). */
  const buildImages = useCallback(
    (): CampaignImageInput[] =>
      slots.map((s) =>
        s.selection.origin === "marketing"
          ? { origin: "marketing", media_id: s.selection.id, focal_point: s.focal ?? null }
          : {
              origin: "product",
              product_id: s.selection.productId,
              image_path: s.selection.imagePath,
              focal_point: s.focal ?? null,
            },
      ),
    [slots],
  );

  /** Valida áudio/imagens antes de qualquer chamada (IA ou manual). */
  function assertReady(): boolean {
    if (!audio || slots.length === 0) return false;
    const audioDur = Number(audio.duration_seconds ?? 0);
    if (audioStart + duration > audioDur + 0.001) {
      toast.error("O trecho do áudio excede sua duração total.");
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
    if (!simpleReady || !primarySlot || primarySlot.selection.origin !== "marketing") {
      toast.error("Selecione uma única mídia do Acervo para continuar.");
      return;
    }
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
      const contentsRet = (res.contents ?? []) as MarketingContentRow[];
      toast.success("Legenda gerada. Revise antes de aprovar ou agendar.");
      onGenerated?.(contentsRet);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao gerar conteúdo.");
    } finally {
      setGenerating(false);
    }
  }
  async function generate() {
    if (!assertReady() || !audio) return;
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
      const contentsRet = (res.contents ?? []) as MarketingContentRow[];
      // Approval-gate: NÃO iniciamos o tracking do render aqui — o job
      // ainda não foi enfileirado. Abrimos a tela de revisão.
      openReview(res.campaign_id, contentsRet, "Textos sugeridos. Revise antes de gerar o vídeo.");
    } catch (e) {
      // Nunca bloquear: classificamos a falha e oferecemos o modo manual.
      setAiFailure(classifyAiFailure(e));
    } finally {
      setGenerating(false);
    }
  }

  async function generateManual(payload: ManualSubmitPayload) {
    if (!assertReady() || !audio) return;
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
      const contentsRet = (res.contents ?? []) as MarketingContentRow[];
      openReview(res.campaign_id, contentsRet, "Campanha criada. Revise e gere o vídeo.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao criar campanha manual.");
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

  return (
    <div className="space-y-4">
      {/* Modo de mídia: mídia existente ou pipeline de vídeo gerado */}
      {!pendingReview && !campaignId && (
        <div className="rounded-lg border bg-card p-4 space-y-3">
          <div className="text-sm font-semibold mb-2">O que você quer criar?</div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            {[
              ["photo", "Foto", "Use uma imagem existente e gere a legenda."],
              ["uploaded_video", "Vídeo pronto", "Use um vídeo existente sem renderizar."],
              ["generated_video", "Criar vídeo", "Use o pipeline atual com áudio e render."],
            ].map(([value, label, description]) => (
              <button key={value} type="button" onClick={() => changeMediaMode(value as typeof mediaMode)} className={cn("rounded-md border p-3 text-left text-sm transition-colors", mediaMode === value ? "border-primary bg-primary/10" : "hover:bg-muted")}>
                <span className="block font-medium">{label}</span>
                <span className="mt-1 block text-xs text-muted-foreground">{description}</span>
              </button>
            ))}
          </div>
          {mediaMode === "generated_video" && (
            <div className="border-t pt-3">
              <div className="text-xs font-medium text-muted-foreground mb-2">Como criar o vídeo?</div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <button type="button" onClick={() => setMode("ai")} className={cn("rounded-md border p-3 text-left text-sm", mode === "ai" ? "border-primary bg-primary/10" : "hover:bg-muted")}>
                  <span className="flex items-center gap-2 font-medium"><Sparkles className="h-4 w-4" /> Gerar com IA</span>
                  <span className="block text-xs text-muted-foreground">Sugere título, legenda e CTA para revisar.</span>
                </button>
                <button type="button" onClick={() => setMode("manual")} className={cn("rounded-md border p-3 text-left text-sm", mode === "manual" ? "border-primary bg-primary/10" : "hover:bg-muted")}>
                  <span className="flex items-center gap-2 font-medium"><PencilRuler className="h-4 w-4" /> Criar manualmente</span>
                  <span className="block text-xs text-muted-foreground">Escreva os textos sem consumir créditos.</span>
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Fallback automático quando a IA falha */}
      {aiFailure && mode === "ai" && !pendingReview && (
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

      <div className="flex items-center gap-2 overflow-x-auto pb-1" aria-label="Etapas da criação">
        {[['brief', 'Contexto'], ['assets', assetsLabel], ['ready', isManual ? 'Textos e criar' : 'Revisar e gerar']].map(([id, label], index) => <button key={id} type="button" onClick={() => setStep(id as typeof step)} className={`shrink-0 rounded-full border px-3 py-1.5 text-xs ${step === id ? "border-primary bg-primary/10 font-medium text-primary" : "text-muted-foreground"}`}>{index + 1}. {label}</button>)}
      </div>

      {/* Contexto */}
      <div hidden={step !== "brief"} className="rounded-lg border bg-card p-4 space-y-3">

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div>
            <Label>Promoção (opcional)</Label>
            <select
              className="w-full h-9 rounded-md border bg-background px-2 text-sm"
              value={promotionId}
              onChange={(e) => setPromotionId(e.target.value)}
            >
              <option value="">— Sem promoção específica —</option>
              {promotions.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.title}
                </option>
              ))}
            </select>
          </div>
          {!isManual && (
          <>
          <div>
            <Label>Tom da comunicação</Label>
            <select
              className="w-full h-9 rounded-md border bg-background px-2 text-sm"
              value={tone}
              onChange={(e) => setTone(e.target.value as typeof tone)}
            >
              <option value="amigável">Amigável</option>
              <option value="profissional">Profissional</option>
              <option value="descontraído">Descontraído</option>
              <option value="urgente">Urgente</option>
            </select>
          </div>
          <div className="md:col-span-2">
            <Label>Público-alvo</Label>
            <Input
              value={audience}
              onChange={(e) => setAudience(e.target.value)}
              placeholder="Ex.: moradores da região, clientes recorrentes"
            />
          </div>
          <div className="md:col-span-2">
            {/* Mesmo componente do modo manual — escolha visível e editável
                ANTES de "Gerar campanha". */}
            <CampaignFormatsField
              id="ai-campaign-formats"
              value={aiFormats}
              onChange={setAiFormats}
              disabled={generating}
              hint="A IA gera e o render/publicação usam somente os formatos escolhidos."
            />
          </div>
          <div className="md:col-span-2">
            <Label>Instruções extras (opcional)</Label>
            <Textarea
              value={extra}
              onChange={(e) => setExtra(e.target.value)}
              rows={2}
              placeholder="Ex.: destacar entrega grátis; mencionar 10 anos de mercado"
            />
          </div>
          </>
          )}
        </div>
      </div>

      {/* Imagens da campanha — só no pipeline de vídeo gerado */}
      <div hidden={step !== "assets" || isSimpleMode} className="rounded-lg border bg-card p-4 space-y-3">
        <div className="flex items-baseline justify-between flex-wrap gap-2">
          <div className="text-sm font-semibold">
            Imagens da campanha ({slots.length}/{MAX_IMAGES})
          </div>
          <div className="text-xs text-muted-foreground">
            Arraste para reordenar · a 1ª é a principal
          </div>
        </div>
        <CampaignImageList
          items={items}
          onReorder={reorder}
          onRemove={removeByKey}
          onMakePrimary={makePrimary}
          onEditFocal={(key) => setEditingKey(key)}
        />
        {primarySlot && (
          <div className="pt-2">
            <div className="text-xs font-medium text-muted-foreground mb-1">
              Prévia do enquadramento (imagem principal)
            </div>
            <CampaignFramingPreview
              imageUrl={primarySlot.previewUrl}
              focalPoint={primarySlot.focal}
              compact
            />
          </div>
        )}
      </div>

      {/* Ativos: o acervo completo fica em um seletor compacto */}
      <div hidden={step !== "assets"} className="rounded-lg border bg-card p-4 space-y-3">
        <div><div className="text-sm font-semibold">{assetsLabel}</div><p className="text-xs text-muted-foreground">Escolha os ativos quando estiver pronto. Eles continuam disponíveis no Acervo.</p></div>
        <MarketingAssetPicker companyId={companyId} selectedMedia={selectedMediaSelections} onMediaChange={replaceSelections} selectedAudio={audio} onAudioChange={setAudio} showAudio={!isSimpleMode} mediaKind={mediaMode === "uploaded_video" ? "video" : "image"} marketingOnly={isSimpleMode} maxItems={isSimpleMode ? 1 : MAX_IMAGES} />
        {isSimpleMode && primarySlot && (
          <div className="mx-auto w-full max-w-[220px] overflow-hidden rounded-md border bg-muted">
            {!primarySlot.previewUrl ? (
              <div className="flex aspect-square items-center justify-center text-xs text-muted-foreground">
                {primarySlot.failed ? "Não foi possível carregar a prévia." : "Carregando prévia…"}
              </div>
            ) : mediaMode === "uploaded_video" ? (
              <video src={primarySlot.previewUrl} className="w-full" controls muted preload="metadata" />
            ) : (
              <img src={primarySlot.previewUrl} alt="Mídia selecionada" className="w-full" loading="lazy" />
            )}
          </div>
        )}
        {mediaMode === "generated_video" && audio && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div><Label>Início no áudio (segundos)</Label><Input type="number" min={0} max={Math.max(0, Math.floor(Number(audio.duration_seconds ?? 0) - 1))} value={audioStart} onChange={(e) => setAudioStart(Math.max(0, parseInt(e.target.value || "0", 10)))} /></div>
            <div><Label>Duração do vídeo</Label><select className="w-full h-9 rounded-md border bg-background px-2 text-sm" value={duration} onChange={(e) => setDuration(Number(e.target.value) as Duration)}>{[8, 10, 15, 30, 60].map((d) => <option key={d} value={d}>{d}s</option>)}</select></div>
          </div>
        )}
      </div>
      {/* Resumo antes de gerar (modos com IA) */}
      {step === "ready" && !isManual && !pendingReview && !campaignId && (
        <div className="rounded-lg border bg-card p-4 space-y-2 text-sm">
          <div className="font-semibold">Confira antes de gerar</div>
          <dl className="grid grid-cols-1 gap-x-4 gap-y-1 sm:grid-cols-2">
            <div><dt className="inline text-muted-foreground">Tipo: </dt><dd className="inline">{mediaMode === "photo" ? "Foto" : mediaMode === "uploaded_video" ? "Vídeo pronto" : "Vídeo criado com IA"}</dd></div>
            <div><dt className="inline text-muted-foreground">Formatos: </dt><dd className="inline">{aiFormats === "feed" ? "Feed" : aiFormats === "story" ? "Story" : "Feed + Story"}</dd></div>
            <div><dt className="inline text-muted-foreground">Promoção: </dt><dd className="inline">{promotions.find((p) => p.id === promotionId)?.title ?? "Sem promoção específica"}</dd></div>
            <div><dt className="inline text-muted-foreground">Tom: </dt><dd className="inline">{tone}</dd></div>
            <div><dt className="inline text-muted-foreground">Mídia: </dt><dd className="inline">{isSimpleMode ? (slots.length ? "1 selecionada" : "nenhuma") : `${slots.length} imagem(ns)`}</dd></div>
            {!isSimpleMode && <div><dt className="inline text-muted-foreground">Música: </dt><dd className="inline">{audio ? `${audio.name} · ${duration}s a partir de ${audioStart}s` : "nenhuma"}</dd></div>}
          </dl>
          {!canGenerate && <p className="text-xs text-destructive">{assetsHint}. Volte à etapa "{assetsLabel}".</p>}
        </div>
      )}

      {/* Modo manual — formulário completo, sem IA */}
      {isManual && step === "ready" && !pendingReview && !campaignId && (
        <CampaignManualForm
          submitting={generating}
          disabled={!baseReady}
          disabledReason="Selecione ao menos 1 imagem e um áudio para continuar."
          onSubmit={(payload) => void generateManual(payload)}
        />
      )}

      {/* Revisão de texto (approval-gate) — sem job de render ainda */}
      {pendingReview && !campaignId && (
        <CampaignVideoEditor
          campaignId={pendingReview.campaignId}
          contents={pendingReview.contents}
          previewImageUrl={primarySlot?.previewUrl ?? null}
          focalPoint={primarySlot?.focal ?? null}
          onContentsUpdated={(fresh: MarketingContentRow[]) =>
            setPendingReview((cur) =>
              cur ? { ...cur, contents: fresh } : cur,
            )
          }
          onApproved={() => {
            const id = pendingReview.campaignId;
            setPendingReview(null);
            setCampaignId(id);
            trackCampaign(id);
          }}
        />
      )}

      {/* Progresso da renderização (global) */}
      {campaignId && <CampaignRenderProgress tracked={tracked} onRetry={handleRetry} />}

      {/* Editor de focal point */}
      <FocalPointEditor
        open={!!editingSlot}
        imageUrl={editingSlot?.previewUrl ?? null}
        initialFocal={editingSlot?.focal ?? null}
        onCancel={() => setEditingKey(null)}
        onSave={(fp) => editingKey && saveFocal(editingKey, fp)}
      />

      {/* Sticky action — no modo manual, a última etapa usa o botão do formulário */}
      {!(isManual && step === "ready") && !pendingReview && !campaignId && (
        <CampaignStickyActionBar>
          <div className="hidden md:flex items-center gap-2 text-xs text-muted-foreground mr-2">
            {assetsHint}
          </div>
          <Button onClick={() => { if (step === "brief") setStep("assets"); else if (step === "assets") { if (canGenerate) setStep("ready"); } else void (isSimpleMode ? generateSimple() : generate()); }} disabled={generating || (step !== "brief" && !canGenerate)} size="lg" className="w-full md:w-auto">
            {generating ? (
              <Loader2 className="h-4 w-4 animate-spin mr-1" />
            ) : step === "ready" ? (
              <Sparkles className="h-4 w-4 mr-1" />
            ) : null}
            {step === "ready" ? "Gerar conteúdo" : "Continuar"}
          </Button>
        </CampaignStickyActionBar>
      )}

    </div>
  );
}
