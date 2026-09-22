import { beforeEach, describe, expect, it, vi } from "vitest";

const supabaseMock = vi.hoisted(() => ({
  auth: {
    getSession: vi.fn(),
  },
  functions: {
    invoke: vi.fn(),
  },
}));

vi.mock("@/integrations/supabase/client", () => ({ supabase: supabaseMock }));

import { sendManualText } from "@/lib/inbox/manual-send";

const whatsappInput = {
  conversationId: "conversation-1",
  leadId: "lead-1",
  channel: "whatsapp",
  origin: "whatsapp",
  text: "Olá cliente",
};

const instagramInput = {
  ...whatsappInput,
  channel: "instagram",
  origin: "instagram_direct",
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  supabaseMock.auth.getSession.mockResolvedValue({
    data: { session: { access_token: "token-1" } },
  });
});

describe("sendManualText", () => {
  it("considera sucesso somente com confirmação e id válido", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
      jsonResponse({ id: "message-1" }),
    ));

    const result = await sendManualText(whatsappInput);

    expect(result).toEqual({
      ok: true,
      kind: "success",
      delivery: "sent",
      messageId: "message-1",
      conversationId: "conversation-1",
    });
  });

  it("trata resposta 200 sem id como erro de confirmação", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ ok: true })));

    const result = await sendManualText(whatsappInput);

    expect(result).toEqual({
      ok: false,
      kind: "error",
      error: "Envio sem confirmação de persistência",
      retryable: false,
      status: 200,
    });
  });

  it("discrimina exceção de getSession", async () => {
    supabaseMock.auth.getSession.mockRejectedValueOnce(new Error("auth unavailable"));

    const result = await sendManualText(whatsappInput);

    expect(result).toEqual({
      ok: false,
      kind: "error",
      error: "auth unavailable",
      retryable: false,
      status: null,
    });
  });

  it("discrimina exceção de invoke", async () => {
    supabaseMock.functions.invoke.mockRejectedValueOnce(new Error("invoke unavailable"));

    const result = await sendManualText(instagramInput);

    expect(result).toEqual({
      ok: false,
      kind: "error",
      error: "invoke unavailable",
      retryable: false,
      status: null,
    });
  });

  it("marca erro transitório HTTP como retryable", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
      jsonResponse({ error: "temporarily unavailable" }, 503),
    ));

    const result = await sendManualText(whatsappInput);

    expect(result).toEqual({
      ok: false,
      kind: "error",
      error: "temporarily unavailable",
      retryable: true,
      status: 503,
    });
  });

  it("mantém erro funcional ou desconhecido como não retryable", async () => {
    supabaseMock.functions.invoke.mockResolvedValueOnce({
      data: { ok: false, error: "provider rejected message" },
      error: null,
    });

    const result = await sendManualText(instagramInput);

    expect(result).toEqual({
      ok: false,
      kind: "error",
      error: "provider rejected message",
      retryable: false,
      status: null,
    });
  });
});
