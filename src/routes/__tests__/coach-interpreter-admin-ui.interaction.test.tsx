// ============================================================================
// FASE 3.1a — Bateria de testes de componente/interação da UI Administrativa
// do Coach Interpreter.
//
// Escopo estrito:
//  - Testa APENAS a fundação estrutural implementada na Fase 3.1a.
//  - Não integra com CoachPanel V1, não ativa flags, não fala com backend.
//  - Mocks estão na FRONTEIRA da UI (server functions, hooks de auth).
//  - Usa React Testing Library + userEvent para interações reais.
// ============================================================================
// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act } from "react";
import {
  render,
  screen,
  cleanup,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

// ---------------------------------------------------------------------------
// MOCKS — devem ser declarados antes do import da rota.
// ---------------------------------------------------------------------------

// TanStack Router: usamos apenas Link/useNavigate/createFileRoute na rota.
vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (_opts: unknown) => ({ options: _opts }),
  Link: (props: { to?: string; children?: ReactNode; className?: string }) => (
    <a href={props.to ?? "#"} className={props.className}>
      {props.children}
    </a>
  ),
  useNavigate: () => vi.fn(),
}));

// useServerFn: retorna a própria função (identidade). Assim os testes
// controlam o comportamento diretamente através dos mocks abaixo.
vi.mock("@tanstack/react-start", () => ({
  useServerFn: <T,>(fn: T) => fn,
}));

// Server functions — cada uma é um vi.fn() que os testes reconfiguram.
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

// Auth + admin — reconfiguráveis por teste.
const authState: {
  user: { id: string } | null;
  loading: boolean;
} = { user: { id: "user-1" }, loading: false };
const adminState: { isAdmin: boolean; isLoading: boolean } = {
  isAdmin: true,
  isLoading: false,
};
vi.mock("@/auth/AuthContext", () => ({
  useAuth: () => authState,
}));
vi.mock("@/hooks/useIsAdmin", () => ({
  useIsAdmin: () => adminState,
}));

// Labels do módulo Coach Rules — expõem constantes puras; passamos por trás
// para não puxar dependências server-side em cascata.
vi.mock("@/lib/coach-rules/coach-rules.repository", () => ({
  COACH_CATEGORY_LABEL: { atendimento: "Atendimento", vendas: "Vendas" },
  COACH_TYPE_LABEL: { proibicao: "Proibição", instrucao: "Instrução" },
}));

// crypto.randomUUID em jsdom moderno já existe; garantimos fallback determinístico
// nos testes que precisam observar reciclagem do UUID.
let uuidCounter = 0;
// crypto.randomUUID vive no jsdom moderno; spy é restaurado em afterEach.

beforeEach(() => {
  uuidCounter = 0;
  vi.spyOn(crypto, "randomUUID").mockImplementation(() => {
    uuidCounter += 1;
    return `00000000-0000-4000-8000-${String(uuidCounter).padStart(12, "0")}` as `${string}-${string}-${string}-${string}-${string}`;
  });
  // Reset dos mocks e do estado global.
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
});

afterEach(() => {
  cleanup();
  {
    (crypto.randomUUID as unknown as { mockRestore?: () => void }).mockRestore?.();
  }
});

