import { describe, expect, it, vi } from "vitest";
import { fetchLeadVisits } from "@/lib/agenda/lead-visits";

function client(rpcResult: { data: unknown; error: unknown }, selectRows: unknown[] = []) {
  const select = vi.fn();
  const builder: Record<string, unknown> = {};
  for (const method of ["select", "eq", "in"]) builder[method] = (...args: unknown[]) => {
    if (method === "select") select(...args);
    return builder;
  };
  builder.then = (resolve: (v: unknown) => unknown) =>
    Promise.resolve({ data: selectRows, error: null }).then(resolve);
  return {
    rpc: vi.fn(async () => rpcResult),
    from: vi.fn(() => builder),
    select,
  };
}

describe("visitas por lead (recuperação)", () => {
  it("usa a função do banco que enxerga visitas de colegas", async () => {
    const db = client({ data: [{ lead_id: "l1", scheduled_at: "2026-10-16", status: "agendada" }], error: null });
    const rows = await fetchLeadVisits(db as never, "c1", ["l1"]);
    expect(rows).toEqual([{ lead_id: "l1", scheduled_at: "2026-10-16", status: "agendada" }]);
    expect(db.rpc).toHaveBeenCalledWith("agenda_lead_visits", { _leads: ["l1"] });
    expect(db.from).not.toHaveBeenCalled();
  });

  it("antes da migração, cai na leitura direta de visits", async () => {
    const db = client(
      { data: null, error: { code: "PGRST202" } },
      [{ lead_id: "l2", scheduled_at: "2026-10-17", status: "confirmada" }],
    );
    const rows = await fetchLeadVisits(db as never, "c1", ["l2"]);
    expect(rows.map((row) => row.lead_id)).toEqual(["l2"]);
    expect(db.from).toHaveBeenCalledWith("visits");
  });

  it("sem leads, não consulta nada", async () => {
    const db = client({ data: [], error: null });
    expect(await fetchLeadVisits(db as never, "c1", [])).toEqual([]);
    expect(db.rpc).not.toHaveBeenCalled();
  });
});
