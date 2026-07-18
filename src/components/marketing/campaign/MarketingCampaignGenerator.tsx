// Gerador de Campanha (Fase C.1).
//
// Fluxo:
//   1. Selecionar 1 imagem (marketing ou produto) via MarketingLibrary (modo
//      seleção única — clique substitui a atual).
//   2. Selecionar 1 áudio via CampaignAudioPicker.
//   3. Definir duração (8/10/15/30/60s) e start_second do áudio.
//   4. Informar tom/público/instruções extras.
//   5. Gerar campanha → cria 4 rascunhos vinculados por campaign_id e
//      enfileira 2 render jobs (Feed 4:5 + Story 9:16) quando a imagem é
//      da Biblioteca de Marketing.
//   6. Polling de status a cada 5s para exibir progresso Feed/Story.
//
// Não gera vídeo para imagens de produto (bucket product-images ainda não é
// suportado pelo worker de render); nesses casos a UI informa e o usuário
// pode aprovar/agendar os textos normalmente.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Sparkles, Loader2, AlertTriangle, Info } from "lucide-react";
import { toast } from "sonner";
import {
  apiListPromotions,
  apiGenerateCampaign,
  apiGetCampaignRenderStatus,
  apiRetryCampaignRender,
  urlForMarketingPath,
  type CampaignPrimaryImage,
} from "@/data/marketingRepo";
import { getSignedImageUrl } from "@/lib/storage";
import type {
  MarketingPromotionRow,
  MarketingContentRow,
} from "@/lib/marketing/marketing.types";
import { MarketingLibrary } from "../MarketingLibrary";
import type { MediaSelection } from "@/lib/marketing/media-selection";
import { CampaignAudioPicker } from "./CampaignAudioPicker";
import { CampaignFramingPreview } from "./CampaignFramingPreview";
import type { AudioLibraryRow } from "@/lib/audio-library/audio-library.types";

type Duration = 8 | 10 | 15 | 30 | 60;

interface Props {
  companyId: string;
  onGenerated?: (contents: MarketingContentRow[]) => void;
}

