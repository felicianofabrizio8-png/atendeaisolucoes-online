import { describe, expect, it } from "vitest";
import { detectHandoffNeeded, runSafetyLayer } from "@/lib/ai-agent.server";
import { detectReadyToClose } from "@/lib/ai-qualifier.server";

describe("Sales Agent handoff boundaries", () => {
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
});
