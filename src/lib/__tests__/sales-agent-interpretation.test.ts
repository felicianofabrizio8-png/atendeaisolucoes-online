import { describe, expect, it } from "vitest";
import {
  buildCompactSalesContextSummary,
  interpretStructuredSalesTurn,
} from "../sales-agent-interpretation";

describe("structured sales interpretation", () => {
  it("entende pergunta natural de preco e referencia o produto apresentado", () => {
    const result = interpretStructuredSalesTurn([
      { role: "agent", text: "Te mostrei a Maragogi.", productIds: ["maragogi"] },
      { role: "lead", text: "E qual o preco desse modelo?" },
    ]);

    expect(result).toMatchObject({
      intent: "product_inquiry",
      subject: "price",
      confirmation: "none",
      productReference: { kind: "pronoun", productIds: ["maragogi"] },
    });
    expect(result.confidence).toBeGreaterThan(0.8);
  });

  it.each(["sim", "pode mandar", "beleza, manda"])(
    "trata confirmacao curta como continuidade do produto anterior: %s",
    (text) => {
      const result = interpretStructuredSalesTurn([
        { role: "agent", text: "Posso enviar as fotos?", productIds: ["p-1", "p-2"] },
        { role: "lead", text },
      ]);

      expect(result).toMatchObject({
        intent: "confirmation",
        confirmation: "affirmative",
        productReference: { kind: "pronoun", productIds: ["p-1", "p-2"] },
      });
    },
  );

  it.each(["e o outro?", "tem mais algum modelo?"])(
    "identifica pedido curto de alternativa: %s",
    (text) => {
      expect(interpretStructuredSalesTurn([{ role: "lead", text }])).toMatchObject({
        intent: "continuation",
        productReference: { kind: "continuation" },
      });
    },
  );

  it("mantem confianca baixa quando a mensagem nao permite inferencia", () => {
    const result = interpretStructuredSalesTurn([{ role: "lead", text: "Oi" }]);
    expect(result).toMatchObject({ intent: "unknown", subject: "unknown" });
    expect(result.confidence).toBeLessThan(0.5);
  });

  it("gera resumo compacto sem carregar fatos de produto", () => {
    const interpretation = interpretStructuredSalesTurn([
      { role: "lead", text: "qual o preco desse?", productIds: ["p-1"] },
    ]);
    const summary = buildCompactSalesContextSummary({
      interpretation,
      productIds: ["p-1"],
      lastValidProductIds: ["p-1", "p-2"],
      lastCatalogQueryStatus: "matches",
    });

    expect(summary).toContain("subject=price");
    expect(summary).toContain("state_product_ids=p-1");
    expect(summary).toContain("catalog_status=matches");
    expect(summary).not.toContain("preco");
    expect(summary.length).toBeLessThanOrEqual(800);
  });
});
