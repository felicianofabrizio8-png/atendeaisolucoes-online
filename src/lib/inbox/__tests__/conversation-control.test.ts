import { beforeEach, describe, expect, it, vi } from "vitest";

const { getSession } = vi.hoisted(() => ({ getSession: vi.fn() }));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { auth: { getSession } },
}));

import { changeConversationControl } from "../conversation-control";

describe("conversation control", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    getSession.mockResolvedValue({ data: { session: { access_token: "token" } } });
  });

  it("sends the existing endpoint action and applies the server state", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({
      ok: true,
      action: "takeover",
      conversation: {
        ai_status: "assumido_humano",
        ai_handling: false,
        sales_agent_auto_reply: false,
        human_takeover_at: "2026-10-22T12:00:00Z",
      },
    }), { status: 200 }));

    const result = await changeConversationControl("conv-1", "takeover");

    expect(fetchMock).toHaveBeenCalledWith("/api/ai/agent-takeover", expect.objectContaining({
      method: "POST",
      body: JSON.stringify({ conversation_id: "conv-1", action: "takeover" }),
    }));
    expect(result).toMatchObject({ ok: true, state: { ai_status: "assumido_humano" } });
  });

  it("does not call the endpoint without a valid session", async () => {
    getSession.mockResolvedValue({ data: { session: null } });
    const fetchMock = vi.spyOn(globalThis, "fetch");

    const result = await changeConversationControl("conv-1", "resume");

    expect(fetchMock).not.toHaveBeenCalled();
    expect(result).toEqual(expect.objectContaining({ ok: false }));
  });
});
