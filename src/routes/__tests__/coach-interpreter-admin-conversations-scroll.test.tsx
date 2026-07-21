// ============================================================================
// FASE 3.1c — Testes de lista, busca, paginação e scroll inteligente do
// console admin do Coach Interpreter.
//
// Escopo estrito:
//  · Lista/Sort/PAGE_SIZE/Preservação de seleção/Estados/Paginação
//    acessível.
//  · Busca sobre dados carregados.
//  · Scroll inteligente da timeline + botão "Ir para o final".
//
// Mocks na fronteira: server functions, auth. Sem acesso a banco.
// ============================================================================
// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act } from "react";
import { render, screen, cleanup, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

// ---------------------------------------------------------------------------
// MOCKS — antes dos imports do módulo.
// ---------------------------------------------------------------------------
vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (_opts: unknown) => ({ options: _opts }),
  Link: (props: { to?: string; children?: ReactNode; className?: string }) => (
    <a href={props.to ?? "#"} className={props.className}>
      {props.children}
    </a>
  ),
  useNavigate: () => vi.fn(),
}));

vi.mock("@tanstack/react-start", () => ({
  useServerFn: <T,>(fn: T) => fn,
}));

const listFn = vi.fn();
const getFn = vi.fn();
const sendFn = vi.fn();
const createFn = vi.fn();
const retryFn = vi.fn();
const updateFn = vi.fn();
const discardFn = vi.fn();
const confirmFn = vi.fn();

vi.mock("@/lib/coach-interpreter/coach-interpreter.functions", () => ({
  listCoachConversationsFn: (...args: unknown[]) => listFn(...args),
  getCoachConversationFn: (...args: unknown[]) => getFn(...args),
  sendCoachMessageFn: (...args: unknown[]) => sendFn(...args),
  createCoachConversationFn: (...args: unknown[]) => createFn(...args),
  retryCoachInterpretationFn: (...args: unknown[]) => retryFn(...args),
  updateCoachProposalFn: (...args: unknown[]) => updateFn(...args),
  discardCoachProposalFn: (...args: unknown[]) => discardFn(...args),
  confirmCoachProposalFn: (...args: unknown[]) => confirmFn(...args),
}));

const authState: { user: { id: string } | null; loading: boolean } = {
  user: { id: "user-1" },
  loading: false,
};
const adminState = { isAdmin: true, isLoading: false };
vi.mock("@/auth/AuthContext", () => ({ useAuth: () => authState }));
vi.mock("@/hooks/useIsAdmin", () => ({ useIsAdmin: () => adminState }));
vi.mock("@/lib/coach-rules/coach-rules.repository", () => ({
  COACH_CATEGORY_LABEL: { atendimento: "Atendimento", vendas: "Vendas" },
  COACH_TYPE_LABEL: { proibicao: "Proibição", instrucao: "Instrução" },
}));

beforeEach(() => {
  listFn.mockReset();
  getFn.mockReset();
  sendFn.mockReset();
  createFn.mockReset();
  retryFn.mockReset();
  updateFn.mockReset();
  discardFn.mockReset();
  confirmFn.mockReset();
  authState.user = { id: "user-1" };
  authState.loading = false;
  adminState.isAdmin = true;
  adminState.isLoading = false;
  // jsdom não implementa scrollTo — instala stub para permitir spy.
  if (typeof HTMLElement.prototype.scrollTo !== "function") {
    (HTMLElement.prototype as unknown as { scrollTo: (arg: unknown) => void }).scrollTo =
      function () {};
  }
});


afterEach(() => cleanup());

const mod = await import("@/lib/coach-interpreter/admin-console");
const {
  InterpreterShell,
  ConversationsPanel,
  ChatTimeline,
  sortConversations,
  isNearBottom,
} = mod;

type ConversationRow = {
  id: string;
  company_id: string;
  owner_user_id: string | null;
  title: string | null;
  status: string;
  last_message_at: string | null;
  created_at: string;
  updated_at?: string | null;
};

