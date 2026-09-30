// Consultas comuns de produto em continuação ("quanto tá?", "e a 602?")
// não podem virar catalog_unvalidated_objective_claim. O foco da conversa
// (produtos já apresentados) é resolvido no contexto/catálogo do tenant e
// só fatos validados chegam ao LLM; a validação checa cada afirmação contra
// o produto a que ela se refere. Segmentos genéricos.
import { describe, expect, it, vi } from "vitest";

vi.mock("@/integrations/supabase/client.server", () => ({ supabaseAdmin: { from: vi.fn() } }));
vi.mock("@/lib/outbound/MetaOutbound.server", () => ({ postGraph: vi.fn() }));

import {
  SalesAgentCore,
  buildSalesAgentSystemPrompt,
  type AgentContext,
  type SalesAgentCatalogSearch,
  type SalesAgentCompletion,
  type SalesAgentCoreInput,
} from "../sales-agent-core";
import { searchSalesAgentCatalog } from "../sales-agent-grounding.server";
import { getConversationFocusProductIds, withConversationFocus } from "../sales-agent-focus";

type Product = AgentContext["grounding"]["catalog"][number];

function product(id: string, name: string, price: number, extra: Partial<Product> = {}): Product {
  return {
    id,
    name,
    category: "Linha",
    description: null,
    price,
    promoPrice: null,
    images: [],
    notes: null,
    ...extra,
  };
}

// Catálogo com vários itens que contêm "ta"/"quanto" em textos variados,
// como no mundo real — a busca textual da última mensagem não acha o foco.
const catalog: Product[] = [
  product("l-400", "Linha Alfa 400", 14_900, { description: "Estrutura compacta" }),
  product("l-401", "Linha Alfa 401", 15_900, { description: "Estrutura intermediária" }),
  product("l-402", "Linha Alfa 402", 16_900, { description: "Estrutura ampliada" }),
  product("l-600", "Linha Alfa 600", 21_900, { description: "Tamanho grande" }),
  product("l-601", "Linha Alfa 601", 22_900, { description: "Tamanho grande com banco" }),
  product("l-602", "Linha Alfa 602", 23_900, { description: "Tamanho grande com degrau" }),
  product("x-900", "Kit Acessório Total", 900, { description: "Tampa e acessórios" }),
];
const scope = { companyId: "company-x", activeOnly: true as const };

