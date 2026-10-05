import { describe, expect, it } from "vitest";
import {
  detectHandoffNeeded,
  interpretSalesAgentTurn,
  redactSalesAgentDecision,
  resolveSalesAgentCatalogSearch,
  runExternalSafetyLayer,
  runSafetyLayer,
} from "@/lib/ai-agent.server";
import { detectReadyToClose } from "@/lib/ai-qualifier.server";

describe("Sales Agent handoff boundaries", () => {
  it("mantém as fronteiras interpretação -> catálogo -> redação sem criar fatos", () => {
    const interpretation = interpretSalesAgentTurn([
      { role: "lead", text: "Quero saber o preço, cor azul" },
    ]);
    const catalogSearch = {
      status: "matches" as const,
      products: [],
    };
    const decision = { kind: "handoff" as const, reason: "catalog_product_not_found" };

    expect(interpretation).toMatchObject({
      intent: "product_inquiry",
      attributes: { variantTerms: ["azul"] },
      references: { lastLeadText: "Quero saber o preço, cor azul", productIds: [] },
    });
    expect(interpretation.history).toHaveLength(1);
    expect(interpretation).not.toHaveProperty("products");
    expect(resolveSalesAgentCatalogSearch(interpretation, {
      grounding: {
        catalog: [],
        catalogScope: { companyId: "company-1", activeOnly: true },
      },
    })).toMatchObject({ status: "empty_catalog", products: [] });
    expect(redactSalesAgentDecision(decision)).toEqual(decision);
    expect(redactSalesAgentDecision(decision)).not.toBe(decision);
  });

  it("não faz handoff para pergunta condicional sobre instalação após fechar hoje", () => {
    expect(detectHandoffNeeded("Se eu fechar hoje, para quando fica a instalação?")).toEqual({
      needed: false,
    });
  });

  it.each(["Quero fechar hoje", "Vamos fechar agora"])(
    "mantém handoff para fechamento imediato explícito: %s",
    (message) => {
      expect(detectHandoffNeeded(message).needed).toBe(true);
    },
  );

  it("reutiliza a detecção existente de intenção clara de fechamento", () => {
    expect(detectReadyToClose("Quero fechar a compra hoje")).toBe(true);
    expect(detectReadyToClose("Se eu fechar hoje, para quando fica a instalação?")).toBe(false);
  });

  it.each([
    "Quando vocês conseguem entregar?",
    "Quando podem instalar?",
    "Quero instalar, mas ainda estou pesquisando",
    "Qual o prazo para a instalação?",
  ])("não trata prazo ou instalação isolados como fechamento: %s", (message) => {
    expect(detectReadyToClose(message)).toBe(false);
  });

  it.each([
    "Vocês parcelam em quantas vezes?",
    "Tem uma opção mais barata?",
    "Qual é o menor preço cadastrado?",
    "Quando vocês entregam e instalam?",
    "Qual é a garantia do produto?",
    "Como faço para finalizar a compra?",
  ])("permite que dados comerciais cadastrados cheguem ao LLM: %s", (message) => {
    expect(detectHandoffNeeded(message)).toEqual({ needed: false });
  });

  it.each([
    "Quero registrar uma reclamação",
    "O produto apresentou um problema",
    "A peça quebrou",
    "O equipamento veio com defeito",
    "Preciso da nota fiscal",
    "Quero revisar o contrato",
    "Tenho uma questão jurídica",
  ])("preserva o handoff obrigatório: %s", (message) => {
    expect(detectHandoffNeeded(message).needed).toBe(true);
  });

  it.each([
    "O preço oficial cadastrado é R$ 20.000,00.",
    "O preço promocional cadastrado é R$ 18.000,00.",
    "O parcelamento cadastrado é em até 10 parcelas no cartão.",
    "As formas de pagamento cadastradas são Pix e cartão.",
  ])("permite informar preço cadastrado sem handoff: %s", (message) => {
    expect(runSafetyLayer({ kind: "reply", message })).toEqual({ kind: "reply", message });
  });

  it.each([
    ["Consigo fazer 10% para você.", "safety_block: tentou aplicar percentual/desconto"],
    ["Posso oferecer desconto.", "safety_block: ofereceu desconto"],
    ["Garanto que vai funcionar.", "safety_block: fez promessa"],
    ["Prometo a entrega.", "safety_block: fez promessa"],
    ["Fecho a venda agora.", "safety_block: tentou fechar venda"],
    ["Tenho uma condição especial.", "safety_block: condição comercial nova"],
  ])("preserva os demais bloqueios do safety: %s", (message, reason) => {
    expect(runSafetyLayer({ kind: "reply", message })).toMatchObject({
      kind: "handoff",
      reason,
    });
  });

  // Vendedora externa: a evidência é o que a empresa cadastrou (qualquer fonte enviada a ela).
  describe("safety da Vendedora externa pelos dados cadastrados da empresa", () => {
    const evidence = [
      "Formas de pagamento: 50% na assinatura e 50% na chegada. Até 12x no cartão.",
      "Garantia: 2 anos contra defeito de fabricação.",
      "Desconto: 5% para pagamento à vista no Pix.",
    ].join("\n");

    it.each([
      "A entrada é de 50% na assinatura.",
      "No Pix à vista você tem 5% de desconto.",
      "A garantia é de 2 anos contra defeito de fabricação.",
    ])("aceita o que a empresa cadastrou: %s", (message) => {
      expect(runExternalSafetyLayer({ kind: "reply", message }, evidence)).toEqual({ kind: "reply", message, external_validated: true });
    });

    it.each([
      ["Consigo 10% de desconto para você.", "safety_block: percentual sem cadastro da empresa"],
      ["Garanto que chega amanhã.", "safety_block: fez promessa"],
      ["Tenho uma condição especial.", "safety_block: condição comercial nova"],
    ])("continua bloqueando o que não tem cadastro: %s", (message, reason) => {
      expect(runExternalSafetyLayer({ kind: "reply", message }, evidence)).toMatchObject({ kind: "handoff", reason });
    });

    it("sem cadastro sobre desconto, falar em desconto continua indo para humano", () => {
      expect(runExternalSafetyLayer({ kind: "reply", message: "Posso oferecer desconto." }, "Garantia: 2 anos."))
        .toMatchObject({ kind: "handoff", reason: "safety_block: ofereceu desconto" });
    });

    it("o dado de uma empresa não libera a resposta de outra", () => {
      const message = "A entrada é de 50% na assinatura.";
      expect(runExternalSafetyLayer({ kind: "reply", message }, "Pagamento: 30% de entrada.")).toMatchObject({ kind: "handoff" });
    });

    it("a decisão já validada não passa de novo pela lista fixa", () => {
      const validated = runExternalSafetyLayer({ kind: "reply", message: "No Pix à vista você tem 5% de desconto." }, evidence);
      expect(runSafetyLayer(validated)).toEqual(validated);
    });
  });

  it("permite percentual cadastrado nos termos comerciais", () => {
    expect(
      runSafetyLayer(
        { kind: "reply", message: "A entrada é de 50%." },
        "Entrada de 50% e saldo na entrega.",
      ),
    ).toEqual({ kind: "reply", message: "A entrada é de 50%." });
  });

  it("bloqueia percentual não cadastrado", () => {
    expect(
      runSafetyLayer({ kind: "reply", message: "A entrada é de 30%." }, "Entrada de 50%."),
    ).toMatchObject({
      kind: "handoff",
      reason: "safety_block: tentou aplicar percentual/desconto",
    });
  });

  it("bloqueia desconto mesmo quando o percentual está cadastrado", () => {
    expect(
      runSafetyLayer(
        { kind: "reply", message: "Posso oferecer 10% de desconto." },
        "Desconto cadastrado de 10%.",
      ),
    ).toMatchObject({ kind: "handoff", reason: "safety_block: ofereceu desconto" });
  });

  it("bloqueia negociacao na resposta comercial do agente", () => {
    expect(
      runSafetyLayer({ kind: "reply", message: "Podemos negociar essa condicao." }),
    ).toMatchObject({ kind: "handoff", reason: "safety_block: tentou negociar" });
  });

});
