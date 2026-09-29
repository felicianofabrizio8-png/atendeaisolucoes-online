// Campanhas de relacionamento — prévia e envio: template certo, {{1}}/var1
// nunca vazio, prévia sem efeitos colaterais (além de salvar o var1), lead sem
// conversa WhatsApp e envio real reutilizando exatamente o var1 da prévia —
// no automático, preparado pelo mesmo pipeline do "Testar" antes de enviar.

/* eslint-disable @typescript-eslint/no-explicit-any */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ---------- Banco falso que registra toda escrita ----------
type Row = Record<string, any>;
const db = vi.hoisted(() => ({
  tables: {} as Record<string, Row[]>,
  writes: [] as Array<{ op: string; table: string; row?: any }>,
  seq: 0,
}));

vi.mock("@/integrations/supabase/client.server", () => {
  // Simula o trigger set_updated_at: toda escrita troca o updated_at.
  function touch(r: Row, patch: Row) {
    Object.assign(r, patch);
    if ("updated_at" in r) r.updated_at = `ts-${++db.seq}`;
  }
  function from(table: string) {
    const preds: Array<(r: Row) => boolean> = [];
    let limit = Infinity;
    const rows = () =>
      (db.tables[table] ?? []).filter((r) => preds.every((p) => p(r))).slice(0, limit);
    const chain: any = {
      select: () => chain,
      eq: (c: string, v: unknown) => (preds.push((r) => r[c] === v), chain),
      in: (c: string, vs: unknown[]) => (preds.push((r) => vs.includes(r[c])), chain),
      gte: () => chain,
      or: () => chain,
      order: () => chain,
      limit: (n: number) => ((limit = n), chain),
      // cópia, como o PostgREST: escrever no banco não muda o que já foi lido
      maybeSingle: async () => ({ data: structuredClone(rows()[0] ?? null), error: null }),
      then: (cb: any) => cb({ data: rows(), error: null }),
      insert: (row: Row) => {
        const full = { id: `${table}-${++db.seq}`, ...row };
        (db.tables[table] ??= []).push(full);
        db.writes.push({ op: "insert", table, row });
        const res = { data: full, error: null };
        return { select: () => ({ single: async () => res }), then: (cb: any) => cb(res) };
      },
      update: (patch: Row) => {
        const upd: any = {
          eq: (c: string, v: unknown) => (preds.push((r) => r[c] === v), upd),
          in: (c: string, vs: unknown[]) => (preds.push((r) => vs.includes(r[c])), upd),
          select: () => upd,
          maybeSingle: async () => {
            const hit = rows();
            for (const r of hit) touch(r, patch);
            db.writes.push({ op: "update", table, row: patch });
            return { data: hit[0] ? { id: hit[0].id } : null, error: null };
          },
          then: (cb: any) => {
            for (const r of rows()) touch(r, patch);
            db.writes.push({ op: "update", table, row: patch });
            return cb({ error: null });
          },
        };
        return upd;
      },
      upsert: (row: Row) => {
        db.writes.push({ op: "upsert", table, row });
        return { select: () => ({ single: async () => ({ data: row, error: null }) }) };
      },
    };
    return chain;
  }
  return { supabaseAdmin: { from } };
});

// ---------- Templates: renderTemplateBody REAL; busca e envio simulados ----------
const tpl = vi.hoisted(() => ({ approved: {} as Record<string, any>, send: vi.fn() }));
vi.mock("@/lib/wa-templates.server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/wa-templates.server")>();
  return {
    ...actual,
    findApprovedTemplateForPurpose: async (_c: string, purpose: string) =>
      tpl.approved[purpose] ?? null,
    sendWhatsappTemplate: tpl.send,
  };
});

// ---------- IA da frase de retomada ----------
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

import {
  dispatchRelationshipRecipient,
  previewRelationshipDispatch,
  runAutomaticRelationshipBatch,
} from "../relationship-campaign-dispatcher.server";
import { RELATIONSHIP_PURPOSES } from "../relationship-campaign-purposes";
import { PURPOSE_TEMPLATE_MAP } from "../wa-templates.server";

