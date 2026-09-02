import { beforeEach, describe, expect, it, vi } from "vitest";

const { from, fetchMock, listLearningCandidates, retrieveLearnings } = vi.hoisted(() => ({
  from: vi.fn(),
  fetchMock: vi.fn(),
  listLearningCandidates: vi.fn(),
  retrieveLearnings: vi.fn(),
}));

vi.mock("@/integrations/supabase/client.server", () => ({ supabaseAdmin: { from } }));
vi.mock("../coach-learnings/coach-learnings.repository", () => ({ listLearningCandidates }));
vi.mock("../coach-learnings/retriever", () => ({ retrieveLearnings }));
vi.mock("../sales-agent-config.server", () => ({
  resolveSalesAgentLlmConfig: () => ({
    ok: true,
    config: {
      endpoint: "https://gateway.test/v1/chat/completions",
      model: "provider/sales-model",
      apiKey: "test-key",
    },
  }),
}));

import { runAgentTurn } from "../ai-agent.server";
import type { AgentContext } from "../sales-agent-core";

const companyId = "company-1";

const context: AgentContext = {
  settings: {
    company_id: companyId,
    ai_auto_reply_enabled: true,
    ai_after_hours_only: false,
    ai_initial_message: null,
    ai_max_auto_replies: 3,
    ai_handoff_timeout_minutes: 30,
    ai_agent_name: "Ana",
    business_hours_start: "08:00:00",
    business_hours_end: "18:00:00",
  },
  companyName: "Solário Piscinas",
  aiProfile: {
    tone: "consultivo",
    description: "Venda de piscinas",
    products: null,
    payment_methods: "Pix e cartão",
    avg_lead_time: null,
    region: "SP",
    differentials: null,
    faq: [],
  },
  products: [
    {
      id: "product-1",
      name: "Piscina 6x3",
      model: "Modelo 6x3",
      category: "Piscinas de fibra",
      description: "Piscina de fibra",
      price: 20_000,
      promoPrice: null,
      images: [],
      notes: null,
    },
  ],
  knowledge: [],
  grounding: {
    catalog: [
      {
        id: "product-1",
        name: "Piscina 6x3",
        model: "Modelo 6x3",
        category: "Piscinas de fibra",
        description: "Piscina de fibra",
        price: 20_000,
        promoPrice: null,
        images: [],
        notes: null,
      },
    ],
    faqKnowledge: [],
    commercialRules: {
      paymentMethods: null,
      commercialTerms: null,
      paymentPolicy: null,
      installationPolicy: null,
      nextLoadForecast: null,
      visitPolicy: null,
      heatingPolicy: null,
      shippingPolicy: null,
      includedItemsPolicy: null,
    },
    approvedCoachLearnings: [],
  },
};

function query(data: unknown, error: unknown = null) {
  const builder = {
    select: vi.fn(),
    eq: vi.fn(),
    in: vi.fn(),
    order: vi.fn(),
    limit: vi.fn(),
    then: (resolve: (value: { data: unknown; error: unknown }) => unknown) =>
      Promise.resolve(resolve({ data, error })),
  };
  builder.select.mockReturnValue(builder);
  builder.eq.mockReturnValue(builder);
  builder.in.mockReturnValue(builder);
  builder.order.mockReturnValue(builder);
  builder.limit.mockReturnValue(builder);
  return builder;
}

function configureCoachRules(options: {
  rules?: unknown[];
  versions?: unknown[];
  quickReplies?: unknown[];
  error?: unknown;
}) {
  const rulesQuery = query(options.rules ?? [], options.error ?? null);
  const versionsQuery = query(options.versions ?? []);
  const quickRepliesQuery = query(options.quickReplies ?? []);
  from.mockImplementation((table: string) => {
    if (table === "coach_rules") return rulesQuery;
    if (table === "coach_rule_versions") return versionsQuery;
    if (table === "quick_replies") return quickRepliesQuery;
    throw new Error(`unexpected table: ${table}`);
  });
  return { rulesQuery, versionsQuery, quickRepliesQuery };
}

