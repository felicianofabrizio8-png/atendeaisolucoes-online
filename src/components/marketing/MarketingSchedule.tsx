import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Loader2, X } from "lucide-react";
import { toast } from "sonner";
import {
  apiListSchedule,
  apiListContents,
  apiCancelSchedule,
} from "@/data/marketingRepo";
import type {
  MarketingScheduleRow,
  MarketingContentRow,
} from "@/lib/marketing/marketing.types";

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
const FORMAT_LABEL: Record<string, string> = { feed: "Feed", story: "Story", reel: "Reel", whatsapp_cta: "WhatsApp" };
const CHANNEL_LABEL: Record<string, string> = { instagram: "Instagram", facebook: "Facebook", whatsapp: "WhatsApp" };

export function MarketingSchedule({ companyId, upcomingOnly = false }: Props) {
  const [schedule, setSchedule] = useState<MarketingScheduleRow[]>([]);
  const [contents, setContents] = useState<Record<string, MarketingContentRow>>({});
  const [loading, setLoading] = useState(true);

  async function refresh() {
    setLoading(true);
    try {
      const [sched, conts] = await Promise.all([apiListSchedule(), apiListContents()]);
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
      if (upcomingOnly && s.status !== "planned" && s.status !== "queued" && s.status !== "publishing") continue;
      const day = s.scheduled_at.slice(0, 10);
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
        <Loader2 className="h-4 w-4 animate-spin" /> Carregando…
      </div>
    );
  }

  if (grouped.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed p-8 text-center text-sm text-muted-foreground">
        Nada agendado. Aprove uma publicação em <strong>Para revisar</strong> e agende em{" "}
        <strong>Aprovadas</strong>.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="text-xs text-muted-foreground">
        Publicações agendadas saem sozinhas no horário, pelo canal conectado.
      </div>
      {grouped.map(([day, items]) => (
        <div key={day} className="rounded-2xl border bg-card overflow-hidden">
          <div className="px-4 py-2 bg-muted text-xs font-semibold first-letter:uppercase">
            {new Date(day).toLocaleDateString("pt-BR", {
              weekday: "long",
              day: "2-digit",
              month: "long",
            })}
          </div>
          <div className="divide-y">
            {items.map((s) => {
              const c = contents[s.content_id];
              return (
                <div key={s.id} className="p-3 flex items-center gap-3" data-testid="schedule-item">
                  <MediaThumb preview={c ? previews[c.id] : null} className="h-14 w-14 shrink-0 rounded-lg" />
                  <div className="flex-1 min-w-0">
                    <div className="text-xs flex flex-wrap items-center gap-x-2 gap-y-0.5 text-muted-foreground">
                      <span className="font-semibold text-foreground">
                        {new Date(s.scheduled_at).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}
                      </span>
                      <span>{FORMAT_LABEL[c?.format ?? ""] ?? c?.format ?? ""}</span>
                      <span>{CHANNEL_LABEL[s.channel] ?? s.channel}</span>
                      <span className={`rounded-full bg-muted px-2 py-0.5 font-medium ${s.status === "failed" ? "text-destructive" : "text-foreground"}`}>
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