// Segunda, 28/09/2026, 13:00 em São Paulo — dentro do horário comercial.
const NOW = new Date("2026-09-28T16:00:00.000Z");

const template = (name: string, body: string, variables = ["var1"]) => ({
  id: `tpl-${name}`,
  name,
  category: "marketing",
  language: "pt_BR",
  status: "approved",
  variables,
  components: [{ type: "BODY", text: body }],
});
// Texto aprovado do chamar_novamente — o fixo não pode mudar nem um espaço.
const CHAMAR_BODY =
  "Olá {{1}} tudo bem?\nPor favor, confirme o recebimento desta mensagem respondendo por aqui.\nObrigado.";
const CHAMAR = template("chamar_novamente", CHAMAR_BODY);
const PHRASE =
  "estou passando para retomar nossa conversa sobre a piscina que você estava analisando. Vi que falamos sobre o modelo Sol 401 e queria saber se ainda posso te ajudar com esse projeto";
const REATIVACAO = template(
  "reativacao_cliente",
  "Olá {{1}}, quanto tempo! Posso te ajudar com algo?",
);

function seed(purpose = "followup_resume") {
  db.seq = 0;
  db.writes = [];
  db.tables = {
    relationship_campaign_settings: [
      {
        company_id: "c1",
        mode: "manual",
        automatic_enabled: false,
        daily_limit: 50,
        hourly_limit: 10,
        business_hours_start: "09:00",
        business_hours_end: "18:00",
        timezone: "America/Sao_Paulo",
        retry_max: 3,
        retry_backoff_seconds: 300,
      },
    ],
    relationship_campaign_recipients: [
      {
        id: "rec-1",
        company_id: "c1",
        relationship_campaign_id: "camp-1",
        lead_id: "lead-1",
        status: "pending",
        attempts: 0,
        metadata: { source: "relationship_segment" },
        updated_at: "ts-0",
        relationship_campaigns: {
          id: "camp-1",
          company_id: "c1",
          template_purpose: purpose,
          segment_id: "seg-1",
        },
      },
    ],
    relationship_segments: [
      {
        id: "seg-1",
        company_id: "c1",
        active: true,
        definition: { all: [{ field: "status", op: "eq", value: "morno" }] },
      },
    ],
    relationship_campaign_suppressions: [],
    leads: [
      {
        id: "lead-1",
        company_id: "c1",
        name: "Mariana Souza",
        phone: "5511999990000",
        external_id: null,
        status: "morno",
        closed_at: null,
        channel: "whatsapp",
        tags: [],
        product: "Ar split 12.000 BTUs",
        assigned_to: null,
      },
    ],
    conversations: [
      {
        id: "conv-wa",
        company_id: "c1",
        lead_id: "lead-1",
        channel: "whatsapp",
        detected_objections: ["preço"],
      },
    ],
    messages: [
      {
        company_id: "c1",
        conversation_id: "conv-wa",
        role: "lead",
        text: "Vou pensar no valor",
        at: "2026-09-20T10:00:00Z",
      },
    ],
    quotes: [],
  };
}

const input = {
  companyId: "c1",
  relationshipCampaignId: "camp-1",
  recipientId: "rec-1",
  mode: "manual" as const,
  now: NOW,
};
const recipient = () => db.tables.relationship_campaign_recipients[0];
const stored = () => recipient().metadata.prepared_dispatch;
/** A única escrita permitida à prévia: metadata.prepared_dispatch do destinatário. */
const onlyPreparedWrites = () =>
  db.writes.every(
    (w) =>
      w.op === "update" &&
      w.table === "relationship_campaign_recipients" &&
      Object.keys(w.row).join() === "metadata",
  );
const realSend = () => {
  process.env.RELATIONSHIP_CAMPAIGN_ENABLE_REAL_SEND = "true";
  return dispatchRelationshipRecipient({ ...input, dryRun: false }) as Promise<any>;
};

