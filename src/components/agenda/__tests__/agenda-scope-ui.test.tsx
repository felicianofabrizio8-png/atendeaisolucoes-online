// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
vi.mock("@/integrations/supabase/client", () => ({ supabase: { from: () => ({}) } }));
// Snapshots estáveis: useSyncExternalStore exige a mesma referência entre leituras.
const empty = vi.hoisted(() => [] as unknown[]);
vi.mock("@/data/leadRepo", () => ({ getLeads: () => empty, subscribeRepo: () => () => {} }));
vi.mock("@/data/quotes", () => ({ listQuotes: () => empty, subscribeQuotes: () => () => {} }));
import { EventFormModal } from "../EventFormModal";
afterEach(cleanup);
const props = {
  companyId: "c1",
  event: null,
  initialAt: new Date(2026, 9, 16, 9),
  types: [],
  extended: true,
  hierarchy: true,
  tags: [],
  members: [{ id: "u2", name: "Bruno" }],
  me: "u1",
  onClose: () => {},
  onSaved: () => {},
  onCreateTag: async () => null,
};
async function toPeopleStep() {
  await userEvent.type(screen.getByPlaceholderText(/reunião de alinhamento/i), "Treino");
  await userEvent.click(screen.getByRole("button", { name: /avançar/i }));
}
describe("formulário com hierarquia", () => {
  it("funcionário não escolhe alcance", async () => {
    render(<EventFormModal {...props} manager={false} />);
    await toPeopleStep();
    expect(screen.queryByRole("radiogroup", { name: /alcance/i })).toBeNull();
  });
  it("gestor escolhe Equipe e vê participantes e toda a equipe", async () => {
    render(<EventFormModal {...props} manager />);
    await toPeopleStep();
    await userEvent.click(screen.getByRole("radio", { name: /^equipe$/i }));
    expect(screen.getByRole("group", { name: /participantes/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /toda a equipe/i })).toBeInTheDocument();
  });
});
