import { useMemo, useState, useSyncExternalStore, type CSSProperties, type ReactNode } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { addMinutes, format } from "date-fns";
import { ptBR } from "date-fns/locale";
import {
  ArrowRight,
  CalendarClock,
  Check,
  ChevronDown,
  Loader2,
  MapPin,
  NotebookPen,
  Search,
  Tag,
  UserPlus,
  UserRound,
  Users,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { getLeads, subscribeRepo } from "@/data/leadRepo";
import { listQuotes, subscribeQuotes } from "@/data/quotes";
import { formatBRL } from "@/data/mock";
import { quoteHue, quoteInitials } from "@/lib/quote-presentation";
import {
  STATUS_KEYS,
  STATUS_LABEL,
  TYPE_HUE,
  TYPE_KEYS,
  TYPE_LABEL,
  type AgendaEvent,
  type AgendaEventType,
  type AppointmentType,
} from "./agenda-model";
import {
  buildEventRow,
  emptyForm,
  formFromEvent,
  formTimes,
  validateForm,
  type EventForm,
} from "./event-form";
import "@/components/orcamentos/quotes.css";

// Mesmo visual do formulário de orçamento (quotes.css): janela preta, etapas e resumo.
const inputClass = "quote-form-input";

function FormField({
  label,
  children,
  className = "",
}: {
  label: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <label className={`block min-w-0 ${className}`}>
      <span className="lq-field-label">{label}</span>
      {children}
    </label>
  );
}

function SectionTitle({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <h3 className="lq-section-title">
      <span aria-hidden="true">{icon}</span>
      {children}
    </h3>
  );
}

const DURATIONS = [
  { label: "30 min", minutes: 30 },
  { label: "1 h", minutes: 60 },
  { label: "2 h", minutes: 120 },
  { label: "4 h", minutes: 240 },
];

/**
 * Formulário de compromisso em três etapas — Quando, Pessoas, Detalhes — com o mesmo
 * desenho do orçamento. Genérico para qualquer empresa: cliente e endereço só são
 * exigidos quando o tipo pede.
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
  const reduceMotion = useReducedMotion();
  const activeTypes = types.filter((type) => type.active || type.id === event?.event_type_id);
  const [form, setForm] = useState<EventForm>(() =>
    event ? formFromEvent(event) : emptyForm(initialAt ?? undefined, activeTypes[0] ?? null),
  );
  const [step, setStep] = useState(1);
  const [direction, setDirection] = useState(1);
  const [withCustomer, setWithCustomer] = useState(
    () => !!(event?.customer_name || event?.lead_id),
  );
  const [clientSearch, setClientSearch] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const leads = useSyncExternalStore(subscribeRepo, getLeads, getLeads);
  const quotes = useSyncExternalStore(subscribeQuotes, listQuotes, listQuotes);

  const type = activeTypes.find((item) => item.id === form.typeId) ?? null;
  const needsCustomer = !!type?.requires_customer;
  const showCustomer = withCustomer || needsCustomer;
  const selectedLead = form.leadId ? leads.find((lead) => lead.id === form.leadId) : undefined;
  const leadQuotes = useMemo(
    () => (form.leadId ? quotes.filter((quote) => quote.leadId === form.leadId) : []),
    [quotes, form.leadId],
  );
  const filteredLeads = useMemo(() => {
    const query = clientSearch.trim().toLowerCase();
    if (!query) return [];
    const digits = query.replace(/\D/g, "");
    return leads
      .filter(
        (lead) =>
          lead.name.toLowerCase().includes(query) ||
          (digits.length >= 3 && (lead.phone ?? "").replace(/\D/g, "").includes(digits)),
      )
      .slice(0, 6);
  }, [leads, clientSearch]);

  const set = <K extends keyof EventForm>(key: K, value: EventForm[K]) =>
    setForm((current) => ({ ...current, [key]: value }));

  const typeName = type?.name ?? TYPE_LABEL[form.legacyType]?.label;
  const typeHue = type?.hue ?? TYPE_HUE[form.legacyType];
  const times = formTimes(form);
  const validTimes = !Number.isNaN(times.start.getTime()) && !Number.isNaN(times.end.getTime());
  const durationMin = validTimes
    ? Math.round((times.end.getTime() - times.start.getTime()) / 60_000)
    : 0;

  // Validação por etapa: cada etapa só libera a próxima com o que ela própria pede.
  const whenValid =
    !!form.title.trim() &&
    /^\d{4}-\d{2}-\d{2}$/.test(form.date) &&
    (form.allDay || (/^\d{2}:\d{2}$/.test(form.start) && /^\d{2}:\d{2}$/.test(form.end))) &&
    validTimes;
  const peopleValid = !needsCustomer || !!form.customerName.trim() || !!form.leadId;
  const canReach = (target: number) =>
    target <= step || (target === 2 && whenValid) || (target === 3 && whenValid && peopleValid);
  const goTo = (target: number) => {
    if (!canReach(target) || target === step) return;
    setDirection(target > step ? 1 : -1);
    setStep(target);
  };

  function chooseType(next: AgendaEventType) {
    setForm((current) => {
      const keepTitle = current.title.trim() && current.title !== type?.name;
      const start = new Date(`${current.date}T${current.start}:00`);
      return {
        ...current,
        typeId: next.id,
        legacyType: next.legacy_type ?? current.legacyType,
        title: keepTitle ? current.title : next.name,
        end:
          event || Number.isNaN(start.getTime())
            ? current.end
            : format(addMinutes(start, next.default_duration_min), "HH:mm"),
        allDay: next.kind === "bloqueio" ? true : current.allDay,
      };
    });
    if (next.requires_customer) setWithCustomer(true);
  }

  function chooseLegacy(key: AppointmentType) {
    setForm((current) => ({
      ...current,
      legacyType: key,
      title:
        !current.title.trim() || current.title === TYPE_LABEL[current.legacyType].label
          ? TYPE_LABEL[key].label
          : current.title,
    }));
  }

  function setDuration(minutes: number) {
    const start = new Date(`${form.date}T${form.start}:00`);
    if (Number.isNaN(start.getTime())) return;
    setForm((current) => ({
      ...current,
      allDay: false,
      end: format(addMinutes(start, minutes), "HH:mm"),
    }));
  }

  function selectLead(id: string) {
    const lead = leads.find((item) => item.id === id);
    setForm((current) => ({
      ...current,
      leadId: id,
      quoteId: null,
      customerName: lead?.name ?? current.customerName,
      customerPhone: lead?.phone ?? current.customerPhone,
      product: current.product || lead?.product || "",
    }));
    setClientSearch("");
    setSearchOpen(false);
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

  const steps = [
    { label: "Quando", hint: event ? "Confira o que e quando." : "O que vai acontecer e quando?" },
    { label: "Pessoas", hint: "Com quem e quem da equipe participa?" },
    { label: "Detalhes", hint: "Onde é e o que será feito?" },
  ];
  const whenLabel = !validTimes
    ? ""
    : form.allDay
      ? format(times.start, "EEEE, d 'de' MMMM · 'dia inteiro'", { locale: ptBR })
      : `${format(times.start, "EEEE, d 'de' MMMM · HH:mm", { locale: ptBR })} – ${format(times.end, "HH:mm")}`;

  return (
    <div className="lq-black-backdrop" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={event ? "Editar compromisso" : "Novo compromisso"}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === "Escape") onClose();
        }}
        className="quote-form lq-black lq-panel lq-form"
      >
        <span className="lq-panel-glow" aria-hidden="true" />
        <div className="lq-form-head">
          <div className="lq-form-title">
            <div>
              <h2>{event ? "Editar compromisso" : "Novo compromisso"}</h2>
              <p>{steps[step - 1].hint}</p>
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Fechar formulário"
              className="lq-close"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
          <nav className="lq-stepper" aria-label={`Etapa ${step} de 3`}>
            {steps.map((item, index) => {
              const target = index + 1;
              return (
                <button
                  type="button"
                  key={item.label}
                  onClick={() => goTo(target)}
                  disabled={!canReach(target)}
                  aria-current={target === step ? "step" : undefined}
                  data-state={target === step ? "current" : target < step ? "done" : "todo"}
                >
                  <i aria-hidden="true" />
                  <span>{item.label}</span>
                </button>
              );
            })}
          </nav>
          {step === 2 && showCustomer && (
            <div className="lq-client-search">
              {selectedLead ? (
                <div className="lq-client-chip">
                  <span
                    className="lq-avatar"
                    aria-hidden="true"
                    style={{ "--hue": quoteHue(selectedLead.id) } as CSSProperties}
                  >
                    {quoteInitials(selectedLead.name)}
                  </span>
                  <span>
                    <b>{selectedLead.name}</b> <small>· cliente cadastrado</small>
                  </span>
                  <button
                    type="button"
                    onClick={() =>
                      setForm((current) => ({ ...current, leadId: null, quoteId: null }))
                    }
                  >
                    Trocar
                  </button>
                </div>
              ) : (
                <>
                  <div className="lq-client-box">
                    <Search aria-hidden="true" />
                    <input
                      value={clientSearch}
                      onFocus={() => setSearchOpen(true)}
                      onChange={(e) => {
                        setClientSearch(e.target.value);
                        setSearchOpen(true);
                      }}
                      placeholder="Buscar cliente por nome ou telefone"
                      aria-label="Pesquisar cliente"
                      className="quote-form-search"
                    />
                    <button
                      type="button"
                      onClick={() => {
                        setSearchOpen(false);
                        setClientSearch("");
                      }}
                    >
                      <UserPlus aria-hidden="true" />
                      Novo
                    </button>
                  </div>
                  {searchOpen && clientSearch.trim() && (
                    <div className="lq-client-results">
                      {filteredLeads.length ? (
                        filteredLeads.map((lead) => (
                          <button type="button" key={lead.id} onClick={() => selectLead(lead.id)}>
                            <span
                              className="lq-avatar"
                              aria-hidden="true"
                              style={
                                {
                                  "--hue": quoteHue(lead.id),
                                  width: 32,
                                  height: 32,
                                  fontSize: 11,
                                } as CSSProperties
                              }
                            >
                              {quoteInitials(lead.name)}
                            </span>
                            <span className="min-w-0">
                              <b className="truncate">{lead.name}</b>
                              <small>{lead.phone || lead.handle || lead.channel}</small>
                            </span>
                          </button>
                        ))
                      ) : (
                        <p>Nenhum cliente encontrado. Toque em Novo e preencha abaixo.</p>
                      )}
                    </div>
                  )}
                </>
              )}
            </div>
          )}
        </div>

        <div className="lq-form-body" onClick={() => searchOpen && setSearchOpen(false)}>
          <motion.div
            key={step}
            initial={reduceMotion ? false : { opacity: 0, x: direction * 28 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
          >
            {step === 1 && (
              <>
                <section className="lq-section">
                  <SectionTitle icon={<Tag />}>Tipo</SectionTitle>
                  <div
                    className="lq-chips lq-chips-lg"
                    role="radiogroup"
                    aria-label="Tipo de compromisso"
                  >
                    {activeTypes.length
                      ? activeTypes.map((item) => (
                          <button
                            type="button"
                            key={item.id}
                            role="radio"
                            aria-checked={form.typeId === item.id}
                            onClick={() => chooseType(item)}
                          >
                            <TypeDot hue={item.hue} />
                            {item.name}
                          </button>
                        ))
                      : TYPE_KEYS.map((key) => (
                          <button
                            type="button"
                            key={key}
                            role="radio"
                            aria-checked={form.legacyType === key}
                            onClick={() => chooseLegacy(key)}
                          >
                            <TypeDot hue={TYPE_HUE[key]} />
                            {TYPE_LABEL[key].label}
                          </button>
                        ))}
                  </div>
                </section>
                <section className="lq-section">
                  <SectionTitle icon={<CalendarClock />}>Quando</SectionTitle>
                  <div className="lq-fields">
                    <FormField label="Título" className="lq-span-2">
                      <input
                        value={form.title}
                        maxLength={160}
                        autoFocus={!event}
                        placeholder="Ex.: Reunião de alinhamento, Visita ao cliente…"
                        onChange={(e) => set("title", e.target.value)}
                        className={inputClass}
                      />
                    </FormField>
                    <FormField label="Data" className="lq-span-2">
                      <input
                        type="date"
                        value={form.date}
                        onChange={(e) => set("date", e.target.value)}
                        className={inputClass}
                      />
                    </FormField>
                    <FormField label="Início">
                      <input
                        type="time"
                        value={form.start}
                        disabled={form.allDay}
                        onChange={(e) => set("start", e.target.value)}
                        className={inputClass}
                      />
                    </FormField>
                    <FormField label="Fim">
                      <input
                        type="time"
                        value={form.end}
                        disabled={form.allDay}
                        onChange={(e) => set("end", e.target.value)}
                        className={inputClass}
                      />
                    </FormField>
                  </div>
                  <div className="lq-chips mt-3" role="group" aria-label="Duração rápida">
                    {DURATIONS.map((item) => (
                      <button
                        type="button"
                        key={item.minutes}
                        aria-pressed={!form.allDay && durationMin === item.minutes}
                        onClick={() => setDuration(item.minutes)}
                      >
                        {item.label}
                      </button>
                    ))}
                    {extended && (
                      <button
                        type="button"
                        aria-pressed={form.allDay}
                        onClick={() => set("allDay", !form.allDay)}
                      >
                        Dia inteiro
                      </button>
                    )}
                  </div>
                </section>
                <section className="lq-section">
                  <SectionTitle icon={<Check />}>Status</SectionTitle>
                  <div className="lq-chips" role="radiogroup" aria-label="Status">
                    {STATUS_KEYS.map((status) => (
                      <button
                        type="button"
                        key={status}
                        role="radio"
                        aria-checked={form.status === status}
                        onClick={() => set("status", status)}
                      >
                        {STATUS_LABEL[status]}
                      </button>
                    ))}
                  </div>
                </section>
              </>
            )}

            {step === 2 && (
              <>
                <section className="lq-section">
                  <SectionTitle icon={<UserRound />}>Cliente</SectionTitle>
                  {!needsCustomer && (
                    <div className="lq-chips mb-3" role="radiogroup" aria-label="Tem cliente?">
                      <button
                        type="button"
                        role="radio"
                        aria-checked={!showCustomer}
                        onClick={() => {
                          setWithCustomer(false);
                          setForm((current) => ({
                            ...current,
                            leadId: null,
                            quoteId: null,
                            customerName: "",
                            customerPhone: "",
                          }));
                        }}
                      >
                        Compromisso interno
                      </button>
                      <button
                        type="button"
                        role="radio"
                        aria-checked={showCustomer}
                        onClick={() => setWithCustomer(true)}
                      >
                        Com cliente
                      </button>
                    </div>
                  )}
                  {showCustomer ? (
                    <div className="lq-fields">
                      <FormField label={needsCustomer ? "Nome *" : "Nome"}>
                        <input
                          value={form.customerName}
                          autoComplete="name"
                          onChange={(e) => set("customerName", e.target.value)}
                          className={inputClass}
                        />
                      </FormField>
                      <FormField label="Telefone">
                        <input
                          type="tel"
                          value={form.customerPhone}
                          placeholder="(00) 00000-0000"
                          onChange={(e) => set("customerPhone", e.target.value)}
                          className={inputClass}
                        />
                      </FormField>
                      {leadQuotes.length > 0 && (
                        <FormField label="Orçamento" className="lq-span-2">
                          <select
                            value={form.quoteId ?? ""}
                            onChange={(e) => set("quoteId", e.target.value || null)}
                            className={inputClass}
                          >
                            <option value="">Nenhum</option>
                            {leadQuotes.map((quote) => (
                              <option key={quote.id} value={quote.id}>
                                {quote.productName} · {formatBRL(quote.finalValue)}
                              </option>
                            ))}
                          </select>
                        </FormField>
                      )}
                    </div>
                  ) : (
                    <p className="lq-hint">Sem cliente: reunião, tarefa, treinamento, folga…</p>
                  )}
                </section>
                <section className="lq-section">
                  <SectionTitle icon={<Users />}>Equipe</SectionTitle>
                  <div className="lq-fields">
                    <FormField label="Responsável">
                      <input
                        value={form.salesperson}
                        placeholder="Quem conduz"
                        onChange={(e) => set("salesperson", e.target.value)}
                        className={inputClass}
                      />
                    </FormField>
                    <FormField label="Executor / técnico">
                      <input
                        value={form.technician}
                        placeholder="Quem executa"
                        onChange={(e) => set("technician", e.target.value)}
                        className={inputClass}
                      />
                    </FormField>
                  </div>
                </section>
              </>
            )}

            {step === 3 && (
              <>
                <section className="lq-section">
                  <SectionTitle icon={<MapPin />}>Local</SectionTitle>
                  <div className="lq-fields">
                    <FormField label="Cidade">
                      <input
                        value={form.city}
                        onChange={(e) => set("city", e.target.value)}
                        className={inputClass}
                      />
                    </FormField>
                    <FormField label="Produto ou serviço">
                      <input
                        value={form.product}
                        onChange={(e) => set("product", e.target.value)}
                        className={inputClass}
                      />
                    </FormField>
                    <FormField
                      label={type?.requires_address ? "Endereço *" : "Endereço ou link da reunião"}
                      className="lq-span-2"
                    >
                      <input
                        value={form.address}
                        onChange={(e) => set("address", e.target.value)}
                        className={inputClass}
                      />
                    </FormField>
                  </div>
                </section>
                <section className="lq-section">
                  <SectionTitle icon={<NotebookPen />}>O que será feito</SectionTitle>
                  <div className="lq-fields">
                    {type?.fields.map((field) => (
                      <FormField key={field.key} label={field.label}>
                        {field.type === "boolean" ? (
                          <select
                            value={form.customFields[field.key] === true ? "sim" : "nao"}
                            onChange={(e) =>
                              set("customFields", {
                                ...form.customFields,
                                [field.key]: e.target.value === "sim",
                              })
                            }
                            className={inputClass}
                          >
                            <option value="nao">Não</option>
                            <option value="sim">Sim</option>
                          </select>
                        ) : (
                          <input
                            type={
                              field.type === "number"
                                ? "number"
                                : field.type === "date"
                                  ? "date"
                                  : "text"
                            }
                            value={String(form.customFields[field.key] ?? "")}
                            onChange={(e) =>
                              set("customFields", {
                                ...form.customFields,
                                [field.key]:
                                  field.type === "number" ? Number(e.target.value) : e.target.value,
                              })
                            }
                            className={inputClass}
                          />
                        )}
                      </FormField>
                    ))}
                    <FormField label="Notas" className="lq-span-2">
                      <textarea
                        rows={5}
                        value={form.notes}
                        placeholder="Pauta, orientações, materiais, observações…"
                        onChange={(e) => set("notes", e.target.value)}
                        className={inputClass}
                      />
                    </FormField>
                  </div>
                </section>
                <div className="lq-total" aria-live="polite">
                  <dl>
                    <dt>Tipo</dt>
                    <dd>{typeName}</dd>
                    <dt>Cliente</dt>
                    <dd>{form.customerName.trim() || "Interno"}</dd>
                    <dt>Equipe</dt>
                    <dd>
                      {[form.salesperson, form.technician]
                        .filter((name) => name.trim())
                        .join(" · ") || "A definir"}
                    </dd>
                  </dl>
                  <div className="lq-total-final">
                    <span className="first-letter:uppercase">{whenLabel}</span>
                    <strong className="flex items-center gap-2">
                      <TypeDot hue={typeHue} />
                      {form.title.trim() || "Sem título"}
                    </strong>
                  </div>
                </div>
                {extended && type?.checklist_template.length ? (
                  <details className="lq-extra">
                    <summary>
                      <Check className="h-4 w-4 text-white/60" aria-hidden="true" />
                      Checklist do tipo
                      <small>{type.checklist_template.length} itens</small>
                      <ChevronDown aria-hidden="true" />
                    </summary>
                    <div className="lq-extra-body">
                      <ul className="list-disc space-y-1 pl-5 text-sm text-white/70">
                        {type.checklist_template.map((item) => (
                          <li key={item}>{item}</li>
                        ))}
                      </ul>
                    </div>
                  </details>
                ) : null}
              </>
            )}
          </motion.div>
        </div>

        <div className="lq-form-foot">
          {step > 1 ? (
            <button type="button" onClick={() => goTo(step - 1)} className="lq-secondary">
              Voltar
            </button>
          ) : null}
          <p className="lq-foot-note">
            {step === 1 ? (
              whenValid ? (
                <span className="first-letter:uppercase">{whenLabel}</span>
              ) : (
                "Dê um título e escolha data e horário."
              )
            ) : step === 2 ? (
              peopleValid ? (
                form.customerName.trim() ? (
                  `Cliente: ${form.customerName.trim()}`
                ) : (
                  "Compromisso interno"
                )
              ) : (
                `"${typeName}" precisa de um cliente.`
              )
            ) : (
              <>
                {typeName} · <b>{form.title.trim() || "Sem título"}</b>
              </>
            )}
          </p>
          {step < 3 ? (
            <button
              type="button"
              disabled={step === 1 ? !whenValid : !peopleValid}
              onClick={() => goTo(step + 1)}
              className="lq-primary"
            >
              Avançar
              <ArrowRight aria-hidden="true" />
            </button>
          ) : (
            <button
              type="button"
              disabled={saving}
              onClick={() => void save()}
              className="lq-primary"
            >
              {saving ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Check className="h-4 w-4" />
              )}
              {event ? "Salvar" : "Agendar"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function TypeDot({ hue }: { hue: number }) {
  return (
    <span
      aria-hidden="true"
      className="mr-2 inline-block h-2 w-2 shrink-0 rounded-full align-middle"
      style={{ background: `oklch(0.7 0.08 ${hue})` }}
    />
  );
}
