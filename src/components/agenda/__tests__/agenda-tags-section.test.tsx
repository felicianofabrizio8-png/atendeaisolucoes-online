// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AgendaTagsSection } from "../AgendaTagsSection";

afterEach(cleanup);
const tags = [
  { id: "t1", name: "Comercial", hue: 280, owner_id: null },
  { id: "t2", name: "Foco", hue: 140, owner_id: "u1" },
];

describe("aba Tags", () => {
  it("funcionário vê as da empresa só para usar e gerencia as próprias", async () => {
    const onCreate = vi.fn().mockResolvedValue(null);
    const onRemove = vi.fn();
    render(
      <AgendaTagsSection
        tags={tags}
        me="u1"
        manager={false}
        onCreate={onCreate}
        onUpdate={vi.fn()}
        onRemove={onRemove}
      />,
    );
    const company = screen.getByRole("region", { name: /tags da empresa/i });
    expect(within(company).getByText("Comercial")).toBeInTheDocument();
    expect(within(company).queryByRole("button", { name: /excluir/i })).toBeNull();
    expect(within(company).queryByRole("button", { name: /nova tag da empresa/i })).toBeNull();
    const mine = screen.getByRole("region", { name: /minhas tags/i });
    await userEvent.click(within(mine).getByRole("button", { name: /excluir foco/i }));
    expect(onRemove).toHaveBeenCalledWith("t2");
    await userEvent.type(within(mine).getByLabelText(/nova tag/i), "Retorno{enter}");
    expect(onCreate).toHaveBeenCalledWith(
      expect.objectContaining({ name: "Retorno", personal: true }),
    );
  });

  it("gestor cria tag da empresa", async () => {
    const onCreate = vi.fn().mockResolvedValue(null);
    render(
      <AgendaTagsSection
        tags={tags}
        me="u1"
        manager
        onCreate={onCreate}
        onUpdate={vi.fn()}
        onRemove={vi.fn()}
      />,
    );
    const company = screen.getByRole("region", { name: /tags da empresa/i });
    await userEvent.type(within(company).getByLabelText(/nova tag/i), "Vendas{enter}");
    expect(onCreate).toHaveBeenCalledWith(
      expect.objectContaining({ name: "Vendas", personal: false }),
    );
  });
});
