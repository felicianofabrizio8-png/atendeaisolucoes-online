// Vendedora IA · Fase 1 — devolver a conversa para a IA (escopo por empresa).
/* eslint-disable @typescript-eslint/no-explicit-any */
import { beforeEach, describe, expect, it, vi } from "vitest";

const { updates, inserts, state } = vi.hoisted(() => ({
  updates: [] as Array<{ values: Record<string, unknown>; filters: Array<[string, unknown]> }>,
  inserts: [] as Array<{ table: string; values: Record<string, unknown> }>,
  state: {
    updateResult: { data: { id: "conv-1" }, error: null } as { data: unknown; error: unknown },
  },
}));

function conversationsChain() {
  const record = { values: {} as Record<string, unknown>, filters: [] as Array<[string, unknown]> };
  const c: any = {
    update: (values: Record<string, unknown>) => ((record.values = values), c),
    eq: (col: string, v: unknown) => (record.filters.push([col, v]), c),
    select: () => c,
    maybeSingle: async () => {
      updates.push(record);
      return state.updateResult;
    },
    then: (ok: any) => {
      updates.push(record);
      return Promise.resolve({ data: null, error: null }).then(ok);
    },
  };
  return c;
}

const client: any = {
  from: (table: string) => {
    if (table === "conversations") return conversationsChain();
    if (table === "ai_flow_events") {
      return {
        insert: async (values: Record<string, unknown>) => (
          inserts.push({ table, values }),
          { error: null }
        ),
      };
    }
    if (table === "profiles") {
      const c: any = {
        select: () => c,
        eq: () => c,
        maybeSingle: async () => ({ data: { company_id: "company-a" }, error: null }),
      };
      return c;
    }
    throw new Error(`unexpected table ${table}`);
  },
  auth: { getUser: async () => ({ data: { user: { id: "user-a" } }, error: null }) },
};

vi.mock("@/integrations/supabase/client.server", () => ({ supabaseAdmin: client }));

import { releaseConversationToAi } from "@/lib/sales-agent-control";

beforeEach(() => {
  updates.length = 0;
  inserts.length = 0;
  state.updateResult = { data: { id: "conv-1" }, error: null };
});

describe("releaseConversationToAi", () => {
  it("limpa o status humano só na conversa da empresa e registra quem devolveu", async () => {
    const result = await releaseConversationToAi(client, {
      companyId: "company-a",
      conversationId: "conv-1",
      userId: "user-a",
    });
    expect(result).toEqual({ ok: true });
    expect(updates[0].values).toEqual({
      ai_status: null,
      human_takeover_at: null,
      ai_handling: false,
    });
    expect(updates[0].filters).toContainEqual(["company_id", "company-a"]);
    expect(updates[0].filters).toContainEqual(["id", "conv-1"]);
    expect(inserts[0].values).toMatchObject({
      company_id: "company-a",
      event_type: "returned_to_ai",
      payload: { released_by: "user-a" },
    });
  });

  it("conversa de outra empresa (nenhuma linha) retorna not_found", async () => {
    state.updateResult = { data: null, error: null };
    const result = await releaseConversationToAi(client, {
      companyId: "company-a",
      conversationId: "conv-de-outra-empresa",
      userId: "user-a",
    });
    expect(result).toEqual({ ok: false, code: "not_found" });
    expect(inserts).toEqual([]);
  });

  it("exige company, conversa e usuário", async () => {
    expect(
      await releaseConversationToAi(client, { companyId: "", conversationId: "c", userId: "u" }),
    ).toEqual({ ok: false, code: "invalid_input" });
  });
});

describe("POST /api/ai/agent-takeover", () => {
  async function post(body: Record<string, unknown>) {
    const mod = await import("../api.ai.agent-takeover");
    const handler = (mod.Route as any).options.server.handlers.POST;
    return handler({
      request: new Request("https://app.test/api/ai/agent-takeover", {
        method: "POST",
        headers: { authorization: "Bearer token", "content-type": "application/json" },
        body: JSON.stringify(body),
      }),
    }) as Promise<Response>;
  }

  it("action release devolve para a IA usando a empresa do perfil, não do payload", async () => {
    const res = await post({
      conversation_id: "conv-1",
      action: "release",
      company_id: "company-b",
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, released: true });
    expect(updates[0].filters).toContainEqual(["company_id", "company-a"]);
    expect(updates[0].filters).not.toContainEqual(["company_id", "company-b"]);
  });

  it("sem action continua assumindo (compatível)", async () => {
    const res = await post({ conversation_id: "conv-1" });
    expect(res.status).toBe(200);
    expect(updates[0].values).toMatchObject({ ai_status: "assumido_humano" });
  });

  it("action desconhecida é rejeitada", async () => {
    const res = await post({ conversation_id: "conv-1", action: "apagar" });
    expect(res.status).toBe(400);
    expect(updates).toEqual([]);
  });
});
