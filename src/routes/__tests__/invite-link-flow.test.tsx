// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const api = vi.hoisted(() => ({
  pending: null as unknown,
  info: {} as Record<string, unknown>,
  join: vi.fn(),
  saved: null as string | null,
  user: { id: "u1" } as { id: string } | null,
  signOut: vi.fn(),
}));
vi.mock("@/lib/team/invite-link", () => ({
  myPendingJoin: async () => api.pending,
  linkInfo: async () => api.info,
  joinViaLink: api.join,
  readPendingInvite: () => api.saved,
  clearPendingInvite: () => {
    api.saved = null;
  },
  savePendingInvite: (token: string) => {
    api.saved = token;
  },
}));
vi.mock("@/auth/AuthContext", () => ({
  useAuth: () => ({ user: api.user, signOut: api.signOut }),
}));
import { PendingInviteGate } from "@/components/team/PendingInviteGate";
import { InviteLanding } from "@/components/team/InviteLanding";

const baseInfo = {
  valid: true,
  company: "Clínica Sol",
  requiresApproval: false,
  currentTeam: "Minha Empresa",
  alreadyMember: false,
  canSwitch: true,
  currentTeamHasData: false,
};

beforeEach(() => {
  api.pending = null;
  api.saved = "tok";
  api.info = { ...baseInfo };
  api.user = { id: "u1" };
  api.join.mockReset();
  Object.defineProperty(window, "location", {
    configurable: true,
    value: { ...window.location, reload: vi.fn(), assign: vi.fn() },
  });
});
afterEach(cleanup);

describe("convite pelo link", () => {
  it("logado: popup com o nome do time, frase de confirmação e Entrar / Agora não", async () => {
    api.join.mockResolvedValue("joined");
    render(<PendingInviteGate />);
    const dialog = await screen.findByRole("dialog", { name: /clínica sol/i });
    expect(dialog).toHaveTextContent(
      "Você foi convidado para fazer parte da equipe Clínica Sol. Deseja entrar?",
    );
    expect(screen.queryByText(/fica sem acesso/i)).toBeNull();
    expect(screen.queryByText(/crie sua equipe/i)).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: /entrar na equipe/i }));
    await waitFor(() => expect(api.join).toHaveBeenCalledWith("tok"));
    await waitFor(() => expect(window.location.reload).toHaveBeenCalled());
    expect(api.saved).toBeNull();
  });

  it("avisa a troca só quando a equipe atual tem dados; com aprovação, mostra a espera", async () => {
    api.info = { ...baseInfo, currentTeamHasData: true, requiresApproval: true };
    api.join.mockResolvedValue("pending_approval");
    render(<PendingInviteGate />);
    expect(await screen.findByText(/sua equipe atual “minha empresa” fica sem acesso/i)).toBeInTheDocument();
    expect(screen.getByText(/o administrador precisa aprovar/i)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /entrar na equipe/i }));
    expect(await screen.findByRole("dialog", { name: /aguardando aprovação/i })).toBeInTheDocument();
  });

  it("conta com colegas: explica e não oferece entrar", async () => {
    api.info = { ...baseInfo, canSwitch: false };
    render(<PendingInviteGate />);
    expect(await screen.findByText(/use outro e-mail/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /entrar na equipe/i })).toBeNull();
  });

  it("Agora não descarta o convite e fecha", async () => {
    render(<PendingInviteGate />);
    await userEvent.click(await screen.findByRole("button", { name: /agora não/i }));
    expect(api.saved).toBeNull();
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(api.join).not.toHaveBeenCalled();
  });

  it("aguardando aprovação: popup de espera com Sair", async () => {
    api.saved = null;
    api.pending = { state: "waiting", company: "Clínica Sol" };
    render(<PendingInviteGate />);
    expect(await screen.findByRole("dialog", { name: /aguardando aprovação/i })).toHaveTextContent(
      /clínica sol/i,
    );
    await userEvent.click(screen.getByRole("button", { name: /sair/i }));
    expect(api.signOut).toHaveBeenCalled();
  });

  it("sem login: a página do convite pede para criar conta ou entrar, sem criar equipe", async () => {
    api.user = null;
    const onAuth = vi.fn();
    render(<InviteLanding token="tok" onAuth={onAuth} />);
    const dialog = await screen.findByRole("dialog", { name: /clínica sol/i });
    expect(dialog).toHaveTextContent(/crie sua conta ou entre para aceitar o convite/i);
    expect(screen.queryByText(/nome da empresa/i)).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: /criar conta/i }));
    expect(onAuth).toHaveBeenCalledWith("signup");
    expect(api.saved).toBe("tok");
  });

  it("link inválido: avisa e não oferece entrar", async () => {
    api.user = null;
    api.info = { valid: false, company: null, requiresApproval: false };
    render(<InviteLanding token="tok" onAuth={vi.fn()} />);
    expect(await screen.findByText(/expirou, foi revogado ou atingiu o limite/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /criar conta/i })).toBeNull();
  });
});
