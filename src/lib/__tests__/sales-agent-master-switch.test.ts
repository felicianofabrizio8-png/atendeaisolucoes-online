// Botão mestre da Vendedora IA por empresa (company_settings.sales_agent_master_enabled).
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/integrations/supabase/client.server", () => ({ supabaseAdmin: {} }));

import {
  isConversationAutoReply,
  isSalesAgentMasterOff,
  isSalesAgentServingAttendants,
  resolveSalesAgentMode,
  withConversationAutoReply,
} from "../sales-agent-mode";
import { isExternalSalesAgentEligible } from "../external-sales-agent-adapter.server";
import {
  isCompanySalesAgentMasterOff,
  type SalesAgentMasterClient,
} from "../sales-agent-master.server";

const ENV = { EXTERNAL_SALES_AGENT_COMPANY_IDS: "company-a, company-b" };

function client(reply: { data: unknown; error: unknown } | Error) {
  const seen: { table?: string; columns?: string; filter?: [string, string] } = {};
  const fake = {
    from(table: string) {
      seen.table = table;
      return {
        select(columns: string) {
          seen.columns = columns;
          return {
            eq(column: string, value: string) {
              seen.filter = [column, value];
              return {
                maybeSingle: async () => {
                  if (reply instanceof Error) throw reply;
                  return reply;
                },
              };
            },
          };
        },
      };
    },
  } as unknown as SalesAgentMasterClient;
  return { fake, seen };
}

const company = (mode: string, master?: boolean | null) => ({
  sales_agent_v2_enabled: true,
  sales_agent_v2_mode: mode,
  ...(master === undefined ? {} : { sales_agent_master_enabled: master }),
});

describe("botão mestre da Vendedora IA", () => {
  it("só o valor false gravado desliga", () => {
    expect(isSalesAgentMasterOff({ sales_agent_master_enabled: false })).toBe(true);
    expect(isSalesAgentMasterOff({ sales_agent_master_enabled: true })).toBe(false);
    // Coluna ausente (migration pendente), nulo ou sem configuração: comportamento atual.
    expect(isSalesAgentMasterOff({ sales_agent_master_enabled: null })).toBe(false);
    expect(isSalesAgentMasterOff({})).toBe(false);
    expect(isSalesAgentMasterOff(null)).toBe(false);
    expect(isSalesAgentMasterOff(undefined)).toBe(false);
  });

  it("desligado: a empresa fica sem modo da Vendedora, em qualquer modo configurado", () => {
    for (const mode of ["silent", "assisted", "automatic"]) {
      expect(resolveSalesAgentMode(company(mode, false))).toBeNull();
      expect(isSalesAgentServingAttendants(company(mode, false))).toBe(false);
    }
  });

  it("ligado, nulo ou coluna ausente: o modo configurado vale exatamente como antes", () => {
    for (const master of [true, null, undefined]) {
      expect(resolveSalesAgentMode(company("silent", master))).toBe("silent");
      expect(resolveSalesAgentMode(company("assisted", master))).toBe("assisted");
      expect(resolveSalesAgentMode(company("automatic", master))).toBe("automatic");
      expect(isSalesAgentServingAttendants(company("assisted", master))).toBe(true);
    }
    expect(
      resolveSalesAgentMode({ sales_agent_v2_enabled: false, sales_agent_master_enabled: true }),
    ).toBeNull();
  });

  it("desligado: o automático da conversa não vale; religado, volta a valer", () => {
    const off = withConversationAutoReply(company("assisted", false), true);
    expect(off).toEqual(company("assisted", false));
    expect(isConversationAutoReply(off)).toBe(false);

    const on = withConversationAutoReply(company("assisted", true), true);
    expect(resolveSalesAgentMode(on)).toBe("automatic");
    expect(isConversationAutoReply(on)).toBe(true);
  });

  it("a elegibilidade vem só da lista EXTERNAL_SALES_AGENT_COMPANY_IDS", () => {
    expect(isExternalSalesAgentEligible("company-a", ENV)).toBe(true);
    expect(isExternalSalesAgentEligible("company-b", ENV)).toBe(true);
    expect(isExternalSalesAgentEligible("company-c", ENV)).toBe(false);
    expect(isExternalSalesAgentEligible("company-a", {})).toBe(false);
  });

  it("lê a configuração sempre pela empresa informada", async () => {
    const off = client({ data: { sales_agent_master_enabled: false }, error: null });
    expect(await isCompanySalesAgentMasterOff("company-a", off.fake, ENV)).toBe(true);
    expect(off.seen).toEqual({
      table: "company_settings",
      columns: "sales_agent_master_enabled",
      filter: ["company_id", "company-a"],
    });

    const on = client({ data: { sales_agent_master_enabled: true }, error: null });
    expect(await isCompanySalesAgentMasterOff("company-b", on.fake, ENV)).toBe(false);
    expect(on.seen.filter).toEqual(["company_id", "company-b"]);
  });

  it("empresa que não usa a Vendedora nunca conta como desligada, nem consulta o botão", async () => {
    const off = client({ data: { sales_agent_master_enabled: false }, error: null });
    expect(await isCompanySalesAgentMasterOff("company-c", off.fake, ENV)).toBe(false);
    expect(off.seen).toEqual({});
  });

  it("falha de leitura, coluna ausente ou empresa sem configuração valem como ligado", async () => {
    const read = (reply: { data: unknown; error: unknown } | Error) =>
      isCompanySalesAgentMasterOff("company-a", client(reply).fake, ENV);
    expect(await read({ data: null, error: { code: "42703" } })).toBe(false);
    expect(await read({ data: null, error: null })).toBe(false);
    expect(await read(new Error("rede"))).toBe(false);
  });
});

