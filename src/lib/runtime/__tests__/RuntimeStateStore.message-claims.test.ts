import { beforeEach, describe, expect, it, vi } from "vitest";

const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));

vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: { rpc },
}));

import {
  claimMessage,
  claimMessageDetailed,
  finishMessageClaim,
  markMessageOutboundStarted,
} from "../RuntimeStateStore.server";

describe("message claims", () => {
  beforeEach(() => rpc.mockReset());

  it("mantém uma única claim sob concorrência e não reutiliza claim enviada", async () => {
    let claimed = false;
    rpc.mockImplementation(async (name: string) => {
      expect(name).toBe("runtime_claim_message");
      if (claimed) return { data: { claimed: false, status: "processing", attempt_count: 1 }, error: null };
      claimed = true;
      await Promise.resolve();
      return { data: { claimed: true, status: "processing", claim_token: "token-1", attempt_count: 1 }, error: null };
    });

    const results = await Promise.all([
      claimMessage({ companyId: "company-a", messageId: "message-1" }),
      claimMessage({ companyId: "company-a", messageId: "message-1" }),
    ]);

    expect(results.filter((row) => row?.claimed)).toHaveLength(1);

    rpc.mockResolvedValue({ data: { claimed: false, status: "sent", attempt_count: 1 }, error: null });
    await expect(claimMessage({ companyId: "company-a", messageId: "message-1" })).resolves.toMatchObject({
      claimed: false,
      status: "sent",
    });
  });

  it("permite retry para falha conhecida e bloqueia envio ambíguo", async () => {
    rpc
      .mockResolvedValueOnce({ data: { claimed: true, status: "processing", claim_token: "token-1", attempt_count: 1 }, error: null })
      .mockResolvedValueOnce({ data: true, error: null })
      .mockResolvedValueOnce({ data: { claimed: true, status: "processing", claim_token: "token-2", attempt_count: 2 }, error: null })
      .mockResolvedValueOnce({ data: true, error: null })
      .mockResolvedValueOnce({ data: true, error: null })
      .mockResolvedValueOnce({ data: { claimed: false, status: "uncertain", attempt_count: 2 }, error: null });

    const first = await claimMessage({ companyId: "company-a", messageId: "message-2" });
    expect(first?.claimed).toBe(true);
    await finishMessageClaim({ companyId: "company-a", messageId: "message-2", claimToken: "token-1", status: "failed_retryable", error: "network_before_request" });
    const retry = await claimMessage({ companyId: "company-a", messageId: "message-2" });
    expect(retry?.claimed).toBe(true);
    await markMessageOutboundStarted({ companyId: "company-a", messageId: "message-2", claimToken: "token-2" });
    await finishMessageClaim({ companyId: "company-a", messageId: "message-2", claimToken: "token-2", status: "uncertain", error: "timeout" });
    await expect(claimMessage({ companyId: "company-a", messageId: "message-2" })).resolves.toMatchObject({
      claimed: false,
      status: "uncertain",
    });
  });

  it("falha fechada quando o RPC não está disponível", async () => {
    rpc.mockResolvedValue({ data: null, error: new Error("database unavailable") });
    await expect(claimMessage({ companyId: "company-a", messageId: "message-3" })).resolves.toBeNull();
  });
  it("diferencia erro de RPC de mensagem duplicada", async () => {
    rpc.mockResolvedValueOnce({ data: null, error: new Error("database unavailable") });
    await expect(claimMessageDetailed({ companyId: "company-a", messageId: "message-4" })).resolves.toEqual({
      claim: null,
      failure: "rpc_error",
    });

    rpc.mockResolvedValueOnce({ data: { claimed: false, status: "observed", attempt_count: 1 }, error: null });
    await expect(claimMessageDetailed({ companyId: "company-a", messageId: "message-4" })).resolves.toEqual({
      claim: { claimed: false, status: "observed", attempt_count: 1 },
    });
  });

  it("finaliza uma sugestão assistida como observada e torna o retry uma duplicata", async () => {
    rpc
      .mockResolvedValueOnce({ data: { claimed: true, status: "processing", claim_token: "token-assisted", attempt_count: 1 }, error: null })
      .mockResolvedValueOnce({ data: true, error: null })
      .mockResolvedValueOnce({ data: { claimed: false, status: "observed", attempt_count: 1 }, error: null });

    const first = await claimMessage({ companyId: "company-a", messageId: "suggestion-1" });
    expect(first?.claimed).toBe(true);
    await expect(finishMessageClaim({
      companyId: "company-a",
      messageId: "suggestion-1",
      claimToken: "token-assisted",
      status: "observed",
    })).resolves.toBe(true);
    await expect(claimMessage({ companyId: "company-a", messageId: "suggestion-1" })).resolves.toMatchObject({
      claimed: false,
      status: "observed",
    });
  });
});
