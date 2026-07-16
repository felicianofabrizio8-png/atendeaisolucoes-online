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

interface Props {
  companyId: string;
}

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
      const day = s.scheduled_at.slice(0, 10);
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
        <Loader2 className="h-4 w-4 animate-spin" /> Carregando…
      </div>
    );
  }

  if (grouped.length === 0) {
    return (
      <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
        Nenhum conteúdo agendado. Aprove um conteúdo e agende na aba <strong>Aprovação</strong>.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="text-xs text-muted-foreground">
        Fase 1: apenas planejamento. A publicação automática não está ativa.
      </div>
      {grouped.map(([day, items]) => (
        <div key={day} className="rounded-lg border bg-card overflow-hidden">
          <div className="px-3 py-2 bg-muted text-xs font-semibold uppercase">
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
                <div key={s.id} className="p-3 flex items-start gap-3">
                  <div className="text-xs text-muted-foreground w-14 shrink-0">
                    {new Date(s.scheduled_at).toLocaleTimeString("pt-BR", {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-xs flex items-center gap-2">
                      <span className="uppercase font-semibold rounded bg-primary/10 text-primary px-1.5 py-0.5">
                        {c?.format ?? "?"}
                      </span>
                      <span className="uppercase text-[10px] text-muted-foreground">
                        {s.channel}
                      </span>
                      <span className="uppercase text-[10px] text-muted-foreground">
                        {s.status}
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
