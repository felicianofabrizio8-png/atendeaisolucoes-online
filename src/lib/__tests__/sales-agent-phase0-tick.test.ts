// Vendedora IA · Fase 0 — regressões do tick do agente (runAgentTick).
import { beforeEach, describe, expect, it, vi } from "vitest";

type Filter = [string, string, unknown];
type Call = {
  table: string;
  op: "select" | "update" | "insert" | "upsert";
  columns: string;
  values?: Record<string, unknown>;
  filters: Filter[];
};
type Reply = { data: unknown; error: unknown };

const { from, postGraph, listLearningCandidates, retrieveLearnings, state } = vi.hoisted(() => ({
  from: vi.fn(),
  postGraph: vi.fn(),
  listLearningCandidates: vi.fn(),
  retrieveLearnings: vi.fn(),
  state: { calls: [] as unknown[], handler: (() => ({ data: null, error: null })) as unknown },
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

import { runAgentTick } from "../ai-agent.server";
import { SalesAgentCore, type AgentDecision } from "../sales-agent-core";

const COMPANY = "company-tick";
const CONV = "11111111-1111-4111-8111-111111111111";
const LEAD = "lead-tick";

function builder(table: string) {
  const call: Call = { table, op: "select", columns: "", filters: [] };
  const resolve = (): Reply => {
    (state.calls as Call[]).push({ ...call, filters: [...call.filters] });
    return (state.handler as (c: Call) => Reply)(call);
  };
  const chain: Record<string, unknown> = {};
  const self = () => chain;
  Object.assign(chain, {
    select: (columns = "*") => {
      if (call.op === "select") call.columns = columns;
      return chain;
    },
    update: (values: Record<string, unknown>) => {
      call.op = "update";
      call.values = values;
      return chain;
    },
    insert: (values: Record<string, unknown>) => {
      call.op = "insert";
      call.values = values;
      return chain;
    },
    upsert: (values: Record<string, unknown>) => {
      call.op = "upsert";
      call.values = values;
      return chain;
    },
    eq: (c: string, v: unknown) => (call.filters.push([c, "eq", v]), chain),
    gt: (c: string, v: unknown) => (call.filters.push([c, "gt", v]), chain),
    gte: (c: string, v: unknown) => (call.filters.push([c, "gte", v]), chain),
    in: (c: string, v: unknown) => (call.filters.push([c, "in", v]), chain),
    or: self,
    is: self,
    order: self,
    limit: self,
    maybeSingle: async () => resolve(),
    single: async () => resolve(),
    then: (ok: (value: Reply) => unknown, fail?: (e: unknown) => unknown) =>
      Promise.resolve(resolve()).then(ok, fail),
  });
  return chain;
}

type Scenario = {
  conversation?: Record<string, unknown>;
  settings?: Record<string, unknown>;
  histories?: Array<Array<Record<string, unknown>>>;
  newerLeadMessage?: boolean[];
  recentAutoReplies?: number;
  statusDuringTurn?: string | null;
};

const product = {
  id: "item-1",
  company_id: COMPANY,
  active: true,
  name: "Item Um",
  category: "Linha",
  description: "Item de teste",
  price: 100,
  promo_price: null,
  images: [],
  notes: null,
};

function install(scenario: Scenario) {
  const conversation = {
    id: CONV,
    company_id: COMPANY,
    lead_id: LEAD,
    channel: "whatsapp",
    ai_handling: false,
    ai_status: null,
    auto_reply_count: 0,
    last_auto_reply_at: null,
    human_takeover_at: null,
    detected_city: null,
    detected_state: null,
    detected_pool_size: null,
    detected_intent: null,
    detected_interest: null,
    detected_budget: null,
    purchase_timing: null,
    customer_stage: null,
    lead_temperature: null,
    lead_score: 0,
    lead_ready_to_close: false,
    detected_objections: [],
    ...scenario.conversation,
  };
  const settings = {
    company_id: COMPANY,
    ai_auto_reply_enabled: true,
    ai_after_hours_only: false,
    ai_initial_message: null,
    ai_max_auto_replies: 5,
    ai_handoff_timeout_minutes: 30,
    ai_agent_name: "Atendente",
    business_hours_start: "08:00",
    business_hours_end: "18:00",
    ...scenario.settings,
  };
  const histories = scenario.histories ?? [
    [{ role: "lead", text: "Oi, tem o Item Um?", at: "2026-09-30T12:00:00Z" }],
  ];
  const newer = [...(scenario.newerLeadMessage ?? [])];
  let historyRead = 0;

  state.calls = [];
  state.handler = (call: Call): Reply => {
    const { table, op, columns } = call;
    if (op === "insert" || op === "upsert") return { data: null, error: null };
    if (table === "conversations") {
      if (op === "update") {
        const isLock = call.filters.some(([c, , v]) => c === "ai_handling" && v === false);
        return { data: isLock ? { id: CONV } : null, error: null };
      }
      if (columns.startsWith("ai_status, human_takeover_at")) {
        return {
          data: { ai_status: scenario.statusDuringTurn ?? null, human_takeover_at: null },
          error: null,
        };
      }
      return { data: conversation, error: null };
    }
    if (table === "messages") {
      if (columns.startsWith("role, text")) {
        const rows = histories[Math.min(historyRead, histories.length - 1)];
        historyRead += 1;
        return { data: [...rows].reverse(), error: null };
      }
      if (columns === "id, source_subtype") {
        return {
          data: Array.from({ length: scenario.recentAutoReplies ?? 0 }, (_, i) => ({
            id: `m${i}`,
            source_subtype: null,
          })),
          error: null,
        };
      }
      if (columns === "id") return { data: newer.shift() ? [{ id: "new" }] : [], error: null };
      return { data: [], error: null };
    }
    if (table === "company_settings") return { data: settings, error: null };
    if (table === "companies") return { data: { name: "Empresa Tick" }, error: null };
    if (table === "ai_profiles") {
      return {
        data: {
          tone: "cordial",
          description: null,
          products: null,
          payment_methods: null,
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
      if (op === "update") return { data: null, error: null };
      return {
        data: {
          name: "Cliente",
          status: "novo",
          phone: "5511999990000",
          external_id: "5511999990000",
          integration_id: "int-1",
        },
        error: null,
      };
    }
    if (table === "products") return { data: [product], error: null };
    if (table === "marketing_knowledge_base" || table === "conversation_sales_states") {
      return { data: null, error: null };
    }
    return { data: [], error: null };
  };
}

function calls(): Call[] {
  return state.calls as Call[];
}

function statusUpdates(): unknown[] {
  return calls()
    .filter(
      (c) =>
        c.table === "conversations" && c.op === "update" && c.values && "ai_status" in c.values,
    )
    .map((c) => c.values?.ai_status);
}

function events(): string[] {
  return calls()
    .filter((c) => c.table === "ai_flow_events" && c.op === "insert")
    .map((c) => String(c.values?.event_type));
}

const reply: AgentDecision = {
  kind: "reply",
  message: "Temos sim, o Item Um.",
  suggested_products: ["item-1"],
};
let decideSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.restoreAllMocks();
  from.mockReset();
  from.mockImplementation((table: string) => builder(table));
  postGraph.mockReset();
  postGraph.mockResolvedValue({
    success: true,
    simulated: false,
    environment: "production",
    externalRequestSent: true,
    externalId: "wamid.1",
    status: 200,
    raw: {},
  });
  listLearningCandidates.mockResolvedValue([]);
  retrieveLearnings.mockReturnValue({ selected: [], scored: [], metrics: {} });
  decideSpy = vi.spyOn(SalesAgentCore.prototype, "decide").mockResolvedValue(reply);
});

describe("runAgentTick · Fase 0", () => {
  it("modo silent não altera status da conversa nem do lead em handoff do LLM", async () => {
    install({ settings: { sales_agent_v2_enabled: true, sales_agent_v2_mode: "silent" } });
    decideSpy.mockResolvedValue({ kind: "handoff", reason: "model_requested" });

    const result = await runAgentTick(CONV);

    expect(result).toMatchObject({ ok: true, action: "skipped", reason: "v2_silent" });
    expect(statusUpdates()).toEqual([]);
    expect(calls().some((c) => c.table === "leads" && c.op === "update")).toBe(false);
    expect(
      calls().some(
        (c) =>
          c.table === "conversations" && c.op === "update" && c.values && "lead_score" in c.values,
      ),
    ).toBe(false);
    expect(events()).toContain("sales_agent_silent_qualification");
    expect(postGraph).not.toHaveBeenCalled();
  });

  it("modo silent não encaminha a humano no pré-check de fechamento", async () => {
    install({
      settings: { sales_agent_v2_enabled: true, sales_agent_v2_mode: "silent" },
      histories: [[{ role: "lead", text: "Quero fechar agora", at: "2026-09-30T12:00:00Z" }]],
    });

    const result = await runAgentTick(CONV);

    expect(result).toMatchObject({ action: "skipped", reason: "v2_silent" });
    expect(statusUpdates()).toEqual([]);
    expect(decideSpy).not.toHaveBeenCalled();
  });

  it("fora do silent, handoff continua marcando aguardando_humano", async () => {
    install({});
    decideSpy.mockResolvedValue({ kind: "handoff", reason: "model_requested" });

    const result = await runAgentTick(CONV);

    expect(result).toMatchObject({ action: "handoff" });
    expect(statusUpdates()).toEqual(["aguardando_humano"]);
  });

  it("conversa aguardando_humano não roda LLM nem envia", async () => {
    install({ conversation: { ai_status: "aguardando_humano" } });

    const result = await runAgentTick(CONV);

    expect(result).toMatchObject({ action: "skipped", reason: "human_pending" });
    expect(decideSpy).not.toHaveBeenCalled();
    expect(postGraph).not.toHaveBeenCalled();
  });

  it("gatilho para mensagem já respondida é idempotente", async () => {
    install({
      histories: [
        [
          { role: "lead", text: "Oi", at: "2026-09-30T12:00:00Z" },
          { role: "agent", text: "Olá!", at: "2026-09-30T12:00:10Z" },
        ],
      ],
    });

    const result = await runAgentTick(CONV);

    expect(result).toMatchObject({ action: "skipped", reason: "already_answered" });
    expect(decideSpy).not.toHaveBeenCalled();
  });

  it("mensagem do cliente que chega durante o turno é respondida em seguida", async () => {
    install({
      histories: [
        [{ role: "lead", text: "Tem o Item Um?", at: "2026-09-30T12:00:00Z" }],
        [
          { role: "lead", text: "Tem o Item Um?", at: "2026-09-30T12:00:00Z" },
          { role: "lead", text: "E entrega amanhã?", at: "2026-09-30T12:00:05Z" },
          { role: "agent", text: "Temos sim, o Item Um.", at: "2026-09-30T12:00:08Z" },
        ],
      ],
      newerLeadMessage: [true, false],
    });

    const result = await runAgentTick(CONV);

    expect(result).toMatchObject({ action: "replied" });
    expect(decideSpy).toHaveBeenCalledTimes(2);
    expect(postGraph).toHaveBeenCalledTimes(2);
  });

  it("recuperação de mensagens é limitada", async () => {
    install({ newerLeadMessage: [true, true, true, true, true] });

    await runAgentTick(CONV);

    expect(decideSpy).toHaveBeenCalledTimes(3);
  });

  it("humano que assume durante o turno impede o envio", async () => {
    install({ statusDuringTurn: "assumido_humano" });

    const result = await runAgentTick(CONV);

    expect(result).toMatchObject({ action: "skipped", reason: "human_active" });
    expect(postGraph).not.toHaveBeenCalled();
    expect(statusUpdates()).not.toContain("pre_atendido_ia");
  });

  it("contador vitalício alto não bloqueia; limite vale na janela recente", async () => {
    install({ conversation: { auto_reply_count: 80 }, recentAutoReplies: 1 });
    expect(await runAgentTick(CONV)).toMatchObject({ action: "replied" });

    install({ conversation: { auto_reply_count: 0 }, recentAutoReplies: 5 });
    decideSpy.mockClear();
    expect(await runAgentTick(CONV)).toMatchObject({ action: "skipped", reason: "rate_limit" });
    expect(decideSpy).not.toHaveBeenCalled();
  });

  it("todas as leituras/escritas do tick em conversas e mensagens são filtradas pela empresa", async () => {
    install({});
    await runAgentTick(CONV);
    const scoped = calls().filter(
      (c) =>
        (c.table === "messages" && c.op === "select") ||
        (c.table === "conversations" && c.op === "update"),
    );
    expect(scoped.length).toBeGreaterThan(0);
    for (const call of scoped) {
      expect(call.filters).toContainEqual(["company_id", "eq", COMPANY]);
    }
  });
});
