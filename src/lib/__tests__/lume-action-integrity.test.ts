import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  stored: null as Record<string, unknown> | null,
  executed: [] as unknown[],
  updates: [] as unknown[],
}));

vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({
    auth: { getUser: async () => ({ data: { user: { id: "u1" } }, error: null }) },
    from: (table: string) => {
      const builder: Record<string, unknown> = {};
      for (const method of ["select", "eq", "limit"]) builder[method] = () => builder;
      builder.maybeSingle = async () => ({
        data: table === "profiles" ? { company_id: "c1", display_name: "Ana" } : null,
        error: null,
      });
      builder.then = (resolve: (v: unknown) => unknown) =>
        Promise.resolve({ data: [], error: null }).then(resolve);
      return builder;
    },
  }),
}));

vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: {
    from: () => {
      const builder: Record<string, unknown> = {};
      for (const method of ["select", "eq"]) builder[method] = () => builder;
      builder.update = (patch: unknown) => {
        state.updates.push(patch);
        return builder;
      };
      builder.maybeSingle = async () => ({ data: state.stored, error: null });
      builder.then = (resolve: (v: unknown) => unknown) =>
        Promise.resolve({ data: null, error: null }).then(resolve);
      return builder;
    },
  },
}));

vi.mock("@/lib/lume/domains/agenda.server", () => ({
  agendaDomain: {
    id: "agenda",
    instructions: () => "",
    undo: async () => {},
    tools: [
      {
        name: "agenda_excluir",
        domain: "agenda",
        description: "",
        parameters: { type: "object", properties: {} },
        risk: "confirm",
        summarize: () => "Excluir",
        execute: async (args: unknown) => {
          state.executed.push(args);
          return { output: { excluidos: 1 } };
        },
      },
    ],
  },
}));

import { handleLumeAction } from "@/lib/lume/http.server";

function request(body: Record<string, unknown>) {
  return new Request("http://localhost/api/lume/action", {
    method: "POST",
    headers: { Authorization: "Bearer t", "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.stubEnv("SUPABASE_URL", "https://x.supabase.co");
  vi.stubEnv("SUPABASE_PUBLISHABLE_KEY", "pk");
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "sr");
  state.stored = null;
  state.executed = [];
  state.updates = [];
});

describe("decisões da Lume usam a ação guardada no servidor", () => {
  it("recusa id sem ação guardada (nada a forjar)", async () => {
    const response = await handleLumeAction(
      request({ decision: "cancel", id: "forjado", tool: "x", summary: "mentira" }),
    );
    expect(response.status).toBe(404);
    expect(state.updates).toEqual([]);
  });

  it("executa a ferramenta e os dados guardados, ignorando os do pedido", async () => {
    state.stored = {
      id: "a1",
      tool: "agenda_excluir",
      summary: "Excluir visita",
      input: { ids: ["e-guardado"] },
      status: "pendente",
      undo: null,
    };
    const response = await handleLumeAction(
      request({ decision: "confirm", id: "a1", tool: "outra", args: { ids: ["e-do-pedido"] } }),
    );
    expect(response.status).toBe(200);
    expect(state.executed).toEqual([{ ids: ["e-guardado"] }]);
    expect(state.updates[0]).toMatchObject({ status: "confirmada" });
  });

  it("não decide de novo uma ação já confirmada", async () => {
    state.stored = { id: "a1", tool: "agenda_excluir", summary: "", input: {}, status: "confirmada", undo: null };
    const response = await handleLumeAction(request({ decision: "confirm", id: "a1" }));
    expect(response.status).toBe(409);
    expect(state.executed).toEqual([]);
  });
});
