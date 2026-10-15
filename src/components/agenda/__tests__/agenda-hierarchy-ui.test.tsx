// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children }: { children: unknown }) => children,
}));
vi.mock("@/data/leadRepo", () => ({ getConversations: () => [] }));
vi.mock("../useEventDetails", () => ({
  useEventDetails: () => ({ history: [], names: {} }),
  describeChange: () => "",
}));
import { EventDrawer } from "../EventDrawer";
import { AgendaToolbar } from "../AgendaToolbar";
import { EMPTY_FILTERS, type AgendaEvent } from "../agenda-model";

afterEach(cleanup);

const teamEvent = {
  id: "e1",
  title: "Treinamento",
  address: null,
  scheduled_at: "2026-10-16T12:00:00Z",
  status: "agendada",
  notes: null,
  customer_name: null,
  customer_phone: null,
  product: null,
  lead_id: null,
  quote_id: null,
  appointment_type: "retorno_comercial",
  city: null,
  salesperson: null,
  technician: null,
  owner_id: "boss",
  scope: "equipe",
  everyone: false,
  participant_ids: ["u1"],
  tag_ids: ["t1"],
} as AgendaEvent;

const drawerProps = {
  type: null,
  extended: true,
  hierarchy: true,
  me: "u1",
  members: [
    { id: "boss", name: "Ana Gestora" },
    { id: "u1", name: "Bruno" },
  ],
  tags: [{ id: "t1", name: "Comercial", hue: 280, owner_id: null }],
  onClose: vi.fn(),
  onStatus: vi.fn(),
  onEdit: vi.fn(),
  onDuplicate: vi.fn(),
  onDelete: vi.fn(),
  onSendTechnician: vi.fn(),
};

describe("hierarquia na tela da Agenda", () => {
  it("participante vê dono, alcance e tags, mas não edita nem exclui o de equipe", () => {
    render(<EventDrawer {...drawerProps} event={teamEvent} manager={false} />);
    expect(screen.getByText("Ana Gestora")).toBeInTheDocument();
    expect(screen.getByText(/equipe · 1 participante/i)).toBeInTheDocument();
    expect(screen.getByText("Comercial")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /editar/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /excluir/i })).toBeNull();
    expect(screen.queryByRole("radiogroup", { name: /status/i })).toBeNull();
  });

  it("gestor edita o de equipe", () => {
    render(<EventDrawer {...drawerProps} event={teamEvent} manager />);
    expect(screen.getByRole("button", { name: /editar/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /excluir/i })).toBeInTheDocument();
  });

  it("seletor De quem só para gestor e emite o escopo escolhido", async () => {
    const onScope = vi.fn();
    const base = {
      view: "semana" as const,
      focus: new Date(2026, 9, 16),
      filters: EMPTY_FILTERS,
      people: [],
      onView: vi.fn(),
      onNavigate: vi.fn(),
      onToday: vi.fn(),
      onFilters: vi.fn(),
      onCustomize: vi.fn(),
      scope: { kind: "minha" } as const,
      members: drawerProps.members,
      onScope,
    };
    const { unmount } = render(<AgendaToolbar {...base} manager={false} />);
    expect(screen.queryByRole("tablist", { name: /de quem/i })).toBeNull();
    unmount();
    render(<AgendaToolbar {...base} manager />);
    await userEvent.click(screen.getByRole("tab", { name: /^equipe$/i }));
    expect(onScope).toHaveBeenCalledWith({ kind: "equipe" });
  });
});
