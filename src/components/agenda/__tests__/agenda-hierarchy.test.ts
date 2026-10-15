import { describe, expect, it } from "vitest";
import { canEditEvent, matchesScope, type AgendaEvent } from "../agenda-model";

const base = {
  id: "e",
  title: "t",
  address: null,
  scheduled_at: "2026-10-16T12:00:00Z",
  status: "agendada",
  notes: null,
  customer_name: null,
  customer_phone: null,
  product: null,
  lead_id: null,
  quote_id: null,
  appointment_type: "retorno_comercial",
  city: null,
  salesperson: null,
  technician: null,
} as AgendaEvent;

describe("hierarquia na tela", () => {
  const mine = { ...base, owner_id: "me", scope: "pessoal" } as AgendaEvent;
  const team = {
    ...base,
    owner_id: "boss",
    scope: "equipe",
    participant_ids: ["me"],
  } as AgendaEvent;
  const other = { ...base, owner_id: "x", scope: "pessoal" } as AgendaEvent;

  it("Minha agenda: os meus e os de equipe em que participo", () => {
    expect(matchesScope(mine, { kind: "minha" }, "me")).toBe(true);
    expect(matchesScope(team, { kind: "minha" }, "me")).toBe(true);
    expect(matchesScope(other, { kind: "minha" }, "me")).toBe(false);
  });
  it("Pessoa: os dela como dona ou participante", () => {
    expect(matchesScope(other, { kind: "pessoa", userId: "x" }, "me")).toBe(true);
    expect(matchesScope(team, { kind: "pessoa", userId: "me" }, "boss")).toBe(true);
  });
  it("edição: gestor tudo; funcionário só o pessoal dele; sem hierarquia, como hoje", () => {
    expect(canEditEvent(team, "me", false)).toBe(false);
    expect(canEditEvent(mine, "me", false)).toBe(true);
    expect(canEditEvent(other, "me", true)).toBe(true);
    expect(canEditEvent(base, "me", false)).toBe(true);
  });
});

describe("detecção da hierarquia no banco", () => {
  it("sem a migração de hierarquia, a Agenda segue como hoje", async () => {
    const { vi } = await import("vitest");
    vi.resetModules();
    vi.doMock("@/integrations/supabase/client", () => ({
      supabase: {
        from: (table: string) => ({
          select: () => ({
            limit: async () => ({ error: table === "agenda_tags" ? { code: "42P01" } : null }),
          }),
        }),
      },
    }));
    const { detectAgendaSchema } = await import("../agenda-schema");
    expect(await detectAgendaSchema()).toEqual({ extended: true, hierarchy: false });
    vi.doUnmock("@/integrations/supabase/client");
  });
});
