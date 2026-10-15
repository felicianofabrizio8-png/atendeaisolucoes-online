import { LumePulse, LumeThinking, PillIndicator } from "../MarketingMotion";
// Gerador de Campanha (Fase C.2).
//
// Evoluções vs. C.1:
// - Múltiplas imagens (ordenáveis) via CampaignImageList.
// - Focal point real por imagem via FocalPointEditor (aplicado no render).
// - Progresso desacoplado da tela via useCampaignRenderTracker (o polling
//   segue rodando mesmo se o usuário navegar de aba).
// - Criação guiada em etapas, com a ação principal junto ao formulário.
// - Preview WYSIWYG do focal point sobre Feed 4:5 e Story 9:16.
//
// Retrocompatível: se apenas 1 imagem for selecionada, o backend continua
// enviando `primary_image` no payload legado; caso contrário envia `images`.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Briefcase,
  Images,
  Library,
  MessageSquareText,
  Music2,
  PartyPopper,
  PencilRuler,
  Plus,
  Smile,
  Sparkles,
  Tag,
  Users,
  Zap,
} from "lucide-react";
import { lumeToast as toast } from "../MarketingFeedback";
import { cn } from "@/lib/utils";
import {
  apiListPromotions,
  apiGenerateCampaign,
  apiGenerateManualCampaign,
  apiRetryCampaignRender,
  urlForMarketingPath,
  type CampaignImageInput,
  type FocalPointInput,
} from "@/data/marketingRepo";
import { getSignedImageUrl } from "@/lib/storage";
import type { MarketingPromotionRow, MarketingContentRow } from "@/lib/marketing/marketing.types";
import { MarketingLibrary } from "../MarketingLibrary";
import { type MediaSelection, selectionKey, sameSelection } from "@/lib/marketing/media-selection";
import { CampaignAudioPicker } from "./CampaignAudioPicker";
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

type Duration = 8 | 10 | 15 | 30 | 60;
// Alinhado com MAX_CAMPAIGN_IMAGES do backend/worker (render.types.ts).
const MAX_IMAGES = 8;

const toneOptions = [
  { value: "amigável", label: "Amigável", sample: "Chegou novidade pra você!", icon: Smile },
  {
    value: "profissional",
    label: "Profissional",
    sample: "Conheça nossa nova linha.",
    icon: Briefcase,
  },
  {
    value: "descontraído",
    label: "Descontraído",
    sample: "Bora conferir? Tá demais!",
    icon: PartyPopper,
  },
  { value: "urgente", label: "Urgente", sample: "Só até domingo. Corre!", icon: Zap },
] as const;

const audienceSuggestions = [
  "Clientes da região",
  "Famílias com crianças",
  "Jovens adultos",
  "Pequenas empresas",
];

