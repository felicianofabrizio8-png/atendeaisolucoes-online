import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  followups: [] as Array<Record<string, unknown>>,
  campaigns: [] as Array<Record<string, unknown>>,
}));

vi.mock("@/integrations/supabase/client.server", () => {
  function from(table: string) {
    const filters: Array<[string, string, unknown]> = [];
    let ordering: { field: string; ascending: boolean } | null = null;
    let take = Infinity;
    const source = () => (table === "follow_ups" ? db.followups : db.campaigns);
    const rows = () => {
      let result = source().filter((row) => filters.every(([op, field, value]) => {
        if (op === "eq") return row[field] === value;
        if (op === "in") return (value as unknown[]).includes(row[field]);
        return Date.parse(String(row[field] ?? "")) >= Date.parse(String(value));
      }));
      if (ordering) {
        const { field, ascending } = ordering;
        result = [...result].sort((a, b) =>
          (Date.parse(String(a[field])) - Date.parse(String(b[field]))) * (ascending ? 1 : -1),
        );
      }
      return result.slice(0, take);
    };
    const chain: any = {
      select: () => chain,
      eq: (field: string, value: unknown) => (filters.push(["eq", field, value]), chain),
      in: (field: string, value: unknown[]) => (filters.push(["in", field, value]), chain),
      gte: (field: string, value: string) => (filters.push(["gte", field, value]), chain),
      order: (field: string, options: { ascending: boolean }) =>
        ((ordering = { field, ascending: options.ascending }), chain),
      limit: (value: number) => ((take = value), chain),
      then: (resolve: (value: unknown) => unknown) => resolve({ data: rows(), error: null }),
    };
    return chain;
  }
  return { supabaseAdmin: { from } };
});

import { findRecentFollowupContact } from "../coordination";

describe("homologação simulada dos três modos", () => {
  beforeEach(() => {
    db.followups = [];
    db.campaigns = [];
    for (const company of ["company-a", "company-b"]) {
      for (let index = 1; index <= 50; index++) {
        const leadId = `${company}-lead-${index}`;
        if (index === 1)
          db.followups.push({ id: `${leadId}-manual`, company_id: company, lead_id: leadId, status: "sent", created_at: new Date().toISOString(), metadata: { manual: true } });
        if (index === 2)
          db.campaigns.push({ id: `${leadId}-bulk`, company_id: company, lead_id: leadId, status: "sent", sent_at: new Date().toISOString() });
        if (index === 3) {
          db.followups.push({ id: `${leadId}-automatic-old`, company_id: company, lead_id: leadId, status: "sent", created_at: new Date(Date.now() - 25 * 3600_000).toISOString(), metadata: {} });
          db.campaigns.push({ id: `${leadId}-bulk-current`, company_id: company, lead_id: leadId, status: "delivered", sent_at: new Date().toISOString() });
        }
        if (index === 4)
          db.followups.push({ id: `${leadId}-automatic-old`, company_id: company, lead_id: leadId, status: "sent", created_at: new Date(Date.now() - 25 * 3600_000).toISOString(), metadata: {} });
      }
    }
  });

  it("cobre 100 clientes, isolamento, simultaneidade e cooldown", async () => {
    const now = new Date();
    const blockedManual = await findRecentFollowupContact({ companyId: "company-a", leadId: "company-a-lead-1", now, cooldownHours: 24 });
    const blockedBulk = await findRecentFollowupContact({ companyId: "company-b", leadId: "company-b-lead-2", now, cooldownHours: 24 });
    const simultaneous = await findRecentFollowupContact({ companyId: "company-a", leadId: "company-a-lead-3", now, cooldownHours: 24 });
    const oldOnly = await findRecentFollowupContact({ companyId: "company-a", leadId: "company-a-lead-4", now, cooldownHours: 24 });
    const isolated = await findRecentFollowupContact({ companyId: "company-a", leadId: "company-b-lead-1", now, cooldownHours: 24 });

    expect(blockedManual?.mode).toBe("manual");
    expect(blockedBulk?.mode).toBe("bulk");
    expect(simultaneous?.mode).toBe("bulk");
    expect(oldOnly).toBeNull();
    expect(isolated).toBeNull();
  });
});
