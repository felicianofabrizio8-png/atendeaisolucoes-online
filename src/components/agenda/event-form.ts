import { addMinutes, endOfDay, format, startOfDay } from "date-fns";
import {
  eventDurationMin,
  type AgendaEvent,
  type AgendaEventType,
  type AppointmentType,
  type EventScope,
  type VisitStatus,
} from "./agenda-model";

/** Estado do formulário de compromisso — o mesmo para a tela e para a IA Lume. */
export interface EventForm {
  title: string;
  typeId: string | null;
  legacyType: AppointmentType;
  date: string; // yyyy-MM-dd
  start: string; // HH:mm
  end: string; // HH:mm
  allDay: boolean;
  status: VisitStatus;
  leadId: string | null;
  quoteId: string | null;
  customerName: string;
  customerPhone: string;
  city: string;
  address: string;
  product: string;
  salesperson: string;
  technician: string;
  notes: string;
  customFields: Record<string, string | number | boolean>;
  // Hierarquia: alcance, toda a equipe, dono, participantes e tags.
  scope: EventScope;
  everyone: boolean;
  ownerId: string | null;
  participantIds: string[];
  tagIds: string[];
}

export function emptyForm(
  at: Date = defaultStart(),
  type: AgendaEventType | null = null,
): EventForm {
  const duration = type?.default_duration_min ?? 60;
  return {
    title: type?.name ?? "",
    typeId: type?.id ?? null,
    legacyType: type?.legacy_type ?? "retorno_comercial",
    date: format(at, "yyyy-MM-dd"),
    start: format(at, "HH:mm"),
    end: format(addMinutes(at, duration), "HH:mm"),
    allDay: type?.kind === "bloqueio",
    status: "agendada",
    leadId: null,
    quoteId: null,
    customerName: "",
    customerPhone: "",
    city: "",
    address: "",
    product: "",
    salesperson: "",
    technician: "",
    notes: "",
    customFields: {},
    scope: "pessoal",
    everyone: false,
    ownerId: null,
    participantIds: [],
    tagIds: [],
  };
}

/** Próxima hora cheia. */
export function defaultStart(now = new Date()): Date {
  const next = new Date(now);
  next.setMinutes(0, 0, 0);
  next.setHours(next.getHours() + 1);
  return next;
}

export function formFromEvent(event: AgendaEvent): EventForm {
  const start = new Date(event.scheduled_at);
  const end = addMinutes(start, eventDurationMin(event));
  return {
    title: event.title,
    typeId: event.event_type_id ?? null,
    legacyType: event.appointment_type,
    date: format(start, "yyyy-MM-dd"),
    start: format(start, "HH:mm"),
    end: format(end, "HH:mm"),
    allDay: event.all_day ?? false,
    status: event.status,
    leadId: event.lead_id,
    quoteId: event.quote_id,
    customerName: event.customer_name ?? "",
    customerPhone: event.customer_phone ?? "",
    city: event.city ?? "",
    address: event.address ?? "",
    product: event.product ?? "",
    salesperson: event.salesperson ?? "",
    technician: event.technician ?? "",
    notes: event.notes ?? "",
    customFields: (event.custom_fields ?? {}) as EventForm["customFields"],
    scope: event.scope ?? "pessoal",
    everyone: event.everyone ?? false,
    ownerId: event.owner_id ?? null,
    participantIds: event.participant_ids ?? [],
    tagIds: event.tag_ids ?? [],
  };
}

export function formTimes(form: Pick<EventForm, "date" | "start" | "end" | "allDay">) {
  const day = new Date(`${form.date}T00:00:00`);
  if (form.allDay) return { start: startOfDay(day), end: endOfDay(day) };
  const start = new Date(`${form.date}T${form.start}:00`);
  let end = new Date(`${form.date}T${form.end}:00`);
  // Fim antes do início: termina no dia seguinte (plantão, evento noturno).
  if (end <= start) end = addMinutes(end, 24 * 60);
  return { start, end };
}

