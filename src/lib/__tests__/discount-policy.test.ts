import { describe, expect, it } from "vitest";
import {
  NO_DISCOUNT_POLICY,
  checkReplyDiscounts,
  discountPolicyPromptSection,
  isDiscountRequest,
  parseDiscountPolicy,
  type DiscountPolicy,
} from "../discount-policy";

const pix: DiscountPolicy = { mode: "authorized", rules: [{ percent: 5, condition: "pagamento à vista no Pix" }] };

describe("parseDiscountPolicy", () => {
  it("sem configuração, ou com valor inválido, não há desconto", () => {
    expect(parseDiscountPolicy(null)).toEqual(NO_DISCOUNT_POLICY);
    expect(parseDiscountPolicy({})).toEqual(NO_DISCOUNT_POLICY);
    expect(parseDiscountPolicy({ ai_discount_mode: "qualquer" })).toEqual(NO_DISCOUNT_POLICY);
  });

  it("autorizado sem regra válida não autoriza nada", () => {
    expect(parseDiscountPolicy({ ai_discount_mode: "authorized", ai_discount_rules: [] })).toEqual(NO_DISCOUNT_POLICY);
    expect(parseDiscountPolicy({
      ai_discount_mode: "authorized",
      ai_discount_rules: [{ percent: 0, condition: "Pix" }, { percent: 150, condition: "Pix" }, { percent: 5, condition: " " }],
    })).toEqual(NO_DISCOUNT_POLICY);
  });

  it("lê as regras cadastradas pelo lojista", () => {
    expect(parseDiscountPolicy({
      ai_discount_mode: "authorized",
      ai_discount_rules: [{ percent: 5, condition: " pagamento à vista no Pix " }],
    })).toEqual(pix);
    expect(parseDiscountPolicy({ ai_discount_mode: "approval_required", ai_discount_rules: [{ percent: 5, condition: "x" }] }))
      .toEqual({ mode: "approval_required", rules: [] });
  });
});

describe("checkReplyDiscounts", () => {
  it("sem política, nenhuma oferta de desconto passa", () => {
    expect(checkReplyDiscounts("No Pix você tem 5% de desconto.", NO_DISCOUNT_POLICY).ok).toBe(false);
    expect(checkReplyDiscounts("Consigo um desconto especial para você.", NO_DISCOUNT_POLICY).ok).toBe(false);
  });

  it("recusar desconto é sempre permitido", () => {
    for (const policy of [NO_DISCOUNT_POLICY, pix, { mode: "approval_required", rules: [] } as DiscountPolicy]) {
      expect(checkReplyDiscounts("Infelizmente não trabalhamos com desconto, mas o valor já inclui a instalação.", policy)).toEqual({ ok: true });
      expect(checkReplyDiscounts("O preço é o cadastrado, sem desconto.", policy)).toEqual({ ok: true });
    }
  });

  it("aceita só o percentual e a condição cadastrados", () => {
    expect(checkReplyDiscounts("No pagamento à vista no Pix você tem 5% de desconto.", pix)).toEqual({ ok: true });
    expect(checkReplyDiscounts("No Pix sai com 5% de desconto.", pix)).toEqual({ ok: true });
    expect(checkReplyDiscounts("Temos desconto no Pix.", pix)).toEqual({ ok: true });
  });

  it("bloqueia percentual acima, condição diferente ou desconto genérico", () => {
    expect(checkReplyDiscounts("No Pix consigo 10% de desconto.", pix)).toEqual({ ok: false, reason: "discount_above_policy" });
    expect(checkReplyDiscounts("No cartão você tem 5% de desconto.", pix)).toEqual({ ok: false, reason: "discount_condition_mismatch" });
    expect(checkReplyDiscounts("Para você faço um desconto especial.", pix)).toEqual({ ok: false, reason: "discount_condition_mismatch" });
    expect(checkReplyDiscounts("Não tem problema, dou 3% de desconto no Pix.", pix).ok).toBe(false);
    // Negação que não rege o desconto não é recusa.
    expect(checkReplyDiscounts("Não tem problema, posso te dar um desconto.", NO_DISCOUNT_POLICY).ok).toBe(false);
    expect(checkReplyDiscounts("Não se preocupe, consigo desconto pra você.", NO_DISCOUNT_POLICY).ok).toBe(false);
  });

  it("frase sem desconto não é avaliada aqui", () => {
    expect(checkReplyDiscounts("A entrada é de 30% e o restante na entrega.", NO_DISCOUNT_POLICY)).toEqual({ ok: true });
  });
});

describe("isDiscountRequest", () => {
  it.each(["Achei caro, tem desconto?", "Dá pra negociar?", "Faz um preço melhor?", "consegue baixar o valor?"])(
    "%j é pedido de desconto",
    (text) => expect(isDiscountRequest(text)).toBe(true),
  );
  it.each(["Quanto custa?", "Aceita Pix?", "Qual o prazo de entrega?"])("%j não é", (text) => {
    expect(isDiscountRequest(text)).toBe(false);
  });
});

describe("discountPolicyPromptSection", () => {
  it("cada modo diz exatamente o que a IA pode fazer", () => {
    expect(discountPolicyPromptSection(NO_DISCOUNT_POLICY)).toContain("a empresa não oferece desconto");
    expect(discountPolicyPromptSection(NO_DISCOUNT_POLICY)).toContain("não é motivo para chamar humano");
    expect(discountPolicyPromptSection(pix)).toContain("- 5% — pagamento à vista no Pix");
    expect(discountPolicyPromptSection({ mode: "approval_required", rules: [] })).toContain("request_human_handoff");
  });
});
