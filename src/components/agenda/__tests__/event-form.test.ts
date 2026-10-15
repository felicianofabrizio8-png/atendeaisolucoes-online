import { describe, expect, it } from "vitest";
import { buildEventRow, emptyForm, formFromEvent, formTimes, validateForm } from "../event-form";
import type { AgendaEventType } from "../agenda-model";

const visitType: AgendaEventType = {
  id: "t1",
  name: "Visita externa",
  hue: 230,
  icon: "map-pin",
  kind: "visita",
  default_duration_min: 90,
  requires_customer: true,
  requires_address: true,
  checklist_template: [],
  fields: [],
  legacy_type: "visita_tecnica",
  position: 0,
  active: true,
};

describe("event-form", () => {
  it("parte do tipo: título, duração e tipo legado", () => {
    const form = emptyForm(new Date(2026, 9, 15, 9, 0), visitType);
    expect(form.title).toBe("Visita externa");
    expect(form.end).toBe("10:30");
    expect(form.legacyType).toBe("visita_tecnica");
  });

  it("exige cliente e endereço só quando o tipo pede", () => {
    const form = { ...emptyForm(new Date(2026, 9, 15, 9, 0), visitType) };
    expect(validateForm(form, visitType)).toMatch(/cliente/);
    expect(validateForm({ ...form, customerName: "Ana" }, visitType)).toMatch(/endereço/);
    expect(validateForm({ ...form, customerName: "Ana", address: "Rua 1" }, visitType)).toBeNull();
    expect(validateForm({ ...form, title: "Reunião interna" }, null)).toBeNull();
  });

  it("fim antes do início vira o dia seguinte e dia inteiro cobre o dia", () => {
    const night = formTimes({ date: "2026-10-15", start: "22:00", end: "02:00", allDay: false });
    expect(night.end.getDate()).toBe(16);
    const all = formTimes({ date: "2026-10-15", start: "", end: "", allDay: true });
    expect(all.start.getHours()).toBe(0);
    expect(all.end.getHours()).toBe(23);
  });

  it("sem a estrutura nova grava só as colunas de sempre", () => {
    const form = { ...emptyForm(new Date(2026, 9, 15, 9, 0)), title: "Reunião" };
    const base = buildEventRow(form, { companyId: "c1", extended: false });
    expect(base).not.toHaveProperty("ends_at");
    expect(base).not.toHaveProperty("source");
    const full = buildEventRow(form, { companyId: "c1", extended: true, source: "lume" });
    expect(full.source).toBe("lume");
    expect(full.ends_at).toBe(new Date(2026, 9, 15, 10, 0).toISOString());
    expect(full.customer_name).toBeNull();
  });

  it("ida e volta de um evento existente preserva os dados", () => {
    const form = formFromEvent({
      id: "e1",
      title: "Instalação",
      address: "Rua 1",
      scheduled_at: new Date(2026, 9, 15, 14, 0).toISOString(),
      ends_at: new Date(2026, 9, 15, 16, 30).toISOString(),
      status: "confirmada",
      notes: null,
      customer_name: "Ana",
      customer_phone: null,
      product: null,
      lead_id: null,
      quote_id: null,
      appointment_type: "instalacao",
      city: null,
      salesperson: null,
      technician: "Bruno",
    });
    expect(form.start).toBe("14:00");
    expect(form.end).toBe("16:30");
    expect(form.technician).toBe("Bruno");
  });

  it("com hierarquia grava alcance, toda a equipe e dono", () => {
    const form = {
      ...emptyForm(new Date(2026, 9, 15, 9, 0)),
      title: "Treino",
      scope: "equipe" as const,
      everyone: true,
      ownerId: "boss",
    };
    const row = buildEventRow(form, { companyId: "c1", extended: true, hierarchy: true });
    expect(row).toMatchObject({ scope: "equipe", everyone: true, owner_id: "boss" });
    const legacy = buildEventRow(form, { companyId: "c1", extended: true, hierarchy: false });
    expect(legacy).not.toHaveProperty("scope");
  });
  it("pessoal nunca grava toda a equipe", () => {
    const form = { ...emptyForm(), title: "x", scope: "pessoal" as const, everyone: true };
    expect(buildEventRow(form, { companyId: "c1", extended: true, hierarchy: true }).everyone).toBe(
      false,
    );
  });
});
