// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QuoteFormModal } from "../QuoteFormModal";
import { QuoteSuccessModal } from "../QuoteSuccessModal";
import { createLead } from "@/data/leadRepo";
import type { Quote } from "@/data/quotes";

const leads = vi.hoisted(
  () => [] as Array<{ id: string; name: string; phone: string; channel: "whatsapp" }>,
);
vi.mock("@/auth/AuthContext", () => ({ useAuth: () => ({ profile: null }) }));
vi.mock("@/data/leadRepo", () => ({
  getLeads: () => leads,
  subscribeRepo: () => () => {},
  createLead: vi.fn(async ({ name }: { name: string }) => ({ id: "lead-wizard", name })),
}));

afterEach(() => {
  cleanup();
  leads.length = 0;
  vi.mocked(createLead).mockClear();
});

describe("Criação de orçamento por etapas", () => {
  it("preserva os dados das três fases no orçamento criado", async () => {
    const user = userEvent.setup();
    const onCreated = vi.fn<(quote: Quote) => void>();
    render(createElement(QuoteFormModal, { onCancel: vi.fn(), onCreated }));

    await user.type(screen.getByLabelText("Nome"), "Ana");
    await user.type(screen.getByLabelText("Sobrenome"), "Silva");
    await user.type(screen.getByLabelText("Telefone 1"), "15999991234");
    await user.type(screen.getByLabelText("Cidade"), "Sorocaba");
    await user.type(screen.getByLabelText("Número"), "42");
    await user.click(screen.getByRole("button", { name: "Avançar" }));

    expect(screen.getByText("Produto")).toBeTruthy();
    await user.clear(screen.getByLabelText("Descrição"));
    await user.type(screen.getByLabelText("Descrição"), "Piscina azul com instalação");
    await user.type(screen.getByLabelText("Benefícios"), "Entrega rápida");
    await user.click(screen.getByRole("button", { name: "Avançar" }));

    expect(screen.getByText("Pagamento")).toBeTruthy();
    await user.clear(screen.getByLabelText("Valor"));
    await user.type(screen.getByLabelText("Valor"), "14000");
    await user.clear(screen.getByLabelText("Desconto (R$)"));
    await user.type(screen.getByLabelText("Desconto (R$)"), "1000");
    await user.click(screen.getByRole("button", { name: "Criar" }));

    await waitFor(() => expect(onCreated).toHaveBeenCalledTimes(1));
    const quote = onCreated.mock.calls[0][0];
    expect(quote.customerDetails?.city).toBe("Sorocaba");
    expect(quote.customerDetails?.number).toBe("42");
    expect(quote.customerDetails?.firstName).toBe("Ana");
    expect(quote.productDescription).toBe("Piscina azul com instalação");
    expect(quote.benefits).toBe("Entrega rápida");
    expect(quote.unitPrice).toBe(14000);
    expect(quote.finalValue).toBe(13000);
  });
  it("reutiliza cliente da empresa quando o telefone já está cadastrado", async () => {
    leads.push({
      id: "lead-existente",
      name: "Ana Silva",
      phone: "5515999991234",
      channel: "whatsapp",
    });
    const user = userEvent.setup();
    const onCreated = vi.fn<(quote: Quote) => void>();
    render(createElement(QuoteFormModal, { onCancel: vi.fn(), onCreated }));
    await user.type(screen.getByLabelText("Nome"), "Ana");
    await user.type(screen.getByLabelText("Sobrenome"), "Silva");
    await user.type(screen.getByLabelText("Telefone 1"), "15999991234");
    await user.click(screen.getByRole("button", { name: "Avançar" }));
    await user.click(screen.getByRole("button", { name: "Avançar" }));
    await user.click(screen.getByRole("button", { name: "Criar" }));
    await waitFor(() => expect(onCreated).toHaveBeenCalledTimes(1));
    expect(onCreated.mock.calls[0][0].leadId).toBe("lead-existente");
    expect(createLead).not.toHaveBeenCalled();
  });
  it("abre a conclusão com envio, edição e visualização", async () => {
    const user = userEvent.setup();
    const onSend = vi.fn();
    const onEdit = vi.fn();
    const onView = vi.fn();
    const quote = {
      id: "q-success",
      leadId: "lead-wizard",
      productId: "p1",
      productName: "Piscina 6 metros",
      unitPrice: 14000,
      discount: 1000,
      finalValue: 13000,
      paymentMethod: "Pix" as const,
      installments: 1,
      validUntil: "2030-10-04",
      createdAt: "2030-10-01T10:00:00Z",
      sent: false,
      message: "Orçamento",
      inclusos: [],
      brindes: [],
      porConta: [],
      notes: "",
    };
    render(
      createElement(QuoteSuccessModal, {
        quote,
        canSend: true,
        onClose: vi.fn(),
        onSend,
        onEdit,
        onView,
      }),
    );
    expect(screen.getByText(/Orçamento criado/)).toBeTruthy();
    expect(screen.queryByText("Piscina 6 metros")).toBeNull();
    expect(screen.queryByText(/Val\./)).toBeNull();
    await user.click(screen.getByRole("button", { name: "Enviar" }));
    await user.click(screen.getByRole("button", { name: "Editar orçamento" }));
    await user.click(screen.getByRole("button", { name: "Visualizar" }));
    expect(onSend).toHaveBeenCalledOnce();
    expect(onEdit).toHaveBeenCalledOnce();
    expect(onView).toHaveBeenCalledOnce();
  });
});