// Mesmo padrão dos testes de rota deste projeto: a guarda é conferida no código-fonte.
const source = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");

describe("o botão mestre no código do servidor", () => {
  it("o tick para antes de lock, envio e qualquer decisão quando a Vendedora está desligada", () => {
    const agent = source("lib/ai-agent.server.ts");
    const tick = agent.slice(agent.indexOf("async function runAgentTickPass"));
    const guard = tick.indexOf("if (isSalesAgentMasterOff(baseCtx.settings))");
    expect(guard).toBeGreaterThan(0);
    expect(guard).toBeLessThan(tick.indexOf(".update({ ai_handling: true })"));
    expect(guard).toBeLessThan(tick.indexOf("shouldAutoReply("));
    expect(guard).toBeLessThan(tick.indexOf("await runAgentTurn({"));
  });

  it("o botão é ignorado para empresa fora da lista ao carregar a configuração do agente", () => {
    const agent = source("lib/ai-agent.server.ts");
    const load = agent.slice(
      agent.indexOf("export async function loadAgentContext"),
      agent.indexOf("export async function runAgentTurn"),
    );
    expect(load).toContain(
      "isSalesAgentMasterOff(agentSettings) && !isExternalSalesAgentEligible(companyId)",
    );
    expect(load).toContain("{ ...agentSettings, sales_agent_master_enabled: true }");
  });

  it("sugestão pendente da Vendedora não aparece nem é aprovada com o botão desligado", () => {
    const route = source("routes/api.ai.v2-suggestion.tsx");
    const active = route.slice(route.indexOf("async function assistedModeIsActive"));
    expect(
      active.indexOf("if (await isCompanySalesAgentMasterOff(companyId)) return false;"),
    ).toBeGreaterThan(0);
    expect(active.indexOf("isCompanySalesAgentMasterOff(companyId)")).toBeLessThan(
      active.indexOf('.from("company_settings")'),
    );
  });

  it("o automático por conversa some com o botão desligado, sem apagar o valor gravado na conversa", () => {
    const route = source("routes/api.ai.agent-takeover.tsx");
    const block = route.slice(route.indexOf('body.action === "auto_reply_status"'));
    const guard = block.indexOf("isCompanySalesAgentMasterOff(profile.company_id)");
    expect(guard).toBeGreaterThan(0);
    expect(guard).toBeLessThan(block.indexOf("available: false, enabled: false"));
    // Nenhuma escrita em sales_agent_auto_reply antes da guarda.
    expect(guard).toBeLessThan(block.indexOf(".update({ sales_agent_auto_reply: enabled }"));
  });

  it("a tela recebe do servidor se a empresa usa a Vendedora", () => {
    expect(source("routes/api.ai.readiness.tsx")).toContain(
      "salesAgentEligible: isExternalSalesAgentEligible(companyId)",
    );
  });

  it("Coach e ferramentas manuais não têm guarda do botão", () => {
    for (const name of [
      "api.coach.suggest",
      "api.coach.analyze",
      "api.ai.suggest",
      "api.ai.suggest-product",
      "api.ai.suggest-reply",
      "api.recovery.assist",
    ]) {
      expect(source(`routes/${name}.tsx`)).not.toMatch(/sales_agent_master|SalesAgentMaster/);
    }
  });

  it("a migration é aditiva e mantém as empresas existentes ligadas", () => {
    const sql = readFileSync(
      new URL(
        "../../../supabase/migrations/20261006120000_company_settings_sales_agent_master_enabled.sql",
        import.meta.url,
      ),
      "utf8",
    );
    expect(sql).toContain(
      "ADD COLUMN IF NOT EXISTS sales_agent_master_enabled boolean NOT NULL DEFAULT true",
    );
    expect(sql).not.toMatch(/\bUPDATE\b|\bDROP\b/);
  });
});
