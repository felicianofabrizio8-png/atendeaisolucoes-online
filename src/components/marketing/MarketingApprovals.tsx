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
} from "lucide-react";
import { toast } from "sonner";
import {
  apiListContents,
  apiListMedia,
  apiUpdateContent,
  apiSetContentStatus,
  apiScheduleContent,
  apiFacebookPublishReadiness,
  urlForMarketingPath,
} from "@/data/marketingRepo";
import type {
  MarketingContentRow,
  MarketingMediaRow,
} from "@/lib/marketing/marketing.types";
import { validateScheduleForm } from "@/lib/marketing/schedule-form";
import { CampaignVideoEditor } from "@/components/marketing/campaign/editor/CampaignVideoEditor";
import {
  useCampaignRenderTracker,
  useTrackedCampaign,
} from "@/lib/marketing/useCampaignRenderTracker";

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
}

type Filter = "all" | "draft" | "pending" | "approved" | "rejected";

export function MarketingApprovals({ companyId }: Props) {
  const [rows, setRows] = useState<MarketingContentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<Filter>("draft");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [scheduleFor, setScheduleFor] = useState<string | null>(null);
  const [scheduleAt, setScheduleAt] = useState("");
  const [scheduleChannel, setScheduleChannel] = useState<"instagram" | "facebook" | "whatsapp">(
    "instagram",
  );
  const [scheduleAtError, setScheduleAtError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // ----- Editor Visual do Vídeo -----
  const [editorCampaignId, setEditorCampaignId] = useState<string | null>(null);
  const [editorPreviewUrl, setEditorPreviewUrl] = useState<string | null>(null);
  const [editorLoading, setEditorLoading] = useState(false);
  const [mediaIndex, setMediaIndex] = useState<Record<string, MarketingMediaRow>>({});
  const { trackCampaign, campaigns } = useCampaignRenderTracker();
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
    } finally {
      setEditorLoading(false);
    }
  }

  function closeVideoEditor() {
    setEditorCampaignId(null);
    setEditorPreviewUrl(null);
  }

  const editorContents = useMemo(
    () => (editorCampaignId ? rows.filter((r) => r.campaign_id === editorCampaignId) : []),
    [rows, editorCampaignId],
  );
  const editorFocalPoint = useMemo(() => {
    const feed = editorContents.find((r) => r.campaign_role === "feed") ?? editorContents[0];
    const prompt =
      feed && typeof feed.ai_prompt === "object" && feed.ai_prompt !== null
        ? (feed.ai_prompt as { focal_point?: { x: number; y: number } | null })
        : null;
    return prompt?.focal_point ?? null;
  }, [editorContents]);
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

  async function refresh() {
    setLoading(true);
    try {
      setRows(await apiListContents());
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
    () => (filter === "all" ? rows : rows.filter((r) => r.status === filter)),
    [rows, filter],
  );

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

  function openSchedule(row: MarketingContentRow) {
    if (row.status !== "approved") {
      toast.error("Apenas conteúdos aprovados podem ser agendados.");
      return;
    }
    // Sempre resetar estado ao abrir para evitar `busy` preso de operação anterior.
    setBusy(false);
    setScheduleFor(row.id);
    setScheduleChannel(row.channel);
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
      <div className="flex items-center gap-2">
        {(["draft", "pending", "approved", "rejected", "all"] as Filter[]).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`px-3 py-1.5 rounded-md text-xs font-medium border ${
              filter === f ? "bg-primary text-primary-foreground border-primary" : "bg-background"
            }`}
          >
            {f === "all" ? "Todos" : f}
          </button>
        ))}
        <Button variant="ghost" size="sm" onClick={() => void refresh()} className="ml-auto">
          Recarregar
        </Button>
      </div>

      {fbReadiness && !fbReadiness.ok ? (
        <div
          role="alert"
          className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-900 dark:text-amber-100 flex items-start gap-3"
        >
          <AlertTriangle className="h-5 w-5 shrink-0 text-amber-600 dark:text-amber-400" aria-hidden />
          <div className="flex-1 space-y-1">
            <div className="font-semibold">Publicação no Facebook bloqueada</div>
            <div className="text-xs leading-relaxed">{fbReadiness.message}</div>
            <div className="text-[11px] text-muted-foreground">
              Código: <code>{fbReadiness.code}</code>
              {fbReadiness.integrationChannel ? ` · integração: ${fbReadiness.integrationChannel}` : ""}
              {fbReadiness.pageId ? ` · page_id: ${fbReadiness.pageId}` : ""}
            </div>
          </div>
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              window.location.href = "/configuracoes#meta";
            }}
          >
            <RefreshCw className="h-3.5 w-3.5 mr-1" /> Reconectar Meta
          </Button>
        </div>
      ) : null}



      {loading ? (
        <div className="text-sm text-muted-foreground flex items-center gap-2">
          <Loader2 className="h-4 w-4 animate-spin" /> Carregando…
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
          Nenhum conteúdo para este filtro.
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
                <option value="whatsapp">WhatsApp</option>
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
              Este agendamento é apenas planejamento. Publicação automática não faz parte da Fase 1.
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
  onOpenVideoEditor,
  onViewVideo,
  tracked,
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
  onOpenVideoEditor: () => void;
  onViewVideo: () => void;
  tracked: import("@/lib/marketing/useCampaignRenderTracker").TrackedCampaign | null;
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
  // Considera "renderizando" também o estado global do tracker (recém-aprovado).
  const trackerRendering =
    !!tracked && !tracked.done && (tracked.feed.status !== "idle" || tracked.story.status !== "idle");
  const isRendering = isVideo && !videoReady && (hasPendingRenderJob(row) || trackerRendering);
  const trackerProgress = tracked
    ? Math.max(tracked.feed.progress ?? 0, tracked.story.progress ?? 0)
    : null;

  return (
    <div className="rounded-lg border bg-card p-3 space-y-2">
      <div className="flex items-center gap-2 text-xs">
        <span className="uppercase font-semibold rounded bg-primary/10 text-primary px-1.5 py-0.5">
          {row.format}
        </span>
        <span className="uppercase text-[10px] text-muted-foreground">{row.channel}</span>
        <span className={`rounded px-1.5 py-0.5 uppercase text-[10px] font-semibold ${statusColor[row.status] ?? ""}`}>
          {row.status}
        </span>
        {isVideo && (
          <span className="uppercase text-[10px] rounded bg-fuchsia-500/15 text-fuchsia-700 dark:text-fuchsia-300 px-1.5 py-0.5">
            vídeo
          </span>
        )}
        {row.ai_model && (
          <span className="text-[10px] text-muted-foreground ml-auto">{row.ai_model}</span>
        )}
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
          {row.title && <div className="font-medium text-sm">{row.title}</div>}
          {isVideo && (row.overlay_headline || row.overlay_subheadline) ? (
            <div className="text-xs text-muted-foreground">
              <span className="font-medium text-foreground">Overlay:</span>{" "}
              {row.overlay_headline}
              {row.overlay_subheadline ? ` — ${row.overlay_subheadline}` : ""}
              {row.overlay_cta ? ` · ${row.overlay_cta}` : ""}
            </div>
          ) : null}
          <div className="text-sm whitespace-pre-wrap">{row.body}</div>
          {row.hashtags?.length ? (
            <div className="text-xs text-muted-foreground">
              {row.hashtags.map((h) => `#${h.replace(/^#+/, "")}`).join(" ")}
            </div>
          ) : null}
          {row.cta_text && (
            <div className="text-xs">
              <strong>CTA:</strong> {row.cta_text}
              {row.cta_destination ? ` → ${row.cta_destination}` : ""}
            </div>
          )}

          {isVideo && isRendering && (
            <div className="rounded-md border border-dashed bg-muted/40 p-2 text-xs flex items-center gap-2">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              <span className="flex-1">
                Gerando vídeo…
                {typeof trackerProgress === "number" && trackerProgress > 0
                  ? ` ${Math.round(trackerProgress)}%`
                  : ""}
              </span>
            </div>
          )}

          <div className="flex flex-wrap gap-2 justify-end">
            {/* Ações específicas de vídeo */}
            {isVideo ? (
              <>
                {videoReady && (
                  <Button size="sm" variant="outline" onClick={onViewVideo}>
                    <Play className="h-4 w-4 mr-1" /> Visualizar vídeo
                  </Button>
                )}
                <Button
                  size="sm"
                  variant={videoReady ? "ghost" : "default"}
                  onClick={onOpenVideoEditor}
                  disabled={isRendering}
                  title={
                    isRendering
                      ? "Aguarde a renderização terminar"
                      : "Abrir Editor Visual do Vídeo IA"
                  }
                >
                  <Film className="h-4 w-4 mr-1" />
                  {videoReady ? "Editar novamente" : "Editar vídeo"}
                </Button>
                {/* Aprovar só faz sentido depois do vídeo renderizado */}
                {videoReady && row.status !== "approved" && (
                  <Button size="sm" variant="outline" onClick={onApprove} disabled={busy}>
                    <CheckCircle2 className="h-4 w-4 mr-1" /> Aprovar
                  </Button>
                )}
              </>
            ) : (
              <>
                <Button size="sm" variant="ghost" onClick={onEdit}>
                  Editar
                </Button>
                {row.status !== "approved" && (
                  <Button size="sm" variant="outline" onClick={onApprove} disabled={busy}>
                    <CheckCircle2 className="h-4 w-4 mr-1" /> Aprovar
                  </Button>
                )}
              </>
            )}

            {row.status !== "rejected" && (
              <Button size="sm" variant="outline" onClick={onReject} disabled={busy}>
                <XCircle className="h-4 w-4 mr-1" /> Rejeitar
              </Button>
            )}
            {row.status === "draft" && (
              <Button size="sm" variant="outline" onClick={onMarkPending} disabled={busy}>
                <Send className="h-4 w-4 mr-1" /> Enviar p/ revisão
              </Button>
            )}
            {row.status === "approved" && (
              <Button size="sm" onClick={onSchedule} disabled={busy}>
                <Calendar className="h-4 w-4 mr-1" /> Agendar
              </Button>
            )}
          </div>
          {row.rejection_reason && (
            <div className="text-xs text-destructive">Motivo: {row.rejection_reason}</div>
          )}
        </>
      )}
    </div>
  );
}