beforeEach(() => {
  seed();
  vi.clearAllMocks();
  delete process.env.RELATIONSHIP_CAMPAIGN_ENABLE_REAL_SEND;
  tpl.approved = { followup_resume: CHAMAR, reactivation: REATIVACAO };
  tpl.send.mockResolvedValue({ ok: true, simulated: false, externalId: "wamid.RC" });
  llm.run.mockResolvedValue({ text: PHRASE });
});
afterEach(() => {
  delete process.env.RELATIONSHIP_CAMPAIGN_ENABLE_REAL_SEND;
});

describe("catálogo de propósitos", () => {
  it("cada propósito aponta para o template do mapa oficial", () => {
    for (const [purpose, info] of Object.entries(RELATIONSHIP_PURPOSES)) {
      expect(PURPOSE_TEMPLATE_MAP[purpose as keyof typeof PURPOSE_TEMPLATE_MAP].templateName).toBe(
        info.template,
      );
    }
  });
});

describe("Retomada (followup_resume → chamar_novamente)", () => {
  it("var1/{{1}} = frase contextual, nunca vazia nem com o nome; conteúdo final renderizado", async () => {
    const r: any = await previewRelationshipDispatch(input);
    expect(r).toMatchObject({
      status: "preview",
      purpose: "followup_resume",
      purpose_label: "Retomada",
      template: { name: "chamar_novamente", category: "marketing", language: "pt_BR" },
      variables: { var1: PHRASE },
      phrase_source: "ai",
      conversation_id: "conv-wa",
    });
    expect(r.variables.var1).not.toMatch(/mariana|souza/i);
    // prévia: var1 entre {{ }} no texto fixo aprovado, intacto
    expect(r.content_preview).toBe(
      `Olá {{${PHRASE}}} tudo bem?\nPor favor, confirme o recebimento desta mensagem respondendo por aqui.\nObrigado.`,
    );
    // conteúdo real (o que a Meta renderiza): sem chaves, mesmo texto fixo
    expect(r.content).toBe(CHAMAR_BODY.replace("{{1}}", PHRASE));
    expect(r.content).not.toMatch(/\{\{|\}\}/);
    expect(r.parameters).toEqual([PHRASE]);
    expect(r.content_preview.replace(/\{\{|\}\}/g, "")).toBe(r.content);
    // a IA leu a conversa real
    const prompt = llm.run.mock.calls[0][0].messages.map((m: any) => m.content).join("\n");
    expect(prompt).toContain("Vou pensar no valor");
    expect(prompt).toContain("Ar split 12.000 BTUs");
  });

  it("IA devolve o nome ou falha: {{1}} cai na retomada contextual, ainda não vazia", async () => {
    llm.run.mockResolvedValueOnce({ text: "Mariana, bora fechar?" });
    const a: any = await previewRelationshipDispatch(input);
    expect(a.variables.var1).toBe(
      "estou passando para retomar nossa conversa sobre Ar split 12.000 BTUs e ver se consigo ajudar com a questão de preço",
    );
    expect(a.phrase_source).toBe("context");
    expect(a.content_preview).toBe(
      `Olá {{${a.variables.var1}}} tudo bem?\nPor favor, confirme o recebimento desta mensagem respondendo por aqui.\nObrigado.`,
    );

    llm.run.mockRejectedValueOnce(new Error("timeout"));
    const b: any = await previewRelationshipDispatch({ ...input, regenerate: true });
    expect(b.variables.var1.trim().length).toBeGreaterThan(0);
  });
});

