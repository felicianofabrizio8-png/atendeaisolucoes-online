// Campanhas de relacionamento — prévia e envio: template certo, {{1}}/var1
// nunca vazio, prévia sem efeitos colaterais e lead sem conversa WhatsApp.

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
      order: () => chain,
      limit: (n: number) => ((limit = n), chain),
      maybeSingle: async () => ({ data: rows()[0] ?? null, error: null }),
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
            for (const r of hit) Object.assign(r, patch);
            db.writes.push({ op: "update", table, row: patch });
            return { data: hit[0] ? { id: hit[0].id } : null, error: null };
          },
          then: (cb: any) => {
            for (const r of rows()) Object.assign(r, patch);
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
const CHAMAR = template("chamar_novamente", "Oi! {{1}} Estou por aqui para ajudar.");
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

beforeEach(() => {
  seed();
  vi.clearAllMocks();
  delete process.env.RELATIONSHIP_CAMPAIGN_ENABLE_REAL_SEND;
  tpl.approved = { followup_resume: CHAMAR, reactivation: REATIVACAO };
  tpl.send.mockResolvedValue({ ok: true, simulated: false, externalId: "wamid.RC" });
  llm.run.mockResolvedValue({ text: "Conseguiu avaliar o ar split que conversamos?" });
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
      variables: { var1: "Conseguiu avaliar o ar split que conversamos?" },
      content: "Oi! Conseguiu avaliar o ar split que conversamos? Estou por aqui para ajudar.",
      phrase_source: "ai",
      conversation_id: "conv-wa",
    });
    expect(r.variables.var1).not.toMatch(/mariana|souza/i);
    // a IA leu a conversa real
    const prompt = llm.run.mock.calls[0][0].messages.map((m: any) => m.content).join("\n");
    expect(prompt).toContain("Vou pensar no valor");
    expect(prompt).toContain("Ar split 12.000 BTUs");
  });

  it("IA devolve o nome ou falha: {{1}} cai na retomada contextual, ainda não vazia", async () => {
    llm.run.mockResolvedValueOnce({ text: "Mariana, bora fechar?" });
    const a: any = await previewRelationshipDispatch(input);
    expect(a.variables.var1).toBe(
      "Posso ajudar com a questão de preço sobre Ar split 12.000 BTUs?",
    );
    expect(a.phrase_source).toBe("context");

    llm.run.mockRejectedValueOnce(new Error("timeout"));
    const b: any = await previewRelationshipDispatch(input);
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
  it("não envia, não cria conversa e não altera o destinatário", async () => {
    const r: any = await previewRelationshipDispatch(input);
    expect(r.blockers).toContain("envio real desabilitado no servidor");
    expect(tpl.send).not.toHaveBeenCalled();
    expect(db.writes).toEqual([]);
    expect(recipient()).toMatchObject({ status: "pending", attempts: 0 });
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
    expect(recipient().status).toBe("pending");
  });

  it("fora do horário a prévia ainda mostra o conteúdo, com o bloqueio", async () => {
    const r: any = await previewRelationshipDispatch({
      ...input,
      now: new Date("2026-09-28T23:00:00Z"),
    });
    expect(r.content).toContain("Oi!");
    expect(r.blockers).toContain("fora do horário comercial configurado");
  });

  it("dispatch com dryRun=false, mas envio real desabilitado, continua sendo só prévia", async () => {
    const r: any = await dispatchRelationshipRecipient({ ...input, dryRun: false });
    expect(r.status).toBe("preview");
    expect(tpl.send).not.toHaveBeenCalled();
    expect(db.writes).toEqual([]);
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
    expect(db.writes).toEqual([]);
    expect(db.tables.conversations).toHaveLength(1);
  });
});

describe("envio real (gate ligado só neste teste) usa a mesma preparação da prévia", () => {
  it("mesmo template e mesmo var1; cria conversa WhatsApp só aqui", async () => {
    const preview: any = await previewRelationshipDispatch(input);
    db.tables.conversations = [];
    process.env.RELATIONSHIP_CAMPAIGN_ENABLE_REAL_SEND = "true";
    const r: any = await dispatchRelationshipRecipient({ ...input, dryRun: false });
    expect(r).toMatchObject({ status: "sent", external_id: "wamid.RC", content: preview.content });
    expect(tpl.send).toHaveBeenCalledWith(
      expect.objectContaining({ purpose: "followup_resume", variables: preview.variables }),
    );
    expect(db.tables.conversations[0]).toMatchObject({ lead_id: "lead-1", channel: "whatsapp" });
    expect(recipient()).toMatchObject({
      status: "sent",
      attempts: 1,
      external_message_id: "wamid.RC",
    });
  });
});
