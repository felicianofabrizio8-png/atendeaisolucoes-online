// Vendedora IA · Fase 1 — esclarecimento, políticas institucionais, catálogo.
import { describe, expect, it, vi } from "vitest";

vi.mock("@/integrations/supabase/client.server", () => ({ supabaseAdmin: { from: vi.fn() } }));
vi.mock("@/lib/outbound/MetaOutbound.server", () => ({ postGraph: vi.fn() }));

import {
  NO_MATCH_CLARIFICATION,
  SalesAgentCore,
  buildAmbiguityClarification,
  previousAgentAskedClarification,
  type AgentContext,
  type SalesAgentCatalogSearch,
  type SalesAgentCompletion,
  type SalesAgentCoreInput,
} from "../sales-agent-core";
import {
  buildInstitutionalPolicyReply,
  detectInstitutionalTopics,
  replyNumbersAreGrounded,
  resolveInstitutionalPolicies,
} from "../sales-agent-institutional";
import {
  detectHandoffNeeded,
  resolveHandoffMessage,
  DEFAULT_HANDOFF_MESSAGE,
} from "../ai-agent.server";
import { resolveCatalogProductReferenceWithContext } from "../sales-agent-product-resolution";
import { searchSalesAgentCatalog } from "../sales-agent-grounding.server";
import { AUDIO_UNAVAILABLE_REPLY, classifyLeadAudio } from "../sales-agent-media";

const rules = {
  paymentMethods: null,
  commercialTerms: null,
  paymentPolicy: "Pix, cartão em até 10x sem juros ou boleto.",
  installationPolicy: null,
  nextLoadForecast: null,
  visitPolicy: null,
  heatingPolicy: null,
  shippingPolicy: "Entrega em até 15 dias úteis na região atendida.",
  includedItemsPolicy: null,
};

const alfa = {
  id: "alfa-1",
  name: "Conjunto Alfa",
  category: "Linha",
  description: "Conjunto completo",
  price: 5_000,
  promoPrice: null,
  images: [],
  notes: null,
};
const beta = { ...alfa, id: "beta-1", name: "Conjunto Beta", price: 7_000 };

function ctx(overrides: Partial<AgentContext["grounding"]["commercialRules"]> = {}): AgentContext {
  return {
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
    products: [alfa, beta],
    catalogForValidation: [alfa, beta],
    knowledge: [],
    grounding: {
      catalog: [alfa, beta],
      catalogSearch: { status: "matches", products: [alfa, beta] },
      faqKnowledge: [],
      commercialRules: { ...rules, ...overrides },
      approvedCoachLearnings: [],
    },
  };
}

const interpretation: SalesAgentCoreInput["interpretation"] = {
  intent: null,
  attributes: {},
  references: { lastLeadText: "", productIds: [] },
};

