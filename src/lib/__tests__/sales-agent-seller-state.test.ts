import { describe, expect, it } from "vitest";
import { collapseImageRuns, sanitizeSellerState } from "../sales-agent-seller-state";

describe("estado comercial da Vendedora entre turnos", () => {
  it("guarda só os campos conhecidos, com tipos e tamanhos limitados", () => {
    const state = sanitizeSellerState({
      stage: "recommendation",
      buyer_stage: "evaluating_terms",
      chosen_product: "p1",
      buying_signals: ["asked_price", "asked_payment", 7],
      customer_topics: ["preço", "  forma   de pagamento "],
      recent_closings: ["x".repeat(500)],
      needs: { goal: "espaço para a família", budget: null },
      turns: 3,
      shown_products: ["p1", "p2"],
      qualquer_coisa: { a: 1 },
    });
    expect(state).toEqual({
      stage: "recommendation",
      buyer_stage: "evaluating_terms",
      chosen_product: "p1",
      buying_signals: ["asked_price", "asked_payment"],
      customer_topics: ["preço", "forma de pagamento"],
      recent_closings: ["x".repeat(200)],
      needs: { goal: "espaço para a família" },
      turns: 3,
    });
  });

  it("estado vazio ou ilegível vira null", () => {
    expect(sanitizeSellerState(null)).toBeNull();
    expect(sanitizeSellerState([])).toBeNull();
    expect(sanitizeSellerState({ shown_products: ["p1"] })).toBeNull();
    expect(sanitizeSellerState({ turns: -1 })).toBeNull();
  });

  it("fotos enviadas em sequência viram uma linha só, com os produtos de todas", () => {
    const history = [
      { role: "lead", text: "Quais opções vocês têm?" },
      { role: "agent", text: "Vou te enviar as fotos." },
      { role: "agent", text: "[imagem: Vestido Azul]", productIds: ["a"] },
      { role: "agent", text: "[imagem: Vestido Verde]", productIds: ["b"] },
      { role: "agent", text: "[imagem: Vestido Azul]", productIds: ["a"] },
      { role: "lead", text: "Gostei do azul" },
      { role: "agent", text: "[imagem: Vestido Azul]", productIds: ["a"] },
    ];
    expect(collapseImageRuns(history)).toEqual([
      { role: "lead", text: "Quais opções vocês têm?" },
      { role: "agent", text: "Vou te enviar as fotos." },
      { role: "agent", text: "[fotos enviadas: Vestido Azul, Vestido Verde]", productIds: ["a", "b"] },
      { role: "lead", text: "Gostei do azul" },
      { role: "agent", text: "[foto enviada: Vestido Azul]", productIds: ["a"] },
    ]);
  });

  it("imagem enviada pelo cliente não é agrupada", () => {
    const history = [{ role: "lead", text: "[imagem: foto do quintal]" }];
    expect(collapseImageRuns(history)).toEqual(history);
  });
});
