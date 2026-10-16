// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const api = vi.hoisted(() => ({
  status: { chat: true, origin: "lume", voice: false, agenda: { extended: true } } as {
    chat: boolean;
    origin: string | null;
    voice: boolean;
    agenda: { extended: boolean };
  },
  ask: vi.fn(),
  decide: vi.fn(),
}));

vi.mock("@/components/ui/orb-bloop", () => ({ OrbBloop: () => <span data-testid="orb" /> }));
vi.mock("@/components/atendimento/RichText", () => ({
  RichText: ({ text }: { text: string }) => <>{text}</>,
}));
vi.mock("@/components/lume/lume-api", () => ({
  lumeStatus: async () => api.status,
  askLume: api.ask,
  decideLumeAction: api.decide,
}));

import { LumeDock } from "@/components/lume/LumeDock";

beforeEach(() => {
  api.status = { chat: true, origin: "lume", voice: false, agenda: { extended: true } };
  api.ask.mockReset();
  api.decide.mockReset();
  Element.prototype.scrollIntoView = vi.fn();
});
afterEach(cleanup);

function dock(onChanged = vi.fn()) {
  render(
    <LumeDock
      page="Agenda"
      greeting="O que vamos organizar?"
      suggestions={["O que tenho amanhã?"]}
      onChanged={onChanged}
    />,
  );
  return onChanged;
}

describe("Lume Dock", () => {
  it("avisa que falta a chave em vez de fingir que funciona", async () => {
    api.status = { chat: false, origin: null, voice: false, agenda: { extended: false } };
    dock();
    await userEvent.click(screen.getByRole("button", { name: /pergunte à lume/i }));
    expect(await screen.findByRole("status")).toHaveTextContent(/LUME_AI_API_KEY/);
    expect(screen.getByRole("button", { name: "O que tenho amanhã?" })).toBeDisabled();
  });

  it("criação vem feita com Desfazer; exclusão só roda após Confirmar", async () => {
    api.ask.mockResolvedValue({
      reply: "Criei a reunião e deixei a exclusão para você confirmar.",
      transcript: null,
      actions: [
        {
          id: "a1",
          tool: "agenda_criar",
          summary: "Criar reunião",
          status: "executada",
          undo: { op: "delete_events", ids: ["e1"] },
          touched: ["e1"],
        },
        {
          id: "a2",
          tool: "agenda_excluir",
          summary: "Excluir visita de sexta",
          status: "pendente",
          args: { ids: ["e2"] },
          touched: [],
        },
      ],
    });
    api.decide.mockResolvedValue({
      status: "confirmada",
      undo: { op: "restore_events", rows: [] },
      touched: ["e2"],
    });
    const onChanged = dock();
    await userEvent.click(screen.getByRole("button", { name: /pergunte à lume/i }));
    await userEvent.type(
      screen.getByLabelText("Mensagem para a Lume"),
      "organiza minha sexta{enter}",
    );

    expect(await screen.findByText("Criar reunião")).toBeInTheDocument();
    expect(onChanged).toHaveBeenCalledWith(["e1"]);
    expect(screen.getByRole("button", { name: /desfazer/i })).toBeInTheDocument();
    expect(api.decide).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole("button", { name: /confirmar/i }));
    await waitFor(() =>
      expect(api.decide).toHaveBeenCalledWith(expect.objectContaining({ id: "a2" }), "confirm"),
    );
    expect(onChanged).toHaveBeenLastCalledWith(["e2"]);
    expect(api.ask).toHaveBeenCalledWith(
      expect.objectContaining({ message: "organiza minha sexta", page: "Agenda" }),
    );
  });
});
