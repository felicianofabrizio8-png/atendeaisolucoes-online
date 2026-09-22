// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const { getSessionMock } = vi.hoisted(() => ({
  getSessionMock: vi.fn(),
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: {
      getSession: getSessionMock,
    },
  },
}));

import { SalesAgentAssistedCard } from "@/components/coach/SalesAgentAssistedCard";

const pendingSuggestion = {
  id: "suggestion-1",
  conversation_id: "conversation-1",
  generated_text: "A Sol 602 está disponível por R$ 12.900,00 à vista.",
  created_at: "2026-09-22T01:00:00.000Z",
};

function response(body: unknown, ok = true, status = 200): Response {
  return {
    ok,
    status,
    json: async () => body,
  } as Response;
}

beforeEach(() => {
  getSessionMock.mockResolvedValue({
    data: {
      session: {
        access_token: "access-token-1",
      },
    },
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("SalesAgentAssistedCard", () => {
  it("carrega a sugestão pendente e aprova apenas para uso no compositor", async () => {
    const onInsertSuggestion = vi.fn();
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === "POST") {
        return response({
          ok: true,
          status: "approved",
          sendAllowed: false,
        });
      }

      return response({ suggestion: pendingSuggestion });
    });
    vi.stubGlobal("fetch", fetchMock);

    const user = userEvent.setup();

    render(
      <SalesAgentAssistedCard
        conversationId="conversation-1"
        onInsertSuggestion={onInsertSuggestion}
      />,
    );

    expect(await screen.findByTestId("v2-assisted-card")).toBeInTheDocument();
    expect(screen.getByText(/Sol 602 está disponível por R\$ 12\.900,00/i)).toBeInTheDocument();

    await user.click(screen.getByTestId("v2-assisted-approve"));

    await waitFor(() => {
      expect(onInsertSuggestion).toHaveBeenCalledWith(pendingSuggestion.generated_text);
    });

    const postCall = fetchMock.mock.calls.find(([, init]) => init?.method === "POST");

    expect(postCall?.[0]).toBe("/api/ai/v2-suggestion");
    expect(JSON.parse(String(postCall?.[1]?.body))).toEqual({
      suggestionId: "suggestion-1",
      action: "approve",
    });
    expect(screen.queryByTestId("v2-assisted-card")).not.toBeInTheDocument();

    expect(
      fetchMock.mock.calls.every(([input]) => String(input).startsWith("/api/ai/v2-suggestion")),
    ).toBe(true);
  });

  it("rejeita a sugestão sem preencher o compositor", async () => {
    const onInsertSuggestion = vi.fn();
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === "POST") {
        return response({
          ok: true,
          status: "rejected",
          sendAllowed: false,
        });
      }

      return response({ suggestion: pendingSuggestion });
    });
    vi.stubGlobal("fetch", fetchMock);

    const user = userEvent.setup();

    render(
      <SalesAgentAssistedCard
        conversationId="conversation-1"
        onInsertSuggestion={onInsertSuggestion}
      />,
    );

    expect(await screen.findByTestId("v2-assisted-card")).toBeInTheDocument();

    await user.click(screen.getByTestId("v2-assisted-reject"));

    await waitFor(() => {
      expect(screen.queryByTestId("v2-assisted-card")).not.toBeInTheDocument();
    });

    expect(onInsertSuggestion).not.toHaveBeenCalled();

    const postCall = fetchMock.mock.calls.find(([, init]) => init?.method === "POST");

    expect(JSON.parse(String(postCall?.[1]?.body))).toEqual({
      suggestionId: "suggestion-1",
      action: "reject",
    });
  });

  it("não permite sobrescrever um rascunho existente", async () => {
    const onInsertSuggestion = vi.fn();
    const fetchMock = vi.fn(async () => response({ suggestion: pendingSuggestion }));
    vi.stubGlobal("fetch", fetchMock);

    render(
      <SalesAgentAssistedCard
        conversationId="conversation-1"
        onInsertSuggestion={onInsertSuggestion}
        composerHasDraft
      />,
    );

    expect(await screen.findByTestId("v2-assisted-card")).toBeInTheDocument();
    expect(screen.getByTestId("v2-assisted-draft-warning")).toBeInTheDocument();
    expect(screen.getByTestId("v2-assisted-approve")).toBeDisabled();
    expect(onInsertSuggestion).not.toHaveBeenCalled();
  });
});
