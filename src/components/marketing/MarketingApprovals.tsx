import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { CheckCircle2, XCircle, Loader2, Send, Calendar, AlertTriangle, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import {
  apiListContents,
  apiUpdateContent,
  apiSetContentStatus,
  apiScheduleContent,
  apiFacebookPublishReadiness,
} from "@/data/marketingRepo";
import type { MarketingContentRow } from "@/lib/marketing/marketing.types";
import { validateScheduleForm } from "@/lib/marketing/schedule-form";

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
          <div className="flex flex-wrap gap-2 justify-end">
            <Button size="sm" variant="ghost" onClick={onEdit}>
              Editar
            </Button>
            {row.status !== "approved" && (
              <Button size="sm" variant="outline" onClick={onApprove} disabled={busy}>
                <CheckCircle2 className="h-4 w-4 mr-1" /> Aprovar
              </Button>
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
