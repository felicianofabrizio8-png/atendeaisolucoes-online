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

import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Sparkles, Loader2 } from "lucide-react";
import { toast } from "sonner";
import {
  apiListPromotions,
  apiGenerateCampaign,
  apiRetryCampaignRender,
  urlForMarketingPath,
  type CampaignImageInput,
  type FocalPointInput,
} from "@/data/marketingRepo";
import { getSignedImageUrl } from "@/lib/storage";
import type { MarketingPromotionRow, MarketingContentRow } from "@/lib/marketing/marketing.types";
import { MarketingLibrary } from "../MarketingLibrary";
import {
  type MediaSelection,
  selectionKey,
  sameSelection,
} from "@/lib/marketing/media-selection";
import { CampaignAudioPicker } from "./CampaignAudioPicker";
import { CampaignFramingPreview } from "./CampaignFramingPreview";
import { CampaignImageList, type CampaignImageItem } from "./CampaignImageList";
import { FocalPointEditor } from "./FocalPointEditor";
import { CampaignStickyActionBar } from "./CampaignStickyActionBar";
import { CampaignRenderProgress } from "./CampaignRenderProgress";
import { CampaignVideoEditor } from "./editor/CampaignVideoEditor";
import {
  useCampaignRenderTracker,
  useTrackedCampaign,
} from "@/lib/marketing/useCampaignRenderTracker";
import type { AudioLibraryRow } from "@/lib/audio-library/audio-library.types";

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

  const [slots, setSlots] = useState<Slot[]>([]);
  const [editingKey, setEditingKey] = useState<string | null>(null);

  const [audio, setAudio] = useState<AudioLibraryRow | null>(null);
  const [audioStart, setAudioStart] = useState<number>(0);
  const [duration, setDuration] = useState<Duration>(15);

  const [generating, setGenerating] = useState(false);
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

  // Resolve preview URL para cada slot novo.
  useEffect(() => {
    let cancelled = false;
    slots.forEach((slot, idx) => {
      if (slot.previewUrl || slot.loading || slot.failed) return;
      setSlots((cur) => cur.map((s, i) => (i === idx ? { ...s, loading: true } : s)));
      (async () => {
        try {
          let url: string | null = null;
          if (slot.selection.origin === "marketing" && slot.selection.storagePath) {
            url = await urlForMarketingPath(slot.selection.storagePath).catch(() => null);
          } else if (slot.selection.origin === "product") {
            url = await getSignedImageUrl(slot.selection.imagePath).catch(() => null);
          }
          if (cancelled) return;
          setSlots((cur) =>
            cur.map((s) =>
              sameSelection(s.selection, slot.selection)
                ? { ...s, previewUrl: url, loading: false, failed: !url }
                : s,
            ),
          );
        } catch {
          if (cancelled) return;
          setSlots((cur) =>
            cur.map((s) =>
              sameSelection(s.selection, slot.selection)
                ? { ...s, previewUrl: null, loading: false, failed: true }
                : s,
            ),
          );
        }
      })();
    });
    return () => {
      cancelled = true;
    };
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
  const canGenerate =
    slots.length > 0 && !!audio && !generating && slots.every((s) => !!s.previewUrl);

  async function generate() {
    if (!audio || slots.length === 0) return;
    const audioDur = Number(audio.duration_seconds ?? 0);
    if (audioStart + duration > audioDur + 0.001) {
      toast.error("O trecho do áudio excede sua duração total.");
      return;
    }
    setGenerating(true);
    try {
      const images: CampaignImageInput[] = slots.map((s) =>
        s.selection.origin === "marketing"
          ? { origin: "marketing", media_id: s.selection.id, focal_point: s.focal ?? null }
          : {
              origin: "product",
              product_id: s.selection.productId,
              image_path: s.selection.imagePath,
              focal_point: s.focal ?? null,
            },
      );
      const res = await apiGenerateCampaign({
        promotion_id: promotionId || null,
        images,
        primary_audio_id: audio.id,
        audio_start_second: audioStart,
        duration_seconds: duration,
        tone,
        audience: audience.trim() || null,
        extra_instructions: extra.trim() || null,
      });
      const contentsRet = (res.contents ?? []) as MarketingContentRow[];
      // Approval-gate: NÃO iniciamos o tracking do render aqui — o job
      // ainda não foi enfileirado. Abrimos a tela de revisão.
      setPendingReview({ campaignId: res.campaign_id, contents: contentsRet });
      toast.success("Textos sugeridos. Revise antes de gerar o vídeo.");
      onGenerated?.(contentsRet);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao gerar campanha.");
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
      {/* Contexto */}
      <div className="rounded-lg border bg-card p-4 space-y-3">
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
              placeholder="Ex.: famílias com crianças, moradores da região"
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
        </div>
      </div>

      {/* Imagens da campanha */}
      <div className="rounded-lg border bg-card p-4 space-y-3">
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
            />
          </div>
        )}
      </div>

      {/* Biblioteca (seleção) */}
      <div className="rounded-lg border bg-card p-4 space-y-3">
        <div className="text-sm font-semibold">Escolher da biblioteca</div>
        <MarketingLibrary
          companyId={companyId}
          selectable
          selected={selectedMediaSelections}
          onToggleSelect={toggleSelection}
        />
      </div>

      {/* Áudio */}
      <div className="rounded-lg border bg-card p-4 space-y-3">
        <div className="text-sm font-semibold">Áudio da campanha</div>
        <CampaignAudioPicker selectedId={audio?.id ?? null} onSelect={setAudio} />
        {audio && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <Label>Início no áudio (segundos)</Label>
              <Input
                type="number"
                min={0}
                max={Math.max(0, Math.floor(Number(audio.duration_seconds ?? 0) - 1))}
                value={audioStart}
                onChange={(e) => setAudioStart(Math.max(0, parseInt(e.target.value || "0", 10)))}
              />
            </div>
            <div>
              <Label>Duração do vídeo</Label>
              <select
                className="w-full h-9 rounded-md border bg-background px-2 text-sm"
                value={duration}
                onChange={(e) => setDuration(Number(e.target.value) as Duration)}
              >
                {[8, 10, 15, 30, 60].map((d) => (
                  <option key={d} value={d}>
                    {d}s
                  </option>
                ))}
              </select>
            </div>
          </div>
        )}
      </div>

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

      {/* Sticky action */}
      <CampaignStickyActionBar>
        <div className="hidden md:flex items-center gap-2 text-xs text-muted-foreground mr-2">
          {slots.length === 0
            ? "Selecione ao menos 1 imagem"
            : !audio
              ? "Selecione um áudio"
              : `${slots.length} imagem(ns) · ${duration}s`}
        </div>
        <Button onClick={generate} disabled={!canGenerate} size="lg" className="w-full md:w-auto">
          {generating ? (
            <Loader2 className="h-4 w-4 animate-spin mr-1" />
          ) : (
            <Sparkles className="h-4 w-4 mr-1" />
          )}
          Gerar campanha (Feed + Story)
        </Button>
      </CampaignStickyActionBar>
    </div>
  );
}
