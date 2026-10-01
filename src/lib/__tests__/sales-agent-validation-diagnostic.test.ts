// Instrumentação: quando a validação rejeita a resposta do LLM, a decisão
// registra o texto rejeitado, o check e os fatos de Produtos usados no turno.
// Não muda comportamento — só torna provável a causa de cada rejeição.
import { describe, expect, it, vi } from "vitest";

vi.mock("@/integrations/supabase/client.server", () => ({ supabaseAdmin: { from: vi.fn() } }));
vi.mock("@/lib/outbound/MetaOutbound.server", () => ({ postGraph: vi.fn() }));

import {
  SalesAgentCore,
  type AgentContext,
  type SalesAgentCatalogSearch,
  type SalesAgentCompletion,
} from "../sales-agent-core";

type Product = AgentContext["grounding"]["catalog"][number];

const item: Product = {
  id: "p-1",
  name: "Linha 500",
  category: "Linha",
  description: null,
  price: 15_900,
  promoPrice: 12_900,
  images: [],
  notes: null,
};

async function decide(message: string, suggest: string[] = ["p-1"]) {
  const search: SalesAgentCatalogSearch = { status: "matches", products: [item] };
  const complete = vi.fn().mockResolvedValue({
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
  return new SalesAgentCore(complete as unknown as SalesAgentCompletion).decide({
    ctx: {
      settings: {
        company_id: "c",
        ai_auto_reply_enabled: true,
        ai_after_hours_only: false,
        ai_initial_message: null,
        ai_max_auto_replies: 5,
        ai_handoff_timeout_minutes: 30,
        ai_agent_name: "A",
        business_hours_start: "08:00",
        business_hours_end: "18:00",
      },
      companyName: "X",
      aiProfile: null,
      products: [item],
      catalogForValidation: [item],
      knowledge: [],
      grounding: {
        catalog: [item],
        catalogSearch: search,
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
    },
    history: [{ role: "lead", text: "Quanto ta?" }],
    leadName: null,
    model: "m",
    interpretation: {
      intent: null,
      attributes: {},
      references: { lastLeadText: "", productIds: [] },
    },
    catalogSearch: search,
  });
}

describe("diagnóstico de validação", () => {
  it("rejeição registra texto, check e fatos de Produtos (preço e promocional)", async () => {
    const decision = await decide(
      "A Linha 500 está na promoção por R$ 12.900,00 (de R$ 15.900,00).",
    );
    expect(decision.validation_diagnostic).toMatchObject({
      check: expect.any(String),
      rejected_reply: "A Linha 500 está na promoção por R$ 12.900,00 (de R$ 15.900,00).",
      suggested_product_ids: ["p-1"],
      catalog_basis: "reference",
      validated_products: [{ id: "p-1", name: "Linha 500", price: 15_900, promo_price: 12_900 }],
    });
  });

  it("resposta aceita não carrega diagnóstico", async () => {
    const decision = await decide("A Linha 500 está saindo por R$ 12.900,00.");
    expect(decision.kind).toBe("reply");
    expect(decision.validation_diagnostic).toBeUndefined();
  });
});