describe("Reativação (reactivation → reativacao_cliente)", () => {
  it("var1 = primeiro nome, sem IA", async () => {
    seed("reactivation");
    const r: any = await previewRelationshipDispatch(input);
    expect(r).toMatchObject({
      purpose_label: "Reativação",
      template: { name: "reativacao_cliente" },
      variables: { var1: "Mariana" },
      content: "Olá Mariana, quanto tempo! Posso te ajudar com algo?",
      content_preview: "Olá {{Mariana}}, quanto tempo! Posso te ajudar com algo?",
    });
    expect(llm.run).not.toHaveBeenCalled();
  });

  it("nome ausente: bloqueia em vez de mandar {{1}} vazio", async () => {
    seed("reactivation");
    db.tables.leads[0].name = "   ";
    const r: any = await previewRelationshipDispatch(input);
    expect(r.would_send).toBe(false);
    expect(r.blockers[0]).toMatch(/\{\{1\}\} ficaria vazia/);
    expect(r.content).toBeUndefined();
  });
});

describe("bloqueios de template", () => {
  it("template com mais de uma variável não é enviado com variáveis vazias", async () => {
    tpl.approved.followup_resume = template("chamar_novamente", "Oi {{1}}, {{2}}", [
      "var1",
      "var2",
    ]);
    const r: any = await previewRelationshipDispatch(input);
    expect(r).toMatchObject({ would_send: false });
    expect(r.blockers[0]).toMatch(/2 variáveis/);
  });

  it("template não aprovado → bloqueado com o nome esperado", async () => {
    tpl.approved = {};
    const r: any = await previewRelationshipDispatch(input);
    expect(r.blockers[0]).toMatch(/chamar_novamente.*não está aprovado.*Retomada/);
  });
});

describe("prévia sem efeitos colaterais", () => {
  it("não envia, não cria conversa e só salva o var1 no destinatário", async () => {
    const r: any = await previewRelationshipDispatch(input);
    expect(r.blockers).toEqual(["envio real desabilitado no servidor"]);
    expect(tpl.send).not.toHaveBeenCalled();
    expect(db.writes).toHaveLength(1);
    expect(onlyPreparedWrites()).toBe(true);
    expect(recipient()).toMatchObject({
      status: "pending",
      attempts: 0,
      metadata: { source: "relationship_segment" }, // o que já havia fica
    });
    expect(recipient().dispatch_key).toBeUndefined();
  });

  it("suprimido/inelegível aparece na prévia, mas o destinatário não muda", async () => {
    db.tables.relationship_campaign_suppressions.push({
      id: "s1",
      company_id: "c1",
      lead_id: "lead-1",
      active: true,
      reason: "opt_out",
    });
    const suppressed: any = await previewRelationshipDispatch(input);
    expect(suppressed).toMatchObject({
      would_send: false,
      outcome: "suppressed",
      blockers: ["opt_out"],
    });

    db.tables.relationship_campaign_suppressions = [];
    db.tables.leads[0].status = "novo"; // saiu do segmento
    const ineligible: any = await previewRelationshipDispatch(input);
    expect(ineligible).toMatchObject({ would_send: false, outcome: "ineligible" });

    expect(db.writes).toEqual([]);
    expect(stored()).toBeUndefined();
    expect(recipient().status).toBe("pending");
  });

  it("fora do horário a prévia ainda mostra o conteúdo, com o bloqueio", async () => {
    const r: any = await previewRelationshipDispatch({
      ...input,
      now: new Date("2026-09-28T23:00:00Z"),
    });
    expect(r.content).toContain("tudo bem?");
    expect(r.blockers).toContain("fora do horário comercial configurado");
  });

  it("dispatch com dryRun=false, mas envio real desabilitado, continua sendo só prévia", async () => {
    const r: any = await dispatchRelationshipRecipient({ ...input, dryRun: false });
    expect(r.status).toBe("preview");
    expect(tpl.send).not.toHaveBeenCalled();
    expect(onlyPreparedWrites()).toBe(true);
  });
});

describe("renderização do var1", () => {
  it("var1 com `$&`/`$1` não é tratado como padrão de substituição", async () => {
    llm.run.mockResolvedValueOnce({
      text: "estou retomando o pedido 'A$&B' e o item $1 que você viu",
    });
    const r: any = await previewRelationshipDispatch(input);
    expect(r.content).toBe(
      CHAMAR_BODY.replace(
        "{{1}}",
        () => "estou retomando o pedido 'A$&B' e o item $1 que você viu",
      ),
    );
  });
});

