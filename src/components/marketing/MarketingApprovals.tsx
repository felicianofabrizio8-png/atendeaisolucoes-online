import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  CheckCircle2,
  XCircle,
  Loader2,
  Send,
  Calendar,
  AlertTriangle,
  RefreshCw,
  Film,
  Play,
  MoreHorizontal,
} from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { toast } from "sonner";
import { openSettings } from "@/lib/settings-dialog";
import {
  apiListContents,
  apiListMedia,
  apiUpdateContent,
  apiSetContentStatus,
  apiScheduleContent,
  apiFacebookPublishReadiness,
  apiGetCampaignRenderStatus,
  apiRetryCampaignRender,
  urlForMarketingPath,
} from "@/data/marketingRepo";
import type {
  MarketingContentRow,
  MarketingMediaRow,
} from "@/lib/marketing/marketing.types";
import { validateScheduleForm } from "@/lib/marketing/schedule-form";
import { isActiveMarketingRenderStatus, resolveMarketingRenderState, type MarketingRenderState } from "@/lib/marketing/render-status";
import { CampaignVideoEditor, type CampaignEditorImage } from "@/components/marketing/campaign/editor/CampaignVideoEditor";
import { getSignedImageUrl } from "@/lib/storage";
import { useContentPreviews } from "@/lib/marketing/useContentPreviews";
import { MediaThumb, type MediaPreview } from "./ui/MarketingUi";
import {
  useCampaignRenderTracker,
  useTrackedCampaign,
} from "@/lib/marketing/useCampaignRenderTracker";

const STATUS_LABEL: Record<string, string> = {
  draft: "Rascunho",
  pending: "Em revisão",
  approved: "Aprovado",
  rejected: "Rejeitado",
};
const FORMAT_LABEL: Record<string, string> = { feed: "Feed", story: "Story", reel: "Reel", whatsapp_cta: "WhatsApp" };
const FILTER_LABEL: Record<string, string> = {
  draft: "Rascunhos",
  pending: "Em revisão",
  approved: "Aprovados",
  rejected: "Rejeitados",
  all: "Todos",
};

function isVideoContent(row: MarketingContentRow): boolean {
  // Conteúdos de vídeo pertencem a uma campanha (feed/story/reel) — o formato
  // whatsapp_cta é apenas texto e mantém o fluxo antigo.
  return !!row.campaign_id && row.format !== "whatsapp_cta";
}

function hasRenderedVideo(row: MarketingContentRow): boolean {
  return !!(row.feed_video_id || row.story_video_id);
}

function hasPendingRenderJob(row: MarketingContentRow): boolean {
  return (
    !hasRenderedVideo(row) &&
    !!(row.feed_render_job_id || row.story_render_job_id)
  );
}

interface Props {
  companyId: string;
  /** Etapa fixada pelo hub de Publicar; esconde os filtros internos. */
  forcedFilter?: "review" | "approved";
  /** Avisado depois de cada recarga, para o hub atualizar os contadores. */
  onChanged?: () => void;
}

type Filter = "all" | "draft" | "pending" | "approved" | "rejected";

