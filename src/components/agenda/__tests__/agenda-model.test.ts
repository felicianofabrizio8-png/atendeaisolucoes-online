import { describe, expect, it } from "vitest";
import {
  applyFilters,
  EMPTY_FILTERS,
  findConflicts,
  layoutDay,
  peopleOf,
  pulseOf,
  shiftFocus,
  viewRange,
  type AgendaEvent,
} from "../agenda-model";

function event(id: string, at: string, extra: Partial<AgendaEvent> = {}): AgendaEvent {
  return {
    id,
    title: `Evento ${id}`,
    address: null,
    scheduled_at: new Date(at).toISOString(),
    status: "agendada",
    notes: null,
    customer_name: null,
    customer_phone: null,
    product: null,
    lead_id: null,
    quote_id: null,
    appointment_type: "visita_tecnica",
    city: null,
    salesperson: null,
    technician: null,
    ...extra,
  };
}

describe("agenda-model", () => {
  it("semana começa na segunda e mês cobre semanas inteiras", () => {
    const week = viewRange("semana", new Date(2026, 9, 15));
    expect(week.from.getDay()).toBe(1);
    expect(week.to.getDay()).toBe(0);
    const month = viewRange("mes", new Date(2026, 9, 15));
    expect(month.from <= new Date(2026, 9, 1)).toBe(true);
    expect(month.to >= new Date(2026, 9, 31)).toBe(true);
  });

  it("navega pelo passo da visão", () => {
    const focus = new Date(2026, 9, 15);
    expect(shiftFocus("dia", focus, 1).getDate()).toBe(16);
    expect(shiftFocus("semana", focus, -1).getDate()).toBe(8);
    expect(shiftFocus("mes", focus, 1).getMonth()).toBe(10);
  });

  it("divide a largura só entre eventos sobrepostos", () => {
    const day = new Date(2026, 9, 15);
    const placed = layoutDay(
      [
        event("a", "2026-10-15T09:00:00"),
        event("b", "2026-10-15T09:30:00"),
        event("c", "2026-10-15T14:00:00"),
      ],
      day,
    );
    const byId = Object.fromEntries(placed.map((p) => [p.event.id, p]));
    expect(byId.a.columns).toBe(2);
    expect(byId.b.column).toBe(1);
    expect(byId.c.columns).toBe(1);
    expect(byId.a.top).toBe(9 * 60);
  });

  it("aponta conflito da mesma pessoa e ignora cancelados", () => {
    const conflicts = findConflicts([
      event("a", "2026-10-15T09:00:00", { technician: "Ana" }),
      event("b", "2026-10-15T09:30:00", { technician: "Ana" }),
      event("c", "2026-10-15T09:30:00", { technician: "Bruno" }),
      event("d", "2026-10-15T09:15:00", { technician: "Ana", status: "cancelada" }),
    ]);
    expect([...conflicts].sort()).toEqual(["a", "b"]);
  });

  it("filtra por busca sem acento, tipo, status e pessoa", () => {
    const events = [
      event("a", "2026-10-15T09:00:00", { city: "São Paulo", technician: "Ana" }),
      event("b", "2026-10-15T10:00:00", { appointment_type: "loja", status: "concluida" }),
    ];
    expect(
      applyFilters(events, { ...EMPTY_FILTERS, search: "sao paulo" }).map((e) => e.id),
    ).toEqual(["a"]);
    expect(applyFilters(events, { ...EMPTY_FILTERS, types: ["loja"] }).map((e) => e.id)).toEqual([
      "b",
    ]);
    expect(
      applyFilters(events, { ...EMPTY_FILTERS, statuses: ["concluida"] }).map((e) => e.id),
    ).toEqual(["b"]);
    expect(applyFilters(events, { ...EMPTY_FILTERS, person: "Ana" }).map((e) => e.id)).toEqual([
      "a",
    ]);
    expect(peopleOf(events)).toEqual(["Ana"]);
  });

  it("resume o pulso da agenda e o próximo compromisso", () => {
    const now = new Date(2026, 9, 15, 8, 0);
    const pulse = pulseOf(
      [
        event("a", "2026-10-15T09:00:00"),
        event("b", "2026-10-15T07:00:00", { status: "concluida" }),
        event("c", "2026-10-16T09:00:00", { status: "cancelada" }),
      ],
      now,
    );
    expect(pulse.today).toBe(2);
    expect(pulse.week).toBe(2);
    expect(pulse.done).toBe(1);
    expect(pulse.next?.id).toBe("a");
  });
});
