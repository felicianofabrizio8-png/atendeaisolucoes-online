import { describe, expect, it } from "vitest";
import { buildQuoteMessage, formatQuoteDate } from "@/data/quotes";
import type { Product } from "@/data/products";

const product = { id: "p1", name: "Consulta de avaliação" } as unknown as Product;

describe("mensagem do orçamento", () => {
  it("mostra a validade no dia escolhido, sem voltar um dia pelo fuso", () => {
    expect(formatQuoteDate("2026-10-11")).toBe("11/10/2026");
    expect(formatQuoteDate("2030-01-01")).toBe("01/01/2030");
  });

  it("é curta e neutra: produto, valor, pagamento e validade", () => {
    const message = buildQuoteMessage({
      product,
      finalValue: 150,
      installments: 1,
      paymentMethod: "Pix",
      validUntil: "2026-10-11",
      discount: 0,
    });
    expect(message.split("\n")).toHaveLength(3);
    expect(message).toContain("Consulta de avaliação");
    expect(message).toContain("Forma de pagamento: *Pix* (à vista).");
    expect(message).toContain("Proposta válida até *11/10/2026*.");
    // Nada de frase ou seção própria de um segmento.
    expect(message).not.toMatch(/reservar|Itens inclusos|Brindes|Por conta do cliente/i);
  });

  it("informa o parcelamento quando há parcelas", () => {
    const message = buildQuoteMessage({
      product,
      finalValue: 300,
      installments: 3,
      paymentMethod: "Cartão de crédito",
      validUntil: "2026-10-11",
      discount: 0,
    });
    expect(message).toContain("3x");
    expect(message).toContain("Proposta válida até *11/10/2026*.");
  });
});