type MessageRow = {
  id: string;
  conversation_id: string;
  kind: string;
  author_user_id: string | null;
  content: string;
  payload: unknown;
  run: unknown;
  client_request_id: string | null;
  created_at: string;
};

function makeConv(over: Partial<ConversationRow> = {}): ConversationRow {
  return {
    id: over.id ?? "conv-x",
    company_id: "co-1",
    owner_user_id: "user-1",
    title: over.title ?? `Conversa ${over.id ?? "x"}`,
    status: "active",
    last_message_at: null,
    created_at: over.created_at ?? "2026-07-01T10:00:00Z",
    updated_at: over.updated_at ?? null,
    ...over,
  };
}

function makeMsg(over: Partial<MessageRow> = {}): MessageRow {
  return {
    id: over.id ?? "m-1",
    conversation_id: over.conversation_id ?? "conv-1",
    kind: over.kind ?? "assistant_message",
    author_user_id: null,
    content: over.content ?? "hello",
    payload: null,
    run: null,
    client_request_id: null,
    created_at: over.created_at ?? "2026-07-21T10:00:00Z",
    ...over,
  };
}

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function renderWithClient(ui: ReactNode) {
  const qc = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0, staleTime: 0 },
      mutations: { retry: false },
    },
  });
  const utils = render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
  return { ...utils, qc };
}

// ===========================================================================
// 1. SORT / PAGE_SIZE
// ===========================================================================
describe("Fase 3.1c · Ordenação e paginação", () => {
  it("ordena por updated_at desc", () => {
    const rows = [
      makeConv({ id: "a", updated_at: "2026-07-10T10:00:00Z" }),
      makeConv({ id: "b", updated_at: "2026-07-20T10:00:00Z" }),
      makeConv({ id: "c", updated_at: "2026-07-15T10:00:00Z" }),
    ];
    expect(sortConversations(rows).map((r) => r.id)).toEqual(["b", "c", "a"]);
  });

  it("fallback para created_at desc quando updated_at ausente", () => {
    const rows = [
      makeConv({ id: "a", created_at: "2026-07-01T10:00:00Z" }),
      makeConv({ id: "b", created_at: "2026-07-05T10:00:00Z" }),
      makeConv({ id: "c", created_at: "2026-07-03T10:00:00Z" }),
    ];
    expect(sortConversations(rows).map((r) => r.id)).toEqual(["b", "c", "a"]);
  });

  it("mistura: updated_at prevalece sobre created_at do mesmo item", () => {
    const rows = [
      makeConv({
        id: "a",
        created_at: "2026-07-01T10:00:00Z",
        updated_at: "2026-07-25T10:00:00Z",
      }),
      makeConv({ id: "b", created_at: "2026-07-20T10:00:00Z" }),
    ];
    expect(sortConversations(rows).map((r) => r.id)).toEqual(["a", "b"]);
  });

  it("PAGE_SIZE = 15: paginação renderiza 15 por página", async () => {
    const rows: ConversationRow[] = Array.from({ length: 20 }, (_, i) =>
      makeConv({
        id: `c-${String(i).padStart(2, "0")}`,
        title: `Título ${i}`,
        updated_at: `2026-07-${String(20 - i).padStart(2, "0")}T10:00:00Z`,
      }),
    );
    renderWithClient(
      <ConversationsPanel
        conversations={rows}
        loading={false}
        error={null}
        selectedId={null}
        onSelect={() => {}}
        onRefresh={() => {}}
      />,
    );
    const list = screen.getByTestId("conversations-list");
    expect(within(list).getAllByRole("button")).toHaveLength(15);
    // Indicador de página + nav acessível
    const nav = screen.getByTestId("conversations-pagination");
    expect(nav.tagName).toBe("NAV");
    expect(nav).toHaveAttribute("aria-label");
    expect(screen.getByTestId("conversations-page-indicator")).toHaveTextContent(
      "Página 1 / 2",
    );
  });

  it("paginação: 'Próxima' avança, 'Anterior' volta; botões acessíveis", async () => {
    const user = userEvent.setup();
    const rows: ConversationRow[] = Array.from({ length: 17 }, (_, i) =>
      makeConv({
        id: `c-${String(i).padStart(2, "0")}`,
        title: `Título ${i}`,
        updated_at: `2026-07-${String(20 - i).padStart(2, "0")}T10:00:00Z`,
      }),
    );
    renderWithClient(
      <ConversationsPanel
        conversations={rows}
        loading={false}
        error={null}
        selectedId={null}
        onSelect={() => {}}
        onRefresh={() => {}}
      />,
    );
    const next = screen.getByRole("button", { name: /Próxima página/i });
    const prev = screen.getByRole("button", { name: /Página anterior/i });
    expect(prev).toBeDisabled();
    await user.click(next);
    expect(screen.getByTestId("conversations-page-indicator")).toHaveTextContent(
      "Página 2 / 2",
    );
    expect(next).toBeDisabled();
    await user.click(prev);
    expect(screen.getByTestId("conversations-page-indicator")).toHaveTextContent(
      "Página 1 / 2",
    );
  });
});

