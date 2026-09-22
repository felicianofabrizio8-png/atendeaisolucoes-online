// @vitest-environment jsdom

import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { Conversation, Lead, Message } from "@/data/mock";

const manualSendMock = vi.hoisted(() => ({
  sendManualText: vi.fn(),
}));

vi.mock("@/lib/inbox/manual-send", () => ({
  sendManualText: manualSendMock.sendManualText,
}));

const aiSuggestMock = vi.hoisted(() => ({
  suggestAiReply: vi.fn(),
}));

vi.mock("@/lib/atendimento/ai-suggest", () => ({
  suggestAiReply: aiSuggestMock.suggestAiReply,
}));
const repoMock = vi.hoisted(() => {
  type RepoState = {
    mode: "remote" | "demo";
    loaded: boolean;
    error: string | null;
    companyId: string;
    leads: Lead[];
    conversations: Conversation[];
    messages: Message[];
  };
  const state: RepoState = {
    mode: "remote",
    loaded: false,
    error: null,
    companyId: "company-a",
    leads: [],
    conversations: [],
    messages: [],
  };
  const listeners = new Set<() => void>();
  const calls = {
    getLeads: 0,
    getConversations: 0,
    getLeadById: 0,
    getMessagesFor: 0,
    refetchConversationMessages: 0,
    forbiddenSend: 0,
    forbiddenPersist: 0,
    forbiddenAi: 0,
  };
  let version = 0;
  return {
    state,
    calls,
    reset() {
      Object.assign(state, {
        mode: "remote",
        loaded: false,
        error: null,
        companyId: "company-a",
        leads: [],
        conversations: [],
        messages: [],
      });
      Object.keys(calls).forEach((key) => {
        calls[key as keyof typeof calls] = 0;
      });
      version = 0;
    },
    setState(next: Partial<RepoState>) {
      Object.assign(state, next);
      version += 1;
      listeners.forEach((listener) => listener());
    },
    getRepoVersion: () => version,
    subscribeRepo(listener: () => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getRepoMode: () => state.mode,
    getRemoteLoadError: () => state.error,
    isRemoteLoaded: () => state.loaded,
    getLeads: () => {
      calls.getLeads += 1;
      return state.leads;
    },
    getConversations: () => {
      calls.getConversations += 1;
      return state.conversations;
    },
    getLeadById: (id: string) => {
      calls.getLeadById += 1;
      return state.leads.find((lead) => lead.id === id);
    },
    getMessagesFor: (id: string) => {
      calls.getMessagesFor += 1;
      return state.messages.filter((message) => message.conversationId === id);
    },
    refetchConversationMessages: async () => {
      calls.refetchConversationMessages += 1;
    },
    forbiddenSend: () => { calls.forbiddenSend += 1; },
    forbiddenPersist: () => { calls.forbiddenPersist += 1; },
    forbiddenAi: () => { calls.forbiddenAi += 1; },
  };
});

vi.mock("@/data/leadRepo", () => ({
  getRepoVersion: repoMock.getRepoVersion,
  subscribeRepo: repoMock.subscribeRepo,
  getRepoMode: repoMock.getRepoMode,
  getRemoteLoadError: repoMock.getRemoteLoadError,
  isRemoteLoaded: repoMock.isRemoteLoaded,
  getLeads: repoMock.getLeads,
  getConversations: repoMock.getConversations,
  getLeadById: repoMock.getLeadById,
  getMessagesFor: repoMock.getMessagesFor,
  refetchConversationMessages: repoMock.refetchConversationMessages,
}));

import { useAtendimentoData } from "@/hooks/useAtendimentoData";
import { Route } from "@/routes/atendimento";

const lead: Lead = {
  id: "lead-company-a",
  name: "Cliente da empresa A",
  phone: "5511999999999",
  channel: "whatsapp",
  status: "novo",
  tags: [],
  createdAt: "2026-09-18T10:00:00.000Z",
};

const conversation: Conversation = {
  id: "conversation-company-a",
  leadId: lead.id,
  channel: "whatsapp",
  lastMessageAt: "2026-09-18T10:00:00.000Z",
  unread: 1,
  awaitingReply: true,
  slaBreached: false,
};

function HookProbe() {
  const data = useAtendimentoData();
  return React.createElement("output", { "data-testid": "hook-state" }, `${data.status}:${data.contacts.length}`);
}

function RouteView() {
  const Component = Route.options.component as React.ComponentType;
  return React.createElement(Component);
}

function setRemoteSnapshot(overrides: Partial<typeof repoMock.state> = {}) {
  repoMock.setState({
    loaded: true,
    error: null,
    leads: [lead],
    conversations: [conversation],
    messages: [],
    ...overrides,
  });
}

describe("Atendimento 2.0 runtime", () => {
  beforeEach(() => {
    repoMock.reset();
    manualSendMock.sendManualText.mockReset();
    aiSuggestMock.suggestAiReply.mockReset();
    aiSuggestMock.suggestAiReply.mockResolvedValue({
      ok: true,
      kind: "reply",
      message: "Sugestão comercial segura",
    });
    manualSendMock.sendManualText.mockResolvedValue({
      ok: true,
      kind: "success",
      delivery: "sent",
      messageId: "message-sent",
      conversationId: conversation.id,
    });
    HTMLElement.prototype.scrollIntoView = vi.fn();
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: vi.fn(() => ({
        matches: false,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      })),
    });
  });

  afterEach(() => cleanup());

  it("executa useAtendimentoData e transita de loading para ready", () => {
    render(React.createElement(HookProbe));
    expect(screen.getByTestId("hook-state").textContent).toContain("loading:0");

    act(() => setRemoteSnapshot());

    expect(screen.getByTestId("hook-state").textContent).toContain("ready:1");
    expect(repoMock.calls.getLeads).toBeGreaterThan(0);
    expect(repoMock.calls.getConversations).toBeGreaterThan(0);
  });

  it("transita de loading para empty sem inventar fila", () => {
    render(React.createElement(HookProbe));
    expect(screen.getByTestId("hook-state").textContent).toContain("loading:0");

    act(() => setRemoteSnapshot({ leads: [], conversations: [] }));

    expect(screen.getByTestId("hook-state").textContent).toContain("empty:0");
  });

  it("mantém falha remota como error, nunca empty", () => {
    repoMock.setState({ loaded: false, error: "falha do snapshot", leads: [], conversations: [] });
    render(React.createElement(HookProbe));

    expect(screen.getByTestId("hook-state").textContent).toContain("error:0");
    expect(screen.getByTestId("hook-state").textContent).not.toContain("empty");
  });

  it("renderiza loading, error e empty na rota real", () => {
    const { rerender } = render(React.createElement(RouteView));
    expect(screen.getByText("Carregando conversas...")).toBeTruthy();

    act(() => repoMock.setState({ error: "falha do snapshot" }));
    expect(screen.getByRole("alert").textContent).toContain("Não foi possível carregar as conversas.");
    expect(screen.queryByText("Nenhuma conversa disponível.")).toBeNull();

    act(() => repoMock.setState({ loaded: true, error: null, leads: [], conversations: [] }));
    rerender(React.createElement(RouteView));
    expect(screen.getByText("Nenhuma conversa disponível.")).toBeTruthy();
    expect(screen.queryByText("Carregando conversas...")).toBeNull();
  });

  it("preserva o resultado já escopado pelo company_id e não usa demo/fallback", () => {
    setRemoteSnapshot();
    render(React.createElement(RouteView));

    expect(screen.getAllByText("Cliente da empresa A").length).toBeGreaterThan(0);
    expect(screen.queryByText(/demo/i)).toBeNull();
    expect(repoMock.state.companyId).toBe("company-a");
    expect(repoMock.getRepoMode()).toBe("remote");
    expect(repoMock.calls.getLeads).toBeGreaterThan(0);
    expect(repoMock.calls.getConversations).toBeGreaterThan(0);
  });

  it("envia pelo adapter compartilhado com conversa, lead, canal e origem corretos", async () => {
    setRemoteSnapshot();
    render(React.createElement(RouteView));

    fireEvent.change(screen.getByLabelText("Mensagem"), { target: { value: "  Olá cliente  " } });
    fireEvent.click(screen.getByRole("button", { name: "Enviar" }));

    await waitFor(() => expect(manualSendMock.sendManualText).toHaveBeenCalledTimes(1));
    expect(manualSendMock.sendManualText).toHaveBeenCalledWith({
      conversationId: conversation.id,
      leadId: lead.id,
      channel: "whatsapp",
      origin: "whatsapp",
      text: "Olá cliente",
    });
    await waitFor(() => expect(repoMock.calls.refetchConversationMessages).toBe(1));
    expect((screen.getByLabelText("Mensagem") as HTMLTextAreaElement).value).toBe("");
    expect(repoMock.calls.forbiddenPersist).toBe(0);
    expect(repoMock.calls.forbiddenAi).toBe(0);
  });

  it("gera sugestão com IA no composer sem enviar automaticamente", async () => {
    setRemoteSnapshot();
    render(React.createElement(RouteView));

    fireEvent.click(screen.getByRole("button", { name: "Sugerir com IA" }));

    await waitFor(() =>
      expect(aiSuggestMock.suggestAiReply).toHaveBeenCalledWith(conversation.id),
    );

    await waitFor(() =>
      expect((screen.getByLabelText("Mensagem") as HTMLInputElement).value)
        .toBe("Sugestão comercial segura"),
    );

    expect(manualSendMock.sendManualText).not.toHaveBeenCalled();
    expect(repoMock.calls.refetchConversationMessages).toBe(0);
    expect(repoMock.state.messages).toHaveLength(0);
  });
  it("bloqueia mensagem vazia e envio duplo enquanto há envio em andamento", async () => {
    let resolveSend: ((value: unknown) => void) | null = null;
    manualSendMock.sendManualText.mockImplementation(() => new Promise((resolve) => { resolveSend = resolve; }));
    setRemoteSnapshot();
    render(React.createElement(RouteView));

    const composer = screen.getByLabelText("Mensagem");
    fireEvent.change(composer, { target: { value: "   " } });
    expect((screen.getByRole("button", { name: "Enviar" }) as HTMLButtonElement).disabled).toBe(true);

    fireEvent.change(composer, { target: { value: "Mensagem única" } });
    fireEvent.click(screen.getByRole("button", { name: "Enviar" }));
    expect((screen.getByRole("button", { name: "Enviando..." }) as HTMLButtonElement).disabled).toBe(true);

    fireEvent.submit(screen.getByRole("button", { name: "Enviando..." }).closest("form")!);
    expect(manualSendMock.sendManualText).toHaveBeenCalledTimes(1);

    (resolveSend as ((value: unknown) => void) | null)?.({
      ok: true,
      kind: "success",
      delivery: "sent",
      messageId: "message-sent",
      conversationId: conversation.id,
    });
    await waitFor(() => expect(screen.getByRole("button", { name: "Enviar" })).toBeTruthy());
  });

  it("não cria mensagem nem refaz dados quando o transporte confirma simulação", async () => {
    manualSendMock.sendManualText.mockResolvedValue({
      ok: true,
      kind: "success",
      delivery: "simulated",
      messageId: null,
      conversationId: conversation.id,
    });
    setRemoteSnapshot();
    render(React.createElement(RouteView));

    fireEvent.change(screen.getByLabelText("Mensagem"), { target: { value: "Teste simulado" } });
    fireEvent.click(screen.getByRole("button", { name: "Enviar" }));

    await waitFor(() => expect(manualSendMock.sendManualText).toHaveBeenCalledTimes(1));
    expect(repoMock.calls.refetchConversationMessages).toBe(0);
    expect(repoMock.state.messages).toHaveLength(0);
    expect((screen.getByLabelText("Mensagem") as HTMLTextAreaElement).value).toBe("");
  });

  it("preserva o texto e libera o composer em erro retornado ou exceção", async () => {
    manualSendMock.sendManualText.mockResolvedValueOnce({
      ok: false,
      kind: "error",
      error: "Falha controlada",
      retryable: false,
      status: 400,
    });
    setRemoteSnapshot();
    const { unmount } = render(React.createElement(RouteView));

    fireEvent.change(screen.getByLabelText("Mensagem"), { target: { value: "Não perder este texto" } });
    fireEvent.click(screen.getByRole("button", { name: "Enviar" }));

    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("Falha controlada"));
    expect((screen.getByLabelText("Mensagem") as HTMLTextAreaElement).value).toBe("Não perder este texto");
    expect((screen.getByRole("button", { name: "Enviar" }) as HTMLButtonElement).disabled).toBe(false);
    expect(repoMock.calls.refetchConversationMessages).toBe(0);

    unmount();
    manualSendMock.sendManualText.mockRejectedValueOnce(new Error("Falha inesperada"));
    render(React.createElement(RouteView));

    fireEvent.change(screen.getByLabelText("Mensagem"), { target: { value: "Texto da exceção" } });
    fireEvent.click(screen.getByRole("button", { name: "Enviar" }));

    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("Falha inesperada"));
    expect((screen.getByLabelText("Mensagem") as HTMLTextAreaElement).value).toBe("Texto da exceção");
    expect((screen.getByRole("button", { name: "Enviar" }) as HTMLButtonElement).disabled).toBe(false);
    expect(repoMock.calls.refetchConversationMessages).toBe(0);
  });
});
