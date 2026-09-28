/* eslint-disable @typescript-eslint/no-explicit-any */
import { beforeEach, describe, expect, it, vi } from "vitest";

// ---------- Banco falso: filtros eq/in, order e limit como o PostgREST ----------
const db = vi.hoisted(() => ({
  tables: {} as Record<string, Array<Record<string, any>>>,
  inserted: [] as Array<{ table: string; row: any }>,
}));

vi.mock("@/integrations/supabase/client.server", () => {
  function from(table: string) {
    const eqs: Array<[string, unknown]> = [];
    const ins: Array<[string, unknown[]]> = [];
    const gtes: Array<[string, string]> = [];
    let order: { col: string; asc: boolean } | null = null;
    let limit = Infinity;
    const rows = () => {
      let out = (db.tables[table] ?? []).filter(
        (r) =>
          eqs.every(([c, v]) => r[c] === v) &&
          ins.every(([c, vs]) => vs.includes(r[c])) &&
          gtes.every(([c, v]) => Date.parse(r[c]) >= Date.parse(v)),
      );
      if (order) {
        const { col, asc } = order;
        out = [...out].sort(
          (a, b) => String(a[col]).localeCompare(String(b[col])) * (asc ? 1 : -1),
        );
      }
      return out.slice(0, limit);
    };
    const chain: any = {
      select: () => chain,
      eq: (c: string, v: unknown) => (eqs.push([c, v]), chain),
      in: (c: string, vs: unknown[]) => (ins.push([c, vs]), chain),
      gte: (c: string, v: string) => (gtes.push([c, v]), chain),
      order: (col: string, o: { ascending: boolean }) => (
        (order = { col, asc: o.ascending }),
        chain
      ),
      limit: (n: number) => ((limit = n), chain),
      maybeSingle: async () => ({ data: rows()[0] ?? null, error: null }),
      then: (cb: any) => cb({ data: rows(), error: null }),
      insert: async (row: any) => {
        db.inserted.push({ table, row });
        return { error: null };
      },
    };
    return chain;
  }
  return { supabaseAdmin: { from } };
});

// ---------- Transporte ----------
const sendText = vi.hoisted(() => vi.fn());
vi.mock("@/lib/ai-agent.server", () => ({ sendWhatsappText: sendText }));

const tpl = vi.hoisted(() => ({
  approved: {} as Record<string, any>,
  send: vi.fn(),
}));
vi.mock("@/lib/wa-templates.server", () => ({
  findApprovedTemplateForPurpose: async (_c: string, purpose: string) =>
    tpl.approved[purpose] ?? null,
  renderTemplateBody: (t: any, vars: Record<string, string>) => ({
    body: (t.variables as string[]).reduce(
      (acc: string, name: string, i: number) => acc.replaceAll(`{{${i + 1}}}`, vars[name] ?? ""),
      t.components[0].text as string,
    ),
    parameters: [],
  }),
  sendWhatsappTemplate: tpl.send,
}));

// ---------- IA ----------
const llm = vi.hoisted(() => ({ run: vi.fn() }));
vi.mock("@/lib/llm-gateway/LLMGateway.server", () => ({
  LLMGateway: class {
    run(req: unknown) {
      return llm.run(req);
    }
  },
}));
vi.mock("@/lib/llm-gateway/providers/LovableChatProvider", () => ({
  LovableChatProvider: class {},
}));

import { dispatchFollowup, type DispatchInput } from "../dispatch";
import { runManualFollowup } from "../manual";

const CHAMAR_NOVAMENTE = {
  name: "chamar_novamente",
  category: "marketing",
  variables: ["var1"],
  components: [{ type: "BODY", text: "Oi! {{1}} Estou por aqui para ajudar." }],
};
const LEGACY = {
  name: "followup_orcamento",
  category: "marketing",
  variables: ["var1"],
  components: [{ type: "BODY", text: "Olá {{1}}, seu orçamento continua disponível." }],
};

