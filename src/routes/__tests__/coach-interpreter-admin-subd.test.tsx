// ============================================================================
// FASE 3.1b · Sub-rodada (d) — Testes de Composer, Retry paralelo,
// Filtros avançados e Acessibilidade.
//
// Escopo estrito da sub-rodada; não sobrepõe outros arquivos.
// Mocks na fronteira: server functions, auth. Sem acesso a banco.
// ============================================================================
// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

// --- Mocks -----------------------------------------------------------------
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

const sendFn = vi.fn();
const retryFn = vi.fn();
const listFn = vi.fn();
const getFn = vi.fn();
const createFn = vi.fn();
const updateFn = vi.fn();
const discardFn = vi.fn();
const confirmFn = vi.fn();

vi.mock("@/lib/coach-interpreter/coach-interpreter.functions", () => ({
  listCoachConversationsFn: (...a: unknown[]) => listFn(...a),
  getCoachConversationFn: (...a: unknown[]) => getFn(...a),
  sendCoachMessageFn: (...a: unknown[]) => sendFn(...a),
  createCoachConversationFn: (...a: unknown[]) => createFn(...a),
  retryCoachInterpretationFn: (...a: unknown[]) => retryFn(...a),
  updateCoachProposalFn: (...a: unknown[]) => updateFn(...a),
  discardCoachProposalFn: (...a: unknown[]) => discardFn(...a),
  confirmCoachProposalFn: (...a: unknown[]) => confirmFn(...a),
}));

vi.mock("@/auth/AuthContext", () => ({ useAuth: () => ({ user: { id: "u1" }, loading: false }) }));
vi.mock("@/hooks/useIsAdmin", () => ({ useIsAdmin: () => ({ isAdmin: true, isLoading: false }) }));
vi.mock("@/lib/coach-rules/coach-rules.repository", () => ({
  COACH_CATEGORY_LABEL: { atendimento: "Atendimento", vendas: "Vendas" },
  COACH_TYPE_LABEL: { proibicao: "Proibição", instrucao: "Instrução" },
}));

beforeEach(() => {
  sendFn.mockReset();
  retryFn.mockReset();
  listFn.mockReset();
  getFn.mockReset();
  createFn.mockReset();
  updateFn.mockReset();
  discardFn.mockReset();
  confirmFn.mockReset();
});
afterEach(() => cleanup());

const mod = await import("@/lib/coach-interpreter/admin-console");
const { MessageComposer, ChatTimeline, ProposalFilterBar } = mod;

function renderWithClient(ui: ReactNode) {
  const qc = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0, staleTime: 0 },
      mutations: { retry: false },
    },
  });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

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
function makeMsg(over: Partial<MessageRow> = {}): MessageRow {
  return {
    id: over.id ?? "m",
    conversation_id: "c1",
    kind: over.kind ?? "user_message",
    author_user_id: null,
    content: over.content ?? "x",
    payload: null,
    run: null,
    client_request_id: null,
    created_at: "2026-07-21T10:00:00Z",
    ...over,
  };
}

// ===========================================================================
// COMPOSER — Ctrl/Cmd+Enter, contador, aria-live, duplicate notice
// ===========================================================================
describe("Sub-d · Composer", () => {
  it("Enter puro não envia (cria nova linha); Ctrl+Enter envia", async () => {
    const user = userEvent.setup();
    sendFn.mockResolvedValue({ status: "created" });
    renderWithClient(<MessageComposer conversationId="c1" onSent={() => {}} />);
    const ta = screen.getByTestId("composer-textarea") as HTMLTextAreaElement;
    await user.type(ta, "linha 1");
    await user.keyboard("{Enter}");
    expect(sendFn).not.toHaveBeenCalled();
    await user.keyboard("{Control>}{Enter}{/Control}");
    await waitFor(() => expect(sendFn).toHaveBeenCalledTimes(1));
  });

  it("Cmd+Enter envia (Mac)", async () => {
    const user = userEvent.setup();
    sendFn.mockResolvedValue({ status: "created" });
    renderWithClient(<MessageComposer conversationId="c1" onSent={() => {}} />);
    const ta = screen.getByTestId("composer-textarea") as HTMLTextAreaElement;
    await user.type(ta, "oi");
    await user.keyboard("{Meta>}{Enter}{/Meta}");
    await waitFor(() => expect(sendFn).toHaveBeenCalledTimes(1));
  });

  it("contador reflete tamanho do texto e é anunciado via aria-live", async () => {
    const user = userEvent.setup();
    renderWithClient(<MessageComposer conversationId="c1" onSent={() => {}} />);
    const counter = screen.getByTestId("composer-counter");
    expect(counter).toHaveTextContent("0/4000");
    expect(counter.getAttribute("aria-live")).toBe("polite");
    await user.type(screen.getByTestId("composer-textarea"), "abcde");
    expect(counter).toHaveTextContent("5/4000");
  });

  it("exibe aviso amigável para duplicate_in_progress", async () => {
    const user = userEvent.setup();
    sendFn.mockResolvedValue({ status: "duplicate_in_progress", idempotent: true });
    renderWithClient(<MessageComposer conversationId="c1" onSent={() => {}} />);
    await user.type(screen.getByTestId("composer-textarea"), "oi");
    await user.click(screen.getByRole("button", { name: /Enviar mensagem/i }));
    const notice = await screen.findByTestId("composer-duplicate-notice");
    expect(notice).toHaveAttribute("aria-live", "polite");
    expect(notice.textContent).toMatch(/já em processamento/i);
  });

  it("botão tem aria-label e formulário marca aria-busy durante envio", async () => {
    const user = userEvent.setup();
    let resolve!: (v: unknown) => void;
    sendFn.mockReturnValue(new Promise((r) => (resolve = r)));
    renderWithClient(<MessageComposer conversationId="c1" onSent={() => {}} />);
    const btn = screen.getByRole("button", { name: /Enviar mensagem/i });
    await user.type(screen.getByTestId("composer-textarea"), "hey");
    await user.click(btn);
    const form = btn.closest("form")!;
    expect(form).toHaveAttribute("aria-busy", "true");
    resolve({ status: "created" });
    await waitFor(() => expect(form).not.toHaveAttribute("aria-busy"));
  });
});

