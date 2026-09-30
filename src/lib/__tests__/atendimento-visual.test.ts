// @vitest-environment jsdom

import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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
    loadConversationRecent: [] as Array<[string, number]>,
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
      calls.getLeads = 0;
      calls.getConversations = 0;
      calls.getLeadById = 0;
      calls.getMessagesFor = 0;
      calls.refetchConversationMessages = 0;
      calls.loadConversationRecent = [];
      calls.forbiddenSend = 0;
      calls.forbiddenPersist = 0;
      calls.forbiddenAi = 0;
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
    loadConversationRecent: async (id: string, limit: number) => {
      calls.loadConversationRecent.push([id, limit]);
      return { ok: true };
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
  loadConversationRecent: repoMock.loadConversationRecent,
  loadConversationOlder: async () => ({ added: 0, hasMore: false }),
  hasMoreOlderMessages: () => false,
  resetConversationRecentLoaded: () => undefined,
  markLeadWon: repoMock.forbiddenPersist,
  markLeadLost: repoMock.forbiddenPersist,
  updateLeadNextAction: repoMock.forbiddenPersist,
}));

// Sessão da empresa A — a tela real roda dentro do AuthProvider.
vi.mock("@/auth/AuthContext", () => ({
  useAuth: () => ({ user: { id: "user-a" }, profile: { id: "user-a", company_id: "company-a" } }),
}));
vi.mock("@/hooks/useIsAdmin", () => ({ useIsAdmin: () => ({ isAdmin: true, isLoading: false }) }));
vi.mock("@/hooks/useManualFollowup", () => ({
  useManualFollowup: () => ({
    run: vi.fn(),
    running: false,
    result: null,
    error: null,
    clear: vi.fn(),
  }),
}));

