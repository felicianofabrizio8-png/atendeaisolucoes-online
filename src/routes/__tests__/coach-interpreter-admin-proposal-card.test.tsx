// ============================================================================
// FASE 3.1b — Sub-rodada (b): ProposalCard completo + edição.
//
// Escopo estrito:
//  - Renderização de todas as seções somente-leitura recolhíveis, sem blocos
//    vazios quando o normalized_output não trouxer o campo.
//  - Aviso claro de duplicidade e indicação textual + acessível de risco
//    crítico (não apenas cor).
//  - Formulário de edição restrito aos campos aceitos pelo contrato
//    updateCoachProposalFn: title / instruction / priority / scope_kind /
//    scope_ref.channel. NENHUM outro campo do normalized_output pode ser
//    editável pela UI.
//  - Validação client-side (trim, limites, enum) mantém o editor aberto em
//    erro, restaura em cancelamento e fecha em sucesso.
//  - Bloqueio de submit duplicado durante mutation pendente.
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
// MOCKS — fronteira da UI. Nenhuma chamada real ao backend.
// ---------------------------------------------------------------------------

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (_opts: unknown) => ({ options: _opts }),
  Link: (props: { to?: string; children?: ReactNode }) => (
    <a href={props.to ?? "#"}>{props.children}</a>
  ),
  useNavigate: () => vi.fn(),
}));
vi.mock("@tanstack/react-start", () => ({
  useServerFn: <T,>(fn: T) => fn,
}));

const updateFn = vi.fn();
const discardFn = vi.fn();
const confirmFn = vi.fn();
vi.mock("@/lib/coach-interpreter/coach-interpreter.functions", () => ({
  listCoachConversationsFn: vi.fn(),
  getCoachConversationFn: vi.fn(),
  sendCoachMessageFn: vi.fn(),
  createCoachConversationFn: vi.fn(),
  retryCoachInterpretationFn: vi.fn(),
  updateCoachProposalFn: (...args: unknown[]) => updateFn(...args),
  discardCoachProposalFn: (...args: unknown[]) => discardFn(...args),
  confirmCoachProposalFn: (...args: unknown[]) => confirmFn(...args),
}));

vi.mock("@/auth/AuthContext", () => ({ useAuth: () => ({ user: { id: "u1" }, loading: false }) }));
vi.mock("@/hooks/useIsAdmin", () => ({ useIsAdmin: () => ({ isAdmin: true, isLoading: false }) }));
vi.mock("@/lib/coach-rules/coach-rules.repository", () => ({
  COACH_CATEGORY_LABEL: { atendimento: "Atendimento" },
  COACH_TYPE_LABEL: { proibicao: "Proibição" },
}));

beforeEach(() => {
  updateFn.mockReset();
  discardFn.mockReset();
  confirmFn.mockReset();
});
afterEach(() => cleanup());

const { ProposalCard } = await import("@/lib/coach-interpreter/admin-console");

type NormalizedShape = {
  condition?: string;
  examples?: string[];
  rationale?: string;
  ambiguities?: string[];
  missing_information?: string[];
  duplicate_warning?: { rule_id?: string; title?: string; reason?: string } | null;
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

function makeProposal(overrides: Partial<ProposalRow> = {}): ProposalRow {
  return {
    id: "prop-1",
    conversation_id: "conv-1",
    source_message_id: "msg-1",
    status: "pending",
    title: "Não prometer prazos fixos",
    category: "atendimento",
    rule_type: "proibicao",
    scope_kind: "company",
    scope_ref: {},
    priority: 50,
    instruction: "Nunca prometer prazo exato de entrega sem consultar produção.",
    confidence: 0.82,
    risk_level: "medium",
    warnings: [],
    normalized_output: {},
    created_at: "2026-07-21T10:00:00Z",
    ...overrides,
  };
}

function renderWithClient(ui: ReactNode) {
  const qc = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0, staleTime: 0 },
      mutations: { retry: false },
    },
  });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
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