describe("lead sem conversa WhatsApp", () => {
  it("conversa de outro canal não serve; a prévia não cria conversa", async () => {
    db.tables.conversations = [
      { id: "conv-ig", company_id: "c1", lead_id: "lead-1", channel: "instagram" },
    ];
    const r: any = await previewRelationshipDispatch(input);
    expect(r).toMatchObject({ conversation_id: null });
    expect(r.conversation_note).toMatch(/sem conversa WhatsApp/);
    expect(r.variables.var1.trim()).not.toBe(""); // frase sai do lead/produto
    expect(onlyPreparedWrites()).toBe(true);
    expect(db.tables.conversations).toHaveLength(1);
  });
});

describe("var1 salvo na prévia", () => {
  it("fica no destinatário com company/campaign/recipient/lead, sem {{ }}", async () => {
    const r: any = await previewRelationshipDispatch(input);
    expect(r.prepared).toMatchObject({ saved: true, reused: false, error: null });
    expect(stored()).toMatchObject({
      version: 1,
      id: r.prepared.id,
      company_id: "c1",
      relationship_campaign_id: "camp-1",
      recipient_id: "rec-1",
      lead_id: "lead-1",
      purpose: "followup_resume",
      template: { name: "chamar_novamente", language: "pt_BR" },
      variables: { var1: PHRASE },
      content: r.content,
      phrase_source: "ai",
    });
  });

  it("nova prévia reutiliza o var1 salvo, sem IA e sem nova escrita (idempotente)", async () => {
    const first: any = await previewRelationshipDispatch(input);
    llm.run.mockClear();
    db.writes = [];
    const again: any = await previewRelationshipDispatch(input);
    expect(llm.run).not.toHaveBeenCalled();
    expect(db.writes).toEqual([]);
    expect(again.prepared).toMatchObject({ id: first.prepared.id, reused: true, saved: true });
    expect(again.variables).toEqual(first.variables);
    expect(again.content_preview).toBe(first.content_preview);
  });

  it('"Gerar outra frase" (regenerate) chama a IA e substitui o salvo', async () => {
    const first: any = await previewRelationshipDispatch(input);
    llm.run.mockResolvedValueOnce({ text: "estou retomando nossa conversa sobre o ar split" });
    const again: any = await previewRelationshipDispatch({ ...input, regenerate: true });
    expect(again.prepared.id).not.toBe(first.prepared.id);
    expect(stored().variables).toEqual({ var1: "estou retomando nossa conversa sobre o ar split" });
  });

  it("destinatário alterado durante a prévia: não sobrescreve e avisa", async () => {
    // outra escrita chega entre a leitura e o salvamento (updated_at muda)
    llm.run.mockImplementationOnce(async () => {
      recipient().updated_at = "ts-concorrente";
      return { text: PHRASE };
    });
    const r: any = await previewRelationshipDispatch(input);
    expect(r.prepared.saved).toBe(false);
    expect(r.blockers.join()).toMatch(/var1 não foi salvo.*mudou durante a prévia/);
    expect(stored()).toBeUndefined();
  });

  it("destinatário já enviado: a prévia não grava nada", async () => {
    recipient().status = "sent";
    const r: any = await previewRelationshipDispatch(input);
    expect(r.prepared.saved).toBe(false);
    expect(db.writes).toEqual([]);
  });
});