/** Mensagem do primeiro problema do formulário, ou null se está pronto para salvar. */
export function validateForm(form: EventForm, type: AgendaEventType | null): string | null {
  if (!form.title.trim()) return "Dê um título ao compromisso.";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(form.date)) return "Escolha a data.";
  if (!form.allDay && (!/^\d{2}:\d{2}$/.test(form.start) || !/^\d{2}:\d{2}$/.test(form.end)))
    return "Informe o horário de início e de fim.";
  const { start } = formTimes(form);
  if (Number.isNaN(start.getTime())) return "Data ou horário inválido.";
  if (type?.requires_customer && !form.customerName.trim() && !form.leadId)
    return `"${type.name}" precisa de um cliente.`;
  if (type?.requires_address && !form.address.trim())
    return `"${type.name}" precisa de um endereço.`;
  return null;
}

const clean = (value: string) => value.trim() || null;

/**
 * Linha para `visits`. Sem a estrutura nova (antes de publicar), só as colunas de sempre;
 * com ela, também fim, dia inteiro, tipo da empresa, campos e origem.
 */
export function buildEventRow(
  form: EventForm,
  options: { companyId: string; extended: boolean; hierarchy?: boolean; source?: "tela" | "lume" },
): Record<string, unknown> {
  const { start, end } = formTimes(form);
  const row: Record<string, unknown> = {
    company_id: options.companyId,
    title: form.title.trim(),
    appointment_type: form.legacyType,
    scheduled_at: start.toISOString(),
    status: form.status,
    lead_id: form.leadId,
    quote_id: form.quoteId,
    customer_name: clean(form.customerName),
    customer_phone: clean(form.customerPhone),
    city: clean(form.city),
    address: clean(form.address),
    product: clean(form.product),
    salesperson: clean(form.salesperson),
    technician: clean(form.technician),
    notes: clean(form.notes),
  };
  if (options.extended) {
    Object.assign(row, {
      ends_at: end.toISOString(),
      all_day: form.allDay,
      event_type_id: form.typeId,
      custom_fields: form.customFields,
      source: options.source ?? "tela",
    });
  }
  if (options.hierarchy) {
    Object.assign(row, {
      scope: form.scope,
      everyone: form.scope === "equipe" && form.everyone,
      ...(form.ownerId ? { owner_id: form.ownerId } : {}),
    });
  }
  return row;
}

/**
 * Grava só o que mudou nas tags e nos participantes do compromisso.
 * - Tags: só mexe nas que a pessoa pode usar (da empresa ou dela); tag pessoal de outra
 *   pessoa ligada ao compromisso fica como está.
 * - Participantes: só em compromisso da equipe, e só os de papel "participante" com conta;
 *   respostas (aceito/recusado) dos que continuam são preservadas.
 * Erro do banco vira exceção, para a tela avisar.
 */
export async function saveEventRelations(
  eventId: string,
  form: EventForm,
  companyId: string,
  members: Array<{ id: string; name: string }>,
  options: {
    previous: { tagIds: string[]; participantIds: string[] };
    editableTagIds: ReadonlySet<string>;
  },
) {
  const { supabase } = await import("@/integrations/supabase/client");
  const check = (result: { error: unknown }) => {
    if (result.error) throw new Error("Não foi possível gravar tags ou participantes.");
  };
  const { previous, editableTagIds } = options;

  const removedTags = previous.tagIds.filter(
    (id) => editableTagIds.has(id) && !form.tagIds.includes(id),
  );
  const addedTags = form.tagIds.filter((id) => editableTagIds.has(id) && !previous.tagIds.includes(id));
  if (removedTags.length)
    check(
      await supabase
        .from("agenda_event_tags" as never)
        .delete()
        .eq("event_id", eventId)
        .in("tag_id", removedTags),
    );
  if (addedTags.length)
    check(
      await supabase
        .from("agenda_event_tags" as never)
        .insert(
          addedTags.map((tag_id) => ({ company_id: companyId, event_id: eventId, tag_id })) as never,
        ),
    );

  if (form.scope !== "equipe") return;
  const removedPeople = previous.participantIds.filter((id) => !form.participantIds.includes(id));
  const addedPeople = form.participantIds.filter((id) => !previous.participantIds.includes(id));
  if (removedPeople.length)
    check(
      await supabase
        .from("agenda_event_participants" as never)
        .delete()
        .eq("event_id", eventId)
        .eq("role", "participante")
        .in("user_id", removedPeople),
    );
  if (addedPeople.length)
    check(
      await supabase.from("agenda_event_participants" as never).insert(
        addedPeople.map((user_id) => ({
          company_id: companyId,
          event_id: eventId,
          user_id,
          name: members.find((member) => member.id === user_id)?.name ?? "Membro",
          role: "participante",
        })) as never,
      ),
    );
}
