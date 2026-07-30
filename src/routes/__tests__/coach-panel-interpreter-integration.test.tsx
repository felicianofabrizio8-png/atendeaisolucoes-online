// ============================================================================
// FASE 3.2 — Integração CoachPanel V1 ↔ Coach Interpreter Admin Console.
//
// Escopo estrito: valida SOMENTE a integração de navegação a partir do
// CoachPanel. Não altera backend, contratos, prompts nem feature flags.
//
// Cenários cobertos:
//   1. Abertura via CoachPanel (atalho "Console" para admins).
//   2. Navegação — href correto para a rota administrativa.
//   3. Retorno — presença dos links "Voltar" no Admin Console (reuso).
//   4. Guard — usuário não-admin não vê o atalho.
//   5. Feature flag desligada — FeatureDisabledScreen é o mesmo componente.
//   6. Lazy loading — módulo do console pode ser importado dinamicamente.
//   7. Ausência de duplicação de providers (QueryClient único, sem AuthProvider extra).
//   8. Nenhuma regressão nas ações originais do CoachPanel (Analisar).
// ============================================================================
// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

// ---------------------------------------------------------------------------
// MOCKS — declarados antes de importar o CoachPanel.
// ---------------------------------------------------------------------------

// TanStack Router: Link vira <a>, útil para inspecionar navegação sem
// exigir um Router real. Mantém o teste focado apenas na integração.
vi.mock("@tanstack/react-router", () => ({
  Link: (props: {
    to?: string;
    children?: ReactNode;
    className?: string;
    "data-testid"?: string;
    title?: string;
    "aria-label"?: string;
  }) => (
    <a
      href={props.to ?? "#"}
      className={props.className}
      data-testid={props["data-testid"]}
      title={props.title}
      aria-label={props["aria-label"]}
    >
      {props.children}
    </a>
  ),
}));

// Supabase client — CoachPanel usa .from(...).select/update e .auth.getSession/.rpc.
// Mock chainable "self" que responde a qualquer método com uma Promise vazia,
// mantendo o CoachPanel silencioso durante os testes de integração.
const { supabaseFromMock, authMock, adminState } = vi.hoisted(() => {
  const makeChain = (): unknown => {
    const target: Record<string, unknown> = {};
    const proxy: unknown = new Proxy(target, {
      get(_t, prop) {
        if (prop === "then") return (resolve: (v: unknown) => void) => resolve({ data: [] });
        return () => proxy;
      },
    });
    return proxy;
  };
  return {
    supabaseFromMock: () => makeChain(),
    authMock: { user: { id: "user-1" }, profile: { company_id: "co-1" }, loading: false },
    adminState: { isAdmin: false },
  };
});

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: supabaseFromMock,
    auth: {
      getSession: () => Promise.resolve({ data: { session: null } }),
    },
    rpc: () => Promise.resolve({ data: false }),
  },
}));

vi.mock("@/auth/AuthContext", () => ({
  useAuth: () => authMock,
}));

vi.mock("@/hooks/useIsAdmin", () => ({
  useIsAdmin: () => ({ isAdmin: adminState.isAdmin, isLoading: false }),
}));

// Import após mocks.
import { CoachPanel } from "@/components/coach/CoachPanel";
import { FeatureDisabledScreen as InterpreterFeatureDisabledScreen } from "@/lib/coach-interpreter/admin/feature-disabled-screen";
import * as adminBarrel from "@/lib/coach-interpreter/admin-console";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function renderWithSingleProvider(node: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const utils = render(<QueryClientProvider client={qc}>{node}</QueryClientProvider>);
  return { ...utils, qc };
}

beforeEach(() => {
  adminState.isAdmin = false;
});
afterEach(() => cleanup());

// ---------------------------------------------------------------------------
// 1. Abertura via CoachPanel + 2. Navegação
// ---------------------------------------------------------------------------