// Widgets reaproveitados da Caixa de atendimento têm testes próprios; aqui só
// importa que o Atendimento 2.0 os monte no lugar certo.
vi.mock("@/components/inbox/composer/ComposerWidgets", async () => {
  const { createElement } = await import("react");
  return {
    MediaSendPanel: () => createElement("button", { type: "button", "aria-label": "Anexar mídia" }),
    QuickRepliesButton: () =>
      createElement("button", { type: "button", "aria-label": "Respostas Rápidas" }),
  };
});
// Pipeline de áudio (microfone, encoder, upload) — o gravador da tela é real.
const voiceMock = vi.hoisted(() => {
  const capture = {
    kind: "native" as const,
    mime: "audio/webm;codecs=opus",
    source: "android_native" as const,
    bitrate: 96000,
    platform: "android_or_desktop" as const,
    pause: vi.fn(),
    resume: vi.fn(),
    stop: vi.fn(async () => new Blob(["raw"], { type: "audio/webm" })),
    abort: vi.fn(),
  };
  class VoiceNoteError extends Error {}
  return {
    capture,
    VoiceNoteError,
    stopLevels: vi.fn(),
    openMicrophone: vi.fn(async () => ({ getTracks: () => [{ stop: vi.fn() }] })),
    startVoiceCapture: vi.fn(async () => capture),
    prepareVoiceNote: vi.fn(async () => ({
      blob: new Blob(["ogg"], { type: "audio/ogg" }),
      transcodeMs: 1,
      bitrate: 96000,
    })),
    uploadVoiceNote: vi.fn(async () => undefined),
  };
});
vi.mock("@/lib/audio/voice-note", () => ({
  openMicrophone: voiceMock.openMicrophone,
  startVoiceCapture: voiceMock.startVoiceCapture,
  prepareVoiceNote: voiceMock.prepareVoiceNote,
  uploadVoiceNote: voiceMock.uploadVoiceNote,
  watchInputLevel: () => voiceMock.stopLevels,
  microphoneErrorMessage: () => "Permissão de microfone negada.",
  VoiceNoteError: voiceMock.VoiceNoteError,
}));
vi.mock("@/components/MetaTemplatesModal", async () => {
  const { createElement } = await import("react");
  return {
    MetaTemplatesModal: ({ open }: { open: boolean }) =>
      open ? createElement("div", { "data-testid": "templates-modal" }) : null,
  };
});
vi.mock("@/components/coach/CoachPanel", async () => {
  const { createElement } = await import("react");
  return { CoachPanel: () => createElement("div", { "data-testid": "coach-panel" }) };
});
vi.mock("@/components/AITimeline", () => ({ AITimeline: () => null }));

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
    window.sessionStorage.clear();
    vi.clearAllMocks();
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: { getUserMedia: vi.fn() },
    });
    Object.defineProperty(window, "isSecureContext", { configurable: true, value: true });
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

  it.each(["legacy", "normalized"])("exibe imagem recebida do Instagram (%s) em vez de [mídia]", async (format) => {
    const url = "https://lookaside.fbsbx.com/ig_messaging_cdn/?asset_id=sample";
    setRemoteSnapshot({
      leads: [{ ...lead, channel: "instagram" }],
      conversations: [{ ...conversation, channel: "instagram" }],
      messages: [{
        id: "instagram-photo", conversationId: conversation.id, role: "lead",
        text: "[mídia]", at: new Date().toISOString(), sourceSubtype: "dm",
        sourceMetadata: format === "legacy"
          ? { raw: { message: { attachments: [{ type: "image", payload: { url } }] } } }
          : { media_kind: "image", media_url: url },
      }],
    });
    render(React.createElement(RouteView));
    const image = await screen.findByRole("img", { name: /^Imagem$/ });
    await waitFor(() => expect(image.getAttribute("src")).toBe(url));
    const bubble = document.getElementById("msg-instagram-photo")!;
    expect(within(bubble).queryByText("[mídia]", { exact: true })).toBeNull();
    expect(manualSendMock.sendManualText).not.toHaveBeenCalled();
  });

  it.each(["X", "fora", "Escape"])("fecha a imagem por %s sem reabrir o modal", async (method) => {
    const user = userEvent.setup();
    setRemoteSnapshot({ messages: [{
      id: "lightbox-photo", conversationId: conversation.id, role: "lead",
      text: "[imagem]", at: new Date().toISOString(), sourceSubtype: "image",
      sourceMetadata: { media_url: "https://example.com/photo.jpg", media_kind: "image" },
    }] });
    render(React.createElement(RouteView));
    const trigger = await screen.findByRole("button", { name: "Ampliar imagem" });
    await user.click(trigger);
    const dialog = await screen.findByRole("dialog", { name: "Imagem ampliada" });
    // O modal não pode ficar dentro do balão que escala/recebe long press.
    expect(document.getElementById("msg-lightbox-photo")!.contains(dialog)).toBe(false);
    await user.click(within(dialog).getByRole("img"));
    expect(screen.getByRole("dialog")).toBe(dialog);
    if (method === "X") await user.click(within(dialog).getByRole("button", { name: "Fechar" }));
    else if (method === "fora") await user.click(dialog.previousElementSibling!);
    else await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(trigger));
    // Uma atualização da conversa não deve reabrir a imagem; só um novo clique.
    act(() => repoMock.setState({ messages: [...repoMock.state.messages] }));
    expect(screen.queryByRole("dialog")).toBeNull();
    await user.click(trigger);
    expect(await screen.findByRole("dialog")).toBeTruthy();
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
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

  it("keeps composer enabled for a closed-sale customer", async () => {
    setRemoteSnapshot({
      leads: [{ ...lead, status: "fechado", closedAt: "2026-09-18T12:00:00.000Z" }],
    });
    render(React.createElement(RouteView));

    const composer = screen.getByLabelText("Mensagem") as HTMLTextAreaElement;
    expect(composer.disabled).toBe(false);
    expect(screen.queryByPlaceholderText("Conversa encerrada.")).toBeNull();

    fireEvent.change(composer, { target: { value: "Mensagem para cliente" } });
    fireEvent.click(screen.getByRole("button", { name: "Enviar" }));
    await waitFor(() => expect(manualSendMock.sendManualText).toHaveBeenCalledTimes(1));
  });

  it("keeps composer blocked for a lost lead", () => {
    setRemoteSnapshot({
      leads: [{ ...lead, status: "perdido" }],
    });
    render(React.createElement(RouteView));

    const composer = screen.getByLabelText("Mensagem") as HTMLTextAreaElement;
    expect(composer.disabled).toBe(true);
    expect(screen.getByPlaceholderText("Conversa encerrada.")).toBeTruthy();
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
    // Campo vazio: no lugar de "Enviar" fica o microfone, como no WhatsApp.
    expect(screen.queryByRole("button", { name: "Enviar" })).toBeNull();
    expect(screen.getByRole("button", { name: "Gravar áudio" })).toBeTruthy();

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
    // Envio concluído: o campo esvazia e o botão volta a ser o microfone.
    await waitFor(() => expect(screen.getByRole("button", { name: "Gravar áudio" })).toBeTruthy());
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
  it("carrega o histórico real da conversa ao abrir", async () => {
    setRemoteSnapshot();
    render(React.createElement(RouteView));

    await waitFor(() =>
      expect(repoMock.calls.loadConversationRecent).toContainEqual([conversation.id, 100]),
    );
  });

  it("expõe os recursos do composer, as ações da conversa e o Coach real", async () => {
    setRemoteSnapshot();
    render(React.createElement(RouteView));

    for (const name of [
      "Anexar mídia",
      "Respostas Rápidas",
      "Inserir emoji",
      "Gravar áudio",
      "Sugerir com IA",
    ]) {
      expect(screen.getByRole("button", { name }), name).toBeTruthy();
    }
    expect(screen.getByRole("button", { name: "Fechar venda" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Mais ações" })).toBeTruthy();

    fireEvent.click(screen.getByRole("tab", { name: "IA" }));
    expect(screen.getByTestId("coach-panel")).toBeTruthy();
  });

  it("fora da janela de 24h oferece template aprovado em vez de só falhar", async () => {
    manualSendMock.sendManualText.mockResolvedValueOnce({
      ok: false,
      kind: "error",
      error: "Cliente fora da janela de 24h. Use um template aprovado.",
      retryable: false,
      status: 409,
      requiresTemplate: true,
    });
    setRemoteSnapshot();
    render(React.createElement(RouteView));

    fireEvent.change(screen.getByLabelText("Mensagem"), { target: { value: "Oi de novo" } });
    fireEvent.click(screen.getByRole("button", { name: "Enviar" }));

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("janela de 24h");
    fireEvent.click(within(alert).getByRole("button", { name: "Enviar template aprovado" }));
    expect(screen.getByTestId("templates-modal")).toBeTruthy();
    expect((screen.getByLabelText("Mensagem") as HTMLTextAreaElement).value).toBe("Oi de novo");
  });

  it("avisa quando o envio foi apenas simulado", async () => {
    manualSendMock.sendManualText.mockResolvedValue({
      ok: true,
      kind: "success",
      delivery: "simulated",
      messageId: null,
      conversationId: conversation.id,
    });
    setRemoteSnapshot();
    render(React.createElement(RouteView));

    fireEvent.change(screen.getByLabelText("Mensagem"), { target: { value: "Teste" } });
    fireEvent.click(screen.getByRole("button", { name: "Enviar" }));

    expect((await screen.findByRole("status")).textContent).toContain("não chegou ao cliente");
  });

  it("responde citando a mensagem com reply nativo quando ela tem id externo", async () => {
    const incoming: Message = {
      id: "msg-lead-1",
      conversationId: conversation.id,
      role: "lead",
      text: "Qual o prazo de entrega?",
      at: "2026-09-18T10:00:00.000Z",
      sourceMetadata: { external_id: "wamid.abc" },
    };
    setRemoteSnapshot({ messages: [incoming] });
    render(React.createElement(RouteView));

    fireEvent.click(screen.getByRole("button", { name: "Responder mensagem" }));
    expect(screen.getByText(`Respondendo a ${lead.name}`)).toBeTruthy();

    fireEvent.change(screen.getByLabelText("Mensagem"), { target: { value: "Chega em 3 dias" } });
    fireEvent.click(screen.getByRole("button", { name: "Enviar" }));

    await waitFor(() =>
      expect(manualSendMock.sendManualText).toHaveBeenCalledWith(
        expect.objectContaining({ text: "Chega em 3 dias", replyToMessageId: incoming.id }),
      ),
    );
    await waitFor(() => expect(screen.queryByText(`Respondendo a ${lead.name}`)).toBeNull());
  });

  it("clientes de exemplo mostram a conversa mas não enviam nada", async () => {
    setRemoteSnapshot();
    render(React.createElement(RouteView));

    fireEvent.click(screen.getByRole("button", { name: /Ver exemplos/ }));

    const composer = screen.getByLabelText("Mensagem") as HTMLTextAreaElement;
    expect(composer.disabled).toBe(true);
    expect(screen.queryByRole("button", { name: "Mais ações" })).toBeNull();
    expect(repoMock.calls.loadConversationRecent.every(([id]) => id === conversation.id)).toBe(
      true,
    );
  });
  it("mantém a mensagem enviada na tela mesmo sem o realtime entregar", async () => {
    setRemoteSnapshot();
    render(React.createElement(RouteView));

    fireEvent.change(screen.getByLabelText("Mensagem"), { target: { value: "Olá, tudo bem?" } });
    fireEvent.click(screen.getByRole("button", { name: "Enviar" }));

    await waitFor(() => expect(repoMock.calls.refetchConversationMessages).toBe(1));
    // O repo (realtime/refetch) não trouxe nada, e a bolha confirmada continua.
    expect(repoMock.state.messages).toHaveLength(0);
    expect(screen.getByText("Olá, tudo bem?")).toBeTruthy();
  });

  it("grava áudio por toque: pausa, continua, descarta e volta ao composer", async () => {
    setRemoteSnapshot();
    render(React.createElement(RouteView));

    fireEvent.click(screen.getByRole("button", { name: "Gravar áudio" }));
    await screen.findByRole("button", { name: "Pausar gravação" });
    expect(screen.queryByLabelText("Mensagem")).toBeNull();
    expect(screen.getByLabelText(/^Duração /)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Pausar gravação" }));
    expect(voiceMock.capture.pause).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Continuar gravação" }));
    expect(voiceMock.capture.resume).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: "Descartar áudio" }));
    expect(voiceMock.capture.abort).toHaveBeenCalledTimes(1);
    expect(screen.getByLabelText("Mensagem")).toBeTruthy();
    expect(voiceMock.uploadVoiceNote).not.toHaveBeenCalled();
  });

  it("envia o áudio pela seta e volta ao composer", async () => {
    setRemoteSnapshot();
    render(React.createElement(RouteView));

    fireEvent.click(screen.getByRole("button", { name: "Gravar áudio" }));
    fireEvent.click(await screen.findByRole("button", { name: "Enviar áudio" }));

    await waitFor(() => expect(voiceMock.uploadVoiceNote).toHaveBeenCalledTimes(1));
    expect(voiceMock.uploadVoiceNote).toHaveBeenCalledWith(
      expect.objectContaining({ conversationId: conversation.id }),
    );
    await waitFor(() => expect(screen.getByLabelText("Mensagem")).toBeTruthy());
  });

  it("preserva a gravação quando o envio do áudio falha e reenvia sem regravar", async () => {
    voiceMock.uploadVoiceNote.mockRejectedValueOnce(new Error("HTTP 502 · stage=meta"));
    setRemoteSnapshot();
    render(React.createElement(RouteView));

    fireEvent.click(screen.getByRole("button", { name: "Gravar áudio" }));
    fireEvent.click(await screen.findByRole("button", { name: "Enviar áudio" }));

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("HTTP 502");
    expect(alert.textContent).toContain("gravação foi mantida");

    fireEvent.click(screen.getByRole("button", { name: "Tentar enviar o áudio de novo" }));
    await waitFor(() => expect(voiceMock.uploadVoiceNote).toHaveBeenCalledTimes(2));
    const [first, second] = voiceMock.uploadVoiceNote.mock.calls.map(
      (call) => (call as unknown as [{ blob: Blob }])[0].blob,
    );
    expect(second).toBe(first);
    expect(voiceMock.capture.stop).toHaveBeenCalledTimes(1);
    expect(voiceMock.prepareVoiceNote).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.getByLabelText("Mensagem")).toBeTruthy());
  });
});