function reply(message: string, suggest: string[] = []) {
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

async function decide(
  complete: ReturnType<typeof vi.fn>,
  history: SalesAgentCoreInput["history"],
  catalogSearch: SalesAgentCatalogSearch,
  context: AgentContext = ctx(),
) {
  return new SalesAgentCore(complete as unknown as SalesAgentCompletion).decide({
    ctx: { ...context, grounding: { ...context.grounding, catalogSearch } },
    history,
    leadName: null,
    model: "provider/model",
    interpretation,
    catalogSearch,
  });
}

describe("esclarecimento em vez de handoff", () => {
  it("ambiguous: pergunta qual das opções reais do catálogo, sem chamar o LLM", async () => {
    const complete = reply("nunca");
    const decision = await decide(complete, [{ role: "lead", text: "Quero o conjunto" }], {
      status: "ambiguous",
      products: [alfa, beta],
    });
    expect(complete).not.toHaveBeenCalled();
    expect(decision).toMatchObject({ kind: "reply", clarification: "ambiguous" });
    expect(decision.message).toBe(buildAmbiguityClarification([alfa, beta]));
    expect(decision.message).toContain("Conjunto Alfa ou Conjunto Beta");
    expect(decision.suggested_products).toEqual(["alfa-1", "beta-1"]);
  });

  it("no_match: pede mais detalhes uma vez", async () => {
    const decision = await decide(
      reply("nunca"),
      [{ role: "lead", text: "Tem o modelo Zeta 900?" }],
      {
        status: "no_match",
        products: [],
      },
    );
    expect(decision).toMatchObject({
      kind: "reply",
      message: NO_MATCH_CLARIFICATION,
      clarification: "no_match",
    });
  });

  it("segundo no_match seguido após esclarecimento vai para humano", async () => {
    const decision = await decide(
      reply("nunca"),
      [
        { role: "lead", text: "Tem o modelo Zeta 900?" },
        { role: "agent", text: NO_MATCH_CLARIFICATION, clarification: "no_match" },
        { role: "lead", text: "O Zeta 900 mesmo" },
      ],
      { status: "no_match", products: [] },
    );
    expect(decision).toMatchObject({ kind: "handoff", reason: "catalog_product_not_found" });
  });

  it("erro de consulta ao catálogo continua indo para humano", async () => {
    const decision = await decide(reply("nunca"), [{ role: "lead", text: "Oi" }], {
      status: "query_error",
    });
    expect(decision).toMatchObject({ kind: "handoff", reason: "catalog_query_error" });
  });

  it("previousAgentAskedClarification olha só a última fala da IA", () => {
    expect(
      previousAgentAskedClarification([
        { role: "agent", clarification: "no_match" },
        { role: "lead" },
      ]),
    ).toBe(true);
    expect(previousAgentAskedClarification([{ role: "agent" }, { role: "lead" }])).toBe(false);
  });
});

describe("perguntas institucionais pelas políticas da empresa", () => {
  it("detecta tópicos genéricos", () => {
    expect(detectInstitutionalTopics("Dá pra parcelar no cartão?")).toContain("payment");
    expect(detectInstitutionalTopics("Qual o prazo de entrega?")).toContain("delivery");
    expect(detectInstitutionalTopics("Bom dia")).toEqual([]);
  });

  it("só responde quando todos os tópicos perguntados têm política cadastrada", () => {
    expect(resolveInstitutionalPolicies("Parcela em quantas vezes?", rules)?.[0]).toMatchObject({
      topic: "payment",
    });
    expect(resolveInstitutionalPolicies("Parcela e instala?", rules)).toBeNull();
    expect(resolveInstitutionalPolicies("Parcela?", { ...rules, paymentPolicy: null })).toBeNull();
  });

  it("desconto, fechamento, crédito/CPF e garantia continuam com humano", () => {
    for (const text of [
      "Parcela com desconto?",
      "Quero fechar e parcelar",
      "Faz análise de crédito no meu CPF para parcelar?",
      "Qual a garantia e forma de pagamento?",
    ]) {
      expect(resolveInstitutionalPolicies(text, rules)).toBeNull();
    }
  });

  it("parcelamento com política cadastrada não dispara handoff de pré-check", () => {
    expect(detectHandoffNeeded("Quero parcelar no cartão", rules)).toEqual({ needed: false });
    expect(
      detectHandoffNeeded("Quero parcelar no cartão", { ...rules, paymentPolicy: null }).needed,
    ).toBe(true);
    expect(detectHandoffNeeded("Quero parcelar com desconto", rules).needed).toBe(true);
    expect(detectHandoffNeeded("Quero parcelar no cartão").needed).toBe(true);
  });

  it("pergunta institucional sem produto correspondente vai ao LLM só com a política", async () => {
    const complete = reply("Aceitamos Pix, cartão em até 10x sem juros ou boleto.");
    const decision = await decide(
      complete,
      [{ role: "lead", text: "Quero saber do parcelamento" }],
      {
        status: "no_match",
        products: [],
      },
    );
    expect(complete).toHaveBeenCalledTimes(1);
    const request = complete.mock.calls[0][0];
    expect(request.messages[1].content).toContain("PERGUNTA INSTITUCIONAL");
    expect(decision).toMatchObject({ kind: "reply" });
    expect(decision.message).toContain("10x");
  });

  it("número fora da política é trocado pelo texto da política", async () => {
    const decision = await decide(
      reply("Parcelamos em até 24x sem juros."),
      [{ role: "lead", text: "Quero saber do parcelamento" }],
      { status: "no_match", products: [] },
    );
    expect(decision.kind).toBe("reply");
    expect(decision.message).not.toContain("24x");
    expect(decision.message).toBe(
      buildInstitutionalPolicyReply(resolveInstitutionalPolicies("parcelamento", rules)!),
    );
  });

  it("falha do provedor em pergunta institucional responde com a política, sem handoff", async () => {
    const complete = vi.fn().mockResolvedValue({ ok: false, reason: "gateway_http_500" });
    const decision = await decide(complete, [{ role: "lead", text: "Como é o frete?" }], {
      status: "matches",
      products: [alfa],
    });
    expect(decision.kind).toBe("reply");
    expect(decision.message).toContain(rules.shippingPolicy);
  });

  it("pergunta mista preço + política: catálogo validado + política no fallback", async () => {
    const decision = await decide(
      reply("O Conjunto Alfa custa R$ 4.000 e o frete é grátis.", ["alfa-1"]),
      [{ role: "lead", text: "Quanto custa o Conjunto Alfa e como é o frete?" }],
      { status: "matches", products: [alfa] },
    );
    expect(decision.kind).toBe("reply");
    expect(decision.message).not.toContain("4.000");
    expect(decision.message).not.toContain("grátis");
    expect(decision.message).toContain(rules.shippingPolicy);
  });

  it("valida números contra políticas e fatos permitidos", () => {
    const policies = resolveInstitutionalPolicies("parcela?", rules)!;
    expect(replyNumbersAreGrounded("Em até 10x sem juros.", policies)).toBe(true);
    expect(replyNumbersAreGrounded("Em até 12x.", policies)).toBe(false);
    expect(replyNumbersAreGrounded("Fica R$ 5.000,00 em até 10x.", policies, ["5000"])).toBe(true);
  });
});

describe("produto existente não reconhecido", () => {
  const presented = {
    ...alfa,
    id: "linha-600",
    name: "Linha Omega 600",
    description: "Com acessório lateral",
  };
  const other = { ...alfa, id: "linha-602", name: "Linha Omega 602", description: "Modelo maior" };

  it("identificador explícito de outro produto vence palavra da descrição do já apresentado", () => {
    const resolved = resolveCatalogProductReferenceWithContext(
      "e a Omega 602 tem acessório lateral?",
      [presented, other],
      [presented],
    );
    expect(resolved.product?.id).toBe("linha-602");
  });

  it("referência ao produto já apresentado continua contextual", () => {
    const resolved = resolveCatalogProductReferenceWithContext(
      "e ela tem acessório lateral?",
      [presented, other],
      [presented],
    );
    expect(resolved.product?.id).toBe("linha-600");
  });

  it("apelido numérico usa marcador do próprio catálogo, não uma linha fixa", () => {
    const scope = { companyId: "company-x", activeOnly: true as const };
    // O modelo completo ("Omega 602 Plus") não aparece na mensagem; só o
    // marcador derivado do catálogo ("omega" + número) identifica o item.
    const catalog = [
      { ...alfa, id: "o-602", name: "Piso Premium", model: "Omega 602 Plus" },
      { ...alfa, id: "o-700", name: "Piso Standard", model: "Omega 700 Plus" },
    ];
    const result = searchSalesAgentCatalog(
      "company-x",
      catalog,
      [{ role: "lead", text: "tem a omega 602?" }],
      null,
      scope,
      { continuityEnabled: true },
    );
    expect(result.status).toBe("matches");
    if (result.status === "matches") expect(result.products.map((p) => p.id)).toEqual(["o-602"]);
  });
});

describe("mensagem de transição e áudio", () => {
  it("usa texto da empresa, padrão neutro quando ausente e desativa com vazio", () => {
    expect(resolveHandoffMessage({ ai_handoff_message: "Já chamo alguém da loja!" })).toBe(
      "Já chamo alguém da loja!",
    );
    expect(resolveHandoffMessage({})).toBe(DEFAULT_HANDOFF_MESSAGE);
    expect(resolveHandoffMessage({ ai_handoff_message: "   " })).toBeNull();
  });

  it("classifica áudio pendente, transcrito e com falha", () => {
    expect(
      classifyLeadAudio({ text: "[áudio]", source_subtype: "audio", source_metadata: {} }),
    ).toBe("pending");
    expect(
      classifyLeadAudio({
        text: "[áudio]",
        source_subtype: "audio",
        source_metadata: { ai_media_error: "x" },
      }),
    ).toBe("failed");
    expect(
      classifyLeadAudio({ text: "quero o conjunto", source_subtype: "audio", source_metadata: {} }),
    ).toBe("transcribed");
    expect(
      classifyLeadAudio({ text: "🎤 Áudio", source_metadata: { ai_media_error: "sem chave" } }),
    ).toBe("failed");
    expect(classifyLeadAudio({ text: "Oi", source_subtype: "text" })).toBe("none");
    expect(AUDIO_UNAVAILABLE_REPLY).not.toMatch(/\d/);
  });
});
