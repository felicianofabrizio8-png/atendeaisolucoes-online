// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const state = vi.hoisted(() => ({
  company: { id: "c1", name: "Minha Empresa" } as { id: string; name: string } | null,
  admin: true,
  saved: null as string | null,
  rename: vi.fn(),
  refresh: vi.fn(),
}));
vi.mock("@/auth/AuthContext", () => ({
  useAuth: () => ({ user: { id: "u1" }, company: state.company, refreshProfile: state.refresh }),
}));
vi.mock("@/hooks/useTeamAccess", () => ({ useTeamAccess: () => ({ isAdmin: state.admin }) }));
vi.mock("@/lib/team/invite-link", () => ({ readPendingInvite: () => state.saved }));
vi.mock("@/lib/users.functions", () => ({ renameTeam: state.rename }));
import { WelcomeTeamDialog } from "@/components/team/WelcomeTeamDialog";

beforeEach(() => {
  state.company = { id: "c1", name: "Minha Empresa" };
  state.admin = true;
  state.saved = null;
  state.rename.mockReset().mockResolvedValue(undefined);
  localStorage.clear();
});
afterEach(cleanup);

describe("Crie sua equipe", () => {
  it("admin de equipe sem nome dá nome à equipe e vê o convite", async () => {
    render(<WelcomeTeamDialog />);
    await userEvent.type(await screen.findByLabelText(/nome da equipe/i), "Clínica Sol");
    await userEvent.click(screen.getByRole("button", { name: /continuar/i }));
    await waitFor(() => expect(state.rename).toHaveBeenCalledWith("Clínica Sol"));
    expect(await screen.findByRole("dialog", { name: /convide sua equipe/i })).toBeInTheDocument();
  });

  it("não aparece com convite pendente, para quem não é admin ou equipe já nomeada", () => {
    state.saved = "tok";
    const { unmount } = render(<WelcomeTeamDialog />);
    expect(screen.queryByRole("dialog")).toBeNull();
    unmount();
    state.saved = null;
    state.admin = false;
    const second = render(<WelcomeTeamDialog />);
    expect(screen.queryByRole("dialog")).toBeNull();
    second.unmount();
    state.admin = true;
    state.company = { id: "c1", name: "Clínica Sol" };
    render(<WelcomeTeamDialog />);
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
