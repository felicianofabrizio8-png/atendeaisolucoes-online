import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { addDays, endOfWeek, max, min, startOfWeek } from "date-fns";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { AGENDA_SELECT, type AgendaEvent, type VisitStatus } from "./agenda-model";

/**
 * Compromissos da empresa no intervalo visível, mais a semana atual e a próxima
 * (para o pulso do topo funcionar em qualquer visão). Atualiza sozinho quando outra
 * pessoa — ou a IA Lume — muda a agenda.
 */
export function useAgendaEvents(
  companyId: string | null | undefined,
  range: { from: Date; to: Date },
) {
  const [events, setEvents] = useState<AgendaEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const request = useRef(0);

  const window = useMemo(() => {
    const now = new Date();
    return {
      from: min([range.from, startOfWeek(now, { weekStartsOn: 1 })]),
      to: max([range.to, addDays(endOfWeek(now, { weekStartsOn: 1 }), 7)]),
    };
  }, [range.from, range.to]);
  const fromIso = window.from.toISOString();
  const toIso = window.to.toISOString();

  const load = useCallback(async () => {
    if (!companyId) {
      setEvents([]);
      setLoading(false);
      return;
    }
    const id = ++request.current;
    setLoading(true);
    const { data, error: loadError } = await supabase
      .from("visits")
      .select(AGENDA_SELECT)
      .eq("company_id", companyId)
      .gte("scheduled_at", fromIso)
      .lte("scheduled_at", toIso)
      .order("scheduled_at", { ascending: true });
    if (id !== request.current) return;
    if (loadError) {
      console.error("agenda.load", loadError);
      setError("Não foi possível carregar a agenda.");
    } else {
      setError(null);
      setEvents((data ?? []) as AgendaEvent[]);
    }
    setLoading(false);
  }, [companyId, fromIso, toIso]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!companyId) return;
    const channel = supabase
      .channel(`agenda:${companyId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "visits", filter: `company_id=eq.${companyId}` },
        () => void load(),
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [companyId, load]);

  const patch = useCallback(
    async (id: string, changes: Partial<Pick<AgendaEvent, "status" | "scheduled_at">>) => {
      const previous = events;
      setEvents((list) =>
        list.map((event) => (event.id === id ? { ...event, ...changes } : event)),
      );
      const { error: updateError } = await supabase.from("visits").update(changes).eq("id", id);
      if (updateError) {
        setEvents(previous);
        toast.error("Não foi possível salvar a alteração.");
        return false;
      }
      return true;
    },
    [events],
  );

  const setStatus = useCallback(
    (id: string, status: VisitStatus) => patch(id, { status }),
    [patch],
  );
  const reschedule = useCallback(
    (id: string, at: Date) => patch(id, { scheduled_at: at.toISOString() }),
    [patch],
  );
  const remove = useCallback(
    async (id: string) => {
      const previous = events;
      setEvents((list) => list.filter((event) => event.id !== id));
      const { error: deleteError } = await supabase.from("visits").delete().eq("id", id);
      if (deleteError) {
        setEvents(previous);
        toast.error("Não foi possível excluir.");
        return false;
      }
      return true;
    },
    [events],
  );

  return { events, loading, error, reload: load, setStatus, reschedule, remove };
}