describe("envio real (gate ligado só nestes testes) reutiliza o var1 da prévia", () => {
  it("usa exatamente o var1 salvo, sem chamar a IA; Meta recebe só o conteúdo interno", async () => {
    const preview: any = await previewRelationshipDispatch(input);
    db.tables.conversations = [];
    llm.run.mockClear();
    llm.run.mockResolvedValue({ text: "estou com outra frase que não pode ir" });

    const r = await realSend();
    expect(r).toMatchObject({ status: "sent", external_id: "wamid.RC", content: preview.content });
    expect(llm.run).not.toHaveBeenCalled();
    expect(tpl.send).toHaveBeenCalledTimes(1);
    expect(tpl.send.mock.calls[0][0]).toMatchObject({
      purpose: "followup_resume",
      variables: { var1: PHRASE },
    });
    expect(tpl.send.mock.calls[0][0].variables.var1).not.toMatch(/\{\{|\}\}/);
    expect(db.tables.conversations[0]).toMatchObject({ lead_id: "lead-1", channel: "whatsapp" });
    expect(recipient()).toMatchObject({
      status: "sent",
      attempts: 1,
      external_message_id: "wamid.RC",
    });
  });

  it("sem var1 preparado: bloqueia, sem IA, sem envio, sem reservar", async () => {
    const r = await realSend();
    expect(r.status).toBe("blocked");
    expect(r.reason).toMatch(/nenhum var1 preparado.*gere a prévia/);
    expect(llm.run).not.toHaveBeenCalled();
    expect(tpl.send).not.toHaveBeenCalled();
    expect(db.writes).toEqual([]);
    expect(recipient()).toMatchObject({ status: "pending", attempts: 0 });
  });

  it("var1 de outra campanha/destinatário/empresa copiado para cá: bloqueia", async () => {
    await previewRelationshipDispatch(input);
    for (const [field, value] of [
      ["relationship_campaign_id", "camp-2"],
      ["recipient_id", "rec-2"],
      ["company_id", "c2"],
      ["lead_id", "lead-2"],
    ] as const) {
      const original = { ...stored() };
      recipient().metadata.prepared_dispatch = { ...original, [field]: value };
      const r = await realSend();
      expect(r).toMatchObject({ status: "blocked" });
      expect(r.reason).toMatch(/pertence a outro destinatário/);
      recipient().metadata.prepared_dispatch = original;
    }
    expect(tpl.send).not.toHaveBeenCalled();
  });

  it("template mudou desde a prévia: bloqueia em vez de mandar texto diferente", async () => {
    await previewRelationshipDispatch(input);
    tpl.approved.followup_resume = template("chamar_novamente", "Oi {{1}}! Tudo certo?");
    const r = await realSend();
    expect(r.reason).toMatch(/texto do template mudou desde a prévia/);
    expect(tpl.send).not.toHaveBeenCalled();
  });

  it("var1 salvo adulterado (nome do cliente, chaves ou vazio): bloqueia", async () => {
    await previewRelationshipDispatch(input);
    for (const bad of ["Mariana, bora fechar?", "{{estou retomando}}", "   "]) {
      recipient().metadata.prepared_dispatch.variables = { var1: bad };
      const r = await realSend();
      expect(r.status).toBe("blocked");
    }
    expect(tpl.send).not.toHaveBeenCalled();
  });

  it("idempotente: segundo disparo não reenvia", async () => {
    await previewRelationshipDispatch(input);
    await realSend();
    const again = await realSend();
    expect(again.status).toBe("idempotent");
    expect(tpl.send).toHaveBeenCalledTimes(1);
  });

  it("falha da Meta: a nova tentativa reutiliza o mesmo var1", async () => {
    await previewRelationshipDispatch(input);
    tpl.send.mockResolvedValueOnce({ ok: false, simulated: false, error: "HTTP 500" });
    expect((await realSend()).status).toBe("failed");
    expect(recipient().status).toBe("failed");
    const retry = await realSend();
    expect(retry.status).toBe("sent");
    expect(tpl.send.mock.calls.map((c: any[]) => c[0].variables)).toEqual([
      { var1: PHRASE },
      { var1: PHRASE },
    ]);
    expect(llm.run).toHaveBeenCalledTimes(1); // só a prévia
  });
});

