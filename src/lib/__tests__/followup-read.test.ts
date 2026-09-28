import { describe, expect, it, vi } from "vitest";

const rows = [
  {
    id: "cycle-a",
    company_id: "company-a",
    conversation_id: "conversation-a",
    reason: "quote_no_reply",
    state: "active",
    attempts: 1,
    max_attempts: 3,
    next_followup_at: "2026-09-27T10:00:00.000Z",
    schedule_source: "engine",
    last_contact_at: "2026-09-26T10:00:00.000Z",
    failures: 0,
    close_reason: null,
    closed_at: null,
  },
  {
    id: "cycle-b",
    company_id: "company-b",
    conversation_id: "conversation-b",
    reason: "lead_silent",
    state: "active",
    attempts: 1,
    max_attempts: 2,
    next_followup_at: "2026-09-30T10:00:00.000Z",
    schedule_source: "engine",
    last_contact_at: "2026-09-27T10:00:00.000Z",
    failures: 0,
    close_reason: null,
    closed_at: null,
  },
];

const queryCalls = { from: 0, eq: [] as Array<[string, string]>, in: 0 };

vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: {
    from: vi.fn(() => {
      queryCalls.from += 1;
      let companyId: string | undefined;
      let conversationIds: readonly string[] | undefined;
      const query: any = {};
      query.select = () => query;
      query.eq = (column: string, value: string) => {
        queryCalls.eq.push([column, value]);
        if (column === "company_id") companyId = value;
        return query;
      };
      query.in = (_column: string, values: readonly string[]) => {
        queryCalls.in += 1;
        conversationIds = values;
        return query;
      };
      query.order = () => query;
      query.then = (resolve: (value: unknown) => unknown) =>
        Promise.resolve({
          data: rows.filter(
            (row) =>
              row.company_id === companyId &&
              (!conversationIds || conversationIds.includes(row.conversation_id)),
          ),
          error: null,
        }).then(resolve);
      return query;
    }),
  },
}));

describe("follow-up atendimento read-model", () => {
  it("classifies active cycles as overdue, upcoming, or none", async () => {
    const { bucketForFollowupCycle } = await import("@/lib/atendimento/followup-view");
    const now = new Date("2026-09-28T10:00:00.000Z");
    expect(bucketForFollowupCycle("active", "2026-09-28T09:59:00.000Z", now)).toBe("overdue");
    expect(bucketForFollowupCycle("active", "2026-09-28T10:01:00.000Z", now)).toBe("upcoming");
    expect(bucketForFollowupCycle("closed", "2026-09-27T10:00:00.000Z", now)).toBe("none");
  });

  it("scopes every result to the authenticated company in one query", async () => {
    const { getAtendimentoFollowupReadModel } = await import("@/lib/atendimento/followup-read.server");
    const result = await getAtendimentoFollowupReadModel("company-a", {
      now: new Date("2026-09-28T10:00:00.000Z"),
    });
    expect(result.map((cycle) => cycle.conversationId)).toEqual(["conversation-a"]);
    expect(queryCalls.from).toBe(1);
    expect(queryCalls.eq).toContainEqual(["company_id", "company-a"]);
    expect(queryCalls.eq).toContainEqual(["state", "active"]);
  });

  it("cannot return another company's cycle even when a foreign conversation is requested", async () => {
    const { getAtendimentoFollowupReadModel } = await import("@/lib/atendimento/followup-read.server");
    const result = await getAtendimentoFollowupReadModel("company-a", {
      conversationIds: ["conversation-b"],
    });
    expect(result).toEqual([]);
    expect(queryCalls.from).toBe(2);
    expect(queryCalls.in).toBe(1);
  });
});