const REF = "2026-09-20T10:00:00+00:00";

function input(over: Partial<DispatchInput> = {}): DispatchInput {
  return {
    companyId: "company-a",
    conversationId: "conv-1",
    leadId: "lead-1",
    rule: "quote_no_reply",
    attempt: 1,
    text: "Texto da janela aberta",
    outsideWindow: true,
    signal: "orçamento enviado sem resposta",
    referenceAt: REF,
    trigger: { kind: "auto" },
    ...over,
  };
}

function seed() {
  db.inserted = [];
  db.tables = {
    conversations: [
      {
        id: "conv-1",
        company_id: "company-a",
        ai_status: null,
        ai_handling: false,
        human_takeover_at: null,
        detected_intent: "comprar ar-condicionado para o quarto",
        detected_interest: null,
        detected_objections: ["preço"],
        purchase_timing: "este mês",
        lead_ready_to_close: false,
      },
    ],
    leads: [
      {
        id: "lead-1",
        company_id: "company-a",
        name: "Mariana Souza",
        product: "Ar split 12.000 BTUs",
        status: "quente",
        closed_at: null,
        lost_at: null,
      },
    ],
    quotes: [
      {
        company_id: "company-a",
        lead_id: "lead-1",
        sent: true,
        sent_at: "2026-09-19T12:00:00+00:00",
        product_name: "Ar split 12.000 BTUs inverter",
      },
    ],
    messages: [
      {
        company_id: "company-a",
        conversation_id: "conv-1",
        role: "lead",
        text: "Vou pensar no valor e te aviso",
        at: REF,
      },
      {
        company_id: "company-a",
        conversation_id: "conv-1",
        role: "agent",
        text: "Combinado! Qualquer dúvida estou aqui.",
        at: "2026-09-20T10:05:00+00:00",
      },
    ],
  };
}

const followUps = () => db.inserted.filter((i) => i.table === "follow_ups").map((i) => i.row);

beforeEach(() => {
  seed();
  vi.clearAllMocks();
  tpl.approved = { followup_resume: CHAMAR_NOVAMENTE, quote_no_reply: LEGACY };
  tpl.send.mockResolvedValue({ ok: true, simulated: false, externalId: "wamid.T" });
  sendText.mockResolvedValue({ ok: true, simulated: false, externalId: "wamid.X" });
  llm.run.mockResolvedValue({ text: "Conseguiu avaliar o orçamento do ar split inverter?" });
});

describe("dispatchFollowup — fora da janela: chamar_novamente contextual", () => {
  it("preenche {{1}} com a retomada da IA, sem o nome do cliente", async () => {
    const r = await dispatchFollowup(input());

    expect(r.status).toBe("sent");
    expect(tpl.send).toHaveBeenCalledTimes(1);
    const call = tpl.send.mock.calls[0][0];
    expect(call.purpose).toBe("followup_resume");
    expect(call.variables).toEqual({ var1: "Conseguiu avaliar o orçamento do ar split inverter?" });
    expect(JSON.stringify(call.variables)).not.toMatch(/mariana|souza/i);

    // A IA recebeu o contexto real da conversa e o corpo do template.
    const prompt = llm.run.mock.calls[0][0].messages.map((m: any) => m.content).join("\n");
    expect(prompt).toContain("Oi! {{1}} Estou por aqui para ajudar.");
    expect(prompt).toContain("Ar split 12.000 BTUs inverter");
    expect(prompt).toContain("preço");
    expect(prompt).toContain("Vou pensar no valor");

    const [fup] = followUps();
    expect(fup.status).toBe("sent");
    expect(fup.message_text).toBe(
      "Oi! Conseguiu avaliar o orçamento do ar split inverter? Estou por aqui para ajudar.",
    );
    expect(fup.metadata).toMatchObject({
      via: "template",
      template_name: "chamar_novamente",
      resume_phrase: "Conseguiu avaliar o orçamento do ar split inverter?",
      resume_phrase_source: "ai",
      external_id: "wamid.T",
    });
  });

  it("frase da IA com o nome do cliente é descartada e entra a retomada contextual", async () => {
    llm.run.mockResolvedValueOnce({ text: "Mariana, ainda quer o ar?" });
    await dispatchFollowup(input());
    expect(tpl.send.mock.calls[0][0].variables).toEqual({
      var1: "Ficou alguma dúvida sobre o orçamento de Ar split 12.000 BTUs inverter?",
    });
    expect(followUps()[0].metadata.resume_phrase_source).toBe("context");
  });

  it("IA fora do ar não impede o envio: usa a retomada contextual", async () => {
    llm.run.mockRejectedValueOnce(new Error("timeout"));
    const r = await dispatchFollowup(input());
    expect(r.status).toBe("sent");
    expect(r.resumePhraseSource).toBe("context");
    expect(r.resumePhrase).toContain("orçamento de Ar split");
  });

  it("empresa sem chamar_novamente segue no template legado, como antes", async () => {
    tpl.approved = { quote_no_reply: LEGACY };
    const r = await dispatchFollowup(input());
    expect(r.templateName).toBe("followup_orcamento");
    expect(tpl.send.mock.calls[0][0]).toMatchObject({
      purpose: "quote_no_reply",
      variables: { var1: "Mariana" },
    });
    expect(llm.run).not.toHaveBeenCalled();
  });

  it("sem nenhum template aprovado: bloqueia e registra template_missing", async () => {
    tpl.approved = {};
    const r = await dispatchFollowup(input());
    expect(r.status).toBe("blocked");
    expect(tpl.send).not.toHaveBeenCalled();
    expect(followUps()[0]).toMatchObject({ status: "blocked" });
    expect(followUps()[0].metadata.reason).toBe("template_missing");
  });

  it("envio simulado não fabrica external_id", async () => {
    tpl.send.mockResolvedValueOnce({
      ok: true,
      simulated: true,
      externalId: null,
      simulationId: "sim-1",
    });
    const r = await dispatchFollowup(input());
    expect(r.status).toBe("simulated");
    expect(followUps()[0].metadata).toMatchObject({ simulated: true, simulation_id: "sim-1" });
    expect(followUps()[0].metadata.external_id).toBeUndefined();
  });
});

describe("dispatchFollowup — revalidação antes de enviar", () => {
  it("cliente respondeu depois da referência: não envia nem grava tentativa", async () => {
    db.tables.messages.push({
      company_id: "company-a",
      conversation_id: "conv-1",
      role: "lead",
      text: "Oi, pode me mandar de novo?",
      at: "2026-09-21T08:00:00+00:00",
    });
    const r = await dispatchFollowup(input());
    expect(r).toMatchObject({ status: "skipped", reason: "cliente respondeu" });
    expect(tpl.send).not.toHaveBeenCalled();
    expect(llm.run).not.toHaveBeenCalled();
    expect(followUps()).toHaveLength(0);
  });

  it("mesmo instante em outro formato não conta como resposta", async () => {
    const r = await dispatchFollowup(input({ referenceAt: "2026-09-20T10:00:00.000Z" }));
    expect(r.status).toBe("sent");
  });

  it("cliente responde enquanto a frase é gerada: cancela no último instante", async () => {
    llm.run.mockImplementationOnce(async () => {
      db.tables.messages.push({
        company_id: "company-a",
        conversation_id: "conv-1",
        role: "lead",
        text: "Voltei! Quero fechar.",
        at: "2026-09-21T09:00:00+00:00",
      });
      return { text: "Conseguiu avaliar o orçamento?" };
    });
    const r = await dispatchFollowup(input());
    expect(r).toMatchObject({ status: "skipped", reason: "cliente respondeu" });
    expect(tpl.send).not.toHaveBeenCalled();
    expect(followUps()).toHaveLength(0);
  });

  it.each([
    [{ status: "fechado" }, "venda fechada"],
    [{ closed_at: "2026-09-21T00:00:00+00:00" }, "venda fechada"],
    [{ status: "perdido" }, "venda perdida"],
    [{ lost_at: "2026-09-21T00:00:00+00:00" }, "venda perdida"],
  ])("lead %o: não envia (%s)", async (patch, reason) => {
    Object.assign(db.tables.leads[0], patch);
    const r = await dispatchFollowup(input());
    expect(r).toMatchObject({ status: "skipped", reason });
    expect(tpl.send).not.toHaveBeenCalled();
  });

  it.each([
    [{ ai_status: "assumido_humano" }, "humano assumiu"],
    [{ human_takeover_at: "2026-09-21T00:00:00+00:00" }, "humano assumiu"],
    [{ ai_status: "desinteresse" }, "cliente sem interesse"],
    [{ ai_handling: true }, "IA em processamento"],
  ])("conversa %o: não envia (%s)", async (patch, reason) => {
    Object.assign(db.tables.conversations[0], patch);
    const r = await dispatchFollowup(input());
    expect(r).toMatchObject({ status: "skipped", reason });
  });

  it("cliente antigo que voltou (returning_customer) não é barrado por venda fechada", async () => {
    Object.assign(db.tables.leads[0], { status: "fechado" });
    const r = await dispatchFollowup(input({ rule: "returning_customer" }));
    expect(r.status).toBe("sent");
  });

  it("não vaza entre empresas: conversa de outra empresa não existe para o motor", async () => {
    const r = await dispatchFollowup(input({ companyId: "company-b" }));
    expect(r).toMatchObject({ status: "skipped", reason: "conversa não encontrada" });
  });
});

describe("dispatchFollowup — dentro da janela", () => {
  it("envia o texto montado, sem template nem IA", async () => {
    const r = await dispatchFollowup(input({ outsideWindow: false }));
    expect(r).toMatchObject({ status: "sent", via: "text", message: "Texto da janela aberta" });
    expect(sendText).toHaveBeenCalledWith(
      expect.objectContaining({ text: "Texto da janela aberta", conversationId: "conv-1" }),
    );
    expect(tpl.send).not.toHaveBeenCalled();
    expect(llm.run).not.toHaveBeenCalled();
  });
});

describe("Follow-up agora usa o mesmo motor", () => {
  beforeEach(() => {
    db.tables.company_settings = [{ company_id: "company-a", ai_followup_enabled: true }];
    db.tables.follow_ups = [];
    db.tables.conversations[0].lead_id = "lead-1";
    db.tables.conversations[0].lead_temperature = "morno";
  });

  it("fora da janela envia chamar_novamente contextual e registra como manual", async () => {
    const out = await runManualFollowup({
      companyId: "company-a",
      userId: "admin-1",
      conversationId: "conv-1",
    });

    expect(out).toMatchObject({ eligible: true, sendStatus: "sent", via: "template" });
    expect(out.generatedMessage).toContain("Conseguiu avaliar o orçamento");
    expect(tpl.send.mock.calls[0][0]).toMatchObject({
      purpose: "followup_resume",
      variables: { var1: "Conseguiu avaliar o orçamento do ar split inverter?" },
    });
    const fup = followUps()[0];
    expect(fup).toMatchObject({ status: "sent", trigger_reason: "manual_admin" });
    expect(fup.metadata).toMatchObject({ manual: true, by: "admin-1" });
    const audit = db.inserted.find((i) => i.table === "audit_log")!.row;
    expect(audit.action).toBe("manual_followup_sent");
  });

  it("venda fechada: o manual também é barrado pela revalidação", async () => {
    Object.assign(db.tables.leads[0], { status: "fechado" });
    const out = await runManualFollowup({
      companyId: "company-a",
      userId: "admin-1",
      conversationId: "conv-1",
    });
    expect(out).toEqual({ eligible: false, blockedReason: "venda fechada" });
    expect(tpl.send).not.toHaveBeenCalled();
    expect(sendText).not.toHaveBeenCalled();
  });
});