const ctx: AgentContext = {
  settings: {
    company_id: "company-x",
    ai_auto_reply_enabled: true,
    ai_after_hours_only: false,
    ai_initial_message: null,
    ai_max_auto_replies: 20,
    ai_handoff_timeout_minutes: 30,
    ai_agent_name: "Atendente",
    business_hours_start: "08:00",
    business_hours_end: "18:00",
  },
  companyName: "Empresa X",
  aiProfile: null,
  products: catalog,
  catalogForValidation: catalog,
  knowledge: [],
  grounding: {
    catalog,
    catalogSearch: { status: "matches", products: catalog },
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

function respond(message: string, suggest: string[]) {
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

export async function decideTurn(
  history: SalesAgentCoreInput["history"],
  complete: ReturnType<typeof vi.fn>,
  extra: Partial<SalesAgentCoreInput> = {},
  products: Product[] = catalog,
) {
  // Mesmo pipeline do runtime: busca da última mensagem + foco da conversa.
  const lexical = searchSalesAgentCatalog("company-x", products, history, null, scope, {});
  const byId = new Map(products.map((item) => [item.id, item]));
  const focusProductIds = getConversationFocusProductIds(history).filter((id) => byId.has(id));
  const catalogSearch: SalesAgentCatalogSearch = withConversationFocus(
    lexical,
    focusProductIds.map((id) => byId.get(id)!),
  );
  const context = {
    ...ctx,
    products,
    catalogForValidation: products,
    grounding: { ...ctx.grounding, catalog: products },
  };
  return new SalesAgentCore(complete as unknown as SalesAgentCompletion).decide({
    ctx: { ...context, grounding: { ...context.grounding, catalogSearch } },
    history,
    leadName: null,
    model: "provider/model",
    interpretation,
    catalogSearch,
    priceComparison: { catalog: products },
    focusProductIds,
    ...extra,
  });
}

describe("reprodução: continuação de produto apresentado", () => {
  it("'Quanto tá?' após apresentar três modelos: resposta com os três preços reais", async () => {
    const history: SalesAgentCoreInput["history"] = [
      { role: "lead", text: "quero ver os modelos menores" },
      {
        role: "agent",
        text: "Temos a Linha Alfa 400, a 401 e a 402.",
        productIds: ["l-400", "l-401", "l-402"],
      },
      { role: "lead", text: "Quanto tá?" },
    ];
    const decision = await decideTurn(
      history,
      respond(
        "A Linha Alfa 400 sai por R$ 14.900,00, a Linha Alfa 401 por R$ 15.900,00 e a Linha Alfa 402 por R$ 16.900,00.",
        ["l-400", "l-401", "l-402"],
      ),
    );
    expect(decision.kind).toBe("reply");
    expect(decision.message).toContain("R$ 15.900,00");
  });

  it("'Quanto está saindo a 602?' com o foco em turno anterior", async () => {
    const history: SalesAgentCoreInput["history"] = [
      { role: "lead", text: "quais os modelos grandes?" },
      {
        role: "agent",
        text: "Temos a Linha Alfa 600, 601 e 602.",
        productIds: ["l-600", "l-601", "l-602"],
      },
      { role: "lead", text: "legal" },
      { role: "agent", text: "Quer que eu te conte a diferença entre elas?" },
      { role: "lead", text: "Quanto está saindo a 602?" },
    ];
    const decision = await decideTurn(
      history,
      respond("A Linha Alfa 602 está saindo por R$ 23.900,00.", ["l-602"]),
    );
    expect(decision.kind).toBe("reply");
    expect(decision.message).toContain("R$ 23.900,00");
  });
});

describe("guardrail continua final: afirmação errada por produto é bloqueada", () => {
  const history: SalesAgentCoreInput["history"] = [
    { role: "lead", text: "quero ver os modelos menores" },
    {
      role: "agent",
      text: "Temos a Linha Alfa 400, a 401 e a 402.",
      productIds: ["l-400", "l-401", "l-402"],
    },
    { role: "lead", text: "Quanto tá?" },
  ];

  it("preço trocado entre produtos citados não passa", async () => {
    const decision = await decideTurn(
      history,
      respond("A Linha Alfa 400 sai por R$ 15.900,00 e a Linha Alfa 401 por R$ 14.900,00.", [
        "l-400",
        "l-401",
      ]),
    );
    expect(decision.message ?? "").not.toMatch(/400 sai por R\$ 15\.900/);
  });

  it("preço inventado para um dos produtos não passa", async () => {
    const decision = await decideTurn(
      history,
      respond("A Linha Alfa 400 sai por R$ 14.900,00 e a Linha Alfa 402 por R$ 9.999,00.", [
        "l-400",
        "l-402",
      ]),
    );
    expect(decision.message ?? "").not.toContain("9.999");
  });

  it("apelidos numéricos exclusivos do conjunto ancoram cada preço", async () => {
    const decision = await decideTurn(
      history,
      respond("A 400 fica em R$ 14.900,00; a 401, R$ 15.900,00; e a 402, R$ 16.900,00.", [
        "l-400",
        "l-401",
        "l-402",
      ]),
    );
    expect(decision.kind).toBe("reply");
    expect(decision.message).toContain("R$ 16.900,00");
  });
});

describe("foco da conversa", () => {
  it("entra só quando a busca da última mensagem é fraca", () => {
    const history: SalesAgentCoreInput["history"] = [
      { role: "agent", text: "Temos a 400, 401 e 402.", productIds: ["l-400", "l-401", "l-402"] },
      { role: "lead", text: "Quanto tá?" },
    ];
    const lexical = searchSalesAgentCatalog("company-x", catalog, history, null, scope, {});
    const focused = withConversationFocus(lexical, catalog.slice(0, 3));
    expect(focused.status === "matches" && focused.products.slice(0, 3).map((p) => p.id)).toEqual([
      "l-400",
      "l-401",
      "l-402",
    ]);
    expect(focused.status === "matches" && focused.focusProductIds).toEqual([
      "l-400",
      "l-401",
      "l-402",
    ]);

    const explicit = searchSalesAgentCatalog(
      "company-x",
      catalog,
      [...history.slice(0, 1), { role: "lead", text: "e a Linha Alfa 600?" }],
      null,
      scope,
      {},
    );
    const kept = withConversationFocus(explicit, catalog.slice(0, 3));
    expect(kept.status === "matches" && kept.products.map((p) => p.id)).toEqual(["l-600"]);
  });

  it("usa a última apresentação em qualquer ponto do histórico e, sem ela, a memória", () => {
    expect(
      getConversationFocusProductIds([
        { role: "agent", productIds: ["a"] },
        { role: "lead" },
        { role: "agent" },
        { role: "lead" },
      ]),
    ).toEqual(["a"]);
    expect(getConversationFocusProductIds([{ role: "lead" }], ["m1", "m2"])).toEqual(["m1", "m2"]);
  });

  it("prompt marca os produtos em foco e orienta interpretar pelo histórico", () => {
    const history: SalesAgentCoreInput["history"] = [
      { role: "agent", text: "Temos a 400, 401 e 402.", productIds: ["l-400", "l-401", "l-402"] },
      { role: "lead", text: "Quanto tá?" },
    ];
    const lexical = searchSalesAgentCatalog("company-x", catalog, history, null, scope, {});
    const catalogSearch = withConversationFocus(lexical, catalog.slice(0, 3));
    const prompt = buildSalesAgentSystemPrompt(
      { ...ctx, grounding: { ...ctx.grounding, catalogSearch } },
      history,
    );
    expect(prompt).toContain("Linha Alfa 401 (ID: l-401) [em foco na conversa]");
    expect(prompt).toContain("Preço cadastrado: R$ 15.900,00");
    expect(prompt).toContain("interprete pelo histórico");
  });

  it("continuação sem produto na frase e sem correspondência usa o foco, não esclarecimento", async () => {
    const history: SalesAgentCoreInput["history"] = [
      { role: "agent", text: "Temos a 600 e a 601.", productIds: ["l-600", "l-601"] },
      { role: "lead", text: "tem alguma diferença entre elas?" },
    ];
    const decision = await decideTurn(
      history,
      respond("A Linha Alfa 601 tem banco; a Linha Alfa 600 não.", ["l-600", "l-601"]),
      { focusProductIds: ["l-600", "l-601"] },
    );
    expect(decision.kind).toBe("reply");
  });
});

describe("outro segmento", () => {
  const audio: Product[] = [
    product("f-200", "Fone Orion 200", 349, { description: "Sem fio, cancelamento de ruído" }),
    product("f-300", "Fone Orion 300", 549, { description: "Sem fio, estojo com carga rápida" }),
    product("c-10", "Caixa Nova 10", 799, { description: "Caixa de som portátil" }),
  ];

  it("'e quanto custam?' após apresentar dois fones responde os dois preços reais", async () => {
    const history: SalesAgentCoreInput["history"] = [
      { role: "lead", text: "procuro um fone sem fio" },
      {
        role: "agent",
        text: "Tenho o Fone Orion 200 e o Fone Orion 300.",
        productIds: ["f-200", "f-300"],
      },
      { role: "lead", text: "e quanto custam?" },
    ];
    const decision = await decideTurn(
      history,
      respond("O Fone Orion 200 sai por R$ 349,00 e o Fone Orion 300 por R$ 549,00.", [
        "f-200",
        "f-300",
      ]),
      {},
      audio,
    );
    expect(decision.kind).toBe("reply");
    expect(decision.message).toContain("R$ 549,00");
  });

  it("'o 300 é quanto?' resolve o apelido no foco", async () => {
    const history: SalesAgentCoreInput["history"] = [
      { role: "agent", text: "Tenho o Orion 200 e o Orion 300.", productIds: ["f-200", "f-300"] },
      { role: "lead", text: "o 300 é quanto?" },
    ];
    const decision = await decideTurn(
      history,
      respond("O Fone Orion 300 sai por R$ 549,00.", ["f-300"]),
      {},
      audio,
    );
    expect(decision.kind).toBe("reply");
    expect(decision.message).toContain("R$ 549,00");
  });
});