// ===========================================================================
// 1. Seções recolhíveis — nenhum bloco vazio.
// ===========================================================================
describe("Fase 3.1b · Seções recolhíveis (leitura)", () => {
  it("normalized_output vazio: NÃO renderiza nenhuma seção de detalhes", () => {
    renderWithClient(<ProposalCard proposal={makeProposal()} onChanged={() => {}} />);
    expect(screen.queryByTestId("section-condition")).not.toBeInTheDocument();
    expect(screen.queryByTestId("section-rationale")).not.toBeInTheDocument();
    expect(screen.queryByTestId("section-examples")).not.toBeInTheDocument();
    expect(screen.queryByTestId("section-ambiguities")).not.toBeInTheDocument();
    expect(screen.queryByTestId("section-missing-information")).not.toBeInTheDocument();
    expect(screen.queryByTestId("duplicate-warning")).not.toBeInTheDocument();
    expect(screen.queryByTestId("section-warnings")).not.toBeInTheDocument();
  });

  it("renderiza rationale, condition, examples, ambiguities e missing_information quando presentes", () => {
    const normalized: NormalizedShape = {
      condition: "Quando o cliente pedir prazo exato",
      rationale: "Alinhamento com o time de produção",
      examples: ["Ex 1", "Ex 2"],
      ambiguities: ["Ambíguo 1"],
      missing_information: ["Faltou 1"],
    };
    renderWithClient(
      <ProposalCard
        proposal={makeProposal({ normalized_output: normalized })}
        onChanged={() => {}}
      />,
    );
    expect(screen.getByTestId("section-condition")).toHaveTextContent(/Quando o cliente/);
    expect(screen.getByTestId("section-rationale")).toHaveTextContent(/Alinhamento/);
    expect(screen.getByTestId("section-examples")).toHaveTextContent(/Ex 1/);
    expect(screen.getByTestId("section-ambiguities")).toHaveTextContent(/Ambíguo 1/);
    expect(screen.getByTestId("section-missing-information")).toHaveTextContent(/Faltou 1/);
  });

  it("arrays vazios/strings vazias NÃO criam seção", () => {
    const normalized: NormalizedShape = {
      condition: "   ",
      rationale: "",
      examples: [],
      ambiguities: [""],
      missing_information: [],
    };
    renderWithClient(
      <ProposalCard
        proposal={makeProposal({ normalized_output: normalized })}
        onChanged={() => {}}
      />,
    );
    expect(screen.queryByTestId("section-condition")).not.toBeInTheDocument();
    expect(screen.queryByTestId("section-rationale")).not.toBeInTheDocument();
    expect(screen.queryByTestId("section-examples")).not.toBeInTheDocument();
    expect(screen.queryByTestId("section-ambiguities")).not.toBeInTheDocument();
    expect(screen.queryByTestId("section-missing-information")).not.toBeInTheDocument();
  });

  it("warnings do topo e duplicate_warning renderizam com semântica de aviso", () => {
    renderWithClient(
      <ProposalCard
        proposal={makeProposal({
          warnings: ["confidence baixa"],
          normalized_output: {
            duplicate_warning: {
              rule_id: "r-1",
              title: "Regra existente sobre prazos",
              reason: "Título quase idêntico",
            },
          },
        })}
        onChanged={() => {}}
      />,
    );
    expect(screen.getByTestId("section-warnings")).toHaveTextContent(/confidence baixa/);
    const dup = screen.getByTestId("duplicate-warning");
    expect(dup).toHaveAttribute("role", "note");
    expect(dup).toHaveTextContent(/Regra existente sobre prazos/);
    expect(dup).toHaveTextContent(/quase idêntico/i);
  });

  it("duplicate_warning objeto vazio NÃO renderiza aviso", () => {
    renderWithClient(
      <ProposalCard
        proposal={makeProposal({ normalized_output: { duplicate_warning: {} } })}
        onChanged={() => {}}
      />,
    );
    expect(screen.queryByTestId("duplicate-warning")).not.toBeInTheDocument();
  });
});

// ===========================================================================
// 2. Risco — indicação textual + acessível.
// ===========================================================================
describe("Fase 3.1b · Risco (indicação textual e acessível)", () => {
  it.each([
    ["low", "Baixo"],
    ["medium", "Médio"],
    ["high", "Alto"],
    ["critical", "Crítico"],
  ])("risco %s exibe rótulo textual '%s' e aria-label acessível", (level, label) => {
    renderWithClient(
      <ProposalCard proposal={makeProposal({ risk_level: level })} onChanged={() => {}} />,
    );
    const badge = screen.getByTestId("risk-badge");
    expect(badge).toHaveAttribute("data-risk", level);
    expect(badge).toHaveTextContent(new RegExp(label, "i"));
    expect(badge).toHaveAttribute("aria-label", `Risco ${label}`);
  });

  it("risco crítico mostra também o aviso textual dedicado (não somente cor)", () => {
    renderWithClient(
      <ProposalCard
        proposal={makeProposal({ risk_level: "critical" })}
        onChanged={() => {}}
      />,
    );
    const notice = screen.getByTestId("critical-notice");
    expect(notice).toHaveAttribute("role", "note");
    expect(notice).toHaveTextContent(/crítica/i);
  });
});

