// Vendedora IA · Fase 0 — rotas agent-trigger e suggest-product.
/* eslint-disable @typescript-eslint/no-explicit-any */
import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { runAgentTick, productFilters, productRows, fetchMock } = vi.hoisted(() => ({
  runAgentTick: vi.fn(),
  productFilters: [] as Array<[string, unknown]>,
  productRows: { value: [] as unknown[] },
  fetchMock: vi.fn(),
}));

vi.mock("@/lib/ai-agent.server", () => ({ runAgentTick }));
vi.mock("@/lib/runtime/HookSecretVault.server", () => ({
  getHookSecret: async () => "hook-secret",
}));
vi.mock("@/lib/runtime/RuntimeStateStore.server", () => ({ rateLimitCheck: async () => true }));

function chain(result: { data: unknown; error: unknown }, onEq?: (c: string, v: unknown) => void) {
  const c: any = {
    select: () => c,
    eq: (col: string, v: unknown) => (onEq?.(col, v), c),
    order: () => c,
    limit: () => c,
    maybeSingle: async () => result,
    then: (ok: any) => Promise.resolve(result).then(ok),
  };
  return c;
}

vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: {
    auth: { getUser: async () => ({ data: { user: { id: "user-a" } }, error: null }) },
    from: (table: string) => {
      if (table === "profiles") return chain({ data: { company_id: "company-a" }, error: null });
      if (table === "products") {
        return chain({ data: productRows.value, error: null }, (col, v) =>
          productFilters.push([col, v]),
        );
      }
      return chain({ data: null, error: null });
    },
  },
}));

async function handler(path: string) {
  const mod = await import(path);
  return (mod.Route as any).options.server.handlers.POST as (a: {
    request: Request;
  }) => Promise<Response>;
}

describe("POST /api/public/hooks/agent-trigger", () => {
  beforeEach(() => {
    runAgentTick.mockReset();
    runAgentTick.mockResolvedValue({ ok: true, action: "replied" });
  });

  function trigger(conversationId: string, secret = "hook-secret") {
    return new Request("https://app.test/api/public/hooks/agent-trigger", {
      method: "POST",
      headers: { "content-type": "application/json", "x-agent-trigger-secret": secret },
      body: JSON.stringify({ conversation_id: conversationId }),
    });
  }

  it("segunda mensagem do cliente em menos de 30s ainda aciona o agente", async () => {
    const post = await handler("../api.public.hooks.agent-trigger");
    const conv = "22222222-2222-4222-8222-222222222222";
    const first = await post({ request: trigger(conv) });
    const second = await post({ request: trigger(conv) });
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(await second.json()).not.toHaveProperty("deduped");
    expect(runAgentTick).toHaveBeenCalledTimes(2);
  });

  it("continua exigindo o segredo", async () => {
    const post = await handler("../api.public.hooks.agent-trigger");
    const res = await post({ request: trigger("33333333-3333-4333-8333-333333333333", "errado") });
    expect(res.status).toBe(401);
    expect(runAgentTick).not.toHaveBeenCalled();
  });
});

describe("POST /api/ai/suggest-product", () => {
  beforeEach(() => {
    productFilters.length = 0;
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
    process.env.LOVABLE_API_KEY = "test-key";
  });

  function request() {
    return new Request("https://app.test/api/ai/suggest-product", {
      method: "POST",
      headers: { authorization: "Bearer user-token", "content-type": "application/json" },
      body: JSON.stringify({ messages: [{ role: "lead", text: "Quero o produto da empresa A" }] }),
    });
  }

  it("usa o catálogo ativo da empresa do usuário, não o seed de demonstração", async () => {
    productRows.value = [
      {
        id: "a-1",
        company_id: "company-a",
        active: true,
        name: "Produto da Empresa A",
        category: "X",
        description: null,
      },
    ];
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                tool_calls: [
                  {
                    function: {
                      arguments: JSON.stringify({
                        productId: "a-1",
                        confidence: "alta",
                        reason: "ok",
                      }),
                    },
                  },
                ],
              },
            },
          ],
        }),
      ),
    );
    const post = await handler("../api.ai.suggest-product");
    const res = await post({ request: request() });

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ productId: "a-1" });
    expect(productFilters).toContainEqual(["company_id", "company-a"]);
    expect(productFilters).toContainEqual(["active", true]);
    const payload = JSON.parse(fetchMock.mock.calls[0][1].body);
    const prompt = payload.messages.map((m: { content: string }) => m.content).join("\n");
    expect(prompt).toContain("Produto da Empresa A");
    expect(payload.tools[0].function.parameters.properties.productId.enum).toEqual(["a-1"]);
  });

  it("empresa sem catálogo não chama a IA", async () => {
    productRows.value = [];
    const post = await handler("../api.ai.suggest-product");
    const res = await post({ request: request() });
    expect(res.status).toBe(422);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("não importa mais o store do cliente", () => {
    const source = readFileSync("src/routes/api.ai.suggest-product.tsx", "utf8");
    expect(source).not.toContain("@/data/products");
  });
});

describe("meta-send (Edge Function) não envia pelo número global de outro tenant", () => {
  it("token global só completa a integração do mesmo número", () => {
    const source = readFileSync("supabase/functions/meta-send/index.ts", "utf8");
    expect(source).not.toMatch(
      /integration\?\.external_account_id\s*\|\|\s*Deno\.env\.get\("WHATSAPP_PHONE_NUMBER_ID"\)/,
    );
    expect(source).toContain("envPhoneNumberId === phoneNumberId");
  });
});