describe("modo automático: prepara pelo pipeline do Testar e envia só o salvo", () => {
  // automação ligada só no banco falso destes testes
  const enableAutomation = () =>
    Object.assign(db.tables.relationship_campaign_settings[0], {
      mode: "automatic",
      automatic_enabled: true,
    });
  const autoSend = () => {
    process.env.RELATIONSHIP_CAMPAIGN_ENABLE_REAL_SEND = "true";
    return dispatchRelationshipRecipient({
      ...input,
      mode: "automatic",
      dryRun: false,
    }) as Promise<any>;
  };

  it("sem var1 salvo: gera uma vez, salva e envia exatamente o salvo", async () => {
    enableAutomation();
    const r = await autoSend();
    expect(r.status).toBe("sent");
    expect(llm.run).toHaveBeenCalledTimes(1);
    expect(stored()).toMatchObject({ recipient_id: "rec-1", variables: { var1: PHRASE } });
    expect(tpl.send.mock.calls[0][0].variables).toEqual(stored().variables);
    expect(tpl.send.mock.calls[0][0].variables.var1).not.toMatch(/\{\{|\}\}/);
    expect(recipient()).toMatchObject({ status: "sent", attempts: 1 });
  });

  it("var1 salvo válido (ex.: do Testar): não chama a IA", async () => {
    await previewRelationshipDispatch(input);
    enableAutomation();
    llm.run.mockClear();
    const r = await autoSend();
    expect(r.status).toBe("sent");
    expect(llm.run).not.toHaveBeenCalled();
    expect(tpl.send.mock.calls[0][0].variables).toEqual({ var1: PHRASE });
  });

  it("var1 salvo inválido (de outro destinatário): prepara de novo e envia o novo", async () => {
    await previewRelationshipDispatch(input);
    recipient().metadata.prepared_dispatch.recipient_id = "rec-2";
    enableAutomation();
    llm.run.mockResolvedValueOnce({ text: "estou retomando nossa conversa sobre o ar split" });
    const r = await autoSend();
    expect(r.status).toBe("sent");
    expect(stored().recipient_id).toBe("rec-1");
    expect(tpl.send.mock.calls[0][0].variables).toEqual({
      var1: "estou retomando nossa conversa sobre o ar split",
    });
  });

  it("automação desligada: bloqueia antes da IA, sem escrita", async () => {
    const r = await autoSend();
    expect(r).toMatchObject({ status: "blocked", reason: "automação desativada" });
    expect(llm.run).not.toHaveBeenCalled();
    expect(db.writes).toEqual([]);
    expect(tpl.send).not.toHaveBeenCalled();
  });

  it("fora do horário: bloqueia antes da IA, sem escrita", async () => {
    enableAutomation();
    process.env.RELATIONSHIP_CAMPAIGN_ENABLE_REAL_SEND = "true";
    const r: any = await dispatchRelationshipRecipient({
      ...input,
      mode: "automatic",
      dryRun: false,
      now: new Date("2026-09-28T23:00:00Z"),
    });
    expect(r.reason).toMatch(/fora do horário/);
    expect(llm.run).not.toHaveBeenCalled();
    expect(db.writes).toEqual([]);
  });

  it("opt-out: registra supressão, sem IA e sem envio", async () => {
    enableAutomation();
    db.tables.relationship_campaign_suppressions.push({
      id: "s1",
      company_id: "c1",
      lead_id: "lead-1",
      active: true,
      reason: "opt_out",
    });
    const r = await autoSend();
    expect(r.status).toBe("suppressed");
    expect(recipient().status).toBe("suppressed");
    expect(llm.run).not.toHaveBeenCalled();
    expect(tpl.send).not.toHaveBeenCalled();
  });

  it("preparação gera conteúdo inválido ({{1}} vazio): não envia e registra o motivo", async () => {
    seed("reactivation");
    enableAutomation();
    db.tables.leads[0].name = "   ";
    const r = await autoSend();
    expect(r.status).toBe("blocked");
    expect(r.reason).toMatch(/preparação automática falhou.*ficaria vazia/);
    expect(tpl.send).not.toHaveBeenCalled();
    expect(recipient()).toMatchObject({ status: "pending", attempts: 0 });
    expect(recipient().last_error).toMatch(/^preparação automática: .*ficaria vazia/);
    expect(recipient().next_attempt_at).toBe(new Date(NOW.getTime() + 300_000).toISOString());
  });

  it("salvamento concorrente falha: não envia e registra o motivo", async () => {
    enableAutomation();
    llm.run.mockImplementationOnce(async () => {
      recipient().updated_at = "ts-concorrente";
      return { text: PHRASE };
    });
    const r = await autoSend();
    expect(r.reason).toMatch(/preparação automática falhou: var1 não foi salvo/);
    expect(tpl.send).not.toHaveBeenCalled();
    expect(stored()).toBeUndefined();
    expect(recipient().last_error).toMatch(/mudou durante a prévia/);
  });

  it("IA fora do ar: usa a retomada contextual (validada), salva e envia a salva", async () => {
    enableAutomation();
    llm.run.mockRejectedValueOnce(new Error("timeout"));
    const r = await autoSend();
    expect(r.status).toBe("sent");
    expect(stored().phrase_source).toBe("context");
    expect(tpl.send.mock.calls[0][0].variables).toEqual(stored().variables);
  });

  it("idempotente: segundo ciclo não reenvia nem regenera", async () => {
    enableAutomation();
    await autoSend();
    const again = await autoSend();
    expect(again.status).toBe("idempotent");
    expect(tpl.send).toHaveBeenCalledTimes(1);
    expect(llm.run).toHaveBeenCalledTimes(1);
  });

  it("manual continua exigindo a prévia explícita", async () => {
    enableAutomation();
    const r = await realSend(); // mode manual
    expect(r.reason).toMatch(/nenhum var1 preparado/);
    expect(llm.run).not.toHaveBeenCalled();
  });
});

