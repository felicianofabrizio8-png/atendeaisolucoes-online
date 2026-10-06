// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const { db, admin, toast } = vi.hoisted(() => ({
  db: { row: null as Record<string, unknown> | null, reads: 0, writes: 0 },
  admin: { isAdmin: true },
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: { getSession: async () => ({ data: { session: { access_token: "access-token-1" } } }) },
    from: () => {
      const chain: Record<string, unknown> = {};
      chain.select = () => chain;
      chain.eq = () => chain;
      chain.update = () => {
        db.writes += 1;
        return chain;
      };
      chain.maybeSingle = async () => {
        db.reads += 1;
        return { data: db.row, error: null };
      };
      return chain;
    },
  },
}));
vi.mock("@/hooks/useIsAdmin", () => ({
  useIsAdmin: () => ({ isAdmin: admin.isAdmin, isLoading: false }),
}));
vi.mock("sonner", () => ({ toast }));

import { SalesAgentMasterSwitch } from "@/components/ai/SalesAgentMasterSwitch";

const READINESS = "/api/ai/readiness";
const MASTER = "/api/ai/sales-agent-master";
const findToggle = () => screen.findByRole("switch", { name: "Ativar a Vendedora IA" });

/** O servidor diz se a empresa usa a Vendedora e é ele que troca o botão. */
function stubServer(
  options: {
    readiness?: unknown;
    save?: (enabled: boolean) => { status: number; body: unknown };
  } = {},
) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url === READINESS) {
      return {
        ok: true,
        status: 200,
        json: async () => options.readiness ?? { ok: true, salesAgentEligible: true },
      } as Response;
    }
    const enabled = (JSON.parse(String(init?.body)) as { enabled: boolean }).enabled;
    const reply = options.save?.(enabled) ?? { status: 200, body: { ok: true, enabled } };
    return {
      ok: reply.status < 400,
      status: reply.status,
      json: async () => reply.body,
    } as Response;
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

const saves = (fetchMock: ReturnType<typeof stubServer>) =>
  fetchMock.mock.calls
    .filter(([input]) => String(input) === MASTER)
    .map(([, init]) => init as RequestInit);

beforeEach(() => {
  db.row = {
    company_id: "company-1",
    sales_agent_master_enabled: true,
    sales_agent_v2_mode: "assisted",
  };
  db.reads = 0;
  db.writes = 0;
  admin.isAdmin = true;
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("botão mestre da Vendedora IA na tela de configuração", () => {
  it("desligar pede a troca ao servidor com a sessão do usuário, sem escrever direto no banco", async () => {
    const fetchMock = stubServer();
    render(<SalesAgentMasterSwitch companyId="company-1" />);
    const toggle = await findToggle();
    expect(toggle).toBeChecked();
    expect(screen.getByText("Vendedora IA ativada")).toBeInTheDocument();

    await userEvent.click(toggle);

    await waitFor(() => expect(screen.getByText("Vendedora IA desativada")).toBeInTheDocument());
    expect(screen.getByText(/o atendimento fica com a equipe/)).toBeInTheDocument();
    expect(saves(fetchMock)).toEqual([
      {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer access-token-1" },
        body: JSON.stringify({ enabled: false }),
      },
    ]);
    // Só o estado vai no pedido: a empresa é definida pelo servidor.
    expect(db.writes).toBe(0);
    expect(toast.success).toHaveBeenCalledWith("Vendedora IA desativada");
  });

  it("religar pede enabled true e mostra o estado ativo", async () => {
    db.row = { company_id: "company-1", sales_agent_master_enabled: false };
    const fetchMock = stubServer();
    render(<SalesAgentMasterSwitch companyId="company-1" />);
    const toggle = await findToggle();
    expect(toggle).not.toBeChecked();

    await userEvent.click(toggle);

    await waitFor(() => expect(screen.getByText("Vendedora IA ativada")).toBeInTheDocument());
    expect(saves(fetchMock).map((init) => init.body)).toEqual([JSON.stringify({ enabled: true })]);
  });

  it("quem não é admin vê o estado, mas não altera", async () => {
    admin.isAdmin = false;
    const fetchMock = stubServer();
    render(<SalesAgentMasterSwitch companyId="company-1" />);
    const toggle = await findToggle();
    expect(toggle).toBeDisabled();
    expect(screen.getByText(/Apenas administradores podem alterar\./)).toBeInTheDocument();
    await userEvent.click(toggle);
    expect(saves(fetchMock)).toEqual([]);
  });

  it("troca recusada pelo servidor não muda o estado mostrado", async () => {
    stubServer({
      save: () => ({ status: 500, body: { ok: false, error: "Não foi possível salvar." } }),
    });
    render(<SalesAgentMasterSwitch companyId="company-1" />);
    await userEvent.click(await findToggle());
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith("Não foi possível salvar", {
        description: "Não foi possível salvar.",
      }),
    );
    expect(screen.getByText("Vendedora IA ativada")).toBeInTheDocument();
    expect(await findToggle()).toBeChecked();
  });

  it("empresa que não usa a Vendedora não vê o botão nem lê a configuração dele", async () => {
    for (const readiness of [
      { ok: true, salesAgentEligible: false },
      { ok: true },
      { ok: false },
    ]) {
      const fetchMock = stubServer({ readiness });
      const { unmount } = render(<SalesAgentMasterSwitch companyId="company-1" />);
      await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(screen.queryByTestId("sales-agent-master-switch")).toBeNull();
      expect(db.reads).toBe(0);
      unmount();
    }
  });

  it("a elegibilidade é perguntada ao servidor com a sessão do usuário", async () => {
    const fetchMock = stubServer();
    render(<SalesAgentMasterSwitch companyId="company-1" />);
    await findToggle();
    expect(fetchMock).toHaveBeenCalledWith(READINESS, {
      headers: { Authorization: "Bearer access-token-1" },
    });
  });

  it("sem a coluna no banco (migration pendente) o botão não aparece", async () => {
    db.row = { company_id: "company-1", sales_agent_v2_mode: "assisted" };
    stubServer();
    render(<SalesAgentMasterSwitch companyId="company-1" />);
    await waitFor(() => expect(db.reads).toBeGreaterThan(0));
    expect(screen.queryByTestId("sales-agent-master-switch")).toBeNull();
  });
});