export function MarketingApprovals({ companyId, forcedFilter, onChanged }: Props) {
  const [rows, setRows] = useState<MarketingContentRow[]>([]);
  const [renderStates, setRenderStates] = useState<Record<string, { feed: MarketingRenderState; story: MarketingRenderState }>>({});
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<Filter>("draft");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [scheduleFor, setScheduleFor] = useState<string | null>(null);
  const [scheduleAt, setScheduleAt] = useState("");
  const [scheduleChannel, setScheduleChannel] = useState<"instagram" | "facebook">(
    "instagram",
  );
  const [scheduleAtError, setScheduleAtError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // ----- Editor Visual do Vídeo -----
  const [editorCampaignId, setEditorCampaignId] = useState<string | null>(null);
  const [editorPreviewUrl, setEditorPreviewUrl] = useState<string | null>(null);
  const [editorLoading, setEditorLoading] = useState(false);
  const [editorImageSequence, setEditorImageSequence] = useState<CampaignEditorImage[]>([]);
  const [mediaIndex, setMediaIndex] = useState<Record<string, MarketingMediaRow>>({});
  const { trackCampaign, campaigns, refresh: refreshTracked } = useCampaignRenderTracker();
  // Guarda campanhas cujo render completou para auto-refresh.
  const seenDoneRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    let changed = false;
    for (const [cid, t] of Object.entries(campaigns)) {
      if (t.done && !seenDoneRef.current.has(cid)) {
        seenDoneRef.current.add(cid);
        changed = true;
      }
    }
    if (changed) {
      void refresh();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [campaigns]);

  async function ensureMediaIndex(): Promise<Record<string, MarketingMediaRow>> {
    if (Object.keys(mediaIndex).length > 0) return mediaIndex;
    try {
      const list = await apiListMedia();
      const idx: Record<string, MarketingMediaRow> = {};
      for (const m of list) idx[m.id] = m;
      setMediaIndex(idx);
      return idx;
    } catch {
      return {};
    }
  }

  async function openVideoEditor(row: MarketingContentRow) {
    if (!row.campaign_id) return;
    setEditorLoading(true);
    setEditorCampaignId(row.campaign_id);
    setEditorPreviewUrl(null);
    try {
      const idx = await ensureMediaIndex();
      const mediaId = row.primary_image_media_id ?? row.media_ids?.[0] ?? null;
      const media = mediaId ? idx[mediaId] : null;
      if (media?.storage_path) {
        const url = await urlForMarketingPath(media.storage_path).catch(() => null);
        setEditorPreviewUrl(url);
      }
      const prompt = row.ai_prompt && typeof row.ai_prompt === "object" && !Array.isArray(row.ai_prompt) ? row.ai_prompt as { image_sequence?: unknown; focal_point?: { x: number; y: number; zoom?: number } | null } : {};
      const sequence: CampaignEditorImage[] = [];
      const rawSequence = Array.isArray(prompt.image_sequence) ? prompt.image_sequence : [];
      for (const [index, item] of rawSequence.entries()) {
        if (!item || typeof item !== "object") continue;
        const entry = item as Record<string, unknown>;
        const fp = entry.focal_point && typeof entry.focal_point === "object" ? entry.focal_point as CampaignEditorImage["focalPoint"] : null;
        if (entry.source === "marketing_media" && typeof entry.image_id === "string") {
          const source = idx[entry.image_id];
          sequence.push({ key: `marketing:${entry.image_id}`, origin: "marketing", mediaId: entry.image_id, previewUrl: source?.storage_path ? await urlForMarketingPath(source.storage_path).catch(() => null) : null, focalPoint: fp });
        } else if (entry.source === "product_image" && typeof entry.product_id === "string" && typeof entry.product_image_path === "string") {
          sequence.push({ key: `product:${entry.product_id}:${index}`, origin: "product", productId: entry.product_id, imagePath: entry.product_image_path, previewUrl: await getSignedImageUrl(entry.product_image_path).catch(() => null), focalPoint: fp });
        }
      }
      if (sequence.length === 0 && mediaId && mediaId === row.primary_image_media_id) {
        const fp = prompt.focal_point ? { x: prompt.focal_point.x, y: prompt.focal_point.y, zoom: prompt.focal_point.zoom ?? 1 } : null;
        sequence.push({ key: `marketing:${mediaId}`, origin: "marketing", mediaId, previewUrl: media?.storage_path ? await urlForMarketingPath(media.storage_path).catch(() => null) : null, focalPoint: fp });
      }
      setEditorImageSequence(sequence);
    } finally {
      setEditorLoading(false);
    }
  }

  function closeVideoEditor() {
    setEditorCampaignId(null);
    setEditorPreviewUrl(null);
    setEditorImageSequence([]);
  }

  const editorContents = useMemo(
    () => (editorCampaignId ? rows.filter((r) => r.campaign_id === editorCampaignId) : []),
    [rows, editorCampaignId],
  );
  const editorFocalPoint = useMemo(() => {
    const first = editorImageSequence[0]?.focalPoint;
    if (first) return first;
    const feed = editorContents.find((r) => r.campaign_role === "feed") ?? editorContents[0];
    const prompt = feed && typeof feed.ai_prompt === "object" && feed.ai_prompt !== null ? feed.ai_prompt as { focal_point?: { x: number; y: number; zoom?: number } | null } : null;
    return prompt?.focal_point ? { x: prompt.focal_point.x, y: prompt.focal_point.y, zoom: prompt.focal_point.zoom ?? 1 } : null;
  }, [editorContents, editorImageSequence]);
  const [fbReadiness, setFbReadiness] = useState<
    | null
    | {
        ok: boolean;
        code: string;
        message: string;
        hasPagesManagePosts: boolean;
        integrationChannel: string | null;
        pageId: string | null;
      }
  >(null);
  const [fbReadinessLoading, setFbReadinessLoading] = useState(false);

  async function refreshFbReadiness() {
    setFbReadinessLoading(true);
    try {
      const r = await apiFacebookPublishReadiness();
      setFbReadiness(r as typeof fbReadiness);
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn("[marketing] fb readiness fetch failed", e);
      setFbReadiness(null);
    } finally {
      setFbReadinessLoading(false);
    }
  }
  useEffect(() => {
    void refreshFbReadiness();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyId]);

  async function refreshRenderStates(nextRows: MarketingContentRow[]) {
    const campaignIds = Array.from(new Set(nextRows.filter((row) => isVideoContent(row) && hasPendingRenderJob(row)).map((row) => row.campaign_id).filter((id): id is string => Boolean(id))));
    const entries = await Promise.all(campaignIds.map(async (campaignId) => {
      try {
        const status = await apiGetCampaignRenderStatus(campaignId);
        return [campaignId, {
          feed: resolveMarketingRenderState({ role: status.feed, jobId: status.feed.job_id, videoId: status.feed.video_id }),
          story: resolveMarketingRenderState({ role: status.story, jobId: status.story.job_id, videoId: status.story.video_id }),
        }] as const;
      } catch {
        return null;
      }
    }));
    const next: Record<string, { feed: MarketingRenderState; story: MarketingRenderState }> = {};
    for (const entry of entries) {
      if (entry) next[entry[0]] = entry[1];
    }
    setRenderStates(next);
  }

  // Renders iniciados em outra sessão não passam pelo tracker; sem isto o
  // card ficaria em "Gerando vídeo…" até o usuário atualizar a tela.
  const hasActiveRender = Object.values(renderStates).some(
    (state) => isActiveMarketingRenderStatus(state.feed.status) || isActiveMarketingRenderStatus(state.story.status),
  );
  useEffect(() => {
    if (!hasActiveRender) return;
    const id = window.setInterval(() => {
      if (document.visibilityState !== "visible") return;
      void apiListContents()
        .then(async (nextRows) => {
          setRows(nextRows);
          await refreshRenderStates(nextRows);
        })
        .catch(() => {});
    }, 8000);
    return () => window.clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasActiveRender]);

  async function refresh() {
    setLoading(true);
    try {
      const nextRows = await apiListContents();
      setRows(nextRows);
      onChanged?.();
      await refreshRenderStates(nextRows);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao carregar conteúdos.");
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyId]);

  const filtered = useMemo(
    () => {
      if (forcedFilter === "review") {
        // Rascunhos e em revisão primeiro; rejeitados ficam no fim, para reenviar.
        const order = { draft: 0, pending: 0, rejected: 1 } as Record<string, number>;
        return rows.filter((r) => r.status in order).sort((a, b) => order[a.status] - order[b.status]);
      }
      if (forcedFilter === "approved") return rows.filter((r) => r.status === "approved");
      return filter === "all" ? rows : rows.filter((r) => r.status === filter);
    },
    [rows, filter, forcedFilter],
  );
  const previews = useContentPreviews(companyId, filtered);

  async function saveEdit(row: MarketingContentRow, patch: { body: string; title: string | null; hashtags: string[]; cta_text: string | null; cta_destination: string | null }) {
    setBusy(true);
    try {
      await apiUpdateContent({ id: row.id, ...patch });
      toast.success("Conteúdo atualizado.");
      setEditingId(null);
      await refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao salvar.");
    } finally {
      setBusy(false);
    }
  }

  async function setStatus(row: MarketingContentRow, status: "approved" | "rejected" | "pending", reason?: string) {
    setBusy(true);
    try {
      await apiSetContentStatus({ id: row.id, status, rejection_reason: reason ?? null });
      toast.success(`Conteúdo marcado como ${status}.`);
      await refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao alterar status.");
    } finally {
      setBusy(false);
    }
  }

  async function publishNow(row: MarketingContentRow) {
    if (row.status !== "approved") {
      toast.error("Aprove o conteúdo antes de publicar.");
      return;
    }
    const channel = row.channel === "facebook" ? "facebook" : "instagram";
    setBusy(true);
    try {
      await apiScheduleContent({
        content_id: row.id,
        channel,
        scheduled_at: new Date(Date.now() + 1000).toISOString(),
      });
      toast.success("Publicação enfileirada. Aguardando confirmação do canal.");
      await refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao enfileirar publicação.");
    } finally {
      setBusy(false);
    }
  }

  async function retryRender(row: MarketingContentRow) {
    if (!row.campaign_id) return;
    setBusy(true);
    try {
      await apiRetryCampaignRender({
        campaign_id: row.campaign_id,
        role: row.campaign_role === "story" ? "story" : "feed",
      });
      trackCampaign(row.campaign_id);
      await refreshTracked(row.campaign_id);
      toast.info("Renderização reenfileirada.");
      await refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível tentar novamente.");
    } finally {
      setBusy(false);
    }
  }

  function openSchedule(row: MarketingContentRow) {
    if (row.status !== "approved") {
      toast.error("Apenas conteúdos aprovados podem ser agendados.");
      return;
    }
    // Sempre resetar estado ao abrir para evitar `busy` preso de operação anterior.
    setBusy(false);
    setScheduleFor(row.id);
    setScheduleChannel(row.channel === "facebook" ? "facebook" : "instagram");
    setScheduleAt("");
    setScheduleAtError(null);
  }

  function closeSchedule() {
    setScheduleFor(null);
    setScheduleAt("");
    setScheduleAtError(null);
    setBusy(false);
  }

  async function schedule() {
    const target = scheduleFor ? rows.find((r) => r.id === scheduleFor) : null;
    const marketingCount = Array.isArray(target?.media_ids) ? target!.media_ids.length : 0;
    const promptObj =
      target && target.ai_prompt && typeof target.ai_prompt === "object"
        ? (target.ai_prompt as { product_media_refs?: unknown })
        : null;
    const productRefsCount = Array.isArray(promptObj?.product_media_refs)
      ? (promptObj!.product_media_refs as unknown[]).length
      : 0;
    const mediaCount = marketingCount + productRefsCount;
    const result = validateScheduleForm({
      scheduleFor,
      scheduleAt,
      channel: scheduleChannel,
      mediaCount,
    });

    if (!result.ok) {
      for (const err of result.errors) {
        if (err.field === "scheduleAt") setScheduleAtError(err.message);
        toast.error(err.message);
      }
      if (import.meta.env.DEV) {
        // eslint-disable-next-line no-console
        console.warn("[marketing/schedule] validation failed", {
          scheduleFor,
          scheduleAt,
          channel: scheduleChannel,
          mediaCount,
          errors: result.errors.map((e) => ({ field: e.field, message: e.message })),
        });
      }
      return;
    }

    if (result.channel === "facebook" && fbReadiness && !fbReadiness.ok) {
      toast.error(fbReadiness.message);
      return;
    }

    if (import.meta.env.DEV) {
      // eslint-disable-next-line no-console
      console.info("[marketing/schedule] submitting", {
        scheduleFor: result.scheduleFor,
        scheduleAt,
        iso: result.iso,
        channel: result.channel,
      });
    }

    setScheduleAtError(null);
    setBusy(true);
    try {
      await apiScheduleContent({
        content_id: result.scheduleFor,
        channel: result.channel,
        scheduled_at: result.iso,
      });
      toast.success("Conteúdo agendado.");
      closeSchedule();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao agendar.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className={forcedFilter ? "hidden" : "flex flex-wrap items-center gap-2"}>
        {!forcedFilter && (["draft", "pending", "approved", "rejected", "all"] as Filter[]).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`px-3 py-1.5 rounded-md text-xs font-medium border ${
              filter === f ? "bg-primary text-primary-foreground border-primary" : "bg-background"
            }`}
          >
            {FILTER_LABEL[f]}
          </button>
        ))}
        {!forcedFilter && (
          <Button variant="ghost" size="sm" onClick={() => void refresh()} className="ml-auto">
            Recarregar
          </Button>
        )}
      </div>

      {fbReadiness && !fbReadiness.ok ? (
        <details role="alert" className="group rounded-xl border border-amber-500/40 bg-amber-500/10 text-sm text-amber-900 dark:text-amber-100">
          <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2 [&::-webkit-details-marker]:hidden">
            <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" aria-hidden />
            <span className="min-w-0 flex-1 truncate font-medium">Facebook não está pronto para publicar</span>
            <Button
              size="sm"
              variant="outline"
              className="h-7 shrink-0 rounded-full px-3 text-xs"
              onClick={(e) => {
                e.preventDefault();
                openSettings("conexoes");
              }}
            >
              <RefreshCw className="h-3 w-3 mr-1" /> Reconectar
            </Button>
          </summary>
          <div className="space-y-1 px-3 pb-3 text-xs">
            <div className="leading-relaxed">{fbReadiness.message}</div>
            <div className="text-[11px] text-muted-foreground">
              Código: <code>{fbReadiness.code}</code>
              {fbReadiness.integrationChannel ? ` · integração: ${fbReadiness.integrationChannel}` : ""}
              {fbReadiness.pageId ? ` · page_id: ${fbReadiness.pageId}` : ""}
            </div>
          </div>
        </details>
      ) : null}

      {loading ? (
        <div className="text-sm text-muted-foreground flex items-center gap-2">
          <Loader2 className="h-4 w-4 animate-spin" /> Carregando…
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
          {forcedFilter === "review" ? "Nada para revisar. Crie uma publicação para começar." : forcedFilter === "approved" ? "Nenhuma publicação aprovada aguardando agendamento." : "Nenhum conteúdo para este filtro."}
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map((c) => (
            <ContentCard
              key={c.id}
              row={c}
              editing={editingId === c.id}
              onEdit={() => setEditingId(c.id)}
              onCancelEdit={() => setEditingId(null)}
              onSave={(p) => void saveEdit(c, p)}
              onApprove={() => void setStatus(c, "approved")}
              onReject={() => {
                const reason = prompt("Motivo da rejeição (opcional):") ?? undefined;
                void setStatus(c, "rejected", reason);
              }}
              onMarkPending={() => void setStatus(c, "pending")}
              onSchedule={() => openSchedule(c)}
              onPublishNow={() => void publishNow(c)}
              preview={previews[c.id] ?? null}
              renderState={c.campaign_id ? renderStates[c.campaign_id]?.[c.campaign_role === "story" ? "story" : "feed"] ?? null : null}
              onRetryRender={() => void retryRender(c)}
              onOpenVideoEditor={() => void openVideoEditor(c)}
              onViewVideo={async () => {
                const idx = await ensureMediaIndex();
                const vid = c.feed_video_id || c.story_video_id;
                const media = vid ? idx[vid] : null;
                if (!media?.storage_path) {
                  toast.error("Vídeo ainda não disponível.");
                  return;
                }
                const url = await urlForMarketingPath(media.storage_path).catch(() => null);
                if (url) window.open(url, "_blank", "noopener");
                else toast.error("Não foi possível abrir o vídeo.");
              }}
              tracked={c.campaign_id ? campaigns[c.campaign_id] ?? null : null}
              busy={busy}
            />
          ))}
        </div>
      )}

      {scheduleFor && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-md rounded-lg bg-card border p-4 space-y-3">
            <div className="font-semibold">Agendar conteúdo</div>
            <div>
              <Label>Canal</Label>
              <select
                className="w-full h-9 rounded-md border bg-background px-2 text-sm"
                value={scheduleChannel}
                onChange={(e) => setScheduleChannel(e.target.value as typeof scheduleChannel)}
              >
                <option value="instagram">Instagram</option>
                <option value="facebook">Facebook</option>

              </select>
            </div>
            <div>
              <Label htmlFor="schedule-at-input">Data e hora</Label>
              <Input
                id="schedule-at-input"
                type="datetime-local"
                value={scheduleAt}
                aria-invalid={scheduleAtError ? true : undefined}
                aria-describedby={scheduleAtError ? "schedule-at-error" : undefined}
                className={
                  scheduleAtError
                    ? "border-destructive focus-visible:ring-destructive"
                    : undefined
                }
                onChange={(e) => {
                  setScheduleAt(e.target.value);
                  if (scheduleAtError) setScheduleAtError(null);
                }}
              />
              {scheduleAtError && (
                <p id="schedule-at-error" className="mt-1 text-xs text-destructive">
                  {scheduleAtError}
                </p>
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              Depois de agendado, o conteúdo entra na fila de publicação automática quando o canal estiver conectado.
            </p>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={closeSchedule} disabled={busy}>
                Cancelar
              </Button>
              <Button
                onClick={() => void schedule()}
                disabled={busy}
                aria-disabled={busy}
                className={busy ? "cursor-not-allowed opacity-70" : undefined}
              >
                {busy && <Loader2 className="h-4 w-4 animate-spin mr-1" />}
                {busy ? "Agendando…" : "Agendar"}
              </Button>
            </div>
          </div>
        </div>
      )}

      <Dialog
        open={!!editorCampaignId}
        onOpenChange={(o) => {
          if (!o) closeVideoEditor();
        }}
      >
        <DialogContent className="max-w-6xl w-[96vw] max-h-[92vh] overflow-y-auto p-4">
          <DialogHeader>
            <DialogTitle>Editor Visual do Vídeo IA</DialogTitle>
          </DialogHeader>
          {editorLoading ? (
            <div className="p-8 text-sm text-muted-foreground flex items-center gap-2">
              <Loader2 className="h-4 w-4 animate-spin" /> Carregando editor…
            </div>
          ) : editorCampaignId && editorContents.length > 0 ? (
            <CampaignVideoEditor
              campaignId={editorCampaignId}
              contents={editorContents}
              previewImageUrl={editorPreviewUrl}
              focalPoint={editorFocalPoint}
              imageSequence={editorImageSequence}
              onImageSequenceChange={setEditorImageSequence}
              onContentsUpdated={(fresh) => {
                setRows((cur) => {
                  const map = new Map(fresh.map((r) => [r.id, r]));
                  return cur.map((r) => map.get(r.id) ?? r);
                });
              }}
              onApproved={() => {
                if (editorCampaignId) trackCampaign(editorCampaignId);
                closeVideoEditor();
                void refresh();
              }}
            />
          ) : (
            <div className="p-6 text-sm text-muted-foreground">
              Campanha não encontrada.
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function ContentCard({
  row,
  editing,
  onEdit,
  onCancelEdit,
  onSave,
  onApprove,
  onReject,
  onMarkPending,
  onSchedule,
  onPublishNow,
  onOpenVideoEditor,
  onViewVideo,
  tracked,
  renderState,
  onRetryRender,
  preview,
  busy,
}: {
  row: MarketingContentRow;
  editing: boolean;
  onEdit: () => void;
  onCancelEdit: () => void;
  onSave: (p: { body: string; title: string | null; hashtags: string[]; cta_text: string | null; cta_destination: string | null }) => void;
  onApprove: () => void;
  onReject: () => void;
  onMarkPending: () => void;
  onSchedule: () => void;
  onPublishNow: () => void;
  onOpenVideoEditor: () => void;
  onViewVideo: () => void;
  tracked: import("@/lib/marketing/useCampaignRenderTracker").TrackedCampaign | null;
  renderState: MarketingRenderState | null;
  onRetryRender: () => void;
  preview: MediaPreview | null;
  busy: boolean;
}) {
  const [title, setTitle] = useState(row.title ?? "");
  const [body, setBody] = useState(row.body);
  const [hashtags, setHashtags] = useState((row.hashtags ?? []).join(" "));
  const [cta, setCta] = useState(row.cta_text ?? "");
  const [dest, setDest] = useState(row.cta_destination ?? "");

  const statusColor: Record<string, string> = {
    draft: "bg-muted text-foreground",
    pending: "bg-yellow-500/20 text-yellow-700 dark:text-yellow-300",
    approved: "bg-emerald-500/20 text-emerald-700 dark:text-emerald-300",
    rejected: "bg-destructive/20 text-destructive",
    archived: "bg-muted text-muted-foreground",
  };

  const isVideo = isVideoContent(row);
  const videoReady = hasRenderedVideo(row);
  const isRendering = isVideo && !videoReady && !!renderState && isActiveMarketingRenderStatus(renderState.status);
  const renderFailed = isVideo && !videoReady && !!renderState && ["failed", "cancelled", "missing"].includes(renderState.status);
  const renderCompletedWithoutVideo = isVideo && !videoReady && renderState?.status === "completed";
  const trackerProgress = renderState?.progress ?? (tracked ? Math.max(tracked.feed.progress ?? 0, tracked.story.progress ?? 0) : null);

  return (
    <div data-testid="content-card" className="grid min-w-0 grid-cols-[96px_minmax(0,1fr)] gap-3 rounded-2xl border bg-card p-3 sm:grid-cols-[150px_minmax(0,1fr)]">
      <MediaThumb preview={preview} alt="" className={`w-full self-start ${row.format === "story" ? "aspect-[3/4]" : "aspect-[4/5]"}`} />
      <div className="min-w-0 space-y-2">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="rounded-full bg-muted px-2 py-0.5 font-semibold">
          {FORMAT_LABEL[row.format] ?? row.format}
          {isVideo ? " · vídeo" : ""}
        </span>
        <span className={`rounded-full px-2 py-0.5 font-semibold ${statusColor[row.status] ?? ""}`}>
          {STATUS_LABEL[row.status] ?? row.status}
        </span>
      </div>

      {editing ? (
        <div className="space-y-2">
          <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Título" />
          <Textarea value={body} onChange={(e) => setBody(e.target.value)} rows={5} />
          <Input
            value={hashtags}
            onChange={(e) => setHashtags(e.target.value)}
            placeholder="hashtags separadas por espaço"
          />
          {row.format === "whatsapp_cta" && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              <Input value={cta} onChange={(e) => setCta(e.target.value)} placeholder="CTA" />
              <Input
                value={dest}
                onChange={(e) => setDest(e.target.value)}
                placeholder="Destino WhatsApp"
              />
            </div>
          )}
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={onCancelEdit} disabled={busy}>
              Cancelar
            </Button>
            <Button
              onClick={() =>
                onSave({
                  title: title.trim() || null,
                  body: body.trim(),
                  hashtags: hashtags
                    .split(/\s+/)
                    .map((h) => h.replace(/^#+/, "").trim())
                    .filter(Boolean),
                  cta_text: cta.trim() || null,
                  cta_destination: dest.trim() || null,
                })
              }
              disabled={busy}
            >
              Salvar
            </Button>
          </div>
        </div>
      ) : (
        <>
          {row.title && <div className="truncate text-sm font-semibold">{row.title}</div>}
          <p className="line-clamp-3 whitespace-pre-wrap text-sm text-muted-foreground">{row.body}</p>

          {isVideo && isRendering && (
            <div className="rounded-md border border-dashed bg-muted/40 p-2 text-xs flex items-center gap-2">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              <span className="flex-1">
                {renderState?.status === "queued" ? "Na fila para gerar vídeo…" : "Gerando vídeo…"}
                {typeof trackerProgress === "number" && trackerProgress > 0 ? ` ${Math.round(trackerProgress)}%` : ""}
              </span>
            </div>
          )}

          {renderFailed && (
            <div role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 p-2 text-xs flex items-center gap-2">
              <AlertTriangle className="h-3.5 w-3.5 text-destructive shrink-0" />
              <span className="flex-1">
                {renderState?.status === "failed" ? `Render falhou${renderState.errorCode ? `: ${renderState.errorCode}` : "."}` : renderState?.status === "cancelled" ? "Render cancelado." : "Job de render não encontrado."}
              </span>
              <Button size="sm" variant="outline" onClick={onRetryRender} disabled={busy}>Tentar novamente</Button>
            </div>
          )}

          {renderCompletedWithoutVideo && (
            <div role="status" className="rounded-md border border-amber-500/40 bg-amber-500/10 p-2 text-xs flex items-center gap-2">
              <AlertTriangle className="h-3.5 w-3.5 text-amber-600 shrink-0" />
              <span>Render concluído, mas o vídeo não foi vinculado a este conteúdo.</span>
            </div>
          )}

          <div className="flex items-center justify-end gap-2" data-testid="card-actions">
            {isVideo && !videoReady ? (
              <Button size="sm" className="rounded-full" onClick={onOpenVideoEditor} disabled={isRendering} title={isRendering ? "Aguarde a renderização terminar" : undefined}>
                <Film className="h-4 w-4 mr-1" /> Editar vídeo
              </Button>
            ) : row.status === "approved" ? (
              <>
                <Button size="sm" variant="outline" className="rounded-full" onClick={onPublishNow} disabled={busy}>
                  <Send className="h-4 w-4 mr-1" /> Publicar agora
                </Button>
                <Button size="sm" className="rounded-full" onClick={onSchedule} disabled={busy}>
                  <Calendar className="h-4 w-4 mr-1" /> Agendar
                </Button>
              </>
            ) : row.status === "rejected" ? (
              <Button size="sm" className="rounded-full" onClick={onMarkPending} disabled={busy}>
                <Send className="h-4 w-4 mr-1" /> Enviar para revisão
              </Button>
            ) : (
              <Button size="sm" className="rounded-full" onClick={onApprove} disabled={busy}>
                <CheckCircle2 className="h-4 w-4 mr-1" /> Aprovar
              </Button>
            )}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="icon" variant="ghost" className="h-8 w-8 rounded-full" aria-label="Mais ações">
                  <MoreHorizontal className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {isVideo && videoReady && <DropdownMenuItem onSelect={onViewVideo}><Play className="h-4 w-4 mr-2" /> Ver vídeo</DropdownMenuItem>}
                {isVideo && videoReady && <DropdownMenuItem onSelect={onOpenVideoEditor} disabled={isRendering}><Film className="h-4 w-4 mr-2" /> Editar vídeo de novo</DropdownMenuItem>}
                {!isVideo && <DropdownMenuItem onSelect={onEdit}>Editar texto</DropdownMenuItem>}
                {row.status === "draft" && <DropdownMenuItem onSelect={onMarkPending} disabled={busy}><Send className="h-4 w-4 mr-2" /> Enviar para revisão</DropdownMenuItem>}
                {row.status !== "rejected" && <DropdownMenuItem onSelect={onReject} disabled={busy} className="text-destructive"><XCircle className="h-4 w-4 mr-2" /> Rejeitar</DropdownMenuItem>}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
          {row.rejection_reason && (
            <div className="text-xs text-destructive">Motivo: {row.rejection_reason}</div>
          )}
        </>
      )}
      </div>
    </div>
  );
}
