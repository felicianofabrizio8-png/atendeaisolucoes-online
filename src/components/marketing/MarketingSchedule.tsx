import { LumePulse } from "./MarketingMotion";
import { useEffect, useMemo, useState } from "react";
import { MarketingArtwork } from "./MarketingArtwork";
import { Button } from "@/components/ui/button";
import { X } from "lucide-react";
import { lumeToast as toast } from "./MarketingFeedback";
import { apiListSchedule, apiListContents, apiCancelSchedule } from "@/data/marketingRepo";
import type { MarketingScheduleRow, MarketingContentRow } from "@/lib/marketing/marketing.types";

interface Props {
  companyId: string;
}

const scheduleStatusLabel: Record<MarketingScheduleRow["status"], string> = {
  planned: "Planejado",
  queued: "Na fila",
  publishing: "Publicando",
  published: "Publicado",
  failed: "Falha no envio",
  cancelled: "Cancelado",
};

export function MarketingSchedule({ companyId }: Props) {
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
      const date = new Date(s.scheduled_at);
      const day = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
      const arr = map.get(day) ?? [];
      arr.push(s);
      map.set(day, arr);
    }
    return Array.from(map.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [schedule]);

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
          Aprove um conteúdo e escolha uma data em <strong>Revisar conteúdos</strong>. Seus próximos
          envios aparecerão nesta agenda.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="mkt-tool-toolbar text-xs text-muted-foreground">
        Acompanhe datas e canais. Consulte a fila e o resultado dos envios em Publicações.
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
                <div key={s.id} className="p-3 flex items-start gap-3">
                  <div className="text-xs text-muted-foreground w-14 shrink-0">
                    {new Date(s.scheduled_at).toLocaleTimeString("pt-BR", {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-xs flex items-center gap-2">
                      <span className="mkt-badge mkt-tone-neutral">{c?.format ?? "?"}</span>
                      <span className="mkt-badge mkt-tone-quiet">{s.channel}</span>
                      <span className="mkt-badge mkt-tone-quiet">
                        {scheduleStatusLabel[s.status]}
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
