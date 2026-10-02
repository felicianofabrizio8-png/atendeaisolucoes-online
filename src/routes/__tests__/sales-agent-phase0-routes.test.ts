// Vendedora IA · Fase 0 — rotas agent-trigger e suggest-product.
/* eslint-disable @typescript-eslint/no-explicit-any */
import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { runAgentTick, scheduleBackgroundTask, productFilters, productRows, fetchMock } = vi.hoisted(() => ({
  runAgentTick: vi.fn(),
  scheduleBackgroundTask: vi.fn(),
  productFilters: [] as Array<[string, unknown]>,
  productRows: { value: [] as unknown[] },
  fetchMock: vi.fn(),
}));

vi.mock("@/lib/ai-agent.server", () => ({ runAgentTick }));
vi.mock("@/lib/runtime/HookSecretVault.server", () => ({
  getHookSecret: async () => "hook-secret",
}));
vi.mock("@/lib/runtime/RuntimeStateStore.server", () => ({ rateLimitCheck: async () => true }));
vi.mock("@/lib/runtime/BackgroundTask.server", () => ({ scheduleBackgroundTask }));

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
    scheduleBackgroundTask.mockReset();
    scheduleBackgroundTask.mockReturnValue(false);
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

  it("no Workers responde 202 antes do turno e o roda no waitUntil", async () => {
    const tasks: Array<() => Promise<void>> = [];
    scheduleBackgroundTask.mockImplementation((_request: Request, task: () => Promise<void>) => {
      tasks.push(task);
      return true;
    });
    const post = await handler("../api.public.hooks.agent-trigger");
    const res = await post({ request: trigger("44444444-4444-4444-8444-444444444444") });
    expect(res.status).toBe(202);
    expect(scheduleBackgroundTask).toHaveBeenCalledWith(expect.any(Request), expect.any(Function));
    expect(runAgentTick).not.toHaveBeenCalled();
    expect(tasks).toHaveLength(1);
    await tasks[0]();
    expect(runAgentTick).toHaveBeenCalledWith("44444444-4444-4444-8444-444444444444");
  });

  it("erro do turno em segundo plano não vaza da tarefa", async () => {
    const tasks: Array<() => Promise<void>> = [];
    scheduleBackgroundTask.mockImplementation((_request: Request, task: () => Promise<void>) => {
      tasks.push(task);
      return true;
    });
    runAgentTick.mockRejectedValue(new Error("boom"));
    const post = await handler("../api.public.hooks.agent-trigger");
    await post({ request: trigger("55555555-5555-4555-8555-555555555555") });
    await expect(tasks[0]()).resolves.toBeUndefined();
  });

  it("sem waitUntil mantém a execução inline e responde 500 em erro", async () => {
    runAgentTick.mockRejectedValue(new Error("boom"));
    const post = await handler("../api.public.hooks.agent-trigger");
    const res = await post({ request: trigger("66666666-6666-4666-8666-666666666666") });
    expect(res.status).toBe(500);
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