// ---------------------------------------------------------------------------
// Import da rota — depois dos mocks.
// ---------------------------------------------------------------------------
// eslint-disable-next-line @typescript-eslint/no-require-imports
const routeModule = await import("../configuracoes_.coach-interpreter");
const {
  InterpreterAdminPage,
  InterpreterShell,
  MessageComposer,
  ChatTimeline,
  ProposalCard,
  ErrorBanner,
} = routeModule.__test__ as unknown as {
  InterpreterAdminPage: React.FC;
  InterpreterShell: React.FC;
  MessageComposer: React.FC<{ conversationId: string; onSent: () => void }>;
  ChatTimeline: React.FC<{
    messages: MessageRow[];
    conversationId: string;
    onChanged: () => void;
  }>;
  ProposalCard: React.FC<{ proposal: ProposalRow; onChanged: () => void }>;
  ErrorBanner: React.FC<{
    title: string;
    error: import("@/lib/coach-interpreter/errors").SafeInterpreterError;
    onRetry?: () => void;
    testId?: string;
  }>;
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

type ProposalRow = {
  id: string;
  conversation_id: string;
  source_message_id: string;
  status: string;
  title: string;
  category: string;
  rule_type: string;
  scope_kind: string;
  scope_ref: unknown;
  priority: number;
  instruction: string;
  confidence: number;
  risk_level: string;
  warnings: unknown;
  normalized_output: unknown;
  created_at: string;
};

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

// Fábricas de dados mínimas.
function makeMessage(overrides: Partial<MessageRow> = {}): MessageRow {
  return {
    id: overrides.id ?? "msg-1",
    conversation_id: "conv-1",
    kind: "user_message",
    author_user_id: "user-1",
    content: "hello",
    payload: null,
    run: null,
    client_request_id: null,
    created_at: "2026-07-21T10:00:00Z",
    ...overrides,
  };
}
function makeProposal(overrides: Partial<ProposalRow> = {}): ProposalRow {
  return {
    id: overrides.id ?? "prop-1",
    conversation_id: "conv-1",
    source_message_id: "msg-1",
    status: "pending",
    title: "Regra de saudação",
    category: "atendimento",
    rule_type: "proibicao",
    scope_kind: "global",
    scope_ref: null,
    priority: 50,
    instruction: "Sempre saudar o cliente.",
    confidence: 0.9,
    risk_level: "normal",
    warnings: [],
    normalized_output: null,
    created_at: "2026-07-21T10:00:00Z",
    ...overrides,
  };
}

// Util: cria uma promessa deferrable para controlar o timing das mutations.
function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

// ===========================================================================
// 1. GUARD DE AUTENTICAÇÃO
// ===========================================================================
describe("Fase 3.1a · Guard de autenticação", () => {
  it("sessão carregando mostra loader e NÃO renderiza o shell (sem flash)", () => {
    authState.loading = true;
    authState.user = null;
    listFn.mockResolvedValue({ conversations: [] });
    renderWithClient(<InterpreterAdminPage />);
    expect(screen.getByTestId("interpreter-guard-loading")).toBeInTheDocument();
    // Shell só aparece com admin autorizado.
    expect(screen.queryByText(/Console Admin/i)).not.toBeInTheDocument();
    // Nenhuma server function deve ter sido invocada sob o guard.
    expect(listFn).not.toHaveBeenCalled();
  });

  it("sem sessão renderiza loader e não dispara chamadas", () => {
    authState.loading = false;
    authState.user = null;
    renderWithClient(<InterpreterAdminPage />);
    expect(screen.getByTestId("interpreter-guard-loading")).toBeInTheDocument();
    expect(screen.queryByText(/Console Admin/i)).not.toBeInTheDocument();
    expect(listFn).not.toHaveBeenCalled();
  });

  it("admin loading mostra loader (não flash de acesso restrito)", () => {
    adminState.isLoading = true;
    adminState.isAdmin = false;
    renderWithClient(<InterpreterAdminPage />);
    expect(screen.getByTestId("interpreter-guard-loading")).toBeInTheDocument();
    expect(screen.queryByText(/Acesso restrito/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Console Admin/i)).not.toBeInTheDocument();
  });

  it("usuário não-admin mostra tela de acesso restrito e não invoca listagem", () => {
    adminState.isAdmin = false;
    renderWithClient(<InterpreterAdminPage />);
    expect(screen.getByText(/Acesso restrito/i)).toBeInTheDocument();
    expect(screen.queryByText(/Console Admin/i)).not.toBeInTheDocument();
    expect(listFn).not.toHaveBeenCalled();
  });

  it("admin autorizado renderiza o shell", async () => {
    listFn.mockResolvedValue({ conversations: [] });
    renderWithClient(<InterpreterAdminPage />);
    expect(await screen.findByText(/Console Admin/i)).toBeInTheDocument();
    expect(screen.queryByTestId("interpreter-guard-loading")).not.toBeInTheDocument();
  });

  it("não há flash: shell só aparece após admin resolver", async () => {
    adminState.isLoading = true;
    adminState.isAdmin = false;
    const { rerender, qc } = renderWithClient(<InterpreterAdminPage />);
    expect(screen.queryByText(/Console Admin/i)).not.toBeInTheDocument();
    // Resolve admin.
    adminState.isLoading = false;
    adminState.isAdmin = true;
    listFn.mockResolvedValue({ conversations: [] });
    rerender(
      <QueryClientProvider client={qc}>
        <InterpreterAdminPage />
      </QueryClientProvider>,
    );
    expect(await screen.findByText(/Console Admin/i)).toBeInTheDocument();
  });
});

// ===========================================================================
// 2. CONTRATO DE ERRO
// ===========================================================================
describe("Fase 3.1a · Contrato de erro", () => {
  it("COACH_INTERPRETER_DISABLED renderiza a tela 'Recurso desabilitado'", async () => {
    listFn.mockRejectedValue(new Error("COACH_INTERPRETER_DISABLED"));
    renderWithClient(<InterpreterShell />);
    expect(await screen.findByText(/Recurso desabilitado/i)).toBeInTheDocument();
    expect(screen.getByText(/Feature flag desligada/i)).toBeInTheDocument();
  });

  it("COACH_INTERPRETER_KILLED renderiza kill-switch", async () => {
    listFn.mockRejectedValue(new Error("COACH_INTERPRETER_KILLED"));
    renderWithClient(<InterpreterShell />);
    expect(await screen.findByText(/Recurso desabilitado/i)).toBeInTheDocument();
    expect(screen.getByText(/Kill-switch ativo/i)).toBeInTheDocument();
  });

  it("erro genérico NÃO é confundido com feature flag", async () => {
    listFn.mockRejectedValue(new Error("Network fail"));
    renderWithClient(<InterpreterShell />);
    // Shell continua renderizado.
    expect(await screen.findByText(/Console Admin/i)).toBeInTheDocument();
    expect(screen.queryByText(/Recurso desabilitado/i)).not.toBeInTheDocument();
    // Banner de erro aparece na listagem.
    expect(await screen.findByTestId("conversations-error")).toBeInTheDocument();
  });

  it("mensagem interna, SQL e stack NÃO são exibidos ao usuário", async () => {
    const leaky = new Error(
      "SELECT * FROM coach_conversations WHERE id='...'; -- pg: relation not found\n    at pg.js:42",
    );
    listFn.mockRejectedValue(leaky);
    renderWithClient(<InterpreterShell />);
    const banner = await screen.findByTestId("conversations-error");
    expect(banner).toHaveTextContent(/Erro interno/i);
    expect(banner).not.toHaveTextContent(/SELECT/i);
    expect(banner).not.toHaveTextContent(/pg\.js/i);
    expect(banner).not.toHaveTextContent(/relation not found/i);
  });

  it("fallback textual 'Erro interno' só aparece quando não há código estruturado", async () => {
    listFn.mockRejectedValue(new Error("unauthorized"));
    renderWithClient(<InterpreterShell />);
    const banner = await screen.findByTestId("conversations-error");
    // Mensagem específica de código estruturado deve aparecer, não o fallback.
    expect(banner).toHaveTextContent(/Sessão inválida ou sem permissão/i);
    expect(banner).not.toHaveTextContent(/Erro interno/i);
  });
});

// ===========================================================================
// 3. LISTAGEM
// ===========================================================================
describe("Fase 3.1a · Listagem de conversas", () => {
  it("erro da listagem exibe ErrorBanner (não é confundido com empty state)", async () => {
    listFn.mockRejectedValue(new Error("internal"));
    renderWithClient(<InterpreterShell />);
    const banner = await screen.findByTestId("conversations-error");
    expect(banner).toBeInTheDocument();
    // Empty state textual não aparece junto.
    expect(screen.queryByText(/Nenhuma conversa encontrada/i)).not.toBeInTheDocument();
  });

  it("botão 'Tentar novamente' refaz a chamada", async () => {
    const user = userEvent.setup();
    listFn.mockRejectedValueOnce(new Error("internal"));
    listFn.mockResolvedValueOnce({ conversations: [] });
    renderWithClient(<InterpreterShell />);
    const banner = await screen.findByTestId("conversations-error");
    await user.click(within(banner).getByRole("button", { name: /Tentar novamente/i }));
    await waitFor(() => {
      expect(screen.queryByTestId("conversations-error")).not.toBeInTheDocument();
    });
    expect(listFn).toHaveBeenCalledTimes(2);
    expect(screen.getByText(/Nenhuma conversa encontrada/i)).toBeInTheDocument();
  });

  it("estado inicial mostra 'Carregando conversas…' enquanto a promessa pende", async () => {
    const gate = deferred<{ conversations: [] }>();
    listFn.mockReturnValueOnce(gate.promise);
    renderWithClient(<InterpreterShell />);
    expect(screen.getByText(/Carregando conversas…/i)).toBeInTheDocument();
    // ErrorBanner NÃO coexiste com loading.
    expect(screen.queryByTestId("conversations-error")).not.toBeInTheDocument();
    // Empty state NÃO coexiste com loading.
    expect(screen.queryByText(/Nenhuma conversa encontrada/i)).not.toBeInTheDocument();
    await act(async () => {
      gate.resolve({ conversations: [] });
    });
  });

  it("resolve com uma conversa renderiza o título na lista", async () => {
    listFn.mockResolvedValue({
      conversations: [
        {
          id: "conv-abc",
          title: "Minha conversa",
          status: "active",
          owner_user_id: "user-1",
          created_at: "2026-07-21T10:00:00Z",
          last_message_at: "2026-07-21T10:00:00Z",
        },
      ],
    });
    renderWithClient(<InterpreterShell />);
    expect(await screen.findByText(/Minha conversa/i)).toBeInTheDocument();
    expect(screen.queryByText(/Nenhuma conversa encontrada/i)).not.toBeInTheDocument();
    expect(screen.queryByTestId("conversations-error")).not.toBeInTheDocument();
  });
});

// ===========================================================================
// 4. COMPOSER + IDEMPOTÊNCIA
// ===========================================================================
describe("Fase 3.1a · Composer e idempotência", () => {
  it("client_request_id é criado uma única vez por tentativa (estável entre renders)", async () => {
    const { rerender, qc } = renderWithClient(
      <MessageComposer conversationId="conv-1" onSent={() => {}} />,
    );
    const ta1 = screen.getByTestId("composer-textarea") as HTMLTextAreaElement;
    const firstId = ta1.dataset.requestId;
    expect(firstId).toBeTruthy();
    // Re-render sem sucesso — UUID deve permanecer o mesmo.
    rerender(
      <QueryClientProvider client={qc}>
        <MessageComposer conversationId="conv-1" onSent={() => {}} />
      </QueryClientProvider>,
    );
    const ta2 = screen.getByTestId("composer-textarea") as HTMLTextAreaElement;
    expect(ta2.dataset.requestId).toBe(firstId);
  });

  it("reenvio após ERRO reutiliza o mesmo UUID (idempotência)", async () => {
    const user = userEvent.setup();
    sendFn.mockRejectedValue(new Error("internal"));
    renderWithClient(<MessageComposer conversationId="conv-1" onSent={() => {}} />);
    const ta = screen.getByTestId("composer-textarea") as HTMLTextAreaElement;
    const uuid = ta.dataset.requestId;
    await user.type(ta, "primeira");
    await user.click(screen.getByRole("button", { name: /Enviar/i }));
    await screen.findByTestId("composer-error");
    // Tenta novamente pelo banner (retry).
    await user.click(within(screen.getByTestId("composer-error")).getByRole("button", { name: /Tentar novamente/i }));
    await waitFor(() => expect(sendFn).toHaveBeenCalledTimes(2));
    for (const call of sendFn.mock.calls) {
      const arg = call[0] as { data: { client_request_id: string } };
      expect(arg.data.client_request_id).toBe(uuid);
    }
  });

  it("erro preserva o texto digitado", async () => {
    const user = userEvent.setup();
    sendFn.mockRejectedValue(new Error("internal"));
    renderWithClient(<MessageComposer conversationId="conv-1" onSent={() => {}} />);
    const ta = screen.getByTestId("composer-textarea") as HTMLTextAreaElement;
    await user.type(ta, "texto importante");
    await user.click(screen.getByRole("button", { name: /Enviar/i }));
    await screen.findByTestId("composer-error");
    expect(ta.value).toBe("texto importante");
  });

  it("sucesso limpa o texto e emite onSent", async () => {
    const user = userEvent.setup();
    const onSent = vi.fn();
    sendFn.mockResolvedValue({ status: "created" });
    renderWithClient(<MessageComposer conversationId="conv-1" onSent={onSent} />);
    const ta = screen.getByTestId("composer-textarea") as HTMLTextAreaElement;
    await user.type(ta, "oi");
    await user.click(screen.getByRole("button", { name: /Enviar/i }));
    await waitFor(() => expect(ta.value).toBe(""));
    expect(onSent).toHaveBeenCalledTimes(1);
  });

  it("nova mensagem após sucesso recebe NOVO UUID", async () => {
    const user = userEvent.setup();
    sendFn.mockResolvedValue({ status: "created" });
    renderWithClient(<MessageComposer conversationId="conv-1" onSent={() => {}} />);
    const ta = screen.getByTestId("composer-textarea") as HTMLTextAreaElement;
    const firstUuid = ta.dataset.requestId;
    await user.type(ta, "primeira");
    await user.click(screen.getByRole("button", { name: /Enviar/i }));
    await waitFor(() => expect(ta.value).toBe(""));
    // Após limpeza, novo UUID deve estar impresso no dataset.
    await waitFor(() => {
      expect((screen.getByTestId("composer-textarea") as HTMLTextAreaElement).dataset.requestId)
        .not.toBe(firstUuid);
    });
  });

  it("clique duplo não dispara dois envios (isPending desabilita)", async () => {
    const user = userEvent.setup();
    const gate = deferred<{ status: "created" }>();
    sendFn.mockReturnValueOnce(gate.promise);
    renderWithClient(<MessageComposer conversationId="conv-1" onSent={() => {}} />);
    const ta = screen.getByTestId("composer-textarea") as HTMLTextAreaElement;
    await user.type(ta, "oi");
    const btn = screen.getByRole("button", { name: /Enviar/i });
    await user.click(btn);
    // segundo clique enquanto pendente
    await user.click(btn);
    expect(sendFn).toHaveBeenCalledTimes(1);
    await act(async () => {
      gate.resolve({ status: "created" });
    });
  });

  it("erro do envio aparece no ErrorBanner com mensagem SEGURA (não bruta)", async () => {
    const user = userEvent.setup();
    sendFn.mockRejectedValue(new Error("pg: connection refused at internal.js:99"));
    renderWithClient(<MessageComposer conversationId="conv-1" onSent={() => {}} />);
    await user.type(screen.getByTestId("composer-textarea"), "oi");
    await user.click(screen.getByRole("button", { name: /Enviar/i }));
    const banner = await screen.findByTestId("composer-error");
    expect(banner).toHaveTextContent(/Erro interno/i);
    expect(banner).not.toHaveTextContent(/pg: connection refused/);
    expect(banner).not.toHaveTextContent(/internal\.js/);
  });
});

// ===========================================================================
// 5. RETRY
// ===========================================================================
describe("Fase 3.1a · Retry na timeline", () => {
  it("botão 'Reinterpretar' aparece apenas em mensagem do usuário", () => {
    const msgs: MessageRow[] = [
      makeMessage({ id: "u1", kind: "user_message", content: "user" }),
      makeMessage({ id: "a1", kind: "assistant_message", content: "assistant" }),
      makeMessage({ id: "e1", kind: "error", content: "boom" }),
    ];
    renderWithClient(
      <ChatTimeline messages={msgs} conversationId="conv-1" onChanged={() => {}} />,
    );
    const buttons = screen.getAllByRole("button", { name: /Reinterpretar/i });
    expect(buttons).toHaveLength(1);
  });

  it("erro do retry aparece com contrato seguro; novo clique redispara sem duplicar in-flight", async () => {
    const user = userEvent.setup();
    const onChanged = vi.fn();
    retryFn.mockRejectedValueOnce(new Error("internal"));
    retryFn.mockResolvedValueOnce({ ok: true });
    const msgs: MessageRow[] = [makeMessage({ id: "u1" })];
    renderWithClient(
      <ChatTimeline messages={msgs} conversationId="conv-1" onChanged={onChanged} />,
    );
    await user.click(screen.getByRole("button", { name: /Reinterpretar/i }));
    const errBanner = await screen.findByTestId("retry-error-u1");
    expect(errBanner).toHaveTextContent(/Erro interno/i);
    // Retry a partir do banner
    await user.click(within(errBanner).getByRole("button", { name: /Tentar novamente/i }));
    await waitFor(() => expect(retryFn).toHaveBeenCalledTimes(2));
    expect(onChanged).toHaveBeenCalled();
  });

  it("retries de mensagens diferentes mantêm estado independente (erro só afeta a origem)", async () => {
    const user = userEvent.setup();
    // Primeira mensagem falha; segunda tem sucesso.
    retryFn.mockImplementation((args: { data: { user_message_id: string } }) => {
      if (args.data.user_message_id === "u1") return Promise.reject(new Error("internal"));
      return Promise.resolve({ ok: true });
    });
    const msgs: MessageRow[] = [
      makeMessage({ id: "u1", content: "primeira" }),
      makeMessage({ id: "u2", content: "segunda" }),
    ];
    renderWithClient(
      <ChatTimeline messages={msgs} conversationId="conv-1" onChanged={() => {}} />,
    );
    const btns = screen.getAllByRole("button", { name: /Reinterpretar/i });
    await user.click(btns[0]);
    await screen.findByTestId("retry-error-u1");
    // Retry na segunda — não deve mostrar erro nela.
    await user.click(btns[1]);
    await waitFor(() => expect(retryFn).toHaveBeenCalledTimes(2));
    // Erro da u1 permanece; u2 nunca teve banner.
    expect(screen.queryByTestId("retry-error-u2")).not.toBeInTheDocument();
  });
});

// ===========================================================================
// 6. DIALOG DE CONFIRMAÇÃO
// ===========================================================================
describe("Fase 3.1a · Dialog de confirmação", () => {
  it("clicar em 'Confirmar' abre o AlertDialog e NÃO dispara a mutation ainda", async () => {
    const user = userEvent.setup();
    renderWithClient(<ProposalCard proposal={makeProposal()} onChanged={() => {}} />);
    await user.click(screen.getByTestId("confirm-proposal"));
    expect(await screen.findByTestId("confirm-dialog")).toBeInTheDocument();
    expect(confirmFn).not.toHaveBeenCalled();
  });

  it("proposal crítica exige checkbox: ação final permanece bloqueada", async () => {
    const user = userEvent.setup();
    renderWithClient(
      <ProposalCard
        proposal={makeProposal({ risk_level: "critical" })}
        onChanged={() => {}}
      />,
    );
    await user.click(screen.getByTestId("confirm-proposal"));
    await screen.findByTestId("confirm-dialog");
    const action = screen.getByTestId("confirm-dialog-action") as HTMLButtonElement;
    expect(action).toBeDisabled();
    // Marca o checkbox → habilita.
    await user.click(screen.getByTestId("critical-checkbox"));
    expect(action).not.toBeDisabled();
  });

  it("dialog permanece aberto em erro e mostra ErrorBanner; fecha só em sucesso", async () => {
    const user = userEvent.setup();
    confirmFn.mockRejectedValueOnce(new Error("internal"));
    confirmFn.mockResolvedValueOnce({ ok: true });
    renderWithClient(<ProposalCard proposal={makeProposal()} onChanged={() => {}} />);
    await user.click(screen.getByTestId("confirm-proposal"));
    await screen.findByTestId("confirm-dialog");
    // Primeiro clique: falha, dialog fica aberto com banner.
    await user.click(screen.getByTestId("confirm-dialog-action"));
    expect(await screen.findByTestId("confirm-error")).toBeInTheDocument();
    expect(screen.getByTestId("confirm-dialog")).toBeInTheDocument();
    // Segundo clique: sucesso → dialog fecha.
    await user.click(screen.getByTestId("confirm-dialog-action"));
    await waitFor(() => {
      expect(screen.queryByTestId("confirm-dialog")).not.toBeInTheDocument();
    });
    expect(confirmFn).toHaveBeenCalledTimes(2);
  });

  it("clique duplo na ação final não dispara duas mutations", async () => {
    const user = userEvent.setup();
    const gate = deferred<{ ok: true }>();
    confirmFn.mockReturnValueOnce(gate.promise);
    renderWithClient(<ProposalCard proposal={makeProposal()} onChanged={() => {}} />);
    await user.click(screen.getByTestId("confirm-proposal"));
    await screen.findByTestId("confirm-dialog");
    const action = screen.getByTestId("confirm-dialog-action") as HTMLButtonElement;
    await user.click(action);
    // clique adicional enquanto pending
    await user.click(action);
    expect(confirmFn).toHaveBeenCalledTimes(1);
    await act(async () => {
      gate.resolve({ ok: true });
    });
  });

  it("mutation não dispara sem o clique final (só ao abrir o dialog)", async () => {
    const user = userEvent.setup();
    renderWithClient(
      <ProposalCard
        proposal={makeProposal({ risk_level: "critical" })}
        onChanged={() => {}}
      />,
    );
    await user.click(screen.getByTestId("confirm-proposal"));
    await screen.findByTestId("confirm-dialog");
    // Nenhuma mutation ainda.
    expect(confirmFn).not.toHaveBeenCalled();
    // Cancelar → nada disparado.
    await user.click(screen.getByRole("button", { name: /Cancelar/i }));
    expect(confirmFn).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// 7. DIALOG DE DESCARTE
// ===========================================================================
describe("Fase 3.1a · Dialog de descarte", () => {
  it("clicar em 'Descartar' abre o AlertDialog e não descarta por clique único", async () => {
    const user = userEvent.setup();
    renderWithClient(<ProposalCard proposal={makeProposal()} onChanged={() => {}} />);
    await user.click(screen.getByTestId("discard-proposal"));
    expect(await screen.findByTestId("discard-dialog")).toBeInTheDocument();
    expect(discardFn).not.toHaveBeenCalled();
  });

  it("permanece aberto em erro; fecha após sucesso", async () => {
    const user = userEvent.setup();
    discardFn.mockRejectedValueOnce(new Error("internal"));
    discardFn.mockResolvedValueOnce({ ok: true });
    renderWithClient(<ProposalCard proposal={makeProposal()} onChanged={() => {}} />);
    await user.click(screen.getByTestId("discard-proposal"));
    await screen.findByTestId("discard-dialog");
    await user.click(screen.getByTestId("discard-dialog-action"));
    expect(await screen.findByTestId("discard-error")).toBeInTheDocument();
    expect(screen.getByTestId("discard-dialog")).toBeInTheDocument();
    await user.click(screen.getByTestId("discard-dialog-action"));
    await waitFor(() => {
      expect(screen.queryByTestId("discard-dialog")).not.toBeInTheDocument();
    });
    expect(discardFn).toHaveBeenCalledTimes(2);
  });

  it("clique duplo não dispara duas mutations", async () => {
    const user = userEvent.setup();
    const gate = deferred<{ ok: true }>();
    discardFn.mockReturnValueOnce(gate.promise);
    renderWithClient(<ProposalCard proposal={makeProposal()} onChanged={() => {}} />);
    await user.click(screen.getByTestId("discard-proposal"));
    await screen.findByTestId("discard-dialog");
    const action = screen.getByTestId("discard-dialog-action") as HTMLButtonElement;
    await user.click(action);
    await user.click(action);
    expect(discardFn).toHaveBeenCalledTimes(1);
    await act(async () => {
      gate.resolve({ ok: true });
    });
  });

  it("dialog informa que a proposal será marcada como descartada (histórico preservado)", async () => {
    const user = userEvent.setup();
    renderWithClient(<ProposalCard proposal={makeProposal()} onChanged={() => {}} />);
    await user.click(screen.getByTestId("discard-proposal"));
    const dialog = await screen.findByTestId("discard-dialog");
    expect(dialog).toHaveTextContent(/marcada como descartada/i);
  });
});

// ===========================================================================
// SANIDADE — ErrorBanner isolado
// ===========================================================================
describe("Fase 3.1a · ErrorBanner (sanidade)", () => {
  it("renderiza título, mensagem, code e botão retry opcional", async () => {
    const user = userEvent.setup();
    const onRetry = vi.fn();
    render(
      <ErrorBanner
        title="Boom"
        error={{
          code: "internal",
          message: "Erro interno ao contatar o Coach Interpreter.",
          disabled: false,
          killed: false,
          notFound: false,
          unauthorized: false,
        }}
        onRetry={onRetry}
        testId="er"
      />,
    );
    const banner = screen.getByTestId("er");
    expect(banner).toHaveTextContent(/Boom/);
    expect(banner).toHaveTextContent(/Erro interno/);
    expect(banner).toHaveTextContent(/code: internal/);
    await user.click(within(banner).getByRole("button", { name: /Tentar novamente/i }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

});
