// ============================================================================
// Testes puros adicionais — cobrem funções sem I/O e o gate `safety.canSend`
// com o cliente Supabase totalmente mockado.
// Nenhum acesso a rede/banco; nenhum envio real de mensagem.
// ============================================================================

import { describe, it, expect, vi, beforeEach } from "vitest";

import { warmupCapacity } from "@/lib/followup/gates";
import { isWithinBusinessHours } from "@/lib/followup/defaults";
import { DEFAULT_TEMPLATES } from "@/lib/followup/defaults";
import type {
  Candidate,
  FollowupSettings,
} from "@/lib/followup";

// -- Mock do cliente admin usado por safety.ts ------------------------------
// Encadeamento fluente: from().select().eq().maybeSingle() / .order() / .gte().limit()
type QueueEntry = { data: unknown; error: null };
const responseQueue: QueueEntry[] = [];
function pushResponse(data: unknown) {
  responseQueue.push({ data, error: null });
}
function makeThenable(): Promise<QueueEntry> & Record<string, unknown> {
  const next = responseQueue.shift() ?? { data: null, error: null };
  const p: Promise<QueueEntry> & Record<string, unknown> = Promise.resolve(
    next,
  ) as Promise<QueueEntry> & Record<string, unknown>;
  return p;
}
function makeChain(): Record<string, unknown> {
  const chain: Record<string, unknown> = {};
  const passthrough = () => chain;
  for (const m of ["select", "eq", "gte", "lte", "in", "order", "limit"]) {
    chain[m] = passthrough;
  }
  chain.maybeSingle = () => makeThenable();
  // permite `await chain` no final da cadeia (ex.: .limit(1))
  (chain as { then?: unknown }).then = (
    onFulfilled: (v: QueueEntry) => unknown,
  ) => makeThenable().then(onFulfilled);
  return chain;
}
vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: {
    from: vi.fn(() => makeChain()),
  },
}));

// Import DEPOIS do vi.mock para que safety.ts use o stub.
const { canSend } = await import("@/lib/followup/safety");

const baseSettings: FollowupSettings = {
  enabled: true,
  maxPerLead: 3,
  minHoursBetween: 24,
  quoteDelayHours: 24,
  silenceDelayHours: 48,
  visitDelayHours: 24,
  hotDelayHours: 4,
  businessHoursOnly: true,
  businessHoursStart: "09:00:00",
  businessHoursEnd: "18:00:00",
  tone: "amigavel",
  templates: DEFAULT_TEMPLATES,
  initialMessage: null,
  agentName: "Fabrizio",
};
const candidate: Candidate = {
  conversationId: "conv-1",
  leadId: "lead-1",
  rule: "quote_no_reply",
  lastClientMessageAt: null,
  signal: "test",
};

beforeEach(() => {
  responseQueue.length = 0;
});

describe("gates.warmupCapacity", () => {
  const dailyLimit = 100;

  it("sem data de início → 10% (mínimo do warmup)", () => {
    expect(warmupCapacity(null, dailyLimit)).toBe(10);
  });

  it("< 1 dia → 10%", () => {
    const startedAt = new Date(Date.now() - 2 * 3600 * 1000).toISOString();
    expect(warmupCapacity(startedAt, dailyLimit)).toBe(10);
  });

  it("1-2 dias → 25%", () => {
    const startedAt = new Date(Date.now() - 36 * 3600 * 1000).toISOString();
    expect(warmupCapacity(startedAt, dailyLimit)).toBe(25);
  });

  it("3-6 dias → 50%", () => {
    const startedAt = new Date(Date.now() - 4 * 24 * 3600 * 1000).toISOString();
    expect(warmupCapacity(startedAt, dailyLimit)).toBe(50);
  });

  it(">= 7 dias → 100% (limite total)", () => {
    const startedAt = new Date(Date.now() - 8 * 24 * 3600 * 1000).toISOString();
    expect(warmupCapacity(startedAt, dailyLimit)).toBe(dailyLimit);
  });

  it("nunca ultrapassa o dailyLimit", () => {
    const past = new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString();
    for (const limit of [1, 7, 50, 200]) {
      expect(warmupCapacity(past, limit)).toBe(limit);
    }
  });
});

describe("defaults.isWithinBusinessHours (cenários adicionais)", () => {
  const at = (h: number, m = 0) => new Date(2026, 6, 15, h, m, 0);

  it("dentro da janela → true", () => {
    expect(isWithinBusinessHours(baseSettings, at(12, 30))).toBe(true);
    expect(isWithinBusinessHours(baseSettings, at(9, 0))).toBe(true);
    expect(isWithinBusinessHours(baseSettings, at(18, 0))).toBe(true);
  });

  it("fora da janela → false", () => {
    expect(isWithinBusinessHours(baseSettings, at(7))).toBe(false);
    expect(isWithinBusinessHours(baseSettings, at(20))).toBe(false);
    expect(isWithinBusinessHours(baseSettings, at(0))).toBe(false);
  });

  it("businessHoursOnly=false → sempre true", () => {
    const off = { ...baseSettings, businessHoursOnly: false };
    expect(isWithinBusinessHours(off, at(3))).toBe(true);
    expect(isWithinBusinessHours(off, at(23, 59))).toBe(true);
  });
});

describe("safety.canSend", () => {
  it("bloqueia quando humano assumiu a conversa", async () => {
    pushResponse({
      ai_status: "assumido_humano",
      ai_handling: false,
      human_takeover_at: new Date().toISOString(),
      last_message_at: null,
    });
    const r = await canSend("company-1", candidate, baseSettings);
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/humano/i);
  });

  it("bloqueia por mensagem recente do agente (janela de spam 30 min)", async () => {
    // conversa válida
    pushResponse({
      ai_status: null,
      ai_handling: false,
      human_takeover_at: null,
      last_message_at: null,
    });
    // agente enviou algo dentro da janela → array não vazio
    pushResponse([{ id: "msg-recent" }]);
    const r = await canSend("company-1", candidate, baseSettings);
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/recente/i);
  });

  it("permite envio dentro da janela 24h (cliente falou recentemente)", async () => {
    pushResponse({
      ai_status: null,
      ai_handling: false,
      human_takeover_at: null,
      last_message_at: null,
    });
    pushResponse([]); // nenhum agente recente
    pushResponse([]); // nenhum follow-up prévio (attempts=0)
    pushResponse([{ id: "msg-client-recent" }]); // cliente respondeu dentro de 24h
    const r = await canSend("company-1", candidate, baseSettings);
    expect(r.ok).toBe(true);
    expect(r.attempt).toBe(1);
    expect(r.outsideWindow).toBe(false);
  });

  it("sinaliza outsideWindow=true quando cliente ficou > 24h em silêncio", async () => {
    pushResponse({
      ai_status: null,
      ai_handling: false,
      human_takeover_at: null,
      last_message_at: null,
    });
    pushResponse([]);
    pushResponse([]);
    pushResponse([]); // cliente sem mensagem dentro da janela
    const r = await canSend("company-1", candidate, baseSettings);
    expect(r.ok).toBe(true);
    expect(r.outsideWindow).toBe(true);
  });
});
