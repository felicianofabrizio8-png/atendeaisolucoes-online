import { describe, it, expect } from "vitest";
import { analyzeDeterministic } from "../DeterministicConversationAnalyzer.server";
import type { ConversationRaw, RawMessage } from "../ConversationIntelligenceTypes";

const OLD = new Date(Date.now() - 30 * 86400_000).toISOString();
const RECENT = new Date(Date.now() - 1 * 86400_000).toISOString();

function mkMsg(i: number, at: string, text = "oi tudo bem"): RawMessage {
  return { id: `m${i}`, role: "lead", at, text, source_subtype: null };
}

function mkRaw(overrides: Partial<ConversationRaw> = {}): ConversationRaw {
  return {
    conversation_id: "c1",
    company_id: "co1",
    channel: "whatsapp",
    lead_id: "l1",
    lead_status: null,
    lead_source: null,
    lead_closed_at: null,
    lead_lost_at: null,
    lead_estimated_value: null,
    quote_count: 0,
    quote_last_sent_at: null,
    follow_up_count: 0,
    messages: [mkMsg(1, OLD)],
    ...overrides,
  };
}

describe("lifecycle abandonment rule (det-v1)", () => {
  it("1: single old message with no quote/followup => in_progress + insufficient warning", () => {
    const r = mkRaw();
    const out = analyzeDeterministic(r, r.messages);
    expect(out.lifecycle_status).toBe("in_progress");
    expect(out.quality_warnings).toContain("insufficient_activity_for_abandonment");
  });

  it("2: two or more old messages, no sale/loss => abandoned", () => {
    const r = mkRaw({ messages: [mkMsg(1, OLD), mkMsg(2, OLD)] });
    const out = analyzeDeterministic(r, r.messages);
    expect(out.lifecycle_status).toBe("abandoned");
    expect(out.quality_warnings).not.toContain("insufficient_activity_for_abandonment");
  });

  it("3: single old message WITH quote => abandoned", () => {
    const r = mkRaw({ quote_count: 1, quote_last_sent_at: OLD });
    const out = analyzeDeterministic(r, r.messages);
    expect(out.lifecycle_status).toBe("abandoned");
  });

  it("4: single old message WITH follow-up => abandoned", () => {
    const r = mkRaw({ follow_up_count: 1 });
    const out = analyzeDeterministic(r, r.messages);
    expect(out.lifecycle_status).toBe("abandoned");
  });

  it("5: recent conversation => in_progress", () => {
    const r = mkRaw({ messages: [mkMsg(1, RECENT)] });
    const out = analyzeDeterministic(r, r.messages);
    expect(out.lifecycle_status).toBe("in_progress");
  });

  it("6: closed lead (old) => sold, never overridden", () => {
    const r = mkRaw({ lead_status: "fechado", lead_closed_at: OLD });
    const out = analyzeDeterministic(r, r.messages);
    expect(out.lifecycle_status).toBe("sold");
    expect(out.sale_detected).toBe(true);
  });

  it("7: lost lead (old) => lost, never overridden", () => {
    const r = mkRaw({ lead_status: "perdido", lead_lost_at: OLD });
    const out = analyzeDeterministic(r, r.messages);
    expect(out.lifecycle_status).toBe("lost");
    expect(out.loss_detected).toBe(true);
  });

  it("8: quote alone never becomes sale", () => {
    const r = mkRaw({ quote_count: 2 });
    const out = analyzeDeterministic(r, r.messages);
    expect(out.quote_detected).toBe(true);
    expect(out.sale_detected).toBe(false);
  });
});
