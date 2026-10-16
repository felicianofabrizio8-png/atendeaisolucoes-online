// src/lib/goals/__tests__/tick.test.ts
import { describe, expect, it, vi } from "vitest";
import { runGoalsTick } from "../tick.server";

function fakeAdmin() {
  const upserts: Array<{ table: string; rows: unknown[] }> = [];
  const deletes: Array<{ table: string; filter: Record<string, unknown> }> = [];
  const goals = [
    {
      id: "g1",
      company_id: "c1",
      name: "Vendas",
      description: null,
      hue: 275,
      measure: "automatica",
      metric: "vendas_fechadas",
      target: 31,
      unit: null,
      lower_is_better: false,
      scope: "empresa",
      starts_on: "2026-10-01",
      ends_on: "2026-10-31",
      recurrence: null,
      stage_id: null,
      archived_at: null,
    },
  ];
  const chain = (table: string) => {
    const filter: Record<string, unknown> = {};
    // Cliente falso encadeável (select/eq/in…), como o do Supabase.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const api: any = {
      select: () => api,
      eq: (k: string, v: unknown) => {
        filter[k] = v;
        return api;
      },
      is: () => api,
      in: () => api,
      then: (resolve: (v: unknown) => void) =>
        resolve({
          data:
            table === "goals"
              ? goals
              : table === "goal_members"
                ? []
                : table === "goal_stages"
                  ? []
                  : table === "profiles"
                    ? [{ id: "u1", display_name: "Ana" }]
                    : [],
          error: null,
        }),
      upsert: (rows: unknown[]) => {
        upserts.push({ table, rows });
        return Promise.resolve({ error: null });
      },
      insert: (rows: unknown[]) => {
        upserts.push({ table, rows });
        return Promise.resolve({ error: null });
      },
      delete: () => ({
        eq: (k: string, v: unknown) => {
          filter[k] = v;
          return {
            eq: (k2: string, v2: unknown) => {
              filter[k2] = v2;
              deletes.push({ table, filter: { ...filter } });
              return Promise.resolve({ error: null });
            },
          };
        },
      }),
    };
    return api;
  };
  const admin = {
    from: chain,
    rpc: vi.fn(async (fn: string) =>
      fn === "goals_roll_periods"
        ? { data: 1, error: null }
        : {
            data: [
              {
                goal_id: "g1",
                period_id: "p1",
                period_start: "2026-10-01",
                period_end: "2026-10-31",
                value: "10",
                weeks: [],
                contributions: [],
              },
            ],
            error: null,
          },
    ),
  };
  return { admin, upserts, deletes };
}

describe("rotina diária de metas", () => {
  it("grava a foto do dia com esperado e selo, e a análise do dia", async () => {
    const { admin, upserts, deletes } = fakeAdmin();
    const analyze = vi.fn().mockResolvedValue({
      resumo: "Tudo no ritmo.",
      atencao: [],
      sugestoes: [],
      dicas: [{ userId: "u1", body: "Continue." }],
    });
    const out = await runGoalsTick(admin as never, { today: "2026-10-10", analyze });
    expect(out).toMatchObject({ companies: 1, snapshots: 1, closed: 1, analyzed: 1, failures: 0 });
    const snap = upserts.find((u) => u.table === "goal_snapshots")!.rows[0];
    expect(snap).toMatchObject({
      goal_id: "g1",
      period_id: "p1",
      day: "2026-10-10",
      value: 10,
      expected: 10,
      status: "no_ritmo",
    });
    expect(deletes).toContainEqual({
      table: "goal_insights",
      filter: { company_id: "c1", generated_on: "2026-10-10" },
    });
    const insights = upserts.find((u) => u.table === "goal_insights")!.rows as Array<{
      kind: string;
    }>;
    expect(insights.map((i) => i.kind)).toEqual(["resumo", "dica"]);
  });
  it("falha da IA numa empresa não derruba a rotina", async () => {
    const { admin } = fakeAdmin();
    const out = await runGoalsTick(admin as never, {
      today: "2026-10-10",
      analyze: vi.fn().mockRejectedValue(new Error("sem chave")),
    });
    expect(out).toMatchObject({ snapshots: 1, analyzed: 0, failures: 1 });
  });
});
