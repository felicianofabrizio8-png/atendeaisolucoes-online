import { describe, expect, it, vi } from "vitest";

const { from, getUser } = vi.hoisted(() => ({
  from: vi.fn(),
  getUser: vi.fn(),
}));

vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: { from, rpc: vi.fn(async () => ({ data: true, error: null })), auth: { getUser } },
}));

const routeModule = await import("../api.ai.agent-takeover");
const handler = (routeModule.Route as any).options.server.handlers.POST;

function query(data: unknown) {
  const builder = {
    select: vi.fn(),
    eq: vi.fn(),
    update: vi.fn(),
    maybeSingle: vi.fn(async () => ({ data, error: null })),
  };
  builder.select.mockReturnValue(builder);
  builder.eq.mockReturnValue(builder);
  builder.update.mockReturnValue(builder);
  return builder;
}

describe("agent-takeover: isolamento e ações", () => {
  it("recusa ação HTTP desconhecida", async () => {
    getUser.mockResolvedValue({ data: { user: { id: "user-a" } } });
    from.mockImplementation((table: string) => table === "profiles" ? query({ company_id: "company-a" }) : query(null));

    const response = await handler({
      request: new Request("http://test/api/ai/agent-takeover", {
        method: "POST",
        headers: { authorization: "Bearer test" },
        body: JSON.stringify({ conversation_id: "conv-a", action: "enable_all" }),
      }),
    });

    expect(response.status).toBe(400);
  });

  it("não confirma retomada de conversa de outra empresa", async () => {
    getUser.mockResolvedValue({ data: { user: { id: "user-a" } } });
    from.mockImplementation((table: string) => {
      if (table === "profiles") return query({ company_id: "company-a" });
      if (table === "company_settings") return query({ ai_auto_reply_scope: "geral", ai_auto_reply_enabled: true });
      if (table === "conversations") return query(null);
      throw new Error(`unexpected table ${table}`);
    });

    const response = await handler({
      request: new Request("http://test/api/ai/agent-takeover", {
        method: "POST",
        headers: { authorization: "Bearer test" },
        body: JSON.stringify({ conversation_id: "conv-b", action: "resume" }),
      }),
    });

    expect(response.status).toBe(403);
  });

  it("assume durante processamento sem liberar o lock da IA", async () => {
    getUser.mockResolvedValue({ data: { user: { id: "user-a" } } });
    const conversationQuery = query({ id: "conv-a" });
    from.mockImplementation((table: string) => {
      if (table === "profiles") return query({ company_id: "company-a" });
      if (table === "conversations") return conversationQuery;
      throw new Error(`unexpected table ${table}`);
    });

    const response = await handler({
      request: new Request("http://test/api/ai/agent-takeover", {
        method: "POST",
        headers: { authorization: "Bearer test" },
        body: JSON.stringify({ conversation_id: "conv-a", action: "takeover" }),
      }),
    });

    expect(response.status).toBe(200);
    expect(conversationQuery.update).toHaveBeenCalledWith(expect.objectContaining({
      ai_status: "assumido_humano",
    }));
    expect(conversationQuery.update.mock.calls[0][0]).not.toHaveProperty("ai_handling", false);
  });

  it.each(["resume", "disable"] as const)(
    "%s não libera o lock de um worker ainda ativo",
    async (action) => {
      getUser.mockResolvedValue({ data: { user: { id: "user-a" } } });
      const conversationQuery = query({ id: "conv-a", ai_handling: true });
      from.mockImplementation((table: string) => {
        if (table === "profiles") return query({ company_id: "company-a" });
        if (table === "company_settings") return query({ ai_auto_reply_scope: "geral", ai_auto_reply_enabled: true });
        if (table === "conversations") return conversationQuery;
        throw new Error(`unexpected table ${table}`);
      });

      const response = await handler({
        request: new Request("http://test/api/ai/agent-takeover", {
          method: "POST",
          headers: { authorization: "Bearer test" },
          body: JSON.stringify({ conversation_id: "conv-a", action }),
        }),
      });

      expect(response.status).toBe(200);
      // Nenhuma gravação desta ação zera o lock (no escopo geral, disable nem grava).
      for (const [values] of conversationQuery.update.mock.calls) {
        expect(values).not.toHaveProperty("ai_handling");
      }
    },
  );
});
