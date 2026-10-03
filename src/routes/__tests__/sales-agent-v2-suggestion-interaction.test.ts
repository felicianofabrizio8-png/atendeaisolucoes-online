import { beforeEach, describe, expect, it, vi } from "vitest";

const mock = vi.hoisted(() => ({
  company: "company-a",
  suggestionCompany: "company-a",
  classification: "v2_status:pending",
  updates: [] as Array<{ values: Record<string, unknown>; filters: Array<[string, unknown]> }>,
  events: [] as unknown[],
}));

vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: {
    auth: { getUser: async () => ({ data: { user: { id: "user-a" } }, error: null }) },
    from: (table: string) => {
      const filters: Array<[string, unknown]> = [];
      let values: Record<string, unknown> = {};
      const chain = {
        select: () => chain,
        update: (next: Record<string, unknown>) => { values = next; return chain; },
        eq: (key: string, value: unknown) => { filters.push([key, value]); return chain; },
        maybeSingle: async () => {
          if (table === "profiles") return { data: { company_id: mock.company }, error: null };
          if (table === "company_settings") return { data: { sales_agent_v2_enabled: true, sales_agent_v2_mode: "assisted" }, error: null };
          if (table === "ai_suggestions_log" && Object.keys(values).length) {
            mock.updates.push({ values, filters });
            if (mock.suggestionCompany !== mock.company || mock.classification !== "v2_status:pending") return { data: null, error: null };
            mock.classification = String(values.classification);
            return { data: { id: "suggestion-1" }, error: null };
          }
          if (table === "ai_suggestions_log") {
            return { data: mock.suggestionCompany === mock.company
              ? { id: "suggestion-1", company_id: mock.suggestionCompany, conversation_id: "conv-1", classification: mock.classification, was_sent: false }
              : null, error: null };
          }
          throw new Error(`Unexpected table ${table}`);
        },
      };
      return chain;
    },
  },
}));
vi.mock("@/lib/ai-agent.server", () => ({ logEvent: async (...args: unknown[]) => { mock.events.push(args); } }));

import { Route } from "../api.ai.v2-suggestion";

const post = (action: string, company_id = "company-b") =>
  (Route as unknown as { options: { server: { handlers: { POST: (args: { request: Request }) => Promise<Response> } } } })
    .options.server.handlers.POST({ request: new Request("https://example.test/api/ai/v2-suggestion", {
      method: "POST", headers: { authorization: "Bearer test", "content-type": "application/json" },
      body: JSON.stringify({ suggestionId: "suggestion-1", action, company_id }),
    }) });

beforeEach(() => {
  mock.company = "company-a";
  mock.suggestionCompany = "company-a";
  mock.classification = "v2_status:pending";
  mock.updates.length = 0;
  mock.events.length = 0;
});

describe("aprovação assistida autenticada e isolada", () => {
  it("aprova na empresa autenticada sem enviar e só uma vez", async () => {
    const first = await post("approve");
    expect(await first.json()).toMatchObject({ ok: true, status: "approved", sendAllowed: false });
    expect(mock.updates[0].filters).toContainEqual(["company_id", "company-a"]);
    expect(mock.updates[0].filters).toContainEqual(["classification", "v2_status:pending"]);
    expect(mock.updates[0].filters).not.toContainEqual(["company_id", "company-b"]);
    expect((await post("reject")).status).toBe(409);
    expect(mock.events).toHaveLength(1);
  });

  it("não altera sugestão pertencente a outra empresa", async () => {
    mock.suggestionCompany = "company-b";
    expect((await post("approve")).status).toBe(404);
    expect(mock.updates).toHaveLength(0);
    expect(mock.events).toHaveLength(0);
  });

  it("rejeita disputa concorrente quando a sugestão deixa de estar pendente entre leitura e escrita", async () => {
    // A segunda consulta simulada encontra uma transição concorrente.
    const first = await post("reject");
    expect(first.status).toBe(200);
    expect((await post("approve")).status).toBe(409);
  });
});