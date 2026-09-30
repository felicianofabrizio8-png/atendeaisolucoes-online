// Conversa comercial completa pelo tick real (runAgentTick → runAgentTurn →
// SalesAgentCore): descoberta → recomendação → objeção → fechamento, com a
// próxima ação escolhida pelo LLM (simulado), memória do cliente persistida
// entre turnos e o gate aplicando os limites da empresa. Segmento genérico.
/* eslint-disable @typescript-eslint/no-explicit-any */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Call = {
  table: string;
  op: "select" | "update" | "insert" | "upsert";
  columns: string;
  values?: Record<string, unknown>;
  filters: Array<[string, unknown]>;
};

const { from, postGraph, listLearningCandidates, retrieveLearnings, store } = vi.hoisted(() => ({
  from: vi.fn(),
  postGraph: vi.fn(),
  listLearningCandidates: vi.fn(),
  retrieveLearnings: vi.fn(),
  store: {
    calls: [] as unknown[],
    events: [] as Array<Record<string, unknown>>,
    history: [] as Array<Record<string, unknown>>,
    conversation: {} as Record<string, unknown>,
  },
}));

vi.mock("@/integrations/supabase/client.server", () => ({ supabaseAdmin: { from } }));
vi.mock("@/lib/outbound/MetaOutbound.server", () => ({ postGraph }));
vi.mock("../coach-learnings/coach-learnings.repository", () => ({ listLearningCandidates }));
vi.mock("../coach-learnings/retriever", () => ({ retrieveLearnings }));
vi.mock("../sales-agent-config.server", () => ({
  resolveSalesAgentLlmConfig: () => ({
    ok: true,
    config: { endpoint: "https://gateway.test/v1", model: "provider/model", apiKey: "k" },
  }),
}));

import { SALES_TURN_PLAN_EVENT, runAgentTick } from "../ai-agent.server";

const COMPANY = "company-moveis";
const CONV = "44444444-4444-4444-8444-444444444444";
const LEAD = "lead-moveis";

const products = [
  {
    id: "desk-90",
    company_id: COMPANY,
    active: true,
    name: "Mesa Compacta 90",
    category: "Mesas",
    description: "Mesa para home office em espaço reduzido",
    width_m: 0.9,
    price: 890,
    promo_price: null,
    images: [],
    notes: null,
  },
  {
    id: "desk-140",
    company_id: COMPANY,
    active: true,
    name: "Mesa Ampla 140",
    category: "Mesas",
    description: "Mesa para home office com duas telas",
    width_m: 1.4,
    price: 1290,
    promo_price: null,
    images: [],
    notes: null,
  },
];

function builder(table: string) {
  const call: Call = { table, op: "select", columns: "", filters: [] };
  const resolve = () => {
    (store.calls as Call[]).push({ ...call, filters: [...call.filters] });
    return handle(call);
  };
  const chain: any = {
    select: (columns = "*") => (call.op === "select" ? (call.columns = columns) : null, chain),
    update: (values: Record<string, unknown>) => (
      (call.op = "update"),
      (call.values = values),
      chain
    ),
    insert: (values: Record<string, unknown>) => (
      (call.op = "insert"),
      (call.values = values),
      chain
    ),
    upsert: (values: Record<string, unknown>) => (
      (call.op = "upsert"),
      (call.values = values),
      chain
    ),
    eq: (c: string, v: unknown) => (call.filters.push([c, v]), chain),
    gt: (c: string, v: unknown) => (call.filters.push([c, v]), chain),
    gte: (c: string, v: unknown) => (call.filters.push([c, v]), chain),
    in: (c: string, v: unknown) => (call.filters.push([c, v]), chain),
    or: () => chain,
    is: () => chain,
    order: () => chain,
    limit: () => chain,
    maybeSingle: async () => resolve(),
    single: async () => resolve(),
    then: (ok: any, fail?: any) => Promise.resolve(resolve()).then(ok, fail),
  };
  return chain;
}

