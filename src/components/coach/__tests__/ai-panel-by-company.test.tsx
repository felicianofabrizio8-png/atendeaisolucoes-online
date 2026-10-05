// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";

// Configuração da empresa logada: é ela (por company_id) que decide o painel.
const { getSessionMock, db } = vi.hoisted(() => ({
  getSessionMock: vi.fn(),
  db: { settings: null as unknown, settingsError: null as unknown },
}));

vi.mock("@/integrations/supabase/client", () => {
  const builder = (table: string) => {
    const result = () =>
      table === "company_settings"
        ? { data: db.settings, error: db.settingsError }
        : { data: [], error: null };
    const chain: Record<string, unknown> = {};
    for (const method of ["select", "eq", "order", "limit", "update", "insert"]) chain[method] = () => chain;
    chain.maybeSingle = async () => result();
    chain.then = (ok: (value: unknown) => unknown, fail?: (error: unknown) => unknown) =>
      Promise.resolve(result()).then(ok, fail);
    return chain;
  };
  return { supabase: { auth: { getSession: getSessionMock }, from: builder } };
});
vi.mock("@/auth/AuthContext", () => ({
  useAuth: () => ({ profile: { company_id: "company-1" }, user: { id: "user-1" } }),
}));
vi.mock("@/hooks/useIsAdmin", () => ({ useIsAdmin: () => ({ isAdmin: false, isLoading: false }) }));
vi.mock("@/hooks/useTakeOver", () => ({
  useTakeOver: () => ({ takeOver: vi.fn(), takingOver: false, release: vi.fn(), releasing: false }),
}));
vi.mock("@tanstack/react-router", () => ({
  Link: ({ children }: { children?: ReactNode }) => <a>{children}</a>,
}));
vi.mock("@tanstack/react-start", () => ({ useServerFn: (fn: unknown) => fn }));
vi.mock("@/lib/coach-learnings/coach-learnings.functions", () => ({ submitSuggestionFeedbackFn: vi.fn() }));
vi.mock("@/components/coach/TeachModeDrawer", () => ({
  TeachModeDrawer: ({
    open,
    sourceSuggestion,
  }: {
    open: boolean;
    sourceSuggestion?: { suggestion_id: string | null; client_message: string | null; suggestion_text: string } | null;
  }) =>
    open ? (
      <div data-testid="teach-drawer">
        {String(sourceSuggestion?.suggestion_id)}|{sourceSuggestion?.client_message}|{sourceSuggestion?.suggestion_text}
      </div>
    ) : null,
}));

import { CoachPanel } from "@/components/coach/CoachPanel";

const COACH_SUGGEST = "/api/coach/suggest";

function response(body: unknown, ok = true, status = 200): Response {
  return { ok, status, json: async () => body } as Response;
}

const lead = (id: string, text: string) => ({ id, role: "lead" as const, text, at: new Date().toISOString() });

function stubFetch(pending: unknown = null) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.includes("/api/ai/v2-suggestion")) {
      return init?.method === "POST"
        ? response({ ok: true, status: "rejected", sendAllowed: false })
        : response({ suggestion: pending });
    }
    return response({});
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

const coachSuggestCalls = (fetchMock: ReturnType<typeof stubFetch>) =>
  fetchMock.mock.calls.filter(([input]) => String(input).includes(COACH_SUGGEST));

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