// ===========================================================================
// RETRY — paralelismo por mensagem, aria-busy no botão
// ===========================================================================
describe("Sub-d · Retry paralelo", () => {
  it("botão marca aria-busy apenas na mensagem em progresso", async () => {
    const user = userEvent.setup();
    let resolve1!: (v: unknown) => void;
    retryFn.mockImplementation(({ data }: { data: { user_message_id: string } }) => {
      if (data.user_message_id === "u1") return new Promise((r) => (resolve1 = r));
      return Promise.resolve({ ok: true });
    });
    const msgs = [makeMsg({ id: "u1" }), makeMsg({ id: "u2" })];
    renderWithClient(<ChatTimeline messages={msgs} conversationId="c1" onChanged={() => {}} />);
    const btns = screen.getAllByRole("button", { name: /Reinterpretar mensagem/i });
    await user.click(btns[0]);
    // u1 em progresso; u2 livre
    expect(btns[0]).toHaveAttribute("aria-busy", "true");
    expect(btns[1]).not.toHaveAttribute("aria-busy");
    // u2 pode ser clicado em paralelo
    await user.click(btns[1]);
    await waitFor(() => expect(retryFn).toHaveBeenCalledTimes(2));
    resolve1({ ok: true });
  });

  it("erro em u1 NÃO gera banner em u2 (estado isolado)", async () => {
    const user = userEvent.setup();
    retryFn.mockImplementation(({ data }: { data: { user_message_id: string } }) => {
      if (data.user_message_id === "u1") return Promise.reject(new Error("internal"));
      return Promise.resolve({ ok: true });
    });
    const msgs = [makeMsg({ id: "u1" }), makeMsg({ id: "u2" })];
    renderWithClient(<ChatTimeline messages={msgs} conversationId="c1" onChanged={() => {}} />);
    const btns = screen.getAllByRole("button", { name: /Reinterpretar mensagem/i });
    await user.click(btns[0]);
    await screen.findByTestId("retry-error-u1");
    await user.click(btns[1]);
    await waitFor(() => expect(retryFn).toHaveBeenCalledTimes(2));
    expect(screen.getByTestId("retry-error-u1")).toBeInTheDocument();
    expect(screen.queryByTestId("retry-error-u2")).not.toBeInTheDocument();
  });
});

// ===========================================================================
// FILTROS — validação de intervalo + contador filtrado
// ===========================================================================
describe("Sub-d · Filtros de proposals", () => {
  it("exibe erro quando dateFrom > dateTo", async () => {
    const user = userEvent.setup();
    const filters = {
      category: "",
      ruleType: "",
      status: "",
      minConfidence: 0,
      ownerUser: "",
      dateFrom: "2026-07-20",
      dateTo: "2026-07-10",
    };
    renderWithClient(
      <ProposalFilterBar filters={filters} onChange={() => {}} proposals={[]} filteredCount={0} />,
    );
    const alert = await screen.findByTestId("proposals-date-range-error");
    expect(alert).toHaveTextContent(/Intervalo inválido/i);
    // Inputs marcados como inválidos.
    void user; // sem interações necessárias
  });

  it("contador mostra 'N de Total' quando filtrado", () => {
    const filters = {
      category: "",
      ruleType: "",
      status: "",
      minConfidence: 0,
      ownerUser: "",
      dateFrom: "",
      dateTo: "",
    };
    const proposals = Array.from({ length: 5 }, (_, i) => ({
      id: String(i),
      status: "pending",
      category: "atendimento",
      rule_type: "instrucao",
      confidence: 0.9,
      created_at: "2026-07-21T10:00:00Z",
      source_message_id: null,
    })) as never;
    renderWithClient(
      <ProposalFilterBar
        filters={filters}
        onChange={() => {}}
        proposals={proposals}
        filteredCount={2}
      />,
    );
    expect(screen.getByTestId("proposals-header")).toHaveTextContent("Proposals (2 de 5)");
  });

  it("contador é apenas total quando não há filtro ativo", () => {
    const filters = {
      category: "",
      ruleType: "",
      status: "",
      minConfidence: 0,
      ownerUser: "",
      dateFrom: "",
      dateTo: "",
    };
    renderWithClient(
      <ProposalFilterBar
        filters={filters}
        onChange={() => {}}
        proposals={[]}
        filteredCount={0}
      />,
    );
    expect(screen.getByTestId("proposals-header")).toHaveTextContent("Proposals (0)");
  });
});
