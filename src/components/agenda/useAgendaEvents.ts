import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { addDays, endOfWeek, max, min, startOfWeek } from "date-fns";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import {
  AGENDA_SELECT,
  AGENDA_SELECT_EXTENDED,
  AGENDA_SELECT_HIERARCHY,
  type AgendaEvent,
  type VisitStatus,
} from "./agenda-model";
import { detectAgendaSchema } from "./agenda-schema";

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
  const [extended, setExtended] = useState(false);
  const [hierarchy, setHierarchy] = useState(false);
  useEffect(() => {
    void detectAgendaSchema().then((schema) => {
      setExtended(schema.extended);
      setHierarchy(schema.hierarchy);
    });
  }, []);
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
    const schema = await detectAgendaSchema();
    const { data, error: loadError } = await supabase
      .from("visits")
      .select(
        schema.hierarchy
          ? AGENDA_SELECT_HIERARCHY
          : schema.extended
            ? AGENDA_SELECT_EXTENDED
            : AGENDA_SELECT,
      )
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
      // Tags e participantes chegam aninhados; viram listas de ids no compromisso.
      const rows = (data ?? []) as unknown as Array<
        AgendaEvent & {
          agenda_event_tags?: Array<{ tag_id: string }>;
          agenda_event_participants?: Array<{ user_id: string | null }>;
        }
      >;
      setEvents(
        rows.map(({ agenda_event_tags, agenda_event_participants, ...event }) => ({
          ...event,
          tag_ids: agenda_event_tags?.map((row) => row.tag_id) ?? [],
          participant_ids:
            agenda_event_participants
              ?.map((row) => row.user_id)
              .filter((id): id is string => !!id) ?? [],
        })),
      );
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
    async (
      id: string,
      changes: Partial<Pick<AgendaEvent, "status" | "scheduled_at" | "ends_at">>,
    ) => {
      const previous = events;
      setEvents((list) =>
        list.map((event) => (event.id === id ? { ...event, ...changes } : event)),
      );
      const { error: updateError } = await supabase
        .from("visits")
        .update(changes as never)
        .eq("id", id);
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
    (id: string, at: Date) => {
      // Remarcar mantém a duração: o fim anda junto com o início.
      const current = events.find((event) => event.id === id);
      const changes: Partial<Pick<AgendaEvent, "scheduled_at" | "ends_at">> = {
        scheduled_at: at.toISOString(),
      };
      if (current?.ends_at) {
        const duration =
          new Date(current.ends_at).getTime() - new Date(current.scheduled_at).getTime();
        changes.ends_at = new Date(at.getTime() + duration).toISOString();
      }
      return patch(id, changes);
    },
    [events, patch],
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

  /** Cópia do compromisso no mesmo horário do dia seguinte; devolve o id criado. */
  const duplicate = useCallback(
    async (event: AgendaEvent) => {
      if (!companyId) return null;
      const shift = (iso: string | null | undefined) =>
        iso ? addDays(new Date(iso), 1).toISOString() : null;
      const copy: Record<string, unknown> = {
        company_id: companyId,
        title: event.title,
        address: event.address,
        scheduled_at: shift(event.scheduled_at),
        status: "agendada",
        notes: event.notes,
        customer_name: event.customer_name,
        customer_phone: event.customer_phone,
        product: event.product,
        lead_id: event.lead_id,
        quote_id: event.quote_id,
        appointment_type: event.appointment_type,
        city: event.city,
        salesperson: event.salesperson,
        technician: event.technician,
      };
      if (extended) {
        Object.assign(copy, {
          ends_at: shift(event.ends_at),
          all_day: event.all_day ?? false,
          event_type_id: event.event_type_id ?? null,
          custom_fields: event.custom_fields ?? {},
        });
      }
      const { data, error: insertError } = await supabase
        .from("visits")
        .insert(copy as never)
        .select("id")
        .single();
      if (insertError || !data) {
        toast.error("Não foi possível duplicar.");
        return null;
      }
      void load();
      return (data as { id: string }).id;
    },
    [companyId, extended, load],
  );

  return {
    events,
    loading,
    error,
    extended,
    hierarchy,
    reload: load,
    setStatus,
    reschedule,
    remove,
    duplicate,
  };
}