beforeEach(() => {
  db.settings = null;
  db.settingsError = null;
  getSessionMock.mockResolvedValue({ data: { session: { access_token: "access-token-1" } } });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("painel de IA conforme a configuração da empresa", () => {
  it(
    "empresa com a Vendedora 2.0: abrir o painel e chegar mensagem nova não chama /api/coach/suggest",
    async () => {
      db.settings = { sales_agent_v2_enabled: true, sales_agent_v2_mode: "assisted" };
      const fetchMock = stubFetch();
      const { rerender } = render(
        <CoachPanel conversationId="conversation-1" messages={[lead("m1", "Oi")]} />,
      );

      await screen.findByTestId("vendedora-panel");
      expect(screen.getByText("Vendedora IA")).toBeInTheDocument();
      expect(screen.queryByTestId("coach-panel-legacy")).toBeNull();
      expect(screen.queryByText("Coach IA")).toBeNull();
      expect(screen.queryByText(/Gerar (nova )?sugestão/)).toBeNull();
      expect(screen.queryByText("Console")).toBeNull();

      // Mensagem nova do cliente: no painel antigo isto dispara o Coach depois de 1,5 s.
      rerender(
        <CoachPanel
          conversationId="conversation-1"
          messages={[lead("m1", "Oi"), lead("m2", "Quais opções vocês têm?")]}
        />,
      );
      await wait(2500);

      expect(coachSuggestCalls(fetchMock)).toHaveLength(0);
      expect(screen.getByTestId("vendedora-panel")).toBeInTheDocument();
    },
    10_000,
  );

  it(
    "controle: empresa sem a Vendedora 2.0 continua com o Coach, que gera sugestão na mensagem nova",
    async () => {
      db.settings = { sales_agent_v2_enabled: false, sales_agent_v2_mode: null };
      const fetchMock = stubFetch();
      const { rerender } = render(
        <CoachPanel conversationId="conversation-1" messages={[lead("m1", "Oi")]} />,
      );

      await screen.findByTestId("coach-panel-legacy");
      expect(screen.getByText("Coach IA")).toBeInTheDocument();
      expect(screen.queryByTestId("vendedora-panel")).toBeNull();

      await wait(100);
      rerender(
        <CoachPanel
          conversationId="conversation-1"
          messages={[lead("m1", "Oi"), lead("m2", "Quais opções vocês têm?")]}
        />,
      );
      await waitFor(() => expect(coachSuggestCalls(fetchMock).length).toBeGreaterThan(0), { timeout: 6000 });
    },
    10_000,
  );

  it("empresa só avaliando a Vendedora (silent) continua com o painel do Coach", async () => {
    db.settings = { sales_agent_v2_enabled: true, sales_agent_v2_mode: "silent" };
    stubFetch();
    render(<CoachPanel conversationId="conversation-1" messages={[]} />);
    await screen.findByTestId("coach-panel-legacy");
    expect(screen.queryByTestId("vendedora-panel")).toBeNull();
  });

  it("sem conseguir ler a configuração, nenhum painel é montado e o Coach não é chamado", async () => {
    db.settingsError = { message: "falha" };
    const fetchMock = stubFetch();
    render(<CoachPanel conversationId="conversation-1" messages={[lead("m1", "Oi")]} />);
    await screen.findByText("Não foi possível carregar o painel de IA.");
    expect(screen.queryByTestId("coach-panel-legacy")).toBeNull();
    expect(screen.queryByTestId("vendedora-panel")).toBeNull();
    expect(coachSuggestCalls(fetchMock)).toHaveLength(0);
  });

  it("mostra o estado da conversa e oferece devolver para a IA quando está com humano", async () => {
    db.settings = { sales_agent_v2_enabled: true, sales_agent_v2_mode: "assisted" };
    stubFetch();
    const { rerender } = render(<CoachPanel conversationId="conversation-1" messages={[]} aiStatus={null} humanTakeoverAt={null} />);
    await screen.findByTestId("vendedora-panel");
    expect(screen.getByTestId("vendedora-panel-state")).toHaveTextContent("IA ativa nesta conversa.");
    expect(screen.queryByTestId("vendedora-panel-release")).toBeNull();

    rerender(<CoachPanel conversationId="conversation-1" messages={[]} aiStatus="aguardando_humano" humanTakeoverAt={null} />);
    expect(screen.getByTestId("vendedora-panel-state")).toHaveTextContent("A IA pediu atendimento humano nesta conversa.");
    expect(screen.getByTestId("vendedora-panel-release")).toHaveTextContent("Devolver para a IA");
  });

  it("rejeitar e ensinar abre o Ensinar IA com a mensagem do cliente e a resposta recusada", async () => {
    db.settings = { sales_agent_v2_enabled: true, sales_agent_v2_mode: "assisted" };
    stubFetch({
      id: "suggestion-1",
      conversation_id: "conversation-1",
      generated_text: "Parcelamos em até 3x.",
      created_at: "2026-09-22T01:00:00.000Z",
      basis: { products: ["Consulta de avaliação"], company: ["Formas de pagamento"] },
    });
    const user = userEvent.setup();
    render(<CoachPanel conversationId="conversation-1" messages={[lead("m1", "Como posso pagar?")]} />);

    const reject = await screen.findByTestId("v2-assisted-reject");
    expect(reject).toHaveTextContent("Rejeitar e ensinar");
    expect(screen.getByTestId("v2-assisted-basis")).toHaveTextContent(
      "Com base em: Consulta de avaliação · Formas de pagamento",
    );

    await user.click(reject);
    const drawer = await screen.findByTestId("teach-drawer");
    expect(drawer).toHaveTextContent("null|Como posso pagar?|Parcelamos em até 3x.");
  });
});
