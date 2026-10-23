import { beforeEach, describe, expect, it, vi } from "vitest";

const { getHookSecret, runAgentTick, tryDedupe, rateLimitCheck, auditRuntimeEvent } = vi.hoisted(
  () => ({
    getHookSecret: vi.fn(),
    runAgentTick: vi.fn(),
    tryDedupe: vi.fn(),
    rateLimitCheck: vi.fn(),
    auditRuntimeEvent: vi.fn(),
  }),
);

vi.mock("@/lib/runtime/HookSecretVault.server", () => ({ getHookSecret }));
vi.mock("@/lib/ai-agent.server", () => ({ runAgentTick }));
vi.mock("@/integrations/supabase/client.server", () => ({ supabaseAdmin: {} }));
vi.mock("@/lib/runtime/RuntimeStateStore.server", () => ({
  tryDedupe,
  rateLimitCheck,
  auditRuntimeEvent,
}));

const routeModule = await import("../api.public.hooks.agent-trigger");
type RouteWithPost = {
  options: { server: { handlers: { POST: (args: { request: Request }) => Promise<Response> } } };
};
const handler = (routeModule.Route as unknown as RouteWithPost).options.server.handlers.POST;

function request(secret: string, conversationId = "11111111-1111-4111-8111-111111111111") {
  return new Request("http://test/api/public/hooks/agent-trigger", {
    method: "POST",
    headers: { "content-type": "application/json", "x-agent-trigger-secret": secret },
    body: JSON.stringify({
      conversation_id: conversationId,
      message_id: "22222222-2222-4222-8222-222222222222",
    }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  getHookSecret.mockResolvedValue("vault-secret");
  rateLimitCheck.mockResolvedValue(true);
  auditRuntimeEvent.mockResolvedValue(undefined);
  runAgentTick.mockResolvedValue({ ok: true, action: "replied" });
  tryDedupe.mockResolvedValue(true);
});

describe("POST /api/public/hooks/agent-trigger", () => {
  it("rejeita segredo ausente ou inválido", async () => {
    const response = await handler({ request: request("wrong-secret") });
    expect(response.status).toBe(401);
    expect(runAgentTick).not.toHaveBeenCalled();
  });

  it("não aceita chamadas quando o segredo não está configurado", async () => {
    getHookSecret.mockResolvedValue(null);
    const response = await handler({ request: request("vault-secret") });
    expect(response.status).toBe(503);
    expect(runAgentTick).not.toHaveBeenCalled();
    expect(tryDedupe).not.toHaveBeenCalled();
  });

  it("aceita o segredo retornado pelo Vault e preserva o message_id", async () => {
    const response = await handler({
      request: request("vault-secret", "33333333-3333-4333-8333-333333333333"),
    });
    expect(response.status).toBe(200);
    expect(runAgentTick).toHaveBeenCalledWith("33333333-3333-4333-8333-333333333333", {
      dedupeByLatestMessage: true,
      messageId: "22222222-2222-4222-8222-222222222222",
    });
  });

  it("callback repetido leva o mesmo message_id à reserva do tick (sem dedupe por tempo)", async () => {
    // A rota não descarta por janela de tempo (perderia mensagens seguidas legítimas);
    // a reserva persistente por message_id no tick impede a segunda resposta.
    const first = await handler({
      request: request("vault-secret", "44444444-4444-4444-8444-444444444444"),
    });
    const second = await handler({
      request: request("vault-secret", "44444444-4444-4444-8444-444444444444"),
    });

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    const calls = runAgentTick.mock.calls.filter(([id]) => id === "44444444-4444-4444-8444-444444444444");
    expect(calls).toHaveLength(2);
    for (const [, options] of calls) {
      expect(options).toEqual({ dedupeByLatestMessage: true, messageId: "22222222-2222-4222-8222-222222222222" });
    }
  });
});
