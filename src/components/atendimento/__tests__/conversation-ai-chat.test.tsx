// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
const mocks = vi.hoisted(() => ({ ask: vi.fn() }));
vi.mock("@/auth/AuthContext", () => ({
  useAuth: () => ({
    profile: { company_id: "company-a", display_name: "Fabrizio Silva" },
    user: { id: "user-a" },
  }),
}));
vi.mock("@/lib/atendimento/copilot-chat-api", () => ({ askConversationCopilot: mocks.ask }));
vi.mock("@/components/ui/orb-bloop", () => ({
  OrbBloop: ({ size }: { size: number }) => (
    <div data-testid="orb" style={{ width: size, height: size }} />
  ),
}));
import { ConversationAiChat } from "../ConversationAiChat";
import { buildDemoInbox } from "@/data/demo-inbox";
import { AiComposer } from "../AiComposer";
const contact = buildDemoInbox()[0];
beforeEach(() => {
  mocks.ask.mockReset().mockResolvedValue("Resposta contextualizada.");
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: () => ({ matches: true }),
  });
  Element.prototype.scrollIntoView = vi.fn();
  URL.createObjectURL = vi.fn(() => "blob:preview");
  URL.revokeObjectURL = vi.fn();
});
afterEach(cleanup);
describe("chat da IA no atendimento", () => {
  it("mostra introdução e atalhos e remove a orbe após o primeiro pedido", async () => {
    render(<ConversationAiChat contact={contact} onUseSuggestion={vi.fn()} />);
    expect(screen.getByRole("heading")).toHaveTextContent("Fabrizio");
    const input = screen.getByRole("textbox");
    expect(
      input.compareDocumentPosition(screen.getByRole("button", { name: "Resumo" })) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(screen.getByTestId("orb")).toHaveStyle({ width: "192px", height: "192px" });
    await userEvent.click(screen.getByRole("button", { name: "Resumo" }));
    await screen.findByText("Resposta contextualizada.");
    await waitFor(() => expect(screen.queryByTestId("orb")).not.toBeInTheDocument());
    expect(screen.queryByRole("heading")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Próxima resposta" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Sugestões" })).toBeVisible();
  });
  it("usa o histórico e apenas insere rascunho quando o atendente escolhe usar no chat", async () => {
    const insert = vi.fn();
    render(<ConversationAiChat contact={contact} onUseSuggestion={insert} />);
    await userEvent.type(screen.getByRole("textbox"), "Me ajude{Enter}");
    await screen.findByText("Resposta contextualizada.");
    expect(insert).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "Usar no chat" }));
    expect(insert).toHaveBeenCalledWith("Resposta contextualizada.");
    await userEvent.click(screen.getByRole("button", { name: "Sugestões" }));
    await waitFor(() => expect(mocks.ask).toHaveBeenCalledTimes(2));
    expect(mocks.ask.mock.calls[1][0].history).toEqual([
      { role: "user", text: "Me ajude" },
      { role: "assistant", text: "Resposta contextualizada." },
    ]);
  });
  it("aborta ao trocar de cliente e descarta resposta atrasada", async () => {
    let finish!: (text: string) => void;
    mocks.ask.mockImplementationOnce(
      () =>
        new Promise<string>((resolve) => {
          finish = resolve;
        }),
    );
    const { rerender } = render(<ConversationAiChat contact={contact} onUseSuggestion={vi.fn()} />);
    await userEvent.type(screen.getByRole("textbox"), "Primeiro cliente{Enter}");
    const signal = mocks.ask.mock.calls[0][0].signal;
    rerender(
      <ConversationAiChat
        contact={{ ...contact, conversation: { ...contact.conversation, id: "other" } }}
        onUseSuggestion={vi.fn()}
      />,
    );
    expect(signal.aborted).toBe(true);
    await act(async () => finish("Resposta do cliente anterior"));
    expect(screen.queryByText("Resposta do cliente anterior")).toBeNull();
    expect(screen.getByRole("textbox")).toHaveValue("");
  });
  it("mantém pergunta e documento quando a IA falha", async () => {
    mocks.ask.mockRejectedValueOnce(new Error("IA indisponível"));
    render(<ConversationAiChat contact={contact} onUseSuggestion={vi.fn()} />);
    const file = new File(["Pedido"], "pedido.txt", { type: "text/plain" });
    fireEvent.change(screen.getByLabelText("Selecionar documentos"), { target: { files: [file] } });
    await userEvent.type(screen.getByRole("textbox"), "Analise{Enter}");
    await screen.findByRole("alert");
    await waitFor(() => expect(screen.queryByTestId("orb")).not.toBeInTheDocument());
    expect(screen.getByRole("textbox")).toHaveValue("Analise");
    expect(screen.getByRole("button", { name: "Remover pedido.txt" })).toBeEnabled();
    expect(mocks.ask.mock.calls[0][0].files[0]).toBe(file);
  });
  it("libera prévias e rejeita tipos inválidos também pelo arrastar", async () => {
    const { unmount } = render(<AiComposer value="" onChange={vi.fn()} onSubmit={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("Selecionar imagens"), {
      target: { files: [new File(["png"], "print.png", { type: "image/png" })] },
    });
    expect(screen.getByAltText("print.png")).toBeVisible();
    fireEvent.drop(screen.getByRole("textbox").parentElement!, {
      dataTransfer: { files: [new File(["x"], "x.exe", { type: "application/octet-stream" })] },
    });
    expect(screen.getByRole("alert")).toHaveTextContent("Use imagens");
    unmount();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:preview");
  });
  it("Shift+Enter não envia e Enter duplicado não faz duas consultas", async () => {
    mocks.ask.mockImplementation(() => new Promise(() => {}));
    render(<ConversationAiChat contact={contact} onUseSuggestion={vi.fn()} />);
    await userEvent.type(screen.getByRole("textbox"), "Mensagem");
    fireEvent.keyDown(screen.getByRole("textbox"), { key: "Enter", shiftKey: true });
    expect(mocks.ask).not.toHaveBeenCalled();
    fireEvent.keyDown(screen.getByRole("textbox"), { key: "Enter" });
    fireEvent.keyDown(screen.getByRole("textbox"), { key: "Enter" });
    expect(mocks.ask).toHaveBeenCalledTimes(1);
    await userEvent.click(screen.getByRole("button", { name: "Parar" }));
    expect(mocks.ask.mock.calls[0][0].signal.aborted).toBe(true);
  });
});
