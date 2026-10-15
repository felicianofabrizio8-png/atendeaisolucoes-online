import { describe, expect, it } from "vitest";
import { agendaDomain } from "@/lib/lume/domains/agenda.server";
import type { LumeContext } from "@/lib/lume/types";

/** Banco simulado: registra o que a Lume grava e devolve linhas pré-definidas. */
function fakeClient(rows: Record<string, Array<Record<string, unknown>>> = {}) {
  const writes: Array<{ table: string; op: string; payload: unknown }> = [];
  const client = {
    writes,
    failInsert: null as string | null,
    from(table: string) {
      const data = rows[table] ?? [];
      let op = "select";
      let payload: unknown = null;
      const builder: Record<string, unknown> = {};
      for (const method of ["select", "eq", "neq", "in", "gte", "lte", "lt", "order", "limit"])
        builder[method] = () => builder;
      for (const method of ["insert", "update", "delete"])
        builder[method] = (value?: unknown) => {
          op = method;
          payload = value ?? null;
          writes.push({ table, op, payload });
          return builder;
        };
      builder.single = async () =>
        op === "insert" && table === "visits" && client.failInsert
          ? { data: null, error: { message: client.failInsert } }
          : { data: op === "insert" ? { id: "novo-1" } : data[0], error: null };
      builder.maybeSingle = async () => ({ data: data[0] ?? null, error: null });
      builder.then = (resolve: (value: unknown) => unknown) =>
        Promise.resolve({ data: op === "select" ? data : [{ id: "n1" }], error: null }).then(resolve);
      return builder;
    },
  };
  return client;
}

function context(client: ReturnType<typeof fakeClient>, extended = true): LumeContext {
  return {
    client: client as never,
    companyId: "c1",
    userId: "u1",
    userName: "Ana",
    timeZone: "America/Sao_Paulo",
    now: new Date("2026-10-15T12:00:00Z"),
    extended,
  };
}

const tool = (name: string) => agendaDomain.tools.find((item) => item.name === name)!;

describe("Lume na Agenda", () => {
  it("cria no horário local certo, marcado como vindo da Lume, com checklist do tipo", async () => {
    const client = fakeClient({
      agenda_event_types: [
        {
          id: "t1",
          name: "Visita externa",
          kind: "visita",
          default_duration_min: 90,
          requires_customer: true,
          requires_address: false,
          checklist_template: ["Registrar chegada"],
          fields: [],
          legacy_type: "visita_tecnica",
          hue: 230,
          active: true,
        },
      ],
    });
    const result = await tool("agenda_criar").execute(
      { titulo: "Visita João", inicio: "2026-10-16T14:00", tipo: "visita externa", cliente: "João" } as never,
      context(client),
    );
    const insert = client.writes.find((write) => write.table === "visits")!.payload as Record<string, unknown>;
    expect(insert.scheduled_at).toBe("2026-10-16T17:00:00.000Z");
    expect(insert.ends_at).toBe("2026-10-16T18:30:00.000Z");
    expect(insert.source).toBe("lume");
    expect(insert.event_type_id).toBe("t1");
    expect(insert.appointment_type).toBe("visita_tecnica");
    expect(client.writes.some((write) => write.table === "agenda_checklist_items")).toBe(true);
    expect(result.undo).toEqual({ op: "delete_events", ids: ["novo-1"] });
  });

  it("recusa sem gravar quando o tipo exige cliente", async () => {
    const client = fakeClient({
      agenda_event_types: [
        { id: "t1", name: "Visita externa", requires_customer: true, requires_address: false, checklist_template: [], default_duration_min: 60 },
      ],
    });
    const result = await tool("agenda_criar").execute(
      { titulo: "Visita", inicio: "2026-10-16T14:00", tipo: "Visita externa" } as never,
      context(client),
    );
    expect((result.output as { erro: string }).erro).toMatch(/cliente/);
    expect(client.writes).toEqual([]);
  });

  it("antes de publicar a estrutura nova, grava só colunas de sempre", async () => {
    const client = fakeClient();
    await tool("agenda_criar").execute(
      { titulo: "Reunião", inicio: "2026-10-16T09:00", duracao_min: 30 } as never,
      context(client, false),
    );
    const insert = client.writes[0].payload as Record<string, unknown>;
    expect(insert).not.toHaveProperty("source");
    expect(insert).not.toHaveProperty("ends_at");
  });

  it("alterar e excluir pedem confirmação; criar e listar não", () => {
    const risks = Object.fromEntries(agendaDomain.tools.map((item) => [item.name, item.risk]));
    expect(risks).toMatchObject({
      agenda_listar: "read",
      agenda_horarios_livres: "read",
      agenda_criar: "safe",
      agenda_lembrete: "safe",
      agenda_alterar: "confirm",
      agenda_excluir: "confirm",
      equipe_avisar: "confirm",
      automacao_criar: "confirm",
    });
  });

  it("alterar guarda os valores anteriores para desfazer", async () => {
    const client = fakeClient({
      visits: [
        {
          id: "e1",
          company_id: "c1",
          title: "Reunião",
          scheduled_at: "2026-10-16T12:00:00.000Z",
          ends_at: "2026-10-16T13:00:00.000Z",
          status: "agendada",
          technician: null,
          salesperson: null,
          appointment_type: "retorno_comercial",
        },
      ],
    });
    const result = await tool("agenda_alterar").execute(
      { id: "e1", inicio: "2026-10-16T15:00", status: "confirmada" } as never,
      context(client),
    );
    const update = client.writes.find((write) => write.op === "update")!.payload as Record<string, unknown>;
    expect(update.scheduled_at).toBe("2026-10-16T18:00:00.000Z");
    expect(update.ends_at).toBe("2026-10-16T19:00:00.000Z");
    expect(result.undo).toEqual({
      op: "update_event",
      id: "e1",
      changes: {
        scheduled_at: "2026-10-16T12:00:00.000Z",
        ends_at: "2026-10-16T13:00:00.000Z",
        status: "agendada",
      },
    });
  });

  it("não desfaz em tabela fora da lista permitida", async () => {
    await expect(
      agendaDomain.undo({ op: "delete_rows", table: "leads", ids: ["x"] }, context(fakeClient())),
    ).rejects.toThrow();
  });

it("cria de equipe com participantes e tags pelo nome", async () => {
  const client = fakeClient({
    agenda_tags: [{ id: "t1", name: "Comercial", owner_id: null }],
    profiles: [{ id: "u2", display_name: "Bruno" }],
  });
  await tool("agenda_criar").execute(
    { titulo: "Treino", inicio: "2026-10-16T09:00", alcance: "equipe", participantes: ["bruno"], tags: ["comercial"] } as never,
    context(client),
  );
  const visit = client.writes.find((w) => w.table === "visits")!.payload as Record<string, unknown>;
  expect(visit).toMatchObject({ scope: "equipe", everyone: false });
  expect(client.writes.some((w) => w.table === "agenda_event_participants")).toBe(true);
  expect(client.writes.some((w) => w.table === "agenda_event_tags")).toBe(true);
});
it("explica quando o banco recusa compromisso de equipe", async () => {
  const client = fakeClient();
  client.failInsert = "Só a gestão da agenda cria compromissos da equipe";
  const result = await tool("agenda_criar").execute(
    { titulo: "Geral", inicio: "2026-10-16T09:00", alcance: "equipe" } as never,
    context(client),
  );
  expect((result.output as { erro: string }).erro).toMatch(/gestão da agenda/);
});
});
