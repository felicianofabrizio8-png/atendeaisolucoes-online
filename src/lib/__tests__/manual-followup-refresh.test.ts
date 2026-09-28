// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useManualFollowup } from "@/hooks/useManualFollowup";

const { serverFn } = vi.hoisted(() => ({ serverFn: vi.fn() }));

vi.mock("@tanstack/react-start", () => ({
  useServerFn: () => serverFn,
}));
vi.mock("@/lib/manual-followup.functions", () => ({
  runFollowupNowForConversation: {},
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), message: vi.fn() } }));

describe("manual follow-up read-model refresh", () => {
  it("refreshes the conversation read-model after the canonical action resolves", async () => {
    serverFn.mockResolvedValue({ sendStatus: "sent", eligible: true });
    const refresh = vi.fn();
    const { result } = renderHook(() =>      useManualFollowup("conversation-a", refresh),
    );

    await act(async () => result.current.run());

    expect(serverFn).toHaveBeenCalledWith({ data: { conversationId: "conversation-a" } });
    expect(refresh).toHaveBeenCalledOnce();
  });
});
