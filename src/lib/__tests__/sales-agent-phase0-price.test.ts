// Vendedora IA · Fase 0 — preço afirmado sem fonte não pode sair.
import { describe, expect, it, vi } from "vitest";
import {
  SalesAgentCore,
  extractFactualPriceClaims,
  type AgentContext,
  type SalesAgentCoreInput,
} from "../sales-agent-core";

const product = {
  id: "item-alfa",
  name: "Conjunto Alfa",
  category: "Linha principal",
  description: "Conjunto completo",
  price: 5_000,
  promoPrice: 4_500,
  images: [],
  notes: null,
};

const ctx: AgentContext = {
  settings: {
    company_id: "company-x",
    ai_auto_reply_enabled: true,
    ai_after_hours_only: false,
    ai_initial_message: null,
    ai_max_auto_replies: 5,
    ai_handoff_timeout_minutes: 30,
    ai_agent_name: "Atendente",
    business_hours_start: "08:00",
    business_hours_end: "18:00",
  },
  companyName: "Empresa X",
  aiProfile: null,
  products: [product],
  catalogForValidation: [product],
  knowledge: [],
  grounding: {
    catalog: [product],
    catalogSearch: { status: "matches", products: [product] },
    faqKnowledge: [],
    commercialRules: {
      paymentMethods: null,
      commercialTerms: null,
      paymentPolicy: null,
      installationPolicy: null,
      visitPolicy: null,
      heatingPolicy: null,
      shippingPolicy: null,
      includedItemsPolicy: null,
    },
    approvedCoachLearnings: [],
  },
};

const interpretation: SalesAgentCoreInput["interpretation"] = {
  intent: null,
  attributes: {},
  references: { lastLeadText: "", productIds: [] },
};

function completion(message: string, suggest: string[] = [product.id]) {
  return vi.fn().mockResolvedValue({
    ok: true,
    data: {
      choices: [
        {
          message: {
            tool_calls: [
              {
                function: {
                  name: "respond_to_customer",
                  arguments: JSON.stringify({ message, suggest_products: suggest }),
                },
              },
            ],
          },
        },
      ],
    },
  });
}

async function decide(message: string, suggest?: string[]) {
  return new SalesAgentCore(completion(message, suggest)).decide({
    ctx,
    history: [{ role: "lead", text: "Quanto fica?" }],
    leadName: null,
    model: "provider/model",
    interpretation,
    catalogSearch: ctx.grounding.catalogSearch,
  });
}

describe("preço afirmado precisa ter fonte no catálogo", () => {
  it("pergunta no fim da mensagem não isenta preço inventado", async () => {
    const decision = await decide("Fica R$ 9.999,00. Posso reservar para você?");
    expect(decision.message ?? "").not.toContain("9.999");
    expect(decision.fallback_reason ?? decision.reason).toMatch(/catalog_/);
  });

  it("preço sem R$ e sem nome de produto também é validado", async () => {
    const decision = await decide("Custa 7 mil à vista.");
    expect(decision.message ?? "").not.toMatch(/7 mil/);
    expect(decision.fallback_reason).toBe("catalog_unvalidated_price_claim");
  });

  it("preço cadastrado do produto sugerido passa", async () => {
    const decision = await decide("Fica R$ 4.500,00 no promocional. Quer que eu reserve?");
    expect(decision.kind).toBe("reply");
    expect(decision.message).toContain("4.500");
  });

  it("perguntas e hipóteses de valor continuam permitidas", async () => {
    for (const message of ["Seria 20 mil?", "Qual o seu orçamento? Até 3 mil?"]) {
      const decision = await decide(message);
      expect(decision.kind).toBe("reply");
      expect(decision.message).toBe(message);
    }
  });

  it("extrai só preços de frases declarativas", () => {
    expect(extractFactualPriceClaims("Seria 20 mil?")).toEqual([]);
    expect(extractFactualPriceClaims("Vou consultar o valor de 20 mil.")).toEqual([]);
    expect(
      extractFactualPriceClaims("Fica R$ 17.500,00. Posso reservar?").map((c) => c.value),
    ).toEqual([17_500]);
  });

  it("percentual, prazo, parcelas e medida não são tratados como preço", () => {
    for (const message of [
      "O valor da entrada é 50% conforme contrato.",
      "A entrega fica pronta em 15 dias.",
      "O valor pode ser dividido em 10x no cartão.",
      "O preço inclui instalação em até 3 dias úteis.",
      "O produto custa pouco e mede 6 metros.",
      "Fica 2 horas para secar.",
    ]) {
      expect(extractFactualPriceClaims(message)).toEqual([]);
    }
  });

  it("valores monetários explícitos continuam detectados", () => {
    const values = (m: string) => extractFactualPriceClaims(m).map((c) => c.value);
    expect(values("Custa 7 mil à vista.")).toEqual([7_000]);
    expect(values("Sai por 4.500 reais.")).toEqual([4_500]);
    expect(values("O preço é 5.000.")).toEqual([5_000]);
    expect(values("Custa R$ 5.000,00.")).toEqual([5_000]);
    expect(extractFactualPriceClaims("Fica R$ 4.500 no promocional.")[0]?.promo).toBe(true);
  });

  it("frases com percentual ou prazo não disparam fallback de preço", async () => {
    for (const message of [
      "A entrega fica pronta em 15 dias.",
      "O valor da entrada é 50% conforme contrato.",
    ]) {
      const decision = await decide(message);
      expect(decision.fallback_reason).not.toBe("catalog_unvalidated_price_claim");
      expect(decision.reason).not.toBe("catalog_unvalidated_price_claim");
    }
  });
});
