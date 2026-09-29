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
vi.mock("@/lib/wa-templates.server", async (importOriginal) => {
  // Render REAL (contrato do template); só busca e envio são simulados.
  const actual = await importOriginal<typeof import("@/lib/wa-templates.server")>();
  return {
    ...actual,
    findApprovedTemplateForPurpose: async (_c: string, purpose: string) =>
      tpl.approved[purpose] ?? null,
    sendWhatsappTemplate: tpl.send,
  };
});

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

// Formato do chamar_novamente no caso real (lead_silent): o texto fixo entra
// byte a byte — vírgula depois do {{1}} e linhas em branco entre parágrafos.
const CHAMAR_BODY =
  "Olá {{1}}, tudo bem?\n\nPor favor, confirme o recebimento desta mensagem respondendo por aqui.\n\nObrigado.";
const CHAMAR_NOVAMENTE = {
  name: "chamar_novamente",
  category: "marketing",
  variables: ["var1"],
  components: [{ type: "BODY", text: CHAMAR_BODY }],
};
const REAL_VAR1 = "sobre as informações que solicitou, para darmos continuidade ao seu atendimento";
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
  llm.run.mockResolvedValue({ text: REAL_VAR1 });
});

describe("dispatchFollowup — fora da janela: chamar_novamente contextual", () => {
  it("preenche {{1}} com a retomada da IA, sem o nome do cliente", async () => {
    const r = await dispatchFollowup(input());

    expect(r.status).toBe("sent");
    expect(tpl.send).toHaveBeenCalledTimes(1);
    const call = tpl.send.mock.calls[0][0];
    expect(call.purpose).toBe("followup_resume");
    // Payload Meta: só o conteúdo interno, sem {{ }}.
    expect(call.variables).toEqual({ var1: REAL_VAR1 });
    expect(JSON.stringify(call.variables)).not.toMatch(/mariana|souza/i);

    // A IA recebeu o contexto real da conversa e o corpo do template.
    const prompt = llm.run.mock.calls[0][0].messages.map((m: any) => m.content).join("\n");
    expect(prompt).toContain(CHAMAR_BODY);
    expect(prompt).toContain("Ar split 12.000 BTUs inverter");
    expect(prompt).toContain("preço");
    expect(prompt).toContain("Vou pensar no valor");

    const [fup] = followUps();
    expect(fup.status).toBe("sent");
    // Exatamente o texto do caso real: body aprovado + var1, nada inventado.
    expect(fup.message_text).toBe(
      "Olá sobre as informações que solicitou, para darmos continuidade ao seu atendimento, tudo bem?\n\nPor favor, confirme o recebimento desta mensagem respondendo por aqui.\n\nObrigado.",
    );
    expect(fup.message_text).not.toMatch(/\{\{|\}\}/);
    expect(fup.metadata).toMatchObject({
      via: "template",
      template_name: "chamar_novamente",
      resume_phrase: REAL_VAR1,
      resume_phrase_source: "ai",
      external_id: "wamid.T",
    });
  });

  it("prévia marca o var1 entre {{ }} só para exibição; texto enviado sem chaves", async () => {
    const r = await dispatchFollowup(input());
    expect(r.messagePreview).toBe(
      "Olá {{sobre as informações que solicitou, para darmos continuidade ao seu atendimento}}, tudo bem?\n\nPor favor, confirme o recebimento desta mensagem respondendo por aqui.\n\nObrigado.",
    );
    expect(r.message).toBe(CHAMAR_BODY.replace("{{1}}", REAL_VAR1));
    expect(r.messagePreview!.replace(/\{\{|\}\}/g, "")).toBe(r.message);
  });

  it("var1 da IA com pontuação no fim não duplica a vírgula do template", async () => {
    llm.run.mockResolvedValueOnce({ text: REAL_VAR1 + "," });
    const r = await dispatchFollowup(input());
    expect(tpl.send.mock.calls[0][0].variables).toEqual({ var1: REAL_VAR1 });
    expect(r.message).toContain("atendimento, tudo bem?");
    expect(r.message).not.toContain(",,");
  });

  it("chamar_novamente com mais de uma variável: bloqueia, nada vazio vai à Meta", async () => {
    tpl.approved.followup_resume = {
      ...CHAMAR_NOVAMENTE,
      variables: ["var1", "var2"],
      components: [{ type: "BODY", text: "Olá {{1}}, {{2}}" }],
    };
    const r = await dispatchFollowup(input());
    expect(r).toMatchObject({ status: "blocked" });
    expect(r.reason).toMatch(/2 variáveis/);
    expect(tpl.send).not.toHaveBeenCalled();
    expect(llm.run).not.toHaveBeenCalled();
    expect(followUps()[0]).toMatchObject({ status: "blocked" });
  });

  it("frase da IA com o nome do cliente é descartada e entra a retomada contextual", async () => {
    llm.run.mockResolvedValueOnce({ text: "Mariana, ainda quer o ar?" });
    await dispatchFollowup(input());
    expect(tpl.send.mock.calls[0][0].variables).toEqual({
      var1: "estou passando para retomar nossa conversa sobre o orçamento de Ar split 12.000 BTUs inverter e saber se ficou alguma dúvida",
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

  it("venda fechada barra qualquer motivo, inclusive reativação (returning_customer)", async () => {
    Object.assign(db.tables.leads[0], { status: "fechado" });
    const r = await dispatchFollowup(input({ rule: "returning_customer" }));
    expect(r).toMatchObject({ status: "skipped", skipCode: "sale_closed" });
    expect(tpl.send).not.toHaveBeenCalled();
  });

  it("devolve o código do motivo para o ciclo decidir (encerrar ou adiar)", async () => {
    Object.assign(db.tables.conversations[0], { ai_handling: true });
    expect(await dispatchFollowup(input())).toMatchObject({ skipCode: "ai_busy" });
    Object.assign(db.tables.conversations[0], { ai_handling: false, ai_status: "desinteresse" });
    expect(await dispatchFollowup(input())).toMatchObject({ skipCode: "disinterest" });
  });

  it("grava o vínculo com o ciclo na tentativa", async () => {
    await dispatchFollowup(input({ cycleId: "cycle-9" }));
    expect(followUps()[0].cycle_id).toBe("cycle-9");
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