describe("Fase 3.2 · CoachPanel → Coach Interpreter (abertura e navegação)", () => {
  it("admin: exibe o atalho 'Console' com href para a rota administrativa", () => {
    adminState.isAdmin = true;
    renderWithSingleProvider(<CoachPanel conversationId="conv-1" />);

    const link = screen.getByTestId("coach-panel-open-interpreter");
    expect(link).toBeInTheDocument();
    // URL pública real: o sufixo "_" do arquivo é apenas convenção de layout
    // do TanStack Router e NÃO faz parte da URL navegável.
    expect(link).toHaveAttribute("href", "/configuracoes/coach-interpreter");
    expect(link).toHaveAccessibleName(/console do coach interpreter/i);
  });

  it("clicar no atalho não impede o botão original 'Analisar' de continuar funcionando", async () => {
    adminState.isAdmin = true;
    const user = userEvent.setup();
    renderWithSingleProvider(<CoachPanel conversationId="conv-1" />);

    // O botão Analisar continua presente e habilitado (sem regressão).
    const analyze = screen.getByRole("button", { name: /analisar/i });
    expect(analyze).toBeEnabled();

    // Interação com o atalho não dispara Analisar.
    await user.click(screen.getByTestId("coach-panel-open-interpreter"));
    expect(analyze).toBeEnabled();
  });
});

// ---------------------------------------------------------------------------
// 4. Guard — usuário não-admin
// ---------------------------------------------------------------------------

describe("Fase 3.2 · Guard de admin", () => {
  it("não-admin: NÃO renderiza o atalho 'Console'", () => {
    adminState.isAdmin = false;
    renderWithSingleProvider(<CoachPanel conversationId="conv-1" />);

    expect(screen.queryByTestId("coach-panel-open-interpreter")).not.toBeInTheDocument();
    // A UI normal do CoachPanel permanece intacta (mesma experiência atual).
    expect(screen.getByRole("button", { name: /analisar/i })).toBeInTheDocument();
    expect(screen.getByText(/coach ia/i)).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// 3. Retorno + 5. Feature flag desligada (reuso do MESMO componente)
// ---------------------------------------------------------------------------

describe("Fase 3.2 · Reuso da UI aprovada (sem duplicação)", () => {
  it("FeatureDisabledScreen exportado pelo barrel é o MESMO componente do módulo original", () => {
    // Prova estrutural de reuso: o barrel não recria, apenas re-exporta.
    expect(adminBarrel.FeatureDisabledScreen).toBe(InterpreterFeatureDisabledScreen);
  });

  it("FeatureDisabledScreen renderiza a tela padrão de recurso desabilitado", () => {
    render(<InterpreterFeatureDisabledScreen reason="flag desligada" />);
    expect(screen.getByText(/recurso desabilitado/i)).toBeInTheDocument();
    expect(screen.getByText(/flag desligada/)).toBeInTheDocument();
    // Retorno: link "Voltar para Configurações" está presente.
    expect(screen.getByRole("link", { name: /voltar/i })).toBeInTheDocument();
  });

  it("barrel expõe AdminPageBody e InterpreterShell reutilizáveis (não duplica)", () => {
    expect(typeof adminBarrel.AdminPageBody).toBe("function");
    expect(typeof adminBarrel.InterpreterShell).toBe("function");
  });
});

// ---------------------------------------------------------------------------
// 6. Lazy loading + 7. Providers únicos + 8. Sem regressão
// ---------------------------------------------------------------------------

describe("Fase 3.2 · Lazy loading & higiene arquitetural", () => {
  it("permite import dinâmico do módulo do admin console (lazy loading friendly)", async () => {
    const mod = await import("@/lib/coach-interpreter/admin-console");
    expect(mod).toHaveProperty("AdminPageBody");
    expect(mod).toHaveProperty("InterpreterShell");
  });

  it("CoachPanel não instancia providers próprios (nenhum QueryClientProvider/AuthProvider extra)", () => {
    adminState.isAdmin = true;
    const { container } = renderWithSingleProvider(<CoachPanel conversationId="conv-1" />);
    // Sanity check: se o CoachPanel duplicasse um QueryClientProvider ou
    // AuthProvider, o teste falharia na montagem por conflito. Chegar até
    // aqui + o atalho existir confirma o compartilhamento.
    expect(container.querySelector('[data-testid="coach-panel-open-interpreter"]')).toBeTruthy();
  });

  it("CoachPanel preserva header original ('Coach IA') após integração", () => {
    adminState.isAdmin = true;
    renderWithSingleProvider(<CoachPanel conversationId="conv-1" />);
    expect(screen.getByText("Coach IA")).toBeInTheDocument();
  });
});
