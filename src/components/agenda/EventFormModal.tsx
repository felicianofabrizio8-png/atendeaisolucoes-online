import { useMemo, useState, useSyncExternalStore, type ReactNode } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import { getLeads, subscribeRepo } from "@/data/leadRepo";
import { listQuotes, subscribeQuotes } from "@/data/quotes";
import {
  STATUS_KEYS,
  STATUS_LABEL,
  TYPE_HUE,
  TYPE_KEYS,
  TYPE_LABEL,
  type AgendaEvent,
  type AgendaEventType,
} from "./agenda-model";
import {
  buildEventRow,
  emptyForm,
  formFromEvent,
  validateForm,
  type EventForm,
} from "./event-form";

/**
 * Formulário de compromisso genérico: serve para qualquer empresa. Cliente, endereço e
 * campos aparecem conforme o tipo; reunião interna não pede cliente.
 */
export function EventFormModal({
  companyId,
  event,
  initialAt,
  types,
  extended,
  onClose,
  onSaved,
}: {
  companyId: string;
  event: AgendaEvent | null;
  initialAt: Date | null;
  types: AgendaEventType[];
  extended: boolean;
  onClose: () => void;
  onSaved: (id: string) => void;
}) {
  const activeTypes = types.filter((type) => type.active || type.id === event?.event_type_id);
  const [form, setForm] = useState<EventForm>(() =>
    event ? formFromEvent(event) : emptyForm(initialAt ?? undefined, activeTypes[0] ?? null),
  );
  const [withCustomer, setWithCustomer] = useState(
    () => !!(event?.customer_name || event?.lead_id),
  );
  const [saving, setSaving] = useState(false);
  const leads = useSyncExternalStore(subscribeRepo, getLeads, getLeads);
  const quotes = useSyncExternalStore(subscribeQuotes, listQuotes, listQuotes);
  const type = activeTypes.find((item) => item.id === form.typeId) ?? null;
  const showCustomer = withCustomer || !!type?.requires_customer;
  const leadQuotes = useMemo(
    () => (form.leadId ? quotes.filter((quote) => quote.leadId === form.leadId) : []),
    [quotes, form.leadId],
  );
  const set = <K extends keyof EventForm>(key: K, value: EventForm[K]) =>
    setForm((current) => ({ ...current, [key]: value }));

  function chooseType(next: AgendaEventType) {
    setForm((current) => {
      const fresh = emptyForm(new Date(`${current.date}T${current.start}:00`), next);
      // Troca o título só se ele ainda era o nome do tipo anterior (ou vazio).
      const keepTitle = current.title.trim() && current.title !== type?.name;
      return {
        ...current,
        typeId: next.id,
        legacyType: next.legacy_type ?? current.legacyType,
        title: keepTitle ? current.title : next.name,
        end: event ? current.end : fresh.end,
        allDay: next.kind === "bloqueio" ? true : current.allDay,
      };
    });
  }

  function chooseLead(id: string) {
    const lead = leads.find((item) => item.id === id);
    setForm((current) => ({
      ...current,
      leadId: id || null,
      quoteId: null,
      customerName: current.customerName || lead?.name || "",
      customerPhone: current.customerPhone || lead?.phone || "",
      product: current.product || lead?.product || "",
    }));
  }

  async function save() {
    const problem = validateForm(form, type);
    if (problem) return toast.error(problem);
    setSaving(true);
    const row = buildEventRow(form, { companyId, extended });
    const table = supabase.from("visits");
    const { data, error } = event
      ? await table
          .update(row as never)
          .eq("id", event.id)
          .select("id")
          .single()
      : await table
          .insert(row as never)
          .select("id")
          .single();
    setSaving(false);
    if (error || !data) {
      console.error("agenda.save", error);
      return toast.error("Não foi possível salvar o compromisso.");
    }
    toast.success(event ? "Compromisso atualizado" : "Compromisso agendado");
    onSaved((data as { id: string }).id);
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="lume-agenda max-h-[92vh] max-w-2xl overflow-y-auto rounded-[28px] border-[var(--ag-edge)] p-0 text-[var(--ag-ink)]">
        <div className="border-b border-[var(--ag-edge)] px-6 pb-5 pt-6">
          <p className="ag-mono">{event ? "Editar compromisso" : "Novo compromisso"}</p>
          <DialogTitle className="mt-2 text-2xl font-semibold tracking-tight">
            {form.title.trim() || "Sem título"}
          </DialogTitle>
          <DialogDescription className="mt-1 text-sm text-[var(--ag-muted)]">
            Escolha o tipo, quando acontece e quem participa.
          </DialogDescription>
        </div>

        <div className="space-y-6 px-6 py-5">
          <Group label="Tipo">
            <div className="flex flex-wrap gap-1.5">
              {activeTypes.length
                ? activeTypes.map((item) => (
                    <TypeChip
                      key={item.id}
                      hue={item.hue}
                      label={item.name}
                      active={form.typeId === item.id}
                      onClick={() => chooseType(item)}
                    />
                  ))
                : TYPE_KEYS.map((key) => (
                    <TypeChip
                      key={key}
                      hue={TYPE_HUE[key]}
                      label={TYPE_LABEL[key].label}
                      active={form.legacyType === key}
                      onClick={() => {
                        set("legacyType", key);
                        if (!form.title.trim() || form.title === TYPE_LABEL[form.legacyType].label)
                          set("title", TYPE_LABEL[key].label);
                      }}
                    />
                  ))}
            </div>
          </Group>

          <Field label="Título">
            <input
              className="ag-field"
              value={form.title}
              maxLength={160}
              onChange={(e) => set("title", e.target.value)}
              placeholder="Ex.: Reunião de alinhamento, Visita ao cliente…"
              autoFocus={!event}
            />
          </Field>

          <div className="grid gap-3 sm:grid-cols-[1.4fr_1fr_1fr]">
            <Field label="Data">
              <input
                type="date"
                className="ag-field"
                value={form.date}
                onChange={(e) => set("date", e.target.value)}
              />
            </Field>
            <Field label="Início">
              <input
                type="time"
                className="ag-field"
                value={form.start}
                disabled={form.allDay}
                onChange={(e) => set("start", e.target.value)}
              />
            </Field>
            <Field label="Fim">
              <input
                type="time"
                className="ag-field"
                value={form.end}
                disabled={form.allDay}
                onChange={(e) => set("end", e.target.value)}
              />
            </Field>
          </div>
          <div className="flex flex-wrap items-center gap-4">
            <Toggle
              label="Dia inteiro"
              checked={form.allDay}
              disabled={!extended}
              onChange={(value) => set("allDay", value)}
            />
            <Toggle
              label="Com cliente"
              checked={showCustomer}
              disabled={!!type?.requires_customer}
              onChange={setWithCustomer}
            />
            <label className="ml-auto flex items-center gap-2 text-sm">
              <span className="text-[var(--ag-muted)]">Status</span>
              <select
                className="ag-field !h-9 !w-auto"
                value={form.status}
                onChange={(e) => set("status", e.target.value as EventForm["status"])}
              >
                {STATUS_KEYS.map((status) => (
                  <option key={status} value={status}>
                    {STATUS_LABEL[status]}
                  </option>
                ))}
              </select>
            </label>
          </div>

          {showCustomer && (
            <Group label="Cliente">
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Contato do atendimento">
                  <select
                    className="ag-field"
                    value={form.leadId ?? ""}
                    onChange={(e) => chooseLead(e.target.value)}
                  >
                    <option value="">Nenhum — digitar</option>
                    {leads.map((lead) => (
                      <option key={lead.id} value={lead.id}>
                        {lead.name}
                        {lead.phone ? ` · ${lead.phone}` : ""}
                      </option>
                    ))}
                  </select>
                </Field>
                {leadQuotes.length > 0 && (
                  <Field label="Orçamento">
                    <select
                      className="ag-field"
                      value={form.quoteId ?? ""}
                      onChange={(e) => set("quoteId", e.target.value || null)}
                    >
                      <option value="">Nenhum</option>
                      {leadQuotes.map((quote) => (
                        <option key={quote.id} value={quote.id}>
                          {quote.productName} ·{" "}
                          {quote.finalValue.toLocaleString("pt-BR", {
                            style: "currency",
                            currency: "BRL",
                          })}
                        </option>
                      ))}
                    </select>
                  </Field>
                )}
                <Field label="Nome">
                  <input
                    className="ag-field"
                    value={form.customerName}
                    onChange={(e) => set("customerName", e.target.value)}
                  />
                </Field>
                <Field label="Telefone">
                  <input
                    className="ag-field"
                    inputMode="tel"
                    value={form.customerPhone}
                    onChange={(e) => set("customerPhone", e.target.value)}
                  />
                </Field>
              </div>
            </Group>
          )}

          <Group label="Local">
            <div className="grid gap-3 sm:grid-cols-[1fr_2fr]">
              <Field label="Cidade">
                <input
                  className="ag-field"
                  value={form.city}
                  onChange={(e) => set("city", e.target.value)}
                />
              </Field>
              <Field label={type?.requires_address ? "Endereço *" : "Endereço ou link da reunião"}>
                <input
                  className="ag-field"
                  value={form.address}
                  onChange={(e) => set("address", e.target.value)}
                />
              </Field>
            </div>
          </Group>

          <Group label="Equipe e detalhes">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Responsável / vendedor">
                <input
                  className="ag-field"
                  value={form.salesperson}
                  onChange={(e) => set("salesperson", e.target.value)}
                />
              </Field>
              <Field label="Técnico / executor">
                <input
                  className="ag-field"
                  value={form.technician}
                  onChange={(e) => set("technician", e.target.value)}
                />
              </Field>
              <Field label="Produto ou serviço">
                <input
                  className="ag-field"
                  value={form.product}
                  onChange={(e) => set("product", e.target.value)}
                />
              </Field>
              {type?.fields.map((field) => (
                <Field key={field.key} label={field.label}>
                  {field.type === "boolean" ? (
                    <Toggle
                      label="Sim"
                      checked={form.customFields[field.key] === true}
                      onChange={(value) =>
                        set("customFields", { ...form.customFields, [field.key]: value })
                      }
                    />
                  ) : (
                    <input
                      className="ag-field"
                      type={
                        field.type === "number" ? "number" : field.type === "date" ? "date" : "text"
                      }
                      value={String(form.customFields[field.key] ?? "")}
                      onChange={(e) =>
                        set("customFields", {
                          ...form.customFields,
                          [field.key]:
                            field.type === "number" ? Number(e.target.value) : e.target.value,
                        })
                      }
                    />
                  )}
                </Field>
              ))}
            </div>
            <Field label="Notas — o que será feito">
              <textarea
                className="ag-field min-h-[96px] py-2.5"
                value={form.notes}
                onChange={(e) => set("notes", e.target.value)}
                placeholder="Pauta, orientações, materiais, observações…"
              />
            </Field>
          </Group>
        </div>

        <div className="sticky bottom-0 flex justify-end gap-2 border-t border-[var(--ag-edge)] bg-[var(--ag-surface)] px-6 py-4">
          <button type="button" className="ag-btn" onClick={onClose} disabled={saving}>
            Cancelar
          </button>
          <button
            type="button"
            className="ag-btn ag-btn-primary"
            onClick={() => void save()}
            disabled={saving}
          >
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            {event ? "Salvar alterações" : "Agendar"}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Group({ label, children }: { label: string; children: ReactNode }) {
  return (
    <fieldset className="space-y-3">
      <legend className="ag-mono mb-2">{label}</legend>
      {children}
    </fieldset>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block space-y-1.5">
      <span className="text-[12px] font-medium text-[var(--ag-muted)]">{label}</span>
      {children}
    </label>
  );
}

function Toggle({
  label,
  checked,
  disabled = false,
  onChange,
}: {
  label: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <label
      className={`flex items-center gap-2 text-sm ${disabled ? "opacity-50" : "cursor-pointer"}`}
    >
      <input
        type="checkbox"
        className="peer sr-only"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span className="ag-switch" aria-hidden />
      {label}
    </label>
  );
}

function TypeChip({
  hue,
  label,
  active,
  onClick,
}: {
  hue: number;
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className="ag-chip !py-1.5"
      aria-pressed={active}
      style={{ ["--ag-type" as string]: `oklch(0.7 0.08 ${hue})` }}
      onClick={onClick}
    >
      <span className="ag-dot" />
      {label}
    </button>
  );
}