const creationSteps = [
  { label: "Mensagem", icon: MessageSquareText },
  { label: "Imagens", icon: Images },
  { label: "Trilha e criação", icon: Music2 },
];

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
  const [tone, setTone] = useState<"amigável" | "profissional" | "descontraído" | "urgente">(
    "amigável",
  );
  const [audience, setAudience] = useState("");
  const [extra, setExtra] = useState("");
  // Seleção de formatos no modo IA — mesmo contrato canônico do modo manual.
  const [aiFormats, setAiFormats] = useState<CampaignFormatSelection>("feed_story");

  const [slots, setSlots] = useState<Slot[]>([]);
  const mounted = useRef(false);
  const previewRequests = useRef(new Set<string>());
  const [editingKey, setEditingKey] = useState<string | null>(null);

  const [audio, setAudio] = useState<AudioLibraryRow | null>(null);
  const [audioStart, setAudioStart] = useState<number>(0);
  const [duration, setDuration] = useState<Duration>(15);

  const [generating, setGenerating] = useState(false);
  const [creationStep, setCreationStep] = useState(0);
  // Modo de criação: IA (padrão) ou manual (sem IA, sem créditos).
  const [mode, setMode] = useState<"ai" | "manual">("ai");
  // Falha da IA → oferecemos o modo manual sem bloquear o usuário.
  const [aiFailure, setAiFailure] = useState<AiFailureKind | null>(null);
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
    void apiListPromotions()
      .then(setPromotions)
      .catch(() => {});
  }, [companyId]);

  // Resolve preview URL para cada slot novo.
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    slots.forEach((slot) => {
      if (slot.previewUrl || slot.loading || slot.failed) return;
      const key = selectionKey(slot.selection);
      if (previewRequests.current.has(key)) return;
      previewRequests.current.add(key);
      setSlots((cur) =>
        cur.map((s) => (sameSelection(s.selection, slot.selection) ? { ...s, loading: true } : s)),
      );
      (async () => {
        try {
          let url: string | null = null;
          if (slot.selection.origin === "marketing" && slot.selection.storagePath) {
            url = await urlForMarketingPath(slot.selection.storagePath).catch(() => null);
          } else if (slot.selection.origin === "product") {
            url = await getSignedImageUrl(slot.selection.imagePath).catch(() => null);
          }
          if (!mounted.current) return;
          setSlots((cur) =>
            cur.map((s) =>
              sameSelection(s.selection, slot.selection)
                ? { ...s, previewUrl: url, loading: false, failed: !url }
                : s,
            ),
          );
        } catch {
          if (!mounted.current) return;
          setSlots((cur) =>
            cur.map((s) =>
              sameSelection(s.selection, slot.selection)
                ? { ...s, previewUrl: null, loading: false, failed: true }
                : s,
            ),
          );
        } finally {
          previewRequests.current.delete(key);
        }
      })();
    });
  }, [slots]);

  const selectedMediaSelections = useMemo(() => slots.map((s) => s.selection), [slots]);

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
      return [
        ...cur,
        { selection: sel, focal: null, previewUrl: null, loading: false, failed: false },
      ];
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
    setSlots((cur) => cur.map((s) => (selectionKey(s.selection) === key ? { ...s, focal } : s)));
    setEditingKey(null);
  }, []);

  const editingSlot = useMemo(
    () =>
      editingKey ? (slots.find((s) => selectionKey(s.selection) === editingKey) ?? null) : null,
    [editingKey, slots],
  );

  const primarySlot = slots[0] ?? null;
  const baseReady =
    slots.length > 0 && !!audio && !generating && slots.every((s) => !!s.previewUrl);
  const canGenerate = baseReady;

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

  const guided = !pendingReview && !campaignId;
  const selectedPromotion = promotions.find((p) => p.id === promotionId);
  return (
    <div className="mkt-creation-shell">
      <div className="mkt-creation-form">
        {guided && (
          <nav className="mkt-pill mkt-creation-nav" aria-label="Etapas da criação">
            {creationSteps.map(({ label, icon: Icon }, index) => (
              <button
                key={label}
                type="button"
                aria-current={creationStep === index ? "step" : undefined}
                disabled={generating || (index === 2 && slots.length === 0)}
                title={
                  index === 2 && slots.length === 0
                    ? "Escolha uma imagem para continuar"
                    : undefined
                }
                onClick={() => setCreationStep(index)}
              >
                {creationStep === index && <PillIndicator layoutId="mkt-creation-nav" />}
                <Icon aria-hidden />
                {label}
              </button>
            ))}
          </nav>
        )}
        <div className="mkt-campaign-builder space-y-4" data-creation-step={creationStep}>
          {generating && (
            <LumeThinking
              label={
                mode === "ai" ? "A Lume está conectando suas ideias." : "Preparando sua campanha."
              }
            />
          )}
          {/* Modo de criação — IA (acelerador) ou Manual (sempre disponível) */}
          {!pendingReview && !campaignId && creationStep === 0 && (
            <div className="mkt-method-choice rounded-lg border bg-card p-4">
              <div className="text-sm font-semibold mb-2">Como você quer criar?</div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <button
                  type="button"
                  aria-pressed={mode === "ai"}
                  onClick={() => setMode("ai")}
                  className={cn(
                    "rounded-md border p-3 text-left text-sm transition-colors",
                    mode === "ai" ? "border-primary bg-primary/10" : "hover:bg-muted",
                  )}
                >
                  <span className="flex items-center gap-2 font-medium">
                    <Sparkles className="h-4 w-4" /> Criar com Lume
                  </span>
                  <span className="block text-xs text-muted-foreground">
                    Conte sua ideia. A Lume sugere os textos e você revisa antes de criar o vídeo.
                  </span>
                </button>
                <button
                  type="button"
                  aria-pressed={mode === "manual"}
                  onClick={() => setMode("manual")}
                  className={cn(
                    "rounded-md border p-3 text-left text-sm transition-colors",
                    mode === "manual" ? "border-primary bg-primary/10" : "hover:bg-muted",
                  )}
                >
                  <span className="flex items-center gap-2 font-medium">
                    <PencilRuler className="h-4 w-4" /> Criar manualmente
                  </span>
                  <span className="block text-xs text-muted-foreground">
                    Prefere escrever? Você escolhe cada frase, sem usar créditos de IA.
                  </span>
                </button>
              </div>
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

          {/* Contexto */}
          <div
            hidden={guided && creationStep !== 0}
            className="rounded-lg border bg-card p-4 space-y-3"
          >
            <header className="mkt-form-head" data-hue="violet">
              <span className="mkt-icon-chip" aria-hidden>
                <MessageSquareText size={18} />
              </span>
              <div>
                <h3 className="mkt-builder-step">O que você quer contar?</h3>
                <p>Quanto mais contexto, mais certeira a sugestão da Lume.</p>
              </div>
            </header>
            <div className="mkt-form-grid">
              <div className="mkt-field">
                <Label htmlFor="mkt-promotion">
                  Quer divulgar uma oferta? <span className="mkt-optional">opcional</span>
                </Label>
                <select
                  id="mkt-promotion"
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
                {selectedPromotion ? (
                  <p className="mkt-field-preview">
                    <Tag size={14} aria-hidden />
                    <b>{selectedPromotion.title}</b>
                    {selectedPromotion.price_promo != null && (
                      <span>
                        {selectedPromotion.price_promo.toLocaleString("pt-BR", {
                          style: "currency",
                          currency: "BRL",
                        })}
                      </span>
                    )}
                    {selectedPromotion.discount_percent ? (
                      <span>{selectedPromotion.discount_percent}% off</span>
                    ) : null}
                  </p>
                ) : (
                  <p className="mkt-hint">A Lume usa o preço e as condições da oferta no texto.</p>
                )}
              </div>
              <div className="mkt-field">
                <span id="mkt-tone-label" className="mkt-label">
                  Como sua marca fala?
                </span>
                <div className="mkt-choice-grid" role="radiogroup" aria-labelledby="mkt-tone-label">
                  {toneOptions.map(({ value, label, sample, icon: Icon }) => (
                    <button
                      key={value}
                      type="button"
                      role="radio"
                      aria-checked={tone === value}
                      onClick={() => setTone(value)}
                    >
                      <Icon size={16} aria-hidden />
                      <b>{label}</b>
                      <small>“{sample}”</small>
                    </button>
                  ))}
                </div>
              </div>
              <div className="mkt-field mkt-field-wide">
                <Label htmlFor="mkt-audience">Para quem é essa mensagem?</Label>
                <div className="mkt-input-icon">
                  <Users size={16} aria-hidden />
                  <Input
                    id="mkt-audience"
                    value={audience}
                    onChange={(e) => setAudience(e.target.value)}
                    placeholder="Ex.: famílias com crianças, moradores da região"
                  />
                </div>
                <div className="mkt-suggestions" role="group" aria-label="Sugestões de público">
                  {audienceSuggestions.map((suggestion) => (
                    <button
                      key={suggestion}
                      type="button"
                      aria-pressed={audience === suggestion}
                      onClick={() => setAudience(suggestion)}
                    >
                      <Plus size={12} aria-hidden />
                      {suggestion}
                    </button>
                  ))}
                </div>
              </div>
              <div className="mkt-field mkt-field-wide">
                {/* Mesmo componente do modo manual — escolha visível e editável
                ANTES de "Gerar campanha". */}
                <CampaignFormatsField
                  id="ai-campaign-formats"
                  value={aiFormats}
                  onChange={setAiFormats}
                  disabled={generating}
                  hint="Sua campanha será criada nos formatos que você escolher."
                />
              </div>
              <div className="mkt-field mkt-field-wide">
                <Label htmlFor="mkt-extra">
                  O que não pode faltar? <span className="mkt-optional">opcional</span>
                </Label>
                <Textarea
                  id="mkt-extra"
                  value={extra}
                  onChange={(e) => setExtra(e.target.value)}
                  rows={3}
                  placeholder="Ex.: destacar entrega grátis; mencionar 10 anos de mercado"
                />
                <p className="mkt-hint">
                  Separe as ideias com ponto e vírgula. <span>{extra.length} caracteres</span>
                </p>
              </div>
            </div>
          </div>

          {/* Imagens da campanha */}
          <div
            hidden={guided && creationStep !== 1}
            className="rounded-lg border bg-card p-4 space-y-3"
          >
            <header className="mkt-form-head" data-hue="blue">
              <span className="mkt-icon-chip" aria-hidden>
                <Images size={18} />
              </span>
              <div>
                <h3 className="mkt-builder-step">
                  Escolha suas imagens{" "}
                  <span>
                    {slots.length}/{MAX_IMAGES}
                  </span>
                </h3>
                <p>Arraste para reordenar. A primeira imagem é a principal da campanha.</p>
              </div>
              <span className="mkt-slot-meter" aria-hidden>
                {Array.from({ length: MAX_IMAGES }, (_, i) => (
                  <i key={i} data-filled={i < slots.length || undefined} />
                ))}
              </span>
            </header>
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
                />
              </div>
            )}
          </div>

          {/* Biblioteca (seleção) */}
          <div
            hidden={guided && creationStep !== 1}
            className="rounded-lg border bg-card p-4 space-y-3"
          >
            <header className="mkt-form-head mkt-form-head-sm" data-hue="lilac">
              <span className="mkt-icon-chip" aria-hidden>
                <Library size={16} />
              </span>
              <div>
                <h3 className="mkt-builder-step">Escolher da biblioteca</h3>
                <p>Toque nas fotos para adicionar ou remover da campanha.</p>
              </div>
            </header>
            <MarketingLibrary
              companyId={companyId}
              selectable
              selected={selectedMediaSelections}
              onToggleSelect={toggleSelection}
            />
          </div>

          {/* Áudio */}
          <div
            hidden={guided && creationStep !== 2}
            className="rounded-lg border bg-card p-4 space-y-3"
          >
            <header className="mkt-form-head" data-hue="orchid">
              <span className="mkt-icon-chip" aria-hidden>
                <Music2 size={18} />
              </span>
              <div>
                <h3 className="mkt-builder-step">Escolha uma trilha para o vídeo</h3>
                <p>Ouça antes de escolher. A trilha define o ritmo do vídeo.</p>
              </div>
            </header>
            <CampaignAudioPicker selectedId={audio?.id ?? null} onSelect={setAudio} />
            {audio && (
              <div className="mkt-form-grid">
                <div className="mkt-field">
                  <Label htmlFor="lume-audio-start">Início no áudio (segundos)</Label>
                  <div className="mkt-input-suffix">
                    <Input
                      id="lume-audio-start"
                      type="number"
                      min={0}
                      max={Math.max(0, Math.floor(Number(audio.duration_seconds ?? 0) - 1))}
                      value={audioStart}
                      onChange={(e) =>
                        setAudioStart(Math.max(0, parseInt(e.target.value || "0", 10)))
                      }
                    />
                    <span aria-hidden>seg</span>
                  </div>
                  <p className="mkt-hint">Pule a introdução e comece no trecho mais marcante.</p>
                </div>
                <div className="mkt-field">
                  <span id="lume-video-duration" className="mkt-label">
                    Duração do vídeo
                  </span>
                  <div
                    className="mkt-segmented"
                    role="radiogroup"
                    aria-labelledby="lume-video-duration"
                  >
                    {([8, 10, 15, 30, 60] as Duration[]).map((d) => (
                      <button
                        key={d}
                        type="button"
                        role="radio"
                        aria-checked={duration === d}
                        onClick={() => setDuration(d)}
                      >
                        {d}s
                      </button>
                    ))}
                  </div>
                  <p className="mkt-hint">
                    Stories e reels funcionam melhor entre 10 e 15 segundos.
                  </p>
                </div>
              </div>
            )}
          </div>

          {/* Modo manual — formulário completo, sem IA */}
          {mode === "manual" && !pendingReview && !campaignId && (
            <div hidden={creationStep !== 2}>
              <CampaignManualForm
                submitting={generating}
                disabled={!baseReady}
                disabledReason="Selecione ao menos 1 imagem e um áudio para continuar."
                onSubmit={(payload) => void generateManual(payload)}
              />
            </div>
          )}

          {/* Revisão de texto (approval-gate) — sem job de render ainda */}
          {pendingReview && !campaignId && (
            <CampaignVideoEditor
              campaignId={pendingReview.campaignId}
              contents={pendingReview.contents}
              previewImageUrl={primarySlot?.previewUrl ?? null}
              focalPoint={primarySlot?.focal ?? null}
              onContentsUpdated={(fresh: MarketingContentRow[]) =>
                setPendingReview((cur) => (cur ? { ...cur, contents: fresh } : cur))
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

          {/* Sticky action — só no modo IA (o manual tem seu próprio botão) */}
          {mode === "ai" && !pendingReview && !campaignId && creationStep === 2 && (
            <CampaignStickyActionBar>
              <div className="flex items-center gap-2 text-xs text-muted-foreground mr-2">
                {slots.length === 0
                  ? "Selecione ao menos 1 imagem"
                  : !audio
                    ? "Selecione um áudio"
                    : `${slots.length} imagem(ns) · ${duration}s`}
              </div>
              <Button
                onClick={generate}
                disabled={!canGenerate}
                size="lg"
                className="mkt-primary w-full md:w-auto"
              >
                {generating ? (
                  <LumePulse className="h-4 w-4 animate-spin mr-1" />
                ) : (
                  <Sparkles className="h-4 w-4 mr-1" />
                )}
                Gerar campanha
              </Button>
            </CampaignStickyActionBar>
          )}
          {guided && (
            <div className="mkt-creation-controls">
              <Button
                variant="ghost"
                disabled={creationStep === 0 || generating}
                onClick={() => setCreationStep((value) => value - 1)}
              >
                ← Voltar
              </Button>
              {creationStep < 2 ? (
                <>
                  <span>
                    {creationStep === 0
                      ? "Você pode ajustar tudo depois."
                      : slots.length === 0
                        ? "Escolha pelo menos uma imagem."
                        : `${slots.length} ${slots.length === 1 ? "imagem escolhida" : "imagens escolhidas"}.`}
                  </span>
                  <Button
                    className="mkt-primary"
                    disabled={generating || (creationStep === 1 && slots.length === 0)}
                    onClick={() => setCreationStep((value) => value + 1)}
                  >
                    Continuar →
                  </Button>
                </>
              ) : (
                <span>Revise os textos antes de gerar o vídeo.</span>
              )}
            </div>
          )}
        </div>
      </div>
      <aside className="mkt-creation-guide" aria-label="Resumo da campanha" aria-live="polite">
        <div className="mkt-brief-cover">
          <span className="mkt-brief-step">
            Etapa {creationStep + 1} de {creationSteps.length}
          </span>
          <strong>{creationSteps[creationStep].label}</strong>
          <div className="mkt-brief-meter" aria-hidden>
            {creationSteps.map(({ label }, index) => (
              <i key={label} data-done={index <= creationStep || undefined} />
            ))}
          </div>
        </div>
        <h3>Resumo da campanha</h3>
        <p>
          {
            [
              "Escolha o jeito de criar e conte o que deseja comunicar.",
              "Adicione suas fotos. A primeira imagem será o destaque da campanha.",
              "Escolha uma trilha. Depois, revise os textos para deixar tudo com a sua cara.",
            ][creationStep]
          }
        </p>
        <ul>
          <li data-done>
            <span>Tom de voz</span>
            <strong>{tone}</strong>
          </li>
          <li data-done>
            <span>Criação</span>
            <strong>{mode === "ai" ? "Com Lume" : "Manual"}</strong>
          </li>
          <li data-done={slots.length > 0 || undefined}>
            <span>Imagens</span>
            <strong>
              {slots.length} / {MAX_IMAGES}
            </strong>
          </li>
          <li data-done={!!audio || undefined}>
            <span>Trilha</span>
            <strong>{audio ? "Escolhida" : "A escolher"}</strong>
          </li>
        </ul>
        {audience.trim() && (
          <div className="mkt-brief-audience">
            <span>Para quem</span>
            <p>{audience}</p>
          </div>
        )}
        <small>O conteúdo passa pela sua revisão. Agendar e publicar são as próximas etapas.</small>
      </aside>
    </div>
  );
}
