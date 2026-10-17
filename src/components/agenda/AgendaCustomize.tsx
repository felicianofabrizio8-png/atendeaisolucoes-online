import { useState, type CSSProperties, type ReactNode } from "react";
import { Eye, EyeOff, Plus, Sparkles, Trash2 } from "lucide-react";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { KIND_LABEL, type AgendaEventType, type AgendaPreferences } from "./agenda-model";
import { PENDING_SCHEMA_MESSAGE } from "./agenda-schema";
import type { EventTypeDraft } from "./useEventTypes";

const FIELD_TYPES = { text: "Texto", number: "Número", date: "Data", boolean: "Sim/Não" } as const;

/** Personalização: tipos de evento da empresa e preferências de visão de cada pessoa. */
export function AgendaCustomize({
  open,
  extended,
  types,
  preferences,
  onClose,
  onPreferences,
  onSave,
  onToggle,
  onRemove,
  onSeed,
  tagsSlot,
}: {
  open: boolean;
  extended: boolean;
  types: AgendaEventType[];
  preferences: AgendaPreferences;
  onClose: () => void;
  onPreferences: (preferences: AgendaPreferences) => void;
  onSave: (draft: EventTypeDraft, id?: string) => Promise<boolean>;
  onToggle: (id: string, active: boolean) => void;
  onRemove: (id: string) => void;
  onSeed: () => void;
  /** Com a hierarquia, as tags substituem os tipos de evento. */
  tagsSlot?: ReactNode;
}) {
  const [editing, setEditing] = useState<AgendaEventType | "new" | null>(null);

  return (
    <Sheet open={open} onOpenChange={(value) => !value && onClose()}>
      <SheetContent
        side="right"
        className="lume-agenda w-[94vw] max-w-[520px] overflow-y-auto border-l border-[var(--ag-edge)] p-0 text-[var(--ag-ink)]"
      >
        <div className="border-b border-[var(--ag-edge)] px-6 pb-5 pt-12">
          <p className="ag-mono">Personalizar</p>
          <SheetTitle className="mt-2 text-2xl font-semibold tracking-tight text-[var(--ag-ink)]">
            Sua Agenda, do seu jeito
          </SheetTitle>
          <SheetDescription className="mt-1 text-sm text-[var(--ag-muted)]">
            As tags valem para toda a empresa. A visão vale só para você.
          </SheetDescription>
        </div>

        <section className="space-y-4 border-b border-[var(--ag-edge)] px-6 py-5">
          <h3 className="ag-mono">Minha visão</h3>
          <label className="flex items-center justify-between gap-4 text-sm">
            Grade começa às
            <select
              className="ag-field !h-9 !w-28"
              value={preferences.dayStartHour}
              onChange={(e) =>
                onPreferences({ ...preferences, dayStartHour: Number(e.target.value) })
              }
            >
              {Array.from({ length: 13 }, (_, hour) => hour).map((hour) => (
                <option key={hour} value={hour}>
                  {String(hour).padStart(2, "0")}h
                </option>
              ))}
            </select>
          </label>
          <label className="flex cursor-pointer items-center justify-between gap-4 text-sm">
            Esconder sábado e domingo na semana
            <input
              type="checkbox"
              className="peer sr-only"
              checked={preferences.hideWeekends}
              onChange={(e) => onPreferences({ ...preferences, hideWeekends: e.target.checked })}
            />
            <span className="ag-switch" aria-hidden />
          </label>
        </section>

        {tagsSlot ? (
          <section className="px-6 py-5" aria-label="Tags">
            {tagsSlot}
          </section>
        ) : (
          <section className="px-6 py-5">
            <div className="flex items-center justify-between gap-3">
              <h3 className="ag-mono">Tags da empresa</h3>
              {extended && (
                <button type="button" className="ag-btn !py-1.5" onClick={() => setEditing("new")}>
                  <Plus className="h-3.5 w-3.5" /> Nova tag
                </button>
              )}
            </div>

            {!extended && (
              <p className="mt-3 text-sm text-[var(--ag-muted)]">{PENDING_SCHEMA_MESSAGE}</p>
            )}

            {extended && !types.length && (
              <div className="mt-4 rounded-2xl border border-dashed border-[var(--ag-edge-strong)] p-5 text-sm">
                <p>Nenhuma tag criada ainda. Crie as que fazem sentido para a sua empresa.</p>
                <p className="mt-1 text-[var(--ag-muted)]">
                  Comece com um conjunto genérico (atendimento, visita, reunião, tarefa, lembrete e
                  folga) e ajuste depois.
                </p>
                <button type="button" className="ag-btn ag-btn-primary mt-4" onClick={onSeed}>
                  <Sparkles className="h-4 w-4" /> Começar com tags sugeridas
                </button>
              </div>
            )}

            <ul className="mt-4 space-y-2">
              {types.map((type) => (
                <li
                  key={type.id}
                  className="flex items-center gap-3 rounded-2xl border border-[var(--ag-edge)] px-4 py-3"
                  style={{ opacity: type.active ? 1 : 0.5 }}
                >
                  <span
                    className="ag-dot"
                    style={
                      { ["--ag-type" as string]: `oklch(0.7 0.08 ${type.hue})` } as CSSProperties
                    }
                  />
                  <button
                    type="button"
                    className="min-w-0 flex-1 text-left"
                    onClick={() => setEditing(type)}
                  >
                    <span className="block truncate text-sm font-semibold">{type.name}</span>
                    <span className="block text-[11.5px] text-[var(--ag-muted)]">
                      {KIND_LABEL[type.kind]} · {type.default_duration_min} min
                      {type.requires_customer ? " · com cliente" : ""}
                      {type.fields.length ? ` · ${type.fields.length} campos` : ""}
                    </span>
                  </button>
                  <button
                    type="button"
                    className="ag-icon-btn !h-8 !w-8"
                    aria-label={type.active ? `Ocultar ${type.name}` : `Mostrar ${type.name}`}
                    onClick={() => onToggle(type.id, !type.active)}
                  >
                    {type.active ? (
                      <Eye className="h-3.5 w-3.5" />
                    ) : (
                      <EyeOff className="h-3.5 w-3.5" />
                    )}
                  </button>
                  <button
                    type="button"
                    className="ag-icon-btn !h-8 !w-8"
                    aria-label={`Excluir ${type.name}`}
                    onClick={() => {
                      if (
                        confirm(
                          `Excluir a tag "${type.name}"? Os compromissos continuam na agenda.`,
                        )
                      )
                        onRemove(type.id);
                    }}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}

        {!tagsSlot && editing && (
          <TypeEditor
            type={editing === "new" ? null : editing}
            onCancel={() => setEditing(null)}
            onSave={async (draft) => {
              if (await onSave(draft, editing === "new" ? undefined : editing.id)) setEditing(null);
            }}
          />
        )}
      </SheetContent>
    </Sheet>
  );
}

function TypeEditor({
  type,
  onCancel,
  onSave,
}: {
  type: AgendaEventType | null;
  onCancel: () => void;
  onSave: (draft: EventTypeDraft) => void;
}) {
  const [draft, setDraft] = useState<EventTypeDraft>(
    () =>
      type ?? {
        name: "",
        hue: 285,
        icon: "calendar",
        kind: "compromisso",
        default_duration_min: 60,
        requires_customer: false,
        requires_address: false,
        checklist_template: [],
        fields: [],
        legacy_type: null,
      },
  );
  const set = <K extends keyof EventTypeDraft>(key: K, value: EventTypeDraft[K]) =>
    setDraft((current) => ({ ...current, [key]: value }));

  return (
    <section className="space-y-4 border-t border-[var(--ag-edge)] bg-[var(--ag-raised)] px-6 py-5">
      <h3 className="ag-mono">{type ? `Editar "${type.name}"` : "Nova tag"}</h3>
      <label className="block space-y-1.5 text-[12px] text-[var(--ag-muted)]">
        Nome
        <input
          className="ag-field"
          value={draft.name}
          maxLength={60}
          onChange={(e) => set("name", e.target.value)}
          placeholder="Ex.: Consulta, Aula, Entrega, Plantão…"
        />
      </label>
      <div className="grid grid-cols-2 gap-3">
        <label className="block space-y-1.5 text-[12px] text-[var(--ag-muted)]">
          Categoria
          <select
            className="ag-field"
            value={draft.kind}
            onChange={(e) => set("kind", e.target.value as EventTypeDraft["kind"])}
          >
            {Object.entries(KIND_LABEL).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label className="block space-y-1.5 text-[12px] text-[var(--ag-muted)]">
          Duração padrão (min)
          <input
            type="number"
            min={5}
            max={1440}
            step={5}
            className="ag-field"
            value={draft.default_duration_min}
            onChange={(e) => set("default_duration_min", Math.max(5, Number(e.target.value) || 5))}
          />
        </label>
      </div>
      <label className="block space-y-2 text-[12px] text-[var(--ag-muted)]">
        <span className="flex items-center gap-2">
          Cor da luz
          <span
            className="ag-dot"
            style={{ ["--ag-type" as string]: `oklch(0.7 0.08 ${draft.hue})` } as CSSProperties}
          />
        </span>
        <input
          type="range"
          min={0}
          max={360}
          value={draft.hue}
          onChange={(e) => set("hue", Number(e.target.value))}
          className="w-full"
          style={{
            accentColor: `oklch(0.7 0.08 ${draft.hue})`,
            background:
              "linear-gradient(90deg, oklch(0.7 0.2 0), oklch(0.7 0.2 60), oklch(0.7 0.2 120), oklch(0.7 0.2 180), oklch(0.7 0.2 240), oklch(0.7 0.2 300), oklch(0.7 0.2 360))",
            height: 6,
            borderRadius: 999,
          }}
        />
      </label>
      <div className="flex flex-wrap gap-5 text-sm">
        <label className="flex cursor-pointer items-center gap-2">
          <input
            type="checkbox"
            className="peer sr-only"
            checked={draft.requires_customer}
            onChange={(e) => set("requires_customer", e.target.checked)}
          />
          <span className="ag-switch" aria-hidden /> Exige cliente
        </label>
        <label className="flex cursor-pointer items-center gap-2">
          <input
            type="checkbox"
            className="peer sr-only"
            checked={draft.requires_address}
            onChange={(e) => set("requires_address", e.target.checked)}
          />
          <span className="ag-switch" aria-hidden /> Exige endereço
        </label>
      </div>
      <label className="block space-y-1.5 text-[12px] text-[var(--ag-muted)]">
        Checklist padrão (um item por linha)
        <textarea
          className="ag-field min-h-[80px] py-2"
          value={draft.checklist_template.join("\n")}
          onChange={(e) =>
            set(
              "checklist_template",
              e.target.value.split("\n").map((line) => line.slice(0, 200)),
            )
          }
          onBlur={() =>
            set(
              "checklist_template",
              draft.checklist_template.filter((line) => line.trim()),
            )
          }
        />
      </label>

      <div className="space-y-2">
        <p className="text-[12px] text-[var(--ag-muted)]">Campos extras desta tag</p>
        {draft.fields.map((field, index) => (
          <div key={index} className="flex gap-2">
            <input
              className="ag-field"
              value={field.label}
              placeholder="Nome do campo"
              onChange={(e) => {
                const fields = [...draft.fields];
                fields[index] = {
                  ...field,
                  label: e.target.value,
                  key: slug(e.target.value) || field.key,
                };
                set("fields", fields);
              }}
            />
            <select
              className="ag-field !w-32"
              value={field.type}
              onChange={(e) => {
                const fields = [...draft.fields];
                fields[index] = { ...field, type: e.target.value as typeof field.type };
                set("fields", fields);
              }}
            >
              {Object.entries(FIELD_TYPES).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
            <button
              type="button"
              className="ag-icon-btn !h-10 !w-10 shrink-0"
              aria-label="Remover campo"
              onClick={() =>
                set(
                  "fields",
                  draft.fields.filter((_, i) => i !== index),
                )
              }
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
        ))}
        <button
          type="button"
          className="ag-chip"
          onClick={() =>
            set("fields", [
              ...draft.fields,
              { key: `campo_${draft.fields.length + 1}`, label: "", type: "text" },
            ])
          }
        >
          <Plus className="h-3 w-3" /> Adicionar campo
        </button>
      </div>

      <div className="flex justify-end gap-2 pt-2">
        <button type="button" className="ag-btn" onClick={onCancel}>
          Cancelar
        </button>
        <button
          type="button"
          className="ag-btn ag-btn-primary"
          disabled={!draft.name.trim()}
          onClick={() =>
            onSave({
              ...draft,
              name: draft.name.trim(),
              checklist_template: draft.checklist_template.filter((line) => line.trim()),
              fields: draft.fields.filter((field) => field.label.trim()),
            })
          }
        >
          Salvar tag
        </button>
      </div>
    </section>
  );
}

function slug(text: string): string {
  return text
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "")
    .slice(0, 40);
}