// ===========================================================================
// 3. Edição — apenas campos aceitos pelo contrato.
// ===========================================================================
describe("Fase 3.1b · Edição (contrato updateCoachProposalFn)", () => {
  it("exibe somente inputs para title, instruction, priority, scope_kind e scope_ref.channel", async () => {
    const user = userEvent.setup();
    renderWithClient(<ProposalCard proposal={makeProposal()} onChanged={() => {}} />);
    await user.click(screen.getByTestId("edit-proposal"));
    const form = screen.getByTestId("proposal-edit-form");
    expect(within(form).getByTestId("edit-title")).toBeInTheDocument();
    expect(within(form).getByTestId("edit-instruction")).toBeInTheDocument();
    expect(within(form).getByTestId("edit-priority")).toBeInTheDocument();
    expect(within(form).getByTestId("edit-scope-kind")).toBeInTheDocument();
    expect(within(form).getByTestId("edit-scope-channel")).toBeInTheDocument();
    // Nenhum input para campos fora do contrato.
    expect(within(form).queryByLabelText(/rationale/i)).not.toBeInTheDocument();
    expect(within(form).queryByLabelText(/exemplos/i)).not.toBeInTheDocument();
    expect(within(form).queryByLabelText(/ambigu/i)).not.toBeInTheDocument();
    expect(within(form).queryByLabelText(/categoria/i)).not.toBeInTheDocument();
    expect(within(form).queryByLabelText(/tipo/i)).not.toBeInTheDocument();
  });

  it("select de canal fica desabilitado quando scope_kind = company", async () => {
    const user = userEvent.setup();
    renderWithClient(<ProposalCard proposal={makeProposal()} onChanged={() => {}} />);
    await user.click(screen.getByTestId("edit-proposal"));
    const channelSel = screen.getByTestId("edit-scope-channel") as HTMLSelectElement;
    expect(channelSel).toBeDisabled();
    await user.selectOptions(screen.getByTestId("edit-scope-kind"), "channel");
    expect(channelSel).not.toBeDisabled();
  });

  it("valida trim: título com espaços apenas rejeita antes de chamar o backend", async () => {
    const user = userEvent.setup();
    renderWithClient(<ProposalCard proposal={makeProposal()} onChanged={() => {}} />);
    await user.click(screen.getByTestId("edit-proposal"));
    const titleInput = screen.getByTestId("edit-title") as HTMLInputElement;
    await user.clear(titleInput);
    await user.type(titleInput, "   ");
    await user.click(screen.getByTestId("save-edit"));
    expect(await screen.findByTestId("error-title")).toBeInTheDocument();
    expect(updateFn).not.toHaveBeenCalled();
    // Editor permanece aberto.
    expect(screen.getByTestId("proposal-edit-form")).toBeInTheDocument();
  });

  it("valida limites: instrução curta gera erro sem chamar backend", async () => {
    const user = userEvent.setup();
    renderWithClient(<ProposalCard proposal={makeProposal()} onChanged={() => {}} />);
    await user.click(screen.getByTestId("edit-proposal"));
    await user.clear(screen.getByTestId("edit-instruction"));
    await user.type(screen.getByTestId("edit-instruction"), "oi");
    await user.click(screen.getByTestId("save-edit"));
    expect(await screen.findByTestId("error-instruction")).toBeInTheDocument();
    expect(updateFn).not.toHaveBeenCalled();
  });

  it("scope_kind=channel sem canal escolhido bloqueia submit", async () => {
    const user = userEvent.setup();
    renderWithClient(<ProposalCard proposal={makeProposal()} onChanged={() => {}} />);
    await user.click(screen.getByTestId("edit-proposal"));
    await user.selectOptions(screen.getByTestId("edit-scope-kind"), "channel");
    await user.click(screen.getByTestId("save-edit"));
    expect(await screen.findByTestId("error-scope")).toBeInTheDocument();
    expect(updateFn).not.toHaveBeenCalled();
  });

  it("submit válido: envia apenas os campos alterados, no formato do contrato", async () => {
    const user = userEvent.setup();
    updateFn.mockResolvedValue({ ok: true });
    const onChanged = vi.fn();
    renderWithClient(<ProposalCard proposal={makeProposal()} onChanged={onChanged} />);
    await user.click(screen.getByTestId("edit-proposal"));
    await user.selectOptions(screen.getByTestId("edit-scope-kind"), "channel");
    await user.selectOptions(screen.getByTestId("edit-scope-channel"), "whatsapp");
    await user.click(screen.getByTestId("save-edit"));
    await waitFor(() => expect(updateFn).toHaveBeenCalledTimes(1));
    const payload = updateFn.mock.calls[0][0] as {
      data: {
        proposal_id: string;
        scope_kind?: string;
        scope_ref?: { channel?: string };
        title?: string;
      };
    };
    expect(payload.data.proposal_id).toBe("prop-1");
    expect(payload.data.scope_kind).toBe("channel");
    expect(payload.data.scope_ref).toEqual({ channel: "whatsapp" });
    // Campos não alterados NÃO viajam.
    expect(payload.data.title).toBeUndefined();
    // Editor fecha em sucesso.
    await waitFor(() =>
      expect(screen.queryByTestId("proposal-edit-form")).not.toBeInTheDocument(),
    );
    expect(onChanged).toHaveBeenCalled();
  });

  it("cancelamento restaura valores originais (title, instruction, priority, scope)", async () => {
    const user = userEvent.setup();
    renderWithClient(
      <ProposalCard
        proposal={makeProposal({
          scope_kind: "channel",
          scope_ref: { channel: "instagram" },
          priority: 30,
        })}
        onChanged={() => {}}
      />,
    );
    await user.click(screen.getByTestId("edit-proposal"));
    const titleInput = screen.getByTestId("edit-title") as HTMLInputElement;
    await user.clear(titleInput);
    await user.type(titleInput, "outro título temporário");
    await user.selectOptions(screen.getByTestId("edit-scope-kind"), "company");
    await user.click(screen.getByTestId("cancel-edit"));
    // Reabre — deve voltar aos originais.
    await user.click(screen.getByTestId("edit-proposal"));
    expect((screen.getByTestId("edit-title") as HTMLInputElement).value).toBe(
      "Não prometer prazos fixos",
    );
    expect((screen.getByTestId("edit-scope-kind") as HTMLSelectElement).value).toBe("channel");
    expect((screen.getByTestId("edit-scope-channel") as HTMLSelectElement).value).toBe(
      "instagram",
    );
    expect((screen.getByTestId("edit-priority") as HTMLInputElement).value).toBe("30");
  });

  it("erro do backend mantém o editor aberto com banner", async () => {
    const user = userEvent.setup();
    updateFn.mockRejectedValueOnce(new Error("internal"));
    renderWithClient(<ProposalCard proposal={makeProposal()} onChanged={() => {}} />);
    await user.click(screen.getByTestId("edit-proposal"));
    const titleInput = screen.getByTestId("edit-title") as HTMLInputElement;
    await user.clear(titleInput);
    await user.type(titleInput, "novo título aceitável");
    await user.click(screen.getByTestId("save-edit"));
    expect(await screen.findByTestId("update-error")).toBeInTheDocument();
    expect(screen.getByTestId("proposal-edit-form")).toBeInTheDocument();
  });

  it("clique duplo em Salvar não dispara duas mutations", async () => {
    const user = userEvent.setup();
    const gate = deferred<{ ok: true }>();
    updateFn.mockReturnValueOnce(gate.promise);
    renderWithClient(<ProposalCard proposal={makeProposal()} onChanged={() => {}} />);
    await user.click(screen.getByTestId("edit-proposal"));
    const titleInput = screen.getByTestId("edit-title") as HTMLInputElement;
    await user.clear(titleInput);
    await user.type(titleInput, "novo título válido");
    const save = screen.getByTestId("save-edit") as HTMLButtonElement;
    await user.click(save);
    await user.click(save);
    expect(updateFn).toHaveBeenCalledTimes(1);
    await act(async () => {
      gate.resolve({ ok: true });
    });
  });
});

// ===========================================================================
// 4. Escopo — sumário do cabeçalho.
// ===========================================================================
describe("Fase 3.1b · Sumário de escopo no cabeçalho", () => {
  it("scope_kind=company: mostra só 'Escopo company'", () => {
    renderWithClient(<ProposalCard proposal={makeProposal()} onChanged={() => {}} />);
    expect(screen.getByTestId("scope-summary")).toHaveTextContent(/^Escopo company$/);
  });
  it("scope_kind=channel: inclui o nome do canal", () => {
    renderWithClient(
      <ProposalCard
        proposal={makeProposal({
          scope_kind: "channel",
          scope_ref: { channel: "facebook" },
        })}
        onChanged={() => {}}
      />,
    );
    expect(screen.getByTestId("scope-summary")).toHaveTextContent(/Escopo channel.*facebook/);
  });
});
