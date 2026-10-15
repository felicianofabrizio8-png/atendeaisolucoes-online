import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { EventSource } from "./agenda-model";

export interface HistoryEntry {
  id: string;
  actor_id: string | null;
  actor_name: string | null;
  source: EventSource | string;
  action: "criado" | "alterado" | "excluido";
  changes: Record<string, unknown>;
  created_at: string;
}

/** Histórico do evento e nomes de quem criou/alterou. Sem a estrutura nova, fica vazio. */
export function useEventDetails(
  eventId: string | null,
  people: Array<string | null | undefined>,
  extended: boolean,
) {
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [names, setNames] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const peopleKey = [...new Set(people.filter(Boolean))].sort().join(",");

  useEffect(() => {
    if (!eventId || !extended) {
      setHistory([]);
      return;
    }
    let cancelled = false;
    setLoading(true);
    void (async () => {
      const { data } = await supabase
        .from("agenda_event_history" as never)
        .select("id,actor_id,actor_name,source,action,changes,created_at")
        .eq("event_id", eventId)
        .order("created_at", { ascending: false })
        .limit(50);
      if (!cancelled) {
        setHistory((data ?? []) as unknown as HistoryEntry[]);
        setLoading(false);
      }
    })();
    const channel = supabase
      .channel(`agenda-history:${eventId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "agenda_event_history",
          filter: `event_id=eq.${eventId}`,
        },
        (payload) => setHistory((list) => [payload.new as HistoryEntry, ...list]),
      )
      .subscribe();
    return () => {
      cancelled = true;
      void supabase.removeChannel(channel);
    };
  }, [eventId, extended]);

  useEffect(() => {
    const ids = peopleKey ? peopleKey.split(",") : [];
    if (!ids.length) return;
    let cancelled = false;
    void (async () => {
      const { data } = await supabase.from("profiles").select("id,display_name").in("id", ids);
      if (cancelled || !data) return;
      setNames(
        Object.fromEntries(
          data.filter((row) => row.display_name).map((row) => [row.id, row.display_name as string]),
        ),
      );
    })();
    return () => {
      cancelled = true;
    };
  }, [peopleKey]);

  return { history, names, loading };
}

const FIELD_LABEL: Record<string, string> = {
  title: "Título",
  scheduled_at: "Início",
  ends_at: "Fim",
  status: "Status",
  notes: "Notas",
  customer_name: "Cliente",
  customer_phone: "Telefone",
  address: "Endereço",
  city: "Cidade",
  product: "Produto",
  technician: "Técnico",
  salesperson: "Vendedor",
  appointment_type: "Tipo",
  event_type_id: "Tipo",
  all_day: "Dia inteiro",
  custom_fields: "Campos",
  lead_id: "Contato",
  quote_id: "Orçamento",
};

export function describeChange(entry: HistoryEntry): string {
  if (entry.action === "criado") return "criou o compromisso";
  if (entry.action === "excluido") return "excluiu o compromisso";
  const fields = Object.keys(entry.changes)
    .map((key) => FIELD_LABEL[key] ?? key)
    .filter((label, index, list) => list.indexOf(label) === index);
  return fields.length ? `alterou ${fields.join(", ").toLowerCase()}` : "alterou o compromisso";
}
