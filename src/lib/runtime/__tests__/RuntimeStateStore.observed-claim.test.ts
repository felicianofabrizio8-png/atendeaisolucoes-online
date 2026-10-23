import { beforeEach, describe, expect, it, vi } from "vitest";

const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("@/integrations/supabase/client.server", () => ({ supabaseAdmin: { rpc } }));

import { claimMessage, finishMessageClaim } from "../RuntimeStateStore.server";

describe("observed message claims", () => {
  beforeEach(() => rpc.mockReset());

  it("finalizes silent observation and blocks a later retry", async () => {
    rpc
      .mockResolvedValueOnce({
        data: { claimed: true, status: "processing", claim_token: "token", attempt_count: 1 },
        error: null,
      })
      .mockResolvedValueOnce({ data: true, error: null })
      .mockResolvedValueOnce({
        data: { claimed: false, status: "observed", attempt_count: 1 },
        error: null,
      });
    await expect(
      claimMessage({ companyId: "company-a", messageId: "message-a" }),
    ).resolves.toMatchObject({ claimed: true });
    await expect(
      finishMessageClaim({
        companyId: "company-a",
        messageId: "message-a",
        claimToken: "token",
        status: "observed",
      }),
    ).resolves.toBe(true);
    await expect(
      claimMessage({ companyId: "company-a", messageId: "message-a" }),
    ).resolves.toMatchObject({ claimed: false, status: "observed" });
  });
});