function handle(call: Call): { data: unknown; error: unknown } {
  const { table, op, columns, values } = call;
  if (table === "ai_flow_events") {
    if (op === "insert") {
      store.events.push(values ?? {});
      return { data: null, error: null };
    }
    // Último sales_turn_plan desta empresa + conversa.
    const scoped = call.filters.some(([c, v]) => c === "company_id" && v === COMPANY);
    const latest = [...store.events].reverse().find((e) => e.event_type === SALES_TURN_PLAN_EVENT);
    return { data: scoped && latest ? { payload: latest.payload } : null, error: null };
  }
  if (op === "insert" || op === "upsert") {
    if (table === "messages") {
      store.history.push({
        role: "agent",
        at: new Date(Date.now() + store.history.length).toISOString(),
        ...values,
      });
    }
    return { data: null, error: null };
  }
  if (table === "conversations") {
    if (op === "update") {
      if (values && "ai_status" in values) store.conversation.ai_status = values.ai_status;
      const isLock = call.filters.some(([c, v]) => c === "ai_handling" && v === false);
      return { data: isLock ? { id: CONV } : null, error: null };
    }
    if (columns.startsWith("ai_status, human_takeover_at")) {
      return { data: { ai_status: null, human_takeover_at: null }, error: null };
    }
    return { data: store.conversation, error: null };
  }
  if (table === "messages") {
    if (columns.startsWith("role, text"))
      return { data: [...store.history].reverse(), error: null };
    return { data: [], error: null };
  }
  if (table === "company_settings") {
    return {
      data: {
        company_id: COMPANY,
        ai_auto_reply_enabled: true,
        ai_after_hours_only: false,
        ai_initial_message: null,
        ai_max_auto_replies: 20,
        ai_handoff_timeout_minutes: 30,
        ai_agent_name: "Bia",
        business_hours_start: "08:00",
        business_hours_end: "18:00",
      },
      error: null,
    };
  }
  if (table === "companies") return { data: { name: "Casa Móveis" }, error: null };
  if (table === "ai_profiles") {
    return {
      data: {
        tone: "próximo",
        description: "Móveis para casa e escritório",
        differentials: "Montagem inclusa",
        faq: [],
      },
      error: null,
    };
  }
  if (table === "integrations") {
    return {
      data: { id: "int-1", access_token: "tenant-token", external_account_id: "PN-1" },
      error: null,
    };
  }
  if (table === "leads") {
    return {
      data: {
        name: "Cliente",
        status: "novo",
        phone: "5541999990000",
        external_id: "5541999990000",
        integration_id: "int-1",
      },
      error: null,
    };
  }
  if (table === "products") return { data: products, error: null };
  if (table === "marketing_knowledge_base") {
    return {
      data: {
        payment_policy: "Pix ou cartão em até 6x.",
        shipping_policy: "Entrega em até 5 dias úteis.",
      },
      error: null,
    };
  }
  if (table === "conversation_sales_states") return { data: null, error: null };
  return { data: [], error: null };
}

/** Uma resposta do LLM por turno (tool call). */
function llmTurn(name: string, args: Record<string, unknown>) {
  return new Response(
    JSON.stringify({
      choices: [
        { message: { tool_calls: [{ function: { name, arguments: JSON.stringify(args) } }] } },
      ],
    }),
  );
}

let llm: ReturnType<typeof vi.fn>;

function customerSays(text: string) {
  store.history.push({
    role: "lead",
    text,
    at: new Date(Date.now() + store.history.length * 1000).toISOString(),
  });
}

function sentTexts(): string[] {
  return postGraph.mock.calls
    .map((args) => JSON.parse((args[0] as { body: string }).body))
    .filter((payload) => payload.type === "text")
    .map((payload) => payload.text.body as string);
}

function systemPromptOfCall(index: number): string {
  return JSON.parse(llm.mock.calls[index][1].body).messages[0].content as string;
}

function plans(): Array<Record<string, unknown>> {
  return store.events
    .filter((e) => e.event_type === SALES_TURN_PLAN_EVENT)
    .map((e) => e.payload as Record<string, unknown>);
}

