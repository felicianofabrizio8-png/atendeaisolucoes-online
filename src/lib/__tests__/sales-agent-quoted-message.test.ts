import { describe, expect, it } from "vitest";
import { applyQuotedMessage, quotedExternalId, quotedProductIds, withQuotedContext } from "../sales-agent-quoted-message";

describe("mensagem respondida pelo cliente", () => {
  it("lê o identificador da mensagem citada do payload recebido", () => {
    expect(quotedExternalId({ raw: { context: { id: "wamid.ABC" } } })).toBe("wamid.ABC");
    expect(quotedExternalId({ raw: { text: { body: "oi" } } })).toBeNull();
    expect(quotedExternalId(null)).toBeNull();
    expect(quotedExternalId({ raw: { context: { id: 7 } } })).toBeNull();
  });

  it("liga a pergunta ao produto da foto que o cliente respondeu", () => {
    const quoted = { text: "[imagem: Vestido Longo Azul]", source_metadata: { product_id: "p-azul" } };
    const item = applyQuotedMessage<{ role: string; text: string; productIds?: string[] }>(
      { role: "lead", text: "Qual o valor desse?" },
      quoted,
    );
    expect(item.productIds).toEqual(["p-azul"]);
    expect(item.text).toBe('[O cliente respondeu a esta mensagem: "[imagem: Vestido Longo Azul]"]\nQual o valor desse?');
  });

  it("sem mensagem citada o item não muda", () => {
    const item = { role: "lead", text: "Qual o valor?" };
    expect(applyQuotedMessage(item, null)).toBe(item);
  });

  it("só mensagens do cliente recebem o contexto", () => {
    const item = { role: "agent", text: "Segue a foto." };
    expect(applyQuotedMessage(item, { text: "Olá", source_metadata: {} })).toBe(item);
  });

  it("aceita vários produtos e corta textos longos", () => {
    expect(quotedProductIds({ text: "", source_metadata: { catalog_product_ids: ["a", 2, "b"] } })).toEqual(["a", "b"]);
    const long = "x".repeat(300);
    expect(withQuotedContext("ok", { text: long })).toContain(`${"x".repeat(200)}…`);
    expect(withQuotedContext("ok", { text: "   " })).toBe("ok");
  });
});