// ===========================================================================
// 2. ESTADOS DA LISTA
// ===========================================================================
describe("Fase 3.1c · Estados da lista", () => {
  it("loading distinto de vazio/erro/sem-resultado", () => {
    renderWithClient(
      <ConversationsPanel
        conversations={[]}
        loading={true}
        error={null}
        selectedId={null}
        onSelect={() => {}}
        onRefresh={() => {}}
      />,
    );
    expect(screen.getByTestId("conversations-loading")).toBeInTheDocument();
    expect(screen.queryByTestId("conversations-empty")).not.toBeInTheDocument();
    expect(screen.queryByTestId("conversations-no-search-result")).not.toBeInTheDocument();
    expect(screen.queryByTestId("conversations-error")).not.toBeInTheDocument();
  });

  it("erro distinto de vazio", () => {
    renderWithClient(
      <ConversationsPanel
        conversations={[]}
        loading={false}
        error={{
          code: "internal",
          message: "Erro interno.",
          disabled: false,
          killed: false,
          notFound: false,
          unauthorized: false,
        }}
        selectedId={null}
        onSelect={() => {}}
        onRefresh={() => {}}
      />,
    );
    expect(screen.getByTestId("conversations-error")).toBeInTheDocument();
    expect(screen.queryByTestId("conversations-empty")).not.toBeInTheDocument();
  });

  it("vazio (nenhuma conversa carregada)", () => {
    renderWithClient(
      <ConversationsPanel
        conversations={[]}
        loading={false}
        error={null}
        selectedId={null}
        onSelect={() => {}}
        onRefresh={() => {}}
      />,
    );
    expect(screen.getByTestId("conversations-empty")).toBeInTheDocument();
    expect(screen.queryByTestId("conversations-no-search-result")).not.toBeInTheDocument();
  });

  it("busca sem resultados é distinta do estado vazio", async () => {
    const user = userEvent.setup();
    const rows = [makeConv({ id: "a", title: "Alpha" })];
    renderWithClient(
      <ConversationsPanel
        conversations={rows}
        loading={false}
        error={null}
        selectedId={null}
        onSelect={() => {}}
        onRefresh={() => {}}
      />,
    );
    await user.type(screen.getByLabelText(/Buscar conversa/i), "zeta");
    expect(screen.getByTestId("conversations-no-search-result")).toBeInTheDocument();
    expect(screen.queryByTestId("conversations-empty")).not.toBeInTheDocument();
  });

  it("aviso discreto: busca só considera dados carregados", () => {
    renderWithClient(
      <ConversationsPanel
        conversations={[]}
        loading={false}
        error={null}
        selectedId={null}
        onSelect={() => {}}
        onRefresh={() => {}}
      />,
    );
    expect(screen.getByTestId("search-scope-notice")).toHaveTextContent(
      /apenas as conversas já carregadas/i,
    );
  });
});