beforeEach(() => {
  store.calls = [];
  store.events = [];
  store.history = [];
  store.conversation = {
    id: CONV,
    company_id: COMPANY,
    lead_id: LEAD,
    channel: "whatsapp",
    ai_handling: false,
    ai_status: null,
    auto_reply_count: 0,
    last_auto_reply_at: null,
    human_takeover_at: null,
    detected_objections: [],
    lead_score: 0,
    lead_ready_to_close: false,
  };
  from.mockReset();
  from.mockImplementation((table: string) => builder(table));
  postGraph.mockReset();
  postGraph.mockImplementation(async () => ({
    success: true,
    simulated: false,
    environment: "production",
    externalRequestSent: true,
    externalId: `wamid.${postGraph.mock.calls.length}`,
    status: 200,
    raw: {},
  }));
  listLearningCandidates.mockResolvedValue([]);
  retrieveLearnings.mockReturnValue({ selected: [], scored: [], metrics: {} });
  llm = vi.fn();
  vi.stubGlobal("fetch", llm);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("conversa comercial completa conduzida pela Sales Intelligence", () => {
  it("descoberta → recomendação → objeção → fechamento, com memória entre turnos", async () => {
    // Turno 1 — descoberta
    customerSays("Oi, quero montar meu home office");
    llm.mockResolvedValueOnce(
      llmTurn("respond_to_customer", {
        message: "Que legal! Você vai trabalhar com uma tela ou mais de uma?",
        sales_plan: {
          stage: "discovery",
          next_action: "discover_needs",
          customer_context: { needs: ["montar home office"] },
        },
      }),
    );
    expect(await runAgentTick(CONV)).toMatchObject({ action: "replied" });

    // Turno 2 — recomendação (usa a memória do turno 1)
    customerSays("uma tela só, e tenho pouco espaço");
    llm.mockResolvedValueOnce(
      llmTurn("respond_to_customer", {
        message: "Para uma tela em espaço pequeno, a Mesa Compacta 90 atende bem.",
        suggest_products: ["desk-90"],
        sales_plan: {
          stage: "recommendation",
          next_action: "recommend_products",
          customer_context: { preferences: ["uma tela", "pouco espaço"] },
        },
      }),
    );
    expect(await runAgentTick(CONV)).toMatchObject({ action: "replied" });
    const prompt2 = systemPromptOfCall(1);
    expect(prompt2).toContain("montar home office");
    expect(prompt2).toContain("Estágio atual — discovery");

    // Turno 3 — objeção
    customerSays("achei caro");
    llm.mockResolvedValueOnce(
      llmTurn("respond_to_customer", {
        message: "Entendo. O que pesa mais para você nessa escolha: o investimento ou o tamanho?",
        sales_plan: {
          stage: "objection",
          next_action: "handle_objection",
          customer_context: { objections: ["achou caro"] },
        },
      }),
    );
    expect(await runAgentTick(CONV)).toMatchObject({ action: "replied" });
    const prompt3 = systemPromptOfCall(2);
    expect(prompt3).toContain("pouco espaço");
    expect(prompt3).toContain("Estágio atual — recommendation");

    // Turno 4 — sinal de compra: a IA confirma e um atendente conclui.
    customerSays("tá bom, vou querer essa mesa");
    llm.mockResolvedValueOnce(
      llmTurn("respond_to_customer", {
        message: "Ótima escolha! Vou deixar tudo anotado para concluirmos seu pedido.",
        suggest_products: ["desk-90"],
        sales_plan: {
          stage: "closing",
          next_action: "confirm_purchase_intent",
          customer_context: { buying_signals: ["quer a Mesa Compacta 90"] },
        },
      }),
    );
    const closing = await runAgentTick(CONV);
    expect(closing).toMatchObject({ action: "handoff", reason: "ready_to_close_after_reply" });
    const prompt4 = systemPromptOfCall(3);
    expect(prompt4).toContain("achou caro");
    expect(prompt4).toContain("Estágio atual — objection");

    // O que o cliente recebeu, em ordem.
    const texts = sentTexts();
    expect(texts[0]).toContain("uma tela ou mais");
    expect(texts[1]).toContain("Mesa Compacta 90");
    expect(texts[2]).toContain("investimento ou o tamanho");
    expect(texts[3]).toContain("Ótima escolha");
    expect(texts[4]).toMatch(/atendente/);
    expect(store.conversation.ai_status).toBe("aguardando_humano");

    // Próximas ações escolhidas e memória acumulada.
    expect(plans().map((p) => p.next_action)).toEqual([
      "discover_needs",
      "recommend_products",
      "handle_objection",
      "confirm_purchase_intent",
    ]);
    const lastContext = plans().at(-1)?.customer_context as Record<string, unknown>;
    expect(lastContext).toMatchObject({
      stage: "closing",
      needs: ["montar home office"],
      objections: ["achou caro"],
      presentedProductIds: ["desk-90"],
    });
    expect(llm).toHaveBeenCalledTimes(4);
  });

  it("negociação reconhecida pelo LLM vai para humano sem enviar o texto dele", async () => {
    customerSays("se for à vista você faz por menos?");
    llm.mockResolvedValueOnce(
      llmTurn("respond_to_customer", {
        message: "Consigo uma condição especial pra você.",
        sales_plan: { stage: "negotiation", next_action: "handle_objection" },
      }),
    );
    const result = await runAgentTick(CONV);
    expect(result).toMatchObject({ action: "handoff" });
    expect(sentTexts()).not.toContain("Consigo uma condição especial pra você.");
    expect(store.conversation.ai_status).toBe("aguardando_humano");
  });

  it("memória é por empresa: evento de outra empresa não é carregado", async () => {
    store.events.push({
      company_id: "outra-empresa",
      event_type: SALES_TURN_PLAN_EVENT,
      payload: { customer_context: { stage: "closing", needs: ["segredo de outro tenant"] } },
    });
    customerSays("oi");
    llm.mockResolvedValueOnce(
      llmTurn("respond_to_customer", {
        message: "Oi! Me conta o que você procura?",
        sales_plan: { stage: "discovery", next_action: "discover_needs" },
      }),
    );
    await runAgentTick(CONV);
    const loads = (store.calls as Call[]).filter(
      (c) => c.table === "ai_flow_events" && c.op === "select",
    );
    expect(loads.length).toBeGreaterThan(0);
    for (const load of loads) expect(load.filters).toContainEqual(["company_id", COMPANY]);
  });
});
