// Ligar/desligar a Vendedora IA: sugestão pendente dela não reaparece ao religar.
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/integrations/supabase/client.server", () => ({ supabaseAdmin: {} }));

import {
  setCompanySalesAgentMaster,
  type SalesAgentMasterWriteClient,
} from "../sales-agent-master.server";

const ENV = { EXTERNAL_SALES_AGENT_COMPANY_IDS: "company-a,company-b" };
const PENDING = "v2_status:pending";
const SUPERSEDED = "v2_status:superseded";

type Suggestion = {
  id: string;
  company_id: string;
  conversation_id: string;
  classification: string;
  was_sent: boolean;
  generated_text: string;
};
type Op = { table: string; values: Record<string, unknown>; filters: Array<[string, unknown]> };

/** Banco em memória com as duas tabelas tocadas pela troca do botão. */
function database(
  options: { failSupersede?: boolean; failSettings?: boolean; throwSupersede?: boolean } = {},
) {
  const settings = [
    {
      company_id: "company-a",
      sales_agent_master_enabled: true,
      sales_agent_v2_enabled: true,
      sales_agent_v2_mode: "assisted",
    },
    {
      company_id: "company-b",
      sales_agent_master_enabled: true,
      sales_agent_v2_enabled: true,
      sales_agent_v2_mode: "automatic",
    },
  ] as Array<Record<string, unknown>>;
  const suggestions: Suggestion[] = [
    {
      id: "s1",
      company_id: "company-a",
      conversation_id: "conv-1",
      classification: PENDING,
      was_sent: false,
      generated_text: "Texto 1",
    },
    {
      id: "s2",
      company_id: "company-a",
      conversation_id: "conv-2",
      classification: PENDING,
      was_sent: false,
      generated_text: "Texto 2",
    },
    {
      id: "s3",
      company_id: "company-a",
      conversation_id: "conv-3",
      classification: "v2_status:approved",
      was_sent: true,
      generated_text: "Texto 3",
    },
    {
      id: "s4",
      company_id: "company-b",
      conversation_id: "conv-9",
      classification: PENDING,
      was_sent: false,
      generated_text: "Texto 4",
    },
  ];
  const ops: Op[] = [];
  const client = {
    from(table: string) {
      return {
        update(values: Record<string, unknown>) {
          const op: Op = { table, values, filters: [] };
          ops.push(op);
          const filter = {
            eq(column: string, value: unknown) {
              op.filters.push([column, value]);
              return filter;
            },
            select: async () => {
              if (table === "ai_suggestions_log" && options.throwSupersede) throw new Error("rede");
              if (table === "ai_suggestions_log" && options.failSupersede)
                return { data: null, error: { message: "x" } };
              if (table === "company_settings" && options.failSettings)
                return { data: null, error: { message: "x" } };
              const rows = (
                table === "company_settings"
                  ? settings
                  : (suggestions as unknown as Array<Record<string, unknown>>)
              ).filter((row) => op.filters.every(([column, value]) => row[column] === value));
              for (const row of rows) Object.assign(row, values);
              return { data: rows.map((row) => ({ ...row })), error: null };
            },
          };
          return filter;
        },
      };
    },
  } as unknown as SalesAgentMasterWriteClient;
  const pending = (companyId: string) =>
    suggestions
      .filter(
        (row) => row.company_id === companyId && row.classification === PENDING && !row.was_sent,
      )
      .map((row) => row.id);
  const master = (companyId: string) =>
    settings.find((row) => row.company_id === companyId)?.sales_agent_master_enabled;
  return { client, ops, suggestions, settings, pending, master };
}