export function MarketingCampaignGenerator({ companyId, onGenerated }: Props) {
  const [promotions, setPromotions] = useState<MarketingPromotionRow[]>([]);
  const [promotionId, setPromotionId] = useState<string>("");
  const [tone, setTone] =
    useState<"amigável" | "profissional" | "descontraído" | "urgente">("amigável");
  const [audience, setAudience] = useState("");
  const [extra, setExtra] = useState("");

  const [image, setImage] = useState<MediaSelection | null>(null);
  const [imageUrl, setImageUrl] = useState<string | null>(null);

  const [audio, setAudio] = useState<AudioLibraryRow | null>(null);
  const [audioStart, setAudioStart] = useState<number>(0);
  const [duration, setDuration] = useState<Duration>(15);

  const [generating, setGenerating] = useState(false);
  const [campaignId, setCampaignId] = useState<string | null>(null);
  const [needsMarketingMedia, setNeedsMarketingMedia] = useState(false);
  const [renderStatus, setRenderStatus] = useState<Awaited<
    ReturnType<typeof apiGetCampaignRenderStatus>
  > | null>(null);

  useEffect(() => {
    void apiListPromotions().then(setPromotions).catch(() => {});
  }, [companyId]);

  // Resolve URL assinada da imagem selecionada para preview de enquadramento.
  useEffect(() => {
    let cancelled = false;
    async function resolve() {
      if (!image) {
        setImageUrl(null);
        return;
      }
      try {
        if (image.origin === "marketing") {
          // Fallback: MarketingLibrary não expõe path direto no MediaSelection.
          // A URL assinada será resolvida server-side no publisher; aqui
          // usamos o próprio card visual — deixamos preview vazio com aviso.
          // Uma iteração futura pode encaminhar o path junto do MediaSelection.
          setImageUrl(null);
        } else {
          const url = await urlForMarketingPath(image.imagePath).catch(() => null);
          const url2 = url ?? (await getSignedImageUrl(image.imagePath).catch(() => null));
          if (!cancelled) setImageUrl(url2 ?? null);
        }
      } catch {
        if (!cancelled) setImageUrl(null);
      }
    }
    void resolve();
    return () => {
      cancelled = true;
    };
  }, [image]);

  const canGenerate = useMemo(
    () => !!image && !!audio && !generating,
    [image, audio, generating],
  );

  const buildPrimaryImage = useCallback((): CampaignPrimaryImage | null => {
    if (!image) return null;
    if (image.origin === "marketing") return { origin: "marketing", media_id: image.id };
    return {
      origin: "product",
      product_id: image.productId,
      image_path: image.imagePath,
    };
  }, [image]);

  async function generate() {
    const primary = buildPrimaryImage();
    if (!primary || !audio) return;
    // Validação client-side: start + duração ≤ áudio.duration
    const audioDur = Number(audio.duration_seconds ?? 0);
    if (audioStart + duration > audioDur + 0.001) {
      toast.error("O trecho do áudio excede sua duração total.");
      return;
    }
    setGenerating(true);
    try {
      const res = await apiGenerateCampaign({
        promotion_id: promotionId || null,
        primary_image: primary,
        primary_audio_id: audio.id,
        audio_start_second: audioStart,
        duration_seconds: duration,
        tone,
        audience: audience.trim() || null,
        extra_instructions: extra.trim() || null,
      });
      setCampaignId(res.campaign_id);
      setNeedsMarketingMedia(res.needs_marketing_media_for_render);
      toast.success(
        res.needs_marketing_media_for_render
          ? "Campanha criada. Vídeos não enfileirados (imagem é de produto)."
          : "Campanha criada. Renderização Feed + Story enfileirada.",
      );
      onGenerated?.(res.contents as MarketingContentRow[]);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao gerar campanha.");
    } finally {
      setGenerating(false);
    }
  }

  // Polling de status enquanto houver render pendente.
  const pollRef = useRef<number | null>(null);
  useEffect(() => {
    if (!campaignId) return;
    let cancelled = false;
    async function tick() {
      try {
        const s = await apiGetCampaignRenderStatus(campaignId!);
        if (cancelled) return;
        setRenderStatus(s);
        const feedDone = !!s.feed.video_id || s.feed.job?.status === "failed";
        const storyDone = !!s.story.video_id || s.story.job?.status === "failed";
        const noJobs = !s.feed.job_id && !s.story.job_id;
        if (feedDone && storyDone) return;
        if (noJobs) return;
        pollRef.current = window.setTimeout(tick, 5000);
      } catch {
        // silencioso — próximo tick tenta de novo
        if (!cancelled) pollRef.current = window.setTimeout(tick, 8000);
      }
    }
    void tick();
    return () => {
      cancelled = true;
      if (pollRef.current) window.clearTimeout(pollRef.current);
    };
  }, [campaignId]);

  async function retry(role: "feed" | "story") {
    if (!campaignId) return;
    try {
      await apiRetryCampaignRender({ campaign_id: campaignId, role });
      toast.info("Novo render enfileirado.");
      // dispara re-poll imediato
      const s = await apiGetCampaignRenderStatus(campaignId);
      setRenderStatus(s);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao reenfileirar.");
    }
  }

  return (
    <div className="space-y-4">
      {/* Contexto da campanha */}
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

      {/* Imagem única */}
      <div className="rounded-lg border bg-card p-4 space-y-3">
        <div className="flex items-baseline justify-between">
          <div className="text-sm font-semibold">Imagem principal da campanha</div>
          <div className="text-xs text-muted-foreground">
            {image ? "1 selecionada" : "Selecione 1 imagem"}
          </div>
        </div>
        <MarketingLibrary
          companyId={companyId}
          selectable
          selected={image ? [image] : []}
          // Seleção única: sempre substitui a anterior
          onToggleSelect={(sel) => setImage((cur) => (cur && sameKey(cur, sel) ? null : sel))}
        />
        <CampaignFramingPreview imageUrl={imageUrl} />
      </div>

      {/* Áudio único */}
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

      {/* Ação */}
      <div className="flex justify-end">
        <Button onClick={generate} disabled={!canGenerate} size="lg">
          {generating ? (
            <Loader2 className="h-4 w-4 animate-spin mr-1" />
          ) : (
            <Sparkles className="h-4 w-4 mr-1" />
          )}
          Gerar campanha (Feed + Story)
        </Button>
      </div>

      {/* Status de render */}
      {campaignId && (
        <div className="rounded-lg border bg-card p-4 space-y-2">
          <div className="text-sm font-semibold">Campanha gerada</div>
          {needsMarketingMedia && (
            <div className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-xs text-amber-800 dark:text-amber-200">
              <Info className="h-4 w-4 mt-0.5" />
              <div>
                Os textos foram criados como rascunho. Para gerar vídeos MP4 automaticamente,
                cadastre esta imagem na <strong>Biblioteca de Marketing</strong> e regenere.
              </div>
            </div>
          )}
          {!needsMarketingMedia && renderStatus && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <RoleStatus label="Feed 4:5" info={renderStatus.feed} onRetry={() => retry("feed")} />
              <RoleStatus label="Story 9:16" info={renderStatus.story} onRetry={() => retry("story")} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function sameKey(a: MediaSelection, b: MediaSelection): boolean {
  if (a.origin !== b.origin) return false;
  if (a.origin === "marketing" && b.origin === "marketing") return a.id === b.id;
  if (a.origin === "product" && b.origin === "product")
    return a.productId === b.productId && a.imagePath === b.imagePath;
  return false;
}

function RoleStatus({
  label,
  info,
  onRetry,
}: {
  label: string;
  info: {
    job: { status: string; progress: number | null; error_code: string | null } | null | undefined;
    video_id: string | null;
  };
  onRetry: () => void;
}) {
  const status = info.video_id ? "completed" : info.job?.status ?? "pending";
  const progress = info.job?.progress ?? 0;
  const failed = status === "failed";
  return (
    <div className="rounded-md border p-3 space-y-1">
      <div className="flex items-center justify-between">
        <div className="text-sm font-medium">{label}</div>
        <div className="text-xs text-muted-foreground">{status}</div>
      </div>
      {!info.video_id && !failed && (
        <div className="h-1.5 rounded bg-muted overflow-hidden">
          <div
            className="h-full bg-primary transition-all"
            style={{ width: `${Math.min(100, Math.max(0, progress ?? 0))}%` }}
          />
        </div>
      )}
      {info.video_id && (
        <div className="text-xs text-emerald-600 dark:text-emerald-400">Vídeo pronto</div>
      )}
      {failed && (
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1 text-xs text-destructive">
            <AlertTriangle className="h-3 w-3" />
            {info.job?.error_code ?? "erro"}
          </div>
          <Button size="sm" variant="outline" onClick={onRetry}>
            Retentar
          </Button>
        </div>
      )}
    </div>
  );
}
