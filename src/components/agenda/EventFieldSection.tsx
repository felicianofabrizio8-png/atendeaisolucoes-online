import { useCallback, useEffect, useState } from "react";
import { format } from "date-fns";
import { CheckSquare, LogIn, LogOut, NotebookPen, Plus, Square, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/auth/AuthContext";

interface ChecklistItem {
  id: string;
  label: string;
  done: boolean;
  done_at: string | null;
  position: number;
}

interface FieldLog {
  id: string;
  kind: "chegada" | "saida" | "relatorio" | "anexo" | "confirmacao_cliente";
  author_name: string | null;
  note: string | null;
  latitude: number | null;
  longitude: number | null;
  created_at: string;
}

const KIND_LABEL: Record<FieldLog["kind"], string> = {
  chegada: "Chegada",
  saida: "Saída",
  relatorio: "Relatório",
  anexo: "Anexo",
  confirmacao_cliente: "Confirmação do cliente",
};

/** Localização opcional: se a pessoa negar ou o navegador não tiver, registra sem. */
function currentPosition(): Promise<{ latitude: number; longitude: number } | null> {
  if (!navigator.geolocation) return Promise.resolve(null);
  return new Promise((resolve) =>
    navigator.geolocation.getCurrentPosition(
      (position) =>
        resolve({ latitude: position.coords.latitude, longitude: position.coords.longitude }),
      () => resolve(null),
      { timeout: 6000, maximumAge: 60_000 },
    ),
  );
}

/** Checklist e registro de campo do compromisso (chegada, saída, relatório). */
export function EventFieldSection({ eventId, companyId }: { eventId: string; companyId: string }) {
  const { profile } = useAuth();
  const [items, setItems] = useState<ChecklistItem[]>([]);
  const [logs, setLogs] = useState<FieldLog[]>([]);
  const [newItem, setNewItem] = useState("");
  const [report, setReport] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const [checklist, field] = await Promise.all([
      supabase
        .from("agenda_checklist_items" as never)
        .select("id,label,done,done_at,position")
        .eq("event_id", eventId)
        .order("position"),
      supabase
        .from("agenda_field_logs" as never)
        .select("id,kind,author_name,note,latitude,longitude,created_at")
        .eq("event_id", eventId)
        .order("created_at", { ascending: false }),
    ]);
    setItems((checklist.data ?? []) as unknown as ChecklistItem[]);
    setLogs((field.data ?? []) as unknown as FieldLog[]);
  }, [eventId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function toggle(item: ChecklistItem) {
    setItems((list) => list.map((i) => (i.id === item.id ? { ...i, done: !i.done } : i)));
    const { error } = await supabase
      .from("agenda_checklist_items" as never)
      .update({ done: !item.done, done_at: item.done ? null : new Date().toISOString() } as never)
      .eq("id", item.id);
    if (error) {
      toast.error("Não foi possível marcar o item.");
      void load();
    }
  }

  async function addItem() {
    const label = newItem.trim();
    if (!label) return;
    setNewItem("");
    const { error } = await supabase.from("agenda_checklist_items" as never).insert({
      company_id: companyId,
      event_id: eventId,
      label: label.slice(0, 200),
      position: items.length,
    } as never);
    if (error) toast.error("Não foi possível adicionar o item.");
    void load();
  }

  async function removeItem(id: string) {
    await supabase
      .from("agenda_checklist_items" as never)
      .delete()
      .eq("id", id);
    void load();
  }

  async function log(kind: FieldLog["kind"], note: string | null = null) {
    setBusy(true);
    const position = kind === "relatorio" ? null : await currentPosition();
    const { error } = await supabase.from("agenda_field_logs" as never).insert({
      company_id: companyId,
      event_id: eventId,
      kind,
      note,
      author_name: profile?.display_name ?? null,
      latitude: position?.latitude ?? null,
      longitude: position?.longitude ?? null,
    } as never);
    setBusy(false);
    if (error) return toast.error("Não foi possível registrar.");
    if (kind === "relatorio") setReport("");
    toast.success(`${KIND_LABEL[kind]} registrada`);
    void load();
  }

  const done = items.filter((item) => item.done).length;
  const arrived = logs.some((entry) => entry.kind === "chegada");
  const left = logs.some((entry) => entry.kind === "saida");

  return (
    <>
      <section className="border-t border-[var(--ag-edge)] px-6 py-5" aria-label="Checklist">
        <div className="flex items-center justify-between">
          <h3 className="ag-mono flex items-center gap-2">
            <CheckSquare className="h-3.5 w-3.5" /> Checklist
          </h3>
          {items.length > 0 && (
            <span className="text-xs text-[var(--ag-muted)]">
              {done}/{items.length}
            </span>
          )}
        </div>
        {items.length > 0 && (
          <div className="mt-3 h-1 overflow-hidden rounded-full bg-[rgb(255_255_255/0.08)]">
            <div
              className="h-full rounded-full bg-[var(--ag-accent)] transition-[width]"
              style={{ width: `${(done / items.length) * 100}%` }}
            />
          </div>
        )}
        <ul className="mt-3 space-y-1">
          {items.map((item) => (
            <li key={item.id} className="group flex items-center gap-2 text-sm">
              <button
                type="button"
                className="flex min-w-0 flex-1 items-center gap-2 rounded-lg py-1 text-left"
                aria-pressed={item.done}
                onClick={() => void toggle(item)}
              >
                {item.done ? (
                  <CheckSquare className="h-4 w-4 shrink-0 text-[var(--ag-accent)]" />
                ) : (
                  <Square className="h-4 w-4 shrink-0 text-[var(--ag-faint)]" />
                )}
                <span className={item.done ? "text-[var(--ag-muted)] line-through" : ""}>
                  {item.label}
                </span>
              </button>
              <button
                type="button"
                className="opacity-0 transition-opacity group-hover:opacity-100 focus:opacity-100"
                aria-label={`Remover ${item.label}`}
                onClick={() => void removeItem(item.id)}
              >
                <Trash2 className="h-3.5 w-3.5 text-[var(--ag-faint)]" />
              </button>
            </li>
          ))}
        </ul>
        <form
          className="mt-2 flex gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            void addItem();
          }}
        >
          <input
            className="ag-field !h-9"
            value={newItem}
            maxLength={200}
            placeholder="Novo item…"
            onChange={(event) => setNewItem(event.target.value)}
          />
          <button
            type="submit"
            className="ag-icon-btn !h-9 !w-9 shrink-0"
            aria-label="Adicionar item"
          >
            <Plus className="h-4 w-4" />
          </button>
        </form>
      </section>

      <section
        className="border-t border-[var(--ag-edge)] px-6 py-5"
        aria-label="Registro de campo"
      >
        <h3 className="ag-mono flex items-center gap-2">
          <NotebookPen className="h-3.5 w-3.5" /> Registro de campo
        </h3>
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            className="ag-btn"
            disabled={busy || arrived}
            onClick={() => void log("chegada")}
          >
            <LogIn className="h-3.5 w-3.5" /> {arrived ? "Chegada registrada" : "Registrar chegada"}
          </button>
          <button
            type="button"
            className="ag-btn"
            disabled={busy || !arrived || left}
            onClick={() => void log("saida")}
          >
            <LogOut className="h-3.5 w-3.5" /> {left ? "Saída registrada" : "Registrar saída"}
          </button>
        </div>
        <textarea
          className="ag-field mt-3 min-h-[72px] py-2"
          value={report}
          placeholder="Relatório: o que foi feito, pendências, próximos passos…"
          onChange={(event) => setReport(event.target.value)}
        />
        <div className="mt-2 flex justify-end">
          <button
            type="button"
            className="ag-btn !py-1.5"
            disabled={busy || !report.trim()}
            onClick={() => void log("relatorio", report.trim().slice(0, 4000))}
          >
            Salvar relatório
          </button>
        </div>
        {logs.length > 0 && (
          <ol className="mt-4 space-y-2.5">
            {logs.map((entry) => (
              <li key={entry.id} className="text-[13px]">
                <strong>{KIND_LABEL[entry.kind]}</strong>
                <span className="text-[var(--ag-muted)]">
                  {" "}
                  · {format(new Date(entry.created_at), "dd/MM HH:mm")}
                  {entry.author_name ? ` · ${entry.author_name}` : ""}
                </span>
                {entry.latitude != null && entry.longitude != null && (
                  <a
                    className="ml-2 text-[12px] text-[#c6b6ff] underline"
                    target="_blank"
                    rel="noopener noreferrer"
                    href={`https://www.google.com/maps?q=${entry.latitude},${entry.longitude}`}
                  >
                    ver local
                  </a>
                )}
                {entry.note && (
                  <p className="mt-0.5 whitespace-pre-wrap text-[var(--ag-muted)]">{entry.note}</p>
                )}
              </li>
            ))}
          </ol>
        )}
      </section>
    </>
  );
}