describe("ligar e desligar a Vendedora IA", () => {
  it("desligar tira do cartão as sugestões pendentes da empresa, sem apagar nada", async () => {
    const db = database();
    const before = db.suggestions.length;

    const result = await setCompanySalesAgentMaster(
      { companyId: "company-a", enabled: false },
      db.client,
      ENV,
    );

    expect(result).toEqual({ ok: true, enabled: false, superseded: 2 });
    expect(db.master("company-a")).toBe(false);
    expect(db.pending("company-a")).toEqual([]);
    // Histórico preservado: as linhas continuam lá, com o texto, só com outra marca.
    expect(db.suggestions).toHaveLength(before);
    expect(
      db.suggestions
        .filter((row) => row.classification === SUPERSEDED)
        .map((row) => [row.id, row.generated_text]),
    ).toEqual([
      ["s1", "Texto 1"],
      ["s2", "Texto 2"],
    ]);
    // Sugestão já aprovada/enviada não é tocada.
    expect(db.suggestions.find((row) => row.id === "s3")).toMatchObject({
      classification: "v2_status:approved",
      was_sent: true,
    });
  });

  it("religar não traz de volta sugestão pendente antiga, nem a de um turno que terminou com a Vendedora desligada", async () => {
    const db = database();
    await setCompanySalesAgentMaster({ companyId: "company-a", enabled: false }, db.client, ENV);
    // Turno que já estava em andamento quando desligaram grava a sugestão depois da limpeza.
    db.suggestions.push({
      id: "s5",
      company_id: "company-a",
      conversation_id: "conv-1",
      classification: PENDING,
      was_sent: false,
      generated_text: "Atrasada",
    });
    expect(db.pending("company-a")).toEqual(["s5"]);

    const result = await setCompanySalesAgentMaster(
      { companyId: "company-a", enabled: true },
      db.client,
      ENV,
    );

    expect(result).toEqual({ ok: true, enabled: true, superseded: 1 });
    expect(db.master("company-a")).toBe(true);
    expect(db.pending("company-a")).toEqual([]);
    expect(db.suggestions.find((row) => row.id === "s5")).toMatchObject({
      classification: SUPERSEDED,
      generated_text: "Atrasada",
    });
  });

  it("ao religar, as pendentes saem antes de o botão voltar a valer", async () => {
    const db = database();
    await setCompanySalesAgentMaster({ companyId: "company-a", enabled: true }, db.client, ENV);
    expect(db.ops.map((op) => op.table)).toEqual(["ai_suggestions_log", "company_settings"]);
  });

  it("se a limpeza falhar ao religar, a Vendedora continua desligada", async () => {
    for (const failure of [{ failSupersede: true }, { throwSupersede: true }]) {
      const db = database(failure);
      db.settings[0].sales_agent_master_enabled = false;
      const result = await setCompanySalesAgentMaster(
        { companyId: "company-a", enabled: true },
        db.client,
        ENV,
      );
      expect(result).toEqual({ ok: false, code: "supersede_failed" });
      expect(db.master("company-a")).toBe(false);
      expect(db.ops.some((op) => op.table === "company_settings")).toBe(false);
    }
  });

  it("falha da limpeza ao desligar não impede o desligamento (o religamento limpa de novo)", async () => {
    const db = database({ failSupersede: true });
    const result = await setCompanySalesAgentMaster(
      { companyId: "company-a", enabled: false },
      db.client,
      ENV,
    );
    expect(result).toEqual({ ok: true, enabled: false, superseded: null });
    expect(db.master("company-a")).toBe(false);
  });

  it("isolamento por empresa: toda escrita é filtrada pelo company_id e a outra empresa não muda", async () => {
    const db = database();
    await setCompanySalesAgentMaster({ companyId: "company-a", enabled: false }, db.client, ENV);
    await setCompanySalesAgentMaster({ companyId: "company-a", enabled: true }, db.client, ENV);

    for (const op of db.ops) expect(op.filters).toContainEqual(["company_id", "company-a"]);
    expect(db.pending("company-b")).toEqual(["s4"]);
    expect(db.master("company-b")).toBe(true);
    expect(db.settings[1]).toMatchObject({
      sales_agent_v2_mode: "automatic",
      sales_agent_v2_enabled: true,
    });
  });

  it("só o botão é gravado na configuração: modo e demais colunas ficam como estão", async () => {
    const db = database();
    await setCompanySalesAgentMaster({ companyId: "company-a", enabled: false }, db.client, ENV);
    const writes = db.ops.filter((op) => op.table === "company_settings").map((op) => op.values);
    expect(writes).toEqual([{ sales_agent_master_enabled: false }]);
    expect(db.settings[0]).toMatchObject({
      sales_agent_v2_mode: "assisted",
      sales_agent_v2_enabled: true,
    });
    // Só sugestão pendente e não enviada é marcada.
    const marks = db.ops.filter((op) => op.table === "ai_suggestions_log");
    expect(
      marks.every(
        (op) => JSON.stringify(op.values) === JSON.stringify({ classification: SUPERSEDED }),
      ),
    ).toBe(true);
    for (const op of marks) {
      expect(op.filters).toContainEqual(["classification", PENDING]);
      expect(op.filters).toContainEqual(["was_sent", false]);
    }
  });

  it("empresa que não usa a Vendedora: nada é gravado", async () => {
    const db = database();
    const result = await setCompanySalesAgentMaster(
      { companyId: "company-c", enabled: false },
      db.client,
      ENV,
    );
    expect(result).toEqual({ ok: false, code: "not_eligible" });
    expect(db.ops).toEqual([]);
  });

  it("falha ou ausência da configuração da empresa é informada", async () => {
    const failing = database({ failSettings: true });
    expect(
      await setCompanySalesAgentMaster(
        { companyId: "company-a", enabled: false },
        failing.client,
        ENV,
      ),
    ).toEqual({ ok: false, code: "update_failed" });
    const missing = database();
    missing.settings.splice(0, 1);
    expect(
      await setCompanySalesAgentMaster(
        { companyId: "company-a", enabled: false },
        missing.client,
        ENV,
      ),
    ).toEqual({ ok: false, code: "not_found" });
  });
});

describe("rota do botão mestre da Vendedora", () => {
  const route = readFileSync(
    new URL("../../routes/api.ai.sales-agent-master.tsx", import.meta.url),
    "utf8",
  );

  it("só admin, na empresa do perfil autenticado, e a troca passa pela função que limpa as pendentes", () => {
    const profile = route.indexOf('.from("profiles")');
    const admin = route.indexOf('supabaseAdmin.rpc("has_role"');
    const change = route.indexOf(
      "setCompanySalesAgentMaster({ companyId, enabled: body.enabled })",
    );
    expect(profile).toBeGreaterThan(0);
    expect(admin).toBeGreaterThan(profile);
    expect(change).toBeGreaterThan(admin);
    expect(route).toContain('_role: "admin"');
    expect(route).toContain("if (isAdmin !== true)");
    // A empresa nunca vem do corpo da requisição.
    expect(route).not.toMatch(/body\.company/);
  });

  it("a tela troca o botão pela rota, não por escrita direta na configuração", () => {
    const component = readFileSync(
      new URL("../../components/ai/SalesAgentMasterSwitch.tsx", import.meta.url),
      "utf8",
    );
    expect(component).toContain('fetch("/api/ai/sales-agent-master"');
    expect(component).not.toContain(".update(");
  });

  it("a sugestão que o atendente vê é só a pendente", () => {
    const suggestion = readFileSync(
      new URL("../../routes/api.ai.v2-suggestion.tsx", import.meta.url),
      "utf8",
    );
    expect(suggestion).toContain('.eq("classification", "v2_status:pending")');
  });
});
