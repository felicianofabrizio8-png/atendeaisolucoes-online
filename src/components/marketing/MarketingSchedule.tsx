import { LumePulse } from "./MarketingMotion";
import { useEffect, useMemo, useState } from "react";
import { MarketingArtwork } from "./MarketingArtwork";
import { Button } from "@/components/ui/button";
import { X } from "lucide-react";
import { lumeToast as toast } from "./MarketingFeedback";
import {
  apiListPublishSchedule,
  apiListPublishContents,
  apiCancelSchedule,
} from "@/data/marketingRepo";
import type { MarketingScheduleRow, MarketingContentRow } from "@/lib/marketing/marketing.types";

import { useContentPreviews } from "@/lib/marketing/useContentPreviews";
import { MediaThumb } from "./ui/MarketingUi";

interface Props {
  companyId: string;
  /** Só o que ainda vai sair (agendada, na fila ou publicando). */
  upcomingOnly?: boolean;
}

const SCHEDULE_STATUS: Record<string, string> = {
  planned: "Agendada",
  queued: "Na fila",
  publishing: "Publicando",
  published: "Publicada",
  failed: "Com problema",
  cancelled: "Cancelada",
};
const FORMAT_LABEL: Record<string, string> = {
  feed: "Feed",
  story: "Story",
  reel: "Reel",
  whatsapp_cta: "WhatsApp",
  carousel: "Carrossel",
};
const CHANNEL_LABEL: Record<string, string> = {
  instagram: "Instagram",
  facebook: "Facebook",
  whatsapp: "WhatsApp",
};

export function MarketingSchedule({ companyId, upcomingOnly = false }: Props) {
  const [schedule, setSchedule] = useState<MarketingScheduleRow[]>([]);
  const [contents, setContents] = useState<Record<string, MarketingContentRow>>({});
  const [loading, setLoading] = useState(true);

  async function refresh() {
    setLoading(true);
    try {
      const [sched, conts] = await Promise.all([
        apiListPublishSchedule(),
        apiListPublishContents(),
      ]);
      setSchedule(sched);
      setContents(Object.fromEntries(conts.map((c) => [c.id, c])));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao carregar agenda.");
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyId]);

  const grouped = useMemo(() => {
    const map = new Map<string, MarketingScheduleRow[]>();
    for (const s of schedule) {
      if (
        upcomingOnly &&
        s.status !== "planned" &&
        s.status !== "queued" &&
        s.status !== "publishing"
      )
        continue;
      const date = new Date(s.scheduled_at);
      const day = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
      const arr = map.get(day) ?? [];
      arr.push(s);
      map.set(day, arr);
    }
    return Array.from(map.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [schedule, upcomingOnly]);

  const scheduledContents = useMemo(
    () => schedule.map((s) => contents[s.content_id]).filter((c): c is MarketingContentRow => !!c),
    [schedule, contents],
  );
  const previews = useContentPreviews(companyId, scheduledContents);

  async function cancel(id: string) {
    if (!confirm("Cancelar este agendamento?")) return;
    try {
      await apiCancelSchedule(id);
      toast.success("Agendamento cancelado.");
      await refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao cancelar.");
    }
  }

  if (loading) {
    return (
      <div className="text-sm text-muted-foreground flex items-center gap-2">
        <LumePulse className="h-4 w-4 animate-spin" /> Carregando…
      </div>
    );
  }

  if (grouped.length === 0) {
    return (
      <div className="mkt-empty-state">
        <MarketingArtwork kind="ring" />
        <h3>Sua próxima história tem lugar aqui.</h3>
        <p>
          Aprove uma publicação em <strong>Para revisar</strong> e agende em{" "}
          <strong>Aprovadas</strong>. Seus próximos envios aparecerão nesta agenda.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="mkt-tool-toolbar text-xs text-muted-foreground">
        Publicações agendadas saem sozinhas no horário, pelo canal conectado.
      </div>
      {grouped.map(([day, items]) => (
        <div key={day} className="mkt-schedule-day rounded-lg border bg-card overflow-hidden">
          <div className="mkt-schedule-date">
            <strong>
              {new Date(`${day}T12:00:00`).toLocaleDateString("pt-BR", { day: "2-digit" })}
            </strong>
            <span>
              {new Date(`${day}T12:00:00`).toLocaleDateString("pt-BR", {
                weekday: "long",
                month: "long",
              })}
            </span>
          </div>
          <div className="divide-y">
            {items.map((s) => {
              const c = contents[s.content_id];
              return (
                <div key={s.id} className="p-3 flex items-center gap-3" data-testid="schedule-item">
                  <MediaThumb
                    preview={c ? previews[c.id] : null}
                    className="h-14 w-14 shrink-0 rounded-lg"
                  />
                  <div className="flex-1 min-w-0">
                    <div className="text-xs flex flex-wrap items-center gap-2">
                      <span className="mkt-badge mkt-tone-neutral">
                        {new Date(s.scheduled_at).toLocaleTimeString("pt-BR", {
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </span>
                      <span className="mkt-badge mkt-tone-quiet">
                        {FORMAT_LABEL[c?.format ?? ""] ?? c?.format ?? ""}
                      </span>
                      <span className="mkt-badge mkt-tone-quiet">
                        {CHANNEL_LABEL[s.channel] ?? s.channel}
                      </span>
                      <span
                        className={`mkt-badge ${s.status === "failed" ? "mkt-tone-danger" : "mkt-tone-quiet"}`}
                      >
                        {SCHEDULE_STATUS[s.status] ?? s.status}
                      </span>
                    </div>
                    <div className="text-sm mt-1 line-clamp-2">
                      {c?.title ?? c?.body?.slice(0, 120) ?? "(conteúdo indisponível)"}
                    </div>
                  </div>
                  {s.status === "planned" && (
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => void cancel(s.id)}
                      aria-label="Cancelar"
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