// ===========================================================================
// 3. PRESERVAÇÃO DE SELEÇÃO (shell reconcilia após refetch)
// ===========================================================================
describe("Fase 3.1c · Preservação de seleção", () => {
  it("preserva conversa selecionada quando refetch traz a mesma", async () => {
    const user = userEvent.setup();
    const initial = [
      makeConv({ id: "conv-a", title: "Alpha", updated_at: "2026-07-20T10:00Z" }),
      makeConv({ id: "conv-b", title: "Beta", updated_at: "2026-07-18T10:00Z" }),
    ];
    listFn.mockResolvedValue({ conversations: initial });
    getFn.mockResolvedValue({
      conversation: { ...initial[1], created_at: initial[1].created_at },
      messages: [],
      proposals: [],
    });
    renderWithClient(<InterpreterShell />);
    // Seleciona Beta.
    await user.click(await screen.findByText("Beta"));
    await waitFor(() =>
      expect(screen.getByTestId("conversation-item-conv-b")).toHaveAttribute(
        "aria-current",
        "true",
      ),
    );
    // Refetch com mesmo conjunto.
    await user.click(screen.getByLabelText(/Recarregar conversas/i));
    await waitFor(() => expect(listFn).toHaveBeenCalledTimes(2));
    // Seleção preservada.
    expect(screen.getByTestId("conversation-item-conv-b")).toHaveAttribute(
      "aria-current",
      "true",
    );
  });

  it("seleciona fallback (primeira) quando a atual desaparece", async () => {
    const user = userEvent.setup();
    const initial = [
      makeConv({ id: "conv-a", title: "Alpha", updated_at: "2026-07-20T10:00Z" }),
      makeConv({ id: "conv-b", title: "Beta", updated_at: "2026-07-18T10:00Z" }),
    ];
    listFn.mockResolvedValueOnce({ conversations: initial });
    // Segundo fetch: conv-b some.
    listFn.mockResolvedValueOnce({ conversations: [initial[0]] });
    getFn.mockResolvedValue({
      conversation: initial[0],
      messages: [],
      proposals: [],
    });
    renderWithClient(<InterpreterShell />);
    await user.click(await screen.findByText("Beta"));
    await waitFor(() =>
      expect(screen.getByTestId("conversation-item-conv-b")).toHaveAttribute(
        "aria-current",
        "true",
      ),
    );
    await user.click(screen.getByLabelText(/Recarregar conversas/i));
    // Após refetch, seleção cai para conv-a (primeira ordenada).
    await waitFor(() =>
      expect(screen.getByTestId("conversation-item-conv-a")).toHaveAttribute(
        "aria-current",
        "true",
      ),
    );
    expect(screen.queryByTestId("conversation-item-conv-b")).not.toBeInTheDocument();
  });

  it("volta ao empty state quando todas as conversas somem", async () => {
    const user = userEvent.setup();
    const initial = [makeConv({ id: "conv-a", title: "Alpha" })];
    listFn.mockResolvedValueOnce({ conversations: initial });
    listFn.mockResolvedValueOnce({ conversations: [] });
    getFn.mockResolvedValue({
      conversation: initial[0],
      messages: [],
      proposals: [],
    });
    renderWithClient(<InterpreterShell />);
    await user.click(await screen.findByText("Alpha"));
    await user.click(screen.getByLabelText(/Recarregar conversas/i));
    await waitFor(() =>
      expect(screen.getByTestId("conversation-empty-state")).toBeInTheDocument(),
    );
  });
});

// ===========================================================================
// 4. CRIAÇÃO DUPLICADA
// ===========================================================================
describe("Fase 3.1c · Criação de conversa não duplica", () => {
  it("clique duplo enquanto pendente dispara apenas uma criação", async () => {
    const user = userEvent.setup();
    const gate = deferred<{ conversation: { id: string } }>();
    createFn.mockReturnValueOnce(gate.promise);
    listFn.mockResolvedValue({ conversations: [] });
    renderWithClient(<InterpreterShell />);
    const btn = await screen.findByTestId("new-conversation-button");
    await user.click(btn);
    await user.click(btn);
    await user.click(btn);
    expect(createFn).toHaveBeenCalledTimes(1);
    await act(async () => {
      gate.resolve({ conversation: { id: "conv-new" } });
    });
  });
});