describe("runAutomaticRelationshipBatch", () => {
  it("automação desligada: nada é preparado nem enviado", async () => {
    process.env.RELATIONSHIP_CAMPAIGN_ENABLE_REAL_SEND = "true";
    const r = await runAutomaticRelationshipBatch({
      companyId: "c1",
      relationshipCampaignId: "camp-1",
      now: NOW,
    });
    expect(r.status).toBe("disabled");
    expect(llm.run).not.toHaveBeenCalled();
    expect(db.writes).toEqual([]);
  });

  it("envio real desligado: o ciclo só prepara (prévia salva), sem enviar", async () => {
    Object.assign(db.tables.relationship_campaign_settings[0], {
      mode: "automatic",
      automatic_enabled: true,
    });
    const r = await runAutomaticRelationshipBatch({
      companyId: "c1",
      relationshipCampaignId: "camp-1",
      now: NOW,
    });
    expect(r).toMatchObject({ status: "ran", real_send_enabled: false });
    expect(r.results[0]).toMatchObject({ recipient_id: "rec-1", status: "preview" });
    expect(tpl.send).not.toHaveBeenCalled();
    expect(recipient()).toMatchObject({ status: "pending", attempts: 0 });
    expect(stored().variables).toEqual({ var1: PHRASE });
  });

  it("com o gate ligado (só no teste): prepara e envia cada candidato", async () => {
    Object.assign(db.tables.relationship_campaign_settings[0], {
      mode: "automatic",
      automatic_enabled: true,
    });
    process.env.RELATIONSHIP_CAMPAIGN_ENABLE_REAL_SEND = "true";
    const r = await runAutomaticRelationshipBatch({
      companyId: "c1",
      relationshipCampaignId: "camp-1",
      now: NOW,
    });
    expect(r.results[0]).toMatchObject({ recipient_id: "rec-1", status: "sent" });
    expect(tpl.send.mock.calls[0][0].variables).toEqual(stored().variables);
  });
});
