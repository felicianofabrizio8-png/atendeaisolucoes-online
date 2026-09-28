// `chamar_novamente` sincronizado da Meta como APPROVED precisa ser o template
// escolhido por `followup_resume` — e enviado com o {{1}} preenchido.

/* eslint-disable @typescript-eslint/no-explicit-any */
import { beforeEach, describe, expect, it, vi } from "vitest";

// ---------- Banco falso com upsert/eq/in ----------
const db = vi.hoisted(() => ({
  tables: {} as Record<string, Array<Record<string, any>>>,
  inserted: [] as Array<{ table: string; row: any }>,
}));

vi.mock("@/integrations/supabase/client.server", () => {
  function from(table: string) {
    const eqs: Array<[string, unknown]> = [];
    const ins: Array<[string, unknown[]]> = [];
    let limit = Infinity;
    const rows = () =>
      (db.tables[table] ?? [])
        .filter(
          (r) => eqs.every(([c, v]) => r[c] === v) && ins.every(([c, vs]) => vs.includes(r[c])),
        )
        .slice(0, limit);
    const chain: any = {
      select: () => chain,
      eq: (c: string, v: unknown) => (eqs.push([c, v]), chain),
      in: (c: string, vs: unknown[]) => (ins.push([c, vs]), chain),
      limit: (n: number) => ((limit = n), chain),
      maybeSingle: async () => ({ data: rows()[0] ?? null, error: null }),
      then: (cb: any) => cb({ data: rows(), error: null }),
      insert: async (row: any) => {
        db.inserted.push({ table, row });
        return { error: null };
      },
      update: () => ({ eq: async () => ({ error: null }) }),
      upsert: async (list: any[]) => {
        const t = (db.tables[table] ??= []);
        for (const row of list) {
          const i = t.findIndex(
            (r) =>
              r.company_id === row.company_id && r.name === row.name && r.language === row.language,
          );
          if (i >= 0) t[i] = { ...t[i], ...row };
          else t.push({ id: `tpl-${t.length + 1}`, purpose: null, auto_use: false, ...row });
        }
        return { error: null };
      },
    };
    return chain;
  }
  return { supabaseAdmin: { from } };
});

const postGraph = vi.hoisted(() => vi.fn());
vi.mock("@/lib/outbound/MetaOutbound.server", () => ({ postGraph }));

import {
  findApprovedTemplateForPurpose,
  sendWhatsappTemplate,
  syncTemplatesFromMeta,
} from "@/lib/wa-templates.server";

function metaTemplate(over: Record<string, unknown> = {}) {
  return {
    id: "MT-CN",
    name: "chamar_novamente",
    language: "pt_BR",
    category: "MARKETING",
    status: "APPROVED",
    components: [{ type: "BODY", text: "Oi! {{1}} Estou por aqui para ajudar." }],
    ...over,
  };
}

async function syncFromMeta(templates: unknown[], companyId = "company-a") {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify({ data: templates }), { status: 200 })),
  );
  return syncTemplatesFromMeta(companyId);
}

beforeEach(() => {
  vi.unstubAllGlobals();
  postGraph.mockReset();
  db.inserted = [];
  db.tables = {
    integrations: [
      {
        id: "int-a",
        company_id: "company-a",
        channel: "whatsapp",
        active: true,
        access_token: "TKN",
        external_account_id: "PHONE_ID",
        account_metadata: { waba_id: "WABA-A" },
      },
      {
        id: "int-b",
        company_id: "company-b",
        channel: "whatsapp",
        active: true,
        access_token: "TKN-B",
        external_account_id: "PHONE_B",
        account_metadata: { waba_id: "WABA-B" },
      },
    ],
    leads: [
      {
        id: "lead-1",
        company_id: "company-a",
        phone: "5511999999999",
        external_id: "5511999999999",
        integration_id: "int-a",
        name: "Mariana",
      },
    ],
  };
});

describe("chamar_novamente ↔ followup_resume", () => {
  it("APPROVED/MARKETING sincronizado da Meta é o template de followup_resume", async () => {
    const sync = await syncFromMeta([
      metaTemplate(),
      metaTemplate({ id: "MT-OR", name: "followup_orcamento" }),
    ]);
    expect(sync).toMatchObject({ ok: true, approved: 2 });

    const tpl = await findApprovedTemplateForPurpose("company-a", "followup_resume");
    expect(tpl).toMatchObject({
      name: "chamar_novamente",
      status: "approved",
      category: "marketing",
      variables: ["var1"],
    });
  });

  it("também quando a Meta aprovou como UTILITY", async () => {
    await syncFromMeta([metaTemplate({ category: "UTILITY" })]);
    const tpl = await findApprovedTemplateForPurpose("company-a", "followup_resume");
    expect(tpl).toMatchObject({ name: "chamar_novamente", category: "utility" });
  });

  it.each(["PENDING", "REJECTED", "PAUSED"])("status %s não é selecionado", async (status) => {
    await syncFromMeta([metaTemplate({ status })]);
    expect(await findApprovedTemplateForPurpose("company-a", "followup_resume")).toBeNull();
  });

  it("não usa o template de outra empresa", async () => {
    await syncFromMeta([metaTemplate()], "company-b");
    expect(await findApprovedTemplateForPurpose("company-a", "followup_resume")).toBeNull();
  });

  it("propósitos existentes seguem com a categoria exata de antes", async () => {
    await syncFromMeta([metaTemplate({ name: "followup_orcamento", category: "UTILITY" })]);
    expect(await findApprovedTemplateForPurpose("company-a", "quote_no_reply")).toBeNull();
  });

  it("sendWhatsappTemplate envia chamar_novamente com o {{1}} contextual (UTILITY aceito)", async () => {
    await syncFromMeta([metaTemplate({ category: "UTILITY" })]);
    postGraph.mockResolvedValueOnce({
      success: true,
      simulated: false,
      environment: "production",
      externalRequestSent: true,
      externalId: "wamid.CN",
      status: 200,
      raw: { messages: [{ id: "wamid.CN" }] },
    });

    const out = await sendWhatsappTemplate({
      companyId: "company-a",
      conversationId: "conv-1",
      leadId: "lead-1",
      purpose: "followup_resume",
      variables: { var1: "Conseguiu avaliar o orçamento do ar split?" },
    });

    expect(out).toMatchObject({ ok: true, simulated: false, externalId: "wamid.CN" });
    const payload = postGraph.mock.calls[0][0].logicalPayload;
    expect(payload.template).toEqual({
      name: "chamar_novamente",
      language: { code: "pt_BR" },
      components: [
        {
          type: "body",
          parameters: [{ type: "text", text: "Conseguiu avaliar o orçamento do ar split?" }],
        },
      ],
    });
    const message = db.inserted.find((i) => i.table === "messages")!.row;
    expect(message.text).toBe(
      "Oi! Conseguiu avaliar o orçamento do ar split? Estou por aqui para ajudar.",
    );
  });
});