function configureGateway() {
  fetchMock.mockResolvedValue(
    new Response(
      JSON.stringify({
        choices: [
          {
            message: {
              tool_calls: [
                {
                  function: {
                    name: "respond_to_customer",
                    arguments: JSON.stringify({ message: "Posso ajudar com essa informação." }),
                  },
                },
              ],
            },
          },
        ],
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    ),
  );
}

describe("runAgentTurn coach_rules integration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("fetch", fetchMock);
    listLearningCandidates.mockResolvedValue([]);
    retrieveLearnings.mockReturnValue({ selected: [], scored: [], metrics: {} });
    configureGateway();
  });

  it("carrega regras pelo supabaseAdmin com o company_id correto", async () => {
    const { rulesQuery, versionsQuery } = configureCoachRules({
      rules: [
        {
          id: "rule-1",
          company_id: companyId,
          active_version_id: "version-1",
          category: "payments",
          rule_type: "instruction",
          priority: 80,
          scope_kind: "company",
          scope_ref: {},
        },
      ],
      versions: [
        {
          id: "version-1",
          rule_id: "rule-1",
          company_id: companyId,
          version_number: 2,
          status: "approved",
          title: "Pagamento",
          content: "Informe Pix e cartão.",
        },
      ],
    });

    await runAgentTurn({
      ctx: context,
      history: [{ role: "lead", text: "Quais formas de pagamento vocês aceitam?" }],
      leadName: null,
    });

    expect(from).toHaveBeenCalledWith("coach_rules");
    expect(from).toHaveBeenCalledWith("coach_rule_versions");
    expect(rulesQuery.eq).toHaveBeenCalledWith("company_id", companyId);
    expect(versionsQuery.eq).toHaveBeenCalledWith("company_id", companyId);
    expect(versionsQuery.eq).toHaveBeenCalledWith("status", "approved");
  });

  it("coloca quick reply relevante no prompt e preserva company_id", async () => {
    const { quickRepliesQuery } = configureCoachRules({
      quickReplies: [
        {
          name: "Por Conta do Cliente",
          category: "Orçamento",
          content: "Contrapiso, água, energia e materiais.",
          sort_order: 12,
        },
      ],
    });

    await runAgentTurn({
      ctx: context,
      history: [{ role: "lead", text: "O contrapiso fica por conta do cliente?" }],
      leadName: null,
    });

    const request = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(request.messages[0].content).toContain("Contrapiso, água, energia e materiais.");
    expect(quickRepliesQuery.eq).toHaveBeenCalledWith("company_id", companyId);
    expect(quickRepliesQuery.eq).toHaveBeenCalledWith("active", true);
    expect(quickRepliesQuery.limit).toHaveBeenCalledWith(20);
  });

  it("nÃ£o coloca quick reply irrelevante no prompt", async () => {
    configureCoachRules({
      quickReplies: [
        {
          name: "Por Conta do Cliente",
          category: "Orçamento",
          content: "Contrapiso, água e energia.",
          sort_order: 12,
        },
      ],
    });

    await runAgentTurn({
      ctx: context,
      history: [{ role: "lead", text: "Olá, tudo bem?" }],
      leadName: null,
    });

    const request = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(request.messages[0].content).not.toContain("Contrapiso, água e energia.");
  });

  it("continua o turno quando a leitura de quick replies falha", async () => {
    const rulesQuery = query([]);
    const versionsQuery = query([]);
    const quickRepliesQuery = query([], new Error("database unavailable"));
    from.mockImplementation((table: string) => {
      if (table === "coach_rules") return rulesQuery;
      if (table === "coach_rule_versions") return versionsQuery;
      if (table === "quick_replies") return quickRepliesQuery;
      throw new Error(`unexpected table: ${table}`);
    });

    const decision = await runAgentTurn({
      ctx: context,
      history: [{ role: "lead", text: "O contrapiso fica por conta do cliente?" }],
      leadName: null,
    });

    expect(decision.kind).toBe("reply");
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("continua o turno quando a leitura de coach_rules falha", async () => {
    configureCoachRules({ error: new Error("database unavailable") });

    const decision = await runAgentTurn({
      ctx: context,
      history: [{ role: "lead", text: "Quais formas de pagamento vocês aceitam?" }],
      leadName: null,
    });

    expect(decision.kind).toBe("reply");
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("coloca a regra relevante carregada efetivamente no prompt", async () => {
    const { versionsQuery } = configureCoachRules({
      rules: [
        {
          id: "rule-payment",
          company_id: companyId,
          active_version_id: "version-payment",
          category: "payments",
          rule_type: "instruction",
          priority: 80,
          scope_kind: "company",
          scope_ref: {},
        },
      ],
      versions: [
        {
          id: "version-payment",
          rule_id: "rule-payment",
          company_id: companyId,
          version_number: 1,
          status: "approved",
          category: "payments",
          rule_type: "instruction",
          title: "Pagamento",
          content: "Informe Pix e cartão sem negociar desconto.",
        },
      ],
    });

    await runAgentTurn({
      ctx: context,
      history: [{ role: "lead", text: "Quais formas de pagamento vocês aceitam?" }],
      leadName: null,
    });

    expect(from).toHaveBeenCalledWith("coach_rule_versions");
    expect(versionsQuery.in).toHaveBeenCalledWith("id", ["version-payment"]);
    const request = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(request.messages[0].content).toContain("Informe Pix e cartão sem negociar desconto.");
  });

  it("preserva o isolamento quando a empresa não possui regras", async () => {
    const { rulesQuery } = configureCoachRules({ rules: [], versions: [] });

    await runAgentTurn({
      ctx: context,
      history: [{ role: "lead", text: "Quais formas de pagamento vocês aceitam?" }],
      leadName: null,
    });

    expect(rulesQuery.eq).toHaveBeenCalledWith("company_id", companyId);
    const request = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(request.messages[0].content).not.toContain("REGRAS ATIVAS APLICÁVEIS");
  });
});