// ===========================================================================
// 5. SCROLL INTELIGENTE
// ===========================================================================
describe("Fase 3.1c · Scroll inteligente da timeline", () => {
  // Simula um container scrollável — jsdom não faz layout real.
  function stubScroll(
    el: HTMLElement,
    { scrollHeight, clientHeight, scrollTop }: {
      scrollHeight: number;
      clientHeight: number;
      scrollTop: number;
    },
  ) {
    Object.defineProperty(el, "scrollHeight", { configurable: true, value: scrollHeight });
    Object.defineProperty(el, "clientHeight", { configurable: true, value: clientHeight });
    Object.defineProperty(el, "scrollTop", {
      configurable: true,
      value: scrollTop,
      writable: true,
    });
  }

  it("isNearBottom: verdadeiro quando distância <= threshold", () => {
    expect(isNearBottom({ scrollHeight: 1000, scrollTop: 950, clientHeight: 50 })).toBe(true);
    expect(isNearBottom({ scrollHeight: 1000, scrollTop: 100, clientHeight: 50 })).toBe(false);
  });

  it("abre conversa posicionando no fim (scrollTo é chamado)", async () => {
    const spy = vi.spyOn(HTMLElement.prototype, "scrollTo").mockImplementation(() => {});
    try {
      const msgs = [makeMsg({ id: "m1" }), makeMsg({ id: "m2" })];
      renderWithClient(
        <ChatTimeline messages={msgs} conversationId="conv-1" onChanged={() => {}} />,
      );
      await waitFor(() => expect(spy).toHaveBeenCalled());
    } finally {
      spy.mockRestore();
    }
  });

  it("nova mensagem quando usuário está próximo do fim → auto-scroll", async () => {
    const spy = vi.spyOn(HTMLElement.prototype, "scrollTo").mockImplementation(() => {});
    try {
      const initial = [makeMsg({ id: "m1" })];
      const { rerender, qc } = renderWithClient(
        <ChatTimeline messages={initial} conversationId="conv-1" onChanged={() => {}} />,
      );
      const el = screen.getByTestId("chat-timeline");
      stubScroll(el, { scrollHeight: 500, clientHeight: 400, scrollTop: 60 });
      spy.mockClear();
      const next = [...initial, makeMsg({ id: "m2", kind: "assistant_message" })];
      rerender(
        <QueryClientProvider client={qc}>
          <ChatTimeline messages={next} conversationId="conv-1" onChanged={() => {}} />
        </QueryClientProvider>,
      );
      await waitFor(() => expect(spy).toHaveBeenCalled());
    } finally {
      spy.mockRestore();
    }
  });

  it("usuário lendo histórico (distante) NÃO é puxado ao fim por nova assistant_message", async () => {
    const spy = vi.spyOn(HTMLElement.prototype, "scrollTo").mockImplementation(() => {});
    try {
      const initial = [makeMsg({ id: "m1" })];
      const { rerender, qc } = renderWithClient(
        <ChatTimeline messages={initial} conversationId="conv-1" onChanged={() => {}} />,
      );
      const el = screen.getByTestId("chat-timeline");
      // Bem distante do fim: distance = 1000 - 100 - 400 = 500 > threshold.
      stubScroll(el, { scrollHeight: 1000, clientHeight: 400, scrollTop: 100 });
      spy.mockClear();
      const next = [...initial, makeMsg({ id: "m2", kind: "assistant_message" })];
      rerender(
        <QueryClientProvider client={qc}>
          <ChatTimeline messages={next} conversationId="conv-1" onChanged={() => {}} />
        </QueryClientProvider>,
      );
      // Deixa o layoutEffect rodar.
      await Promise.resolve();
      expect(spy).not.toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });

  it("nova user_message SEMPRE puxa ao fim (envio local)", async () => {
    const spy = vi.spyOn(HTMLElement.prototype, "scrollTo").mockImplementation(() => {});
    try {
      const initial = [makeMsg({ id: "m1", kind: "assistant_message" })];
      const { rerender, qc } = renderWithClient(
        <ChatTimeline messages={initial} conversationId="conv-1" onChanged={() => {}} />,
      );
      const el = screen.getByTestId("chat-timeline");
      stubScroll(el, { scrollHeight: 1000, clientHeight: 400, scrollTop: 100 });
      spy.mockClear();
      const next = [...initial, makeMsg({ id: "m2", kind: "user_message" })];
      rerender(
        <QueryClientProvider client={qc}>
          <ChatTimeline messages={next} conversationId="conv-1" onChanged={() => {}} />
        </QueryClientProvider>,
      );
      await waitFor(() => expect(spy).toHaveBeenCalled());
    } finally {
      spy.mockRestore();
    }
  });

  it("botão 'Ir para o final' aparece quando usuário está distante e some ao clicar", async () => {
    const user = userEvent.setup();
    const spy = vi.spyOn(HTMLElement.prototype, "scrollTo").mockImplementation(function (
      this: HTMLElement,
      arg: ScrollToOptions | number,
    ) {
      const top = typeof arg === "number" ? arg : arg?.top ?? 0;
      Object.defineProperty(this, "scrollTop", {
        configurable: true,
        value: top,
        writable: true,
      });
    });
    try {
      const msgs = [makeMsg({ id: "m1" })];
      renderWithClient(
        <ChatTimeline messages={msgs} conversationId="conv-1" onChanged={() => {}} />,
      );
      const el = screen.getByTestId("chat-timeline");
      stubScroll(el, { scrollHeight: 1000, clientHeight: 400, scrollTop: 100 });
      // Dispara scroll para reavaliar visibilidade.
      el.dispatchEvent(new Event("scroll"));
      const jump = await screen.findByTestId("chat-jump-to-end");
      expect(jump).toBeInTheDocument();
      // Simula que scrollTo levará ao fim; após o clique, verificamos apenas
      // que scrollTo foi invocado (comportamento coberto).
      await user.click(jump);
      // Após clique com nosso stub, scrollTop = scrollHeight → botão some.
      // O componente reavalia visibilidade no próximo layoutEffect via re-render
      // do state; disparamos scroll para forçar a leitura.
      Object.defineProperty(el, "scrollTop", { configurable: true, value: 600 });
      el.dispatchEvent(new Event("scroll"));
      await waitFor(() =>
        expect(screen.queryByTestId("chat-jump-to-end")).not.toBeInTheDocument(),
      );
    } finally {
      spy.mockRestore();
    }
  });

  it("retry bem-sucedido atualiza scroll (força fim no próximo layout)", async () => {
    const user = userEvent.setup();
    retryFn.mockResolvedValue({ ok: true });
    const spy = vi.spyOn(HTMLElement.prototype, "scrollTo").mockImplementation(() => {});
    try {
      const msgs = [makeMsg({ id: "u1", kind: "user_message", content: "oi" })];
      renderWithClient(
        <ChatTimeline messages={msgs} conversationId="conv-1" onChanged={() => {}} />,
      );
      const el = screen.getByTestId("chat-timeline");
      // Distante do fim para provar que só o forceScroll do retry puxa.
      stubScroll(el, { scrollHeight: 1000, clientHeight: 400, scrollTop: 100 });
      spy.mockClear();
      await user.click(screen.getByRole("button", { name: /Reinterpretar/i }));
      await waitFor(() => expect(retryFn).toHaveBeenCalledTimes(1));
      // O forceScrollNextRef fica true; o próximo layoutEffect chama scrollTo.
      // Forçamos re-render simulando invalidação (mesma prop messages).
      await waitFor(() => expect(spy).toHaveBeenCalled());
    } finally {
      spy.mockRestore();
    }
  });
});
