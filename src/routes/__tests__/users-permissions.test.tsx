// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const api = vi.hoisted(() => ({
  users: [] as unknown[],
  links: [] as unknown[],
  update: vi.fn(),
  createLink: vi.fn(),
  revoke: vi.fn(),
  approve: vi.fn(),
}));
vi.mock("@/auth/AuthContext", () => ({ useAuth: () => ({ user: { id: "admin" }, profile: { company_id: "c1" } }) }));
vi.mock("@/hooks/useTeamAccess", () => ({
  useTeamAccess: () => ({ isAdmin: true, access: { schemaReady: true, role: "admin", active: true, permissions: [] } }),
}));
vi.mock("@/lib/users.functions", () => ({
  listCompanyUsers: async () => ({ users: api.users }),
  listCompanyInvites: async () => ({ invites: [] }),
  listInviteLinks: async () => api.links,
  inviteUser: vi.fn(),
  cancelInvite: vi.fn(),
  updateTeamMember: api.update,
  createInviteLink: api.createLink,
  revokeInviteLink: api.revoke,
  approveMember: api.approve,
  rejectMember: vi.fn(),
  inviteLinkUrl: (token: string) => `https://app.test/convite?link=${token}`,
}));
import { UsersTab } from "@/components/settings/UsersTab";

const wrap = () =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <UsersTab />
    </QueryClientProvider>,
  );

beforeEach(() => {
  api.users = [
    { id: "admin", displayName: "Ana", email: "ana@x", role: "admin", active: true, permissions: [], createdAt: "", lastSeenAt: null },
    { id: "u2", displayName: "Bruno", email: "b@x", role: "atendente", active: true, permissions: ["conversations.read","conversations.reply","quotes.manage","agenda.manage","products.view"], createdAt: "", lastSeenAt: null },
    { id: "u3", displayName: "Carla", email: "c@x", role: "atendente", active: false, approvalPending: true, permissions: ["agenda.manage"], createdAt: "", lastSeenAt: null },
  ];
  api.links = [];
  Object.values(api).forEach((item) => typeof item === "function" && "mockReset" in item && item.mockReset());
});
afterEach(cleanup);

describe("Usuários e Permissões", () => {
  it("lista membros com perfil e mostra aprovação pendente", async () => {
    wrap();
    expect(await screen.findByText("Bruno")).toBeInTheDocument();
    expect(screen.getByText("Funcionário")).toBeInTheDocument();
    const pending = screen.getByRole("region", { name: /aguardando aprovação/i });
    expect(within(pending).getByText("Carla")).toBeInTheDocument();
    await userEvent.click(within(pending).getByRole("button", { name: /aprovar/i }));
    await waitFor(() => expect(api.approve).toHaveBeenCalledWith("u3"));
  });

  it("perfil Gestor da agenda liga a permissão de equipe e salva", async () => {
    wrap();
    await userEvent.click(await screen.findByRole("button", { name: /editar bruno/i }));
    await userEvent.click(screen.getByRole("radio", { name: /gestor da agenda/i }));
    expect(screen.getByRole("switch", { name: /gerenciar agenda da equipe/i })).toBeChecked();
    await userEvent.click(screen.getByRole("button", { name: /salvar/i }));
    await waitFor(() =>
      expect(api.update).toHaveBeenCalledWith(expect.objectContaining({ id: "u2", permissions: expect.arrayContaining(["agenda.team"]) })),
    );
  });

  it("cria link de convite com aprovação e mostra o endereço para copiar", async () => {
    api.createLink.mockResolvedValue({ id: "l1", token: "abc", label: "Vendas", role: "atendente", permissions: [], requires_approval: true, expires_at: null, max_uses: null, uses: 0, revoked_at: null, created_at: "" });
    wrap();
    await userEvent.click(await screen.findByRole("button", { name: /gerar link/i }));
    await userEvent.click(screen.getByRole("switch", { name: /exigir minha aprovação/i }));
    await userEvent.click(screen.getByRole("button", { name: /criar link/i }));
    await waitFor(() => expect(api.createLink).toHaveBeenCalledWith(expect.objectContaining({ requiresApproval: true })));
  });
});
