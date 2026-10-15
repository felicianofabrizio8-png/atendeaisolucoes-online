// @vitest-environment jsdom
import { createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QuoteCard } from "../QuoteCard";
import { matchesQuote, quoteDate, quoteGlow } from "@/lib/quote-presentation";
import { createQuote, listQuotes } from "@/data/quotes";
import type { Quote } from "@/data/quotes";
vi.mock("@/data/leadRepo", () => ({ getLeads: () => leads, subscribeRepo: () => () => {} }));
vi.mock("../QuoteFormModal", () => ({
  QuoteFormModal: () => createElement("div", null, "Editor de orçamento"),
}));
vi.mock("../SendWhatsAppModal", () => ({
  SendWhatsAppModal: ({ onSent }: { onSent: (id: string) => void }) =>
    createElement(
      "button",
      { onClick: () => onSent("conversation-test") },
      "Confirmar envio simulado",
    ),
}));
const leads = [
  { id: "lead-test", name: "João Silva", phone: "(15) 99999-1234", channel: "whatsapp" },
];
const quote: Quote = {
  id: "q-test",
  leadId: "lead-test",
  productId: "p1",
  productName: "Piscina 6 metros",
  unitPrice: 13000,
  discount: 100,
  finalValue: 12900,
  paymentMethod: "Pix",
  installments: 1,
  validUntil: "2030-10-04",
  createdAt: "2030-10-01T10:00:00Z",
  sent: false,
  message: "Proposta completa: R$12.900",
  inclusos: ["Instalação"],
  brindes: ["Capa"],
  porConta: ["Escavação"],
  notes: "Retirada agendada",
};
afterEach(cleanup);
describe("Orçamentos: apresentação e ações", () => {
  it("mantém informações completas em detalhes e copia a mensagem salva", async () => {
    const user = userEvent.setup();
    render(createElement(QuoteCard, { quote }));
    expect(screen.queryByText("Piscina 6 metros")).toBeNull();
    await user.click(screen.getByRole("button", { name: "Detalhes" }));
    expect((screen.getByLabelText("Produto") as HTMLInputElement).value).toBe(quote.productName);
    expect((screen.getByLabelText("Itens inclusos") as HTMLTextAreaElement).value).toBe(
      "Instalação",
    );
    await user.click(screen.getByRole("button", { name: "Copiar orçamento" }));
    expect(await navigator.clipboard.readText()).toBe(quote.message);
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).toBeNull();
  });
  it("envio não abre conversa nem fecha o acompanhamento dos blocos", async () => {
    const user = userEvent.setup();
    render(createElement(QuoteCard, { quote }));
    await user.click(screen.getByRole("button", { name: /^Enviar$/ }));
    await user.click(screen.getByRole("button", { name: "Confirmar envio simulado" }));
    expect(screen.getByRole("button", { name: "Confirmar envio simulado" })).toBeTruthy();
  });
  it("desabilita envio de orçamento sem cliente", () => {
    render(createElement(QuoteCard, { quote: { ...quote, leadId: "missing" } }));
    expect((screen.getByRole("button", { name: /^Enviar$/ }) as HTMLButtonElement).disabled).toBe(
      true,
    );
  });
  it("busca ignora acentos e encontra telefone formatado e produto", () => {
    for (const query of ["joao", "15999991234", "piscina 6", "q-test"])
      expect(matchesQuote(quote, leads[0], query)).toBe(true);
    expect(matchesQuote(quote, leads[0], "Maria")).toBe(false);
    expect(
      matchesQuote(
        {
          ...quote,
          customerDetails: {
            firstName: "Maria",
            lastName: "Souza",
            email: "",
            phone1: "5515987654321",
            phone2: "",
            street: "",
            number: "",
            city: "",
            neighborhood: "",
            state: "",
            postalCode: "",
          },
        },
        leads[0],
        "Maria",
      ),
    ).toBe(true);
  });
  it("validade não retrocede por fuso e cores são estáveis por orçamento", () => {
    expect(quoteDate("2030-10-04")).toBe("04/10/2030");
    expect(quoteGlow("q1")).toBe(quoteGlow("q1"));
    expect(quoteGlow("q1")).not.toBe(quoteGlow("q2"));
  });
  it("edita o mesmo orçamento e preserva o preço contratado", async () => {
    const input = {
      leadId: "lead-test",
      productId: "p1",
      discount: 100.5,
      paymentMethod: "Pix" as const,
      installments: 1,
      validUntil: "2030-10-04",
    };
    const original = await createQuote(input);
    const length = listQuotes().length;
    const updated = await createQuote(
      { ...input, discount: 200.5, notes: "Atualizado" },
      original.id,
    );
    expect(listQuotes()).toHaveLength(length);
    expect(updated.id).toBe(original.id);
    expect(updated.unitPrice).toBe(original.unitPrice);
    expect(updated.finalValue).toBe(original.unitPrice - 200.5);
    expect(updated.notes).toBe("Atualizado");
  });
});
