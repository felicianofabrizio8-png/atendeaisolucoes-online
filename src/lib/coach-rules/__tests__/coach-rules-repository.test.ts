import { beforeEach, describe, expect, it, vi } from "vitest";

const { from } = vi.hoisted(() => ({ from: vi.fn() }));

vi.mock("@/integrations/supabase/client", () => ({ supabase: { from } }));

import { listActiveCoachRulesForGrounding } from "../coach-rules.repository";

function query(data: unknown) {
  const builder = {
    select: vi.fn(),
    eq: vi.fn(),
    order: vi.fn(),
    limit: vi.fn(),
    in: vi.fn(),
    then: (resolve: (value: { data: unknown; error: null }) => unknown) =>
      Promise.resolve(resolve({ data, error: null })),
  };
  builder.select.mockReturnValue(builder);
  builder.eq.mockReturnValue(builder);
  builder.order.mockReturnValue(builder);
  builder.limit.mockReturnValue(builder);
  builder.in.mockReturnValue(builder);
  return builder;
}

describe("listActiveCoachRulesForGrounding", () => {
  beforeEach(() => vi.clearAllMocks());

  it("isola por company_id e limita a quantidade de regras", async () => {
    const rules = query([
      { id: "rule-1", active_version_id: "version-1", category: "payments", priority: 90 },
    ]);
    const versions = query([
      {
        id: "version-1",
        rule_id: "rule-1",
        company_id: "company-1",
        version_number: 2,
        rule_type: "instruction",
        category: "payments",
        title: "Pagamento",
        content: "Informe as formas cadastradas.",
        priority: 90,
        scope_kind: "company",
        scope_ref: {},
        status: "approved",
      },
    ]);
    from.mockImplementation((table: string) => (table === "coach_rules" ? rules : versions));

    await listActiveCoachRulesForGrounding("company-1", 7);

    expect(rules.eq).toHaveBeenCalledWith("company_id", "company-1");
    expect(rules.eq).toHaveBeenCalledWith("status", "active");
    expect(rules.limit).toHaveBeenCalledWith(7);
    expect(versions.eq).toHaveBeenCalledWith("company_id", "company-1");
    expect(versions.in).toHaveBeenCalledWith("id", ["version-1"]);
  });

  it("retorna somente a versão apontada como ativa e seu content", async () => {
    const rules = query([
      { id: "rule-1", active_version_id: "version-2", category: "sales", priority: 80 },
    ]);
    const versions = query([
      {
        id: "version-1",
        rule_id: "rule-1",
        company_id: "company-1",
        version_number: 1,
        rule_type: "instruction",
        category: "sales",
        title: "Antiga",
        content: "Não usar.",
        priority: 80,
        scope_kind: "company",
        scope_ref: {},
        status: "approved",
      },
      {
        id: "version-2",
        rule_id: "rule-1",
        company_id: "company-1",
        version_number: 2,
        rule_type: "instruction",
        category: "sales",
        title: "Atual",
        content: "Use esta orientação.",
        priority: 80,
        scope_kind: "company",
        scope_ref: {},
        status: "approved",
      },
    ]);
    from.mockImplementation((table: string) => (table === "coach_rules" ? rules : versions));

    await expect(listActiveCoachRulesForGrounding("company-1")).resolves.toEqual([
      expect.objectContaining({
        ruleId: "rule-1",
        versionId: "version-2",
        content: "Use esta orientação.",
      }),
    ]);
  });

  it("ignora regra sem active_version_id e versão não ativa", async () => {
    const rules = query([
      { id: "rule-draft", active_version_id: null, category: "sales", priority: 90 },
      { id: "rule-archived", active_version_id: "version-archived", category: "sales", priority: 80 },
    ]);
    const versions = query([
      {
        id: "version-archived",
        rule_id: "rule-archived",
        company_id: "company-1",
        version_number: 1,
        rule_type: "instruction",
        category: "sales",
        title: "Arquivada",
        content: "Não retornar.",
        priority: 80,
        scope_kind: "company",
        scope_ref: {},
        status: "archived",
      },
    ]);
    from.mockImplementation((table: string) => (table === "coach_rules" ? rules : versions));

    await expect(listActiveCoachRulesForGrounding("company-1")).resolves.toEqual([]);
    expect(versions.eq).toHaveBeenCalledWith("status", "approved");
  });
});
