import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  writes: [] as string[],
  context: true,
  coachRulesFail: false,
  prompt: vi.fn(),
}));

function readOnlyBuilder(table: string) {
  const builder: Record<string, unknown> = {};
  for (const method of ["select", "eq", "in", "is", "order", "limit"])
    builder[method] = vi.fn(() => builder);
  for (const method of ["insert", "update", "upsert", "delete"])
    builder[method] = vi.fn(() => {
      mocks.writes.push(`${method}:${table}`);
      return builder;
    });
  builder.maybeSingle = async () => ({ data: null, error: null });
  return builder;
}

vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: { from: (table: string) => readOnlyBuilder(table) },
}));
vi.mock("@/lib/ai-agent.server", () => ({
  SALES_TURN_PLAN_EVENT: "sales_turn_plan",
  loadAgentContext: async () =>
    mocks.context
      ? {
          settings: { company_id: "company-a", ai_agent_name: "Lia" },
          companyName: "Empresa A",
          aiProfile: null,
          products: [],
          knowledge: [],
          grounding: {
            catalog: [{ id: "p1", name: "Piscina 6m" }],
            commercialRules: { paymentMethods: null },
            approvedCoachLearnings: [],
          },
        }
      : null,
  interpretSalesAgentTurn: (history: unknown[]) => ({ history, structured: {} }),
  resolveSalesAgentCatalogSearch: (turn: { history: Array<{ text: string }> }) =>
    turn.history.at(-1)?.text.includes("piscina")
      ? { status: "matches", products: [{ id: "p1", name: "Piscina 6m" }] }
      : { status: "no_match", products: [] },
}));
vi.mock("@/lib/sales-agent-core", () => ({
  buildSalesAgentSystemPrompt: (...args: unknown[]) => {
    mocks.prompt(...args);
    return "Você é Lia.\nCATÁLOGO\nPiscina 6m\n\nCONTRATO DE AÇÃO:\n1. Sempre retorne via tool call";
  },
}));
vi.mock("@/lib/sales-agent-grounding.server", () => ({
  loadRelevantSalesAgentLearnings: async () => [],
  loadRelevantSalesAgentQuickReplies: async () => [],
  selectRelevantSalesAgentCoachRules: (rules: unknown[]) => rules,
}));
vi.mock("@/lib/coach-rules/coach-rules.repository", () => ({
  listActiveCoachRulesForGrounding: async () => {
    if (mocks.coachRulesFail) throw new Error("db");
    return [];
  },
}));
vi.mock("@/lib/conversation-sales-state.server", () => ({
  loadConversationSalesState: async () => ({ status: "missing", state: null }),
  revalidateConversationSalesState: async () => ({ status: "error", state: null }),
}));
vi.mock("@/lib/sales-agent-normative-resolver", () => ({
  resolveSalesAgentNormativeContext: ({ context }: { context: unknown }) => context,
}));
vi.mock("@/lib/sales-agent-mode", () => ({ resolveSalesAgentMode: () => "assisted" }));
vi.mock("@/lib/sales-agent-seller-state.server", () => ({ loadSellerState: async () => null }));

import {
  buildCopilotSalesIntelligence,
  stripActionContract,
} from "@/lib/atendimento/copilot-sales-intelligence.server";

const params = {
  companyId: "company-a",
  conversationId: "11111111-1111-4111-8111-111111111111",
  history: [{ role: "lead" as const, text: "Oi, tudo bem?" }],
  question: "Tem piscina de 6 metros?",
};

beforeEach(() => {
  vi.clearAllMocks();
  Object.assign(mocks, { writes: [], context: true, coachRulesFail: false });
});

describe("inteligência da Vendedora no copiloto do atendente", () => {
  it("monta o conhecimento da Vendedora sem o contrato de tool call", async () => {
    const text = await buildCopilotSalesIntelligence(params);
    expect(text).toContain("Piscina 6m");
    expect(text).not.toContain("CONTRATO DE AÇÃO");
    expect(text).not.toContain("tool call");
  });

  it("busca no catálogo também pelo que o atendente perguntou", async () => {
    await buildCopilotSalesIntelligence(params);
    const ctx = mocks.prompt.mock.calls[0][0] as {
      grounding: { catalogSearch: { status: string; products: Array<{ id: string }> } };
    };
    expect(ctx.grounding.catalogSearch.status).toBe("matches");
    expect(ctx.grounding.catalogSearch.products.map((p) => p.id)).toEqual(["p1"]);
  });

  it("é somente leitura: nunca grava estado, evento ou mensagem", async () => {
    await buildCopilotSalesIntelligence(params);
    expect(mocks.writes).toEqual([]);
  });

  it("tolera falhas parciais e devolve null sem configuração da empresa", async () => {
    mocks.coachRulesFail = true;
    expect(await buildCopilotSalesIntelligence(params)).toContain("Piscina 6m");
    mocks.context = false;
    expect(await buildCopilotSalesIntelligence(params)).toBeNull();
  });

  it("corta o prompt só no contrato de ação", () => {
    expect(stripActionContract("A\nCONTRATO DE AÇÃO:\nB")).toBe("A");
    expect(stripActionContract("sem contrato")).toBe("sem contrato");
  });
});
