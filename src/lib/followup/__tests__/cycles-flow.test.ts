// Follow-up V2 — ciclos de negociação de ponta a ponta: tick, "Follow-up
// agora" e reativação sobre um banco falso que respeita as regras de
// unicidade de `followup_cycles`. Nada sai para a Meta nem para a IA.

/* eslint-disable @typescript-eslint/no-explicit-any */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ---------- Banco falso ----------
type Row = Record<string, any>;
const db = vi.hoisted(() => ({ tables: {} as Record<string, Row[]>, seq: 0 }));

vi.mock("@/integrations/supabase/client.server", () => {
  function from(table: string) {
    const preds: Array<(r: Row) => boolean> = [];
    let order: { col: string; asc: boolean } | null = null;
    let limit = Infinity;
    let head = false;
    const ms = (v: unknown) => Date.parse(String(v));
    const rows = () => {
      let out = (db.tables[table] ??= []).filter((r) => preds.every((p) => p(r)));
      if (order) {
        const { col, asc } = order;
        out = [...out].sort(
          (a, b) =>
            (ms(a[col]) - ms(b[col]) || String(a[col]).localeCompare(String(b[col]))) *
            (asc ? 1 : -1),
        );
      }
      return out.slice(0, limit);
    };
    const chain: any = {
      select: (_c?: string, o?: { head?: boolean }) => ((head = !!o?.head), chain),
      eq: (c: string, v: unknown) => (preds.push((r) => r[c] === v), chain),
      in: (c: string, vs: unknown[]) => (preds.push((r) => vs.includes(r[c])), chain),
      gte: (c: string, v: string) => (preds.push((r) => r[c] != null && ms(r[c]) >= ms(v)), chain),
      lte: (c: string, v: string) => (preds.push((r) => r[c] != null && ms(r[c]) <= ms(v)), chain),
      gt: (c: string, v: string) => (preds.push((r) => r[c] != null && ms(r[c]) > ms(v)), chain),
      lt: (c: string, v: string) => (preds.push((r) => r[c] != null && ms(r[c]) < ms(v)), chain),
      is: (c: string) => (preds.push((r) => r[c] == null), chain),
      not: (c: string, _op: string, list: string) => {
        const vs = list.replace(/[()]/g, "").split(",");
        preds.push((r) => !vs.includes(r[c]));
        return chain;
      },
      order: (col: string, o: { ascending: boolean }) => (
        (order = { col, asc: o.ascending }),
        chain
      ),
      limit: (n: number) => ((limit = n), chain),
      maybeSingle: async () => ({ data: rows()[0] ?? null, error: null }),
      then: (cb: any) => cb({ data: head ? null : rows(), count: rows().length, error: null }),
      insert: (row: Row) => {
        const t = (db.tables[table] ??= []);
        let error: { message: string } | null = null;
        const full: Row = {
          id: `${table}-${++db.seq}`,
          created_at: new Date().toISOString(),
          ...row,
        };
        if (table === "followup_cycles") {
          Object.assign(full, {
            state: "active",
            attempts: 0,
            failures: 0,
            closed_at: null,
            close_reason: null,
            ...row,
          });
          const dupRef = t.some(
            (c) =>
              c.company_id === row.company_id &&
              c.conversation_id === row.conversation_id &&
              c.reference_key === row.reference_key,
          );
          const dupActive = t.some(
            (c) => c.conversation_id === row.conversation_id && c.state === "active",
          );
          if (dupRef || dupActive)
            error = { message: "duplicate key value violates unique constraint" };
        }
        if (table === "follow_ups") full.sent_at ??= new Date().toISOString();
        if (!error) t.push(full);
        const res = { data: error ? null : full, error };
        return { select: () => ({ single: async () => res }), then: (cb: any) => cb(res) };
      },
      update: (patch: Row) => {
        const upd: any = {
          eq: (c: string, v: unknown) => (preds.push((r) => r[c] === v), upd),
          is: (c: string) => (preds.push((r) => r[c] == null), upd),
          then: (cb: any) => {
            for (const r of rows()) Object.assign(r, patch);
            return cb({ error: null });
          },
        };
        return upd;
      },
    };
    return chain;
  }
  return { supabaseAdmin: { from } };
});

// ---------- Transporte, templates, IA, prontidão, integração ----------
const sendText = vi.hoisted(() => vi.fn());
vi.mock("@/lib/ai-agent.server", () => ({ sendWhatsappText: sendText }));

const tpl = vi.hoisted(() => ({ approved: {} as Record<string, any>, send: vi.fn() }));
vi.mock("@/lib/wa-templates.server", () => ({
  findApprovedTemplateForPurpose: async (_c: string, purpose: string) =>
    tpl.approved[purpose] ?? null,
  renderTemplateBody: (t: any, vars: Record<string, string>) => ({
    body: String(t.components[0].text).replace("{{1}}", vars[t.variables[0]] ?? ""),
    parameters: [],
  }),
  sendWhatsappTemplate: tpl.send,
}));

const llm = vi.hoisted(() => ({ resume: vi.fn(), nextContact: vi.fn() }));
vi.mock("@/lib/llm-gateway/LLMGateway.server", () => ({
  LLMGateway: class {
    run(req: { tags?: { feature?: string } }) {
      return req.tags?.feature === "followup_next_contact" ? llm.nextContact(req) : llm.resume(req);
    }
  },
}));
vi.mock("@/lib/llm-gateway/providers/LovableChatProvider", () => ({
  LovableChatProvider: class {},
}));

vi.mock("@/lib/ai-readiness.server", () => ({ getReadiness: async () => ({ status: "ativa" }) }));
const integration = vi.hoisted(() => ({ connected: true }));
vi.mock("@/lib/followup/integration", () => ({
  getWhatsappIntegrationStatus: async () => ({ connected: integration.connected }),
}));

import { runFollowupTickForCompany } from "../tick";
import { runManualFollowup } from "../manual";
import { runReactivation } from "../reactivation";

// Quarta, 15/07/2026, 11:00 em Brasília.
const brt = (d: number, h: number, m = 0, mo = 7) =>
  new Date(Date.UTC(2026, mo - 1, d, h + 3, m)).toISOString();
const NOW = new Date(brt(15, 11));

const CHAMAR = {
  name: "chamar_novamente",
  category: "marketing",
  variables: ["var1"],
  components: [{ type: "BODY", text: "Oi! {{1}} Estou por aqui." }],
};

function msg(
  id: string,
  role: "lead" | "agent",
  at: string,
  text = "…",
  conv = "conv-1",
  company = "c1",
) {
  return { id, company_id: company, conversation_id: conv, role, text, at };
}

function seed() {
  db.seq = 0;
  db.tables = {
    company_settings: [
      {
        company_id: "c1",
        ai_followup_enabled: true,
        ai_followup_max_per_lead: 3,
        ai_followup_min_hours_between: 24,
        ai_followup_quote_delay_hours: 24,
        ai_followup_silence_delay_hours: 48,
        ai_followup_visit_delay_hours: 24,
        ai_followup_hot_delay_hours: 4,
        ai_followup_business_hours_only: true,
        business_hours_start: "09:00",
        business_hours_end: "18:00",
        ai_followup_timezone: "America/Sao_Paulo",
        ai_followup_business_days: [1, 2, 3, 4, 5],
        ai_followup_humanize: false,
        ai_followup_delay_jitter_minutes: 0,
        ai_followup_daily_limit: 50,
        ai_followup_min_response_rate: 0.05,
        ai_followup_warmup_enabled: false,
        ai_followup_reactivation_enabled: true,
        ai_followup_reactivation_days: 30,
        ai_followup_reactivation_daily_max: 2,
        ai_followup_reactivation_hours_start: "09:00",
        ai_followup_reactivation_hours_end: "18:00",
        ai_followup_reactivation_template: "Oi {{nome}}, tudo bem?",
      },
    ],
    conversations: [
      {
        id: "conv-1",
        company_id: "c1",
        lead_id: "lead-1",
        ai_status: null,
        ai_handling: false,
        human_takeover_at: null,
        lead_temperature: "morno",
        last_message_at: brt(13, 10, 5),
      },
    ],
    leads: [
      { id: "lead-1", company_id: "c1", name: "Mariana", product: "Ar split", status: "morno" },
    ],
    // Cliente perguntou, nós respondemos e ele sumiu.
    messages: [
      msg("m-l1", "lead", brt(13, 10), "Quanto fica a instalação?"),
      msg("m-a1", "agent", brt(13, 10, 5)),
    ],
    quotes: [],
    visits: [],
    followup_cycles: [],
    follow_ups: [],
    audit_log: [],
    ai_flow_events: [],
  };
}

const cycles = () => db.tables.followup_cycles;
const followUps = () => db.tables.follow_ups;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  seed();
  vi.clearAllMocks();
  integration.connected = true;
  tpl.approved = { followup_resume: CHAMAR };
  tpl.send.mockResolvedValue({ ok: true, simulated: false, externalId: "wamid.T" });
  sendText.mockResolvedValue({ ok: true, simulated: false, externalId: "wamid.X" });
  llm.resume.mockResolvedValue({ text: "Conseguiu ver a instalação do ar split?" });
  llm.nextContact.mockResolvedValue({ text: '{"date":null,"evidence":""}' });
});
afterEach(() => vi.useRealTimers());

describe("abertura do ciclo", () => {
  it("nossa mensagem sem resposta abre um ciclo com motivo, referência e próxima data", async () => {
    db.tables.messages[1].at = brt(15, 9); // respondemos hoje 09:00
    db.tables.conversations[0].last_message_at = brt(15, 9);
    const r = await runFollowupTickForCompany("c1", NOW);
    expect(r.opened).toBe(1);
    expect(cycles()[0]).toMatchObject({
      reason: "lead_silent",
      reference_key: "msg:m-a1",
      reference_at: brt(15, 9),
      state: "active",
      attempts: 0,
      max_attempts: 3,
      schedule_source: "policy",
      next_followup_at: new Date(brt(17, 9)).toISOString(), // +48h
    });
    expect(tpl.send).not.toHaveBeenCalled();
  });

  it("cliente esperando resposta é pendência de atendimento, não follow-up", async () => {
    db.tables.messages.push(msg("m-l2", "lead", brt(13, 11), "E aí?"));
    db.tables.conversations[0].last_message_at = brt(13, 11);
    const r = await runFollowupTickForCompany("c1", NOW);
    expect(r).toMatchObject({ opened: 0, pendingAttendance: 1, sent: 0 });
    expect(cycles()).toHaveLength(0);
  });

  it("orçamento sem resposta tem prioridade e referência própria; antigo demais não entra", async () => {
    db.tables.quotes.push({
      id: "q1",
      company_id: "c1",
      conversation_id: "conv-1",
      sent: true,
      sent_at: brt(14, 16),
      status: "enviado",
    });
    db.tables.conversations[0].last_message_at = brt(14, 16);
    await runFollowupTickForCompany("c1", NOW);
    expect(cycles()[0]).toMatchObject({ reason: "quote_no_reply", reference_key: "quote:q1" });

    seed();
    db.tables.quotes.push({
      id: "q-old",
      company_id: "c1",
      conversation_id: "conv-1",
      sent: true,
      sent_at: brt(1, 10, 0, 6),
      status: "enviado",
    });
    db.tables.messages = [msg("m-a0", "agent", brt(1, 10, 0, 6))];
    db.tables.conversations[0].last_message_at = brt(1, 10, 0, 6);
    expect((await runFollowupTickForCompany("c1", NOW)).opened).toBe(0);
  });

  it("mensagem nossa parada há mais de 7 dias não abre ciclo automático (é reativação)", async () => {
    db.tables.messages = [msg("m-l1", "lead", brt(4, 10)), msg("m-a1", "agent", brt(4, 10, 5))];
    db.tables.conversations[0].last_message_at = brt(4, 10, 5);
    expect((await runFollowupTickForCompany("c1", NOW)).opened).toBe(0);
    // …mas o admin ainda pode pedir o contato explicitamente
    const out = await runManualFollowup({
      companyId: "c1",
      userId: "admin",
      conversationId: "conv-1",
    });
    expect(out).toMatchObject({ eligible: true, sendStatus: "sent", attempt: 1 });
  });

  it("prazo explícito do cliente define a data (e tem prioridade)", async () => {
    db.tables.messages = [
      msg("m-l1", "lead", brt(15, 9), "Vou ver com meu marido, me chama semana que vem"),
      msg("m-a1", "agent", brt(15, 9, 5), "Combinado!"),
    ];
    db.tables.conversations[0].last_message_at = brt(15, 9, 5);
    await runFollowupTickForCompany("c1", NOW);
    expect(cycles()[0]).toMatchObject({
      schedule_source: "client_deadline",
      next_followup_at: new Date(brt(20, 9)).toISOString(), // segunda 09:00
      metadata: { deadline_evidence: "semana que vem" },
    });
    expect(llm.nextContact).not.toHaveBeenCalled();
  });

  it("IA sugere a data quando o cliente fala de tempo sem prazo exato — só com evidência real", async () => {
    db.tables.messages = [
      msg("m-l1", "lead", brt(15, 9), "Assim que o salário cair eu fecho"),
      msg("m-a1", "agent", brt(15, 9, 5), "Perfeito"),
    ];
    db.tables.conversations[0].last_message_at = brt(15, 9, 5);
    llm.nextContact.mockResolvedValueOnce({
      text: '{"date":"2026-08-05","evidence":"assim que o salário cair"}',
    });
    await runFollowupTickForCompany("c1", NOW);
    expect(cycles()[0]).toMatchObject({
      schedule_source: "ai_suggestion",
      next_followup_at: new Date(brt(5, 9, 0, 8)).toISOString(),
    });

    // evidência que o cliente não escreveu → política
    seed();
    db.tables.messages = [
      msg("m-l1", "lead", brt(15, 9), "Assim que o salário cair eu fecho"),
      msg("m-a1", "agent", brt(15, 9, 5), "Perfeito"),
    ];
    db.tables.conversations[0].last_message_at = brt(15, 9, 5);
    llm.nextContact.mockResolvedValueOnce({
      text: '{"date":"2026-08-05","evidence":"cliente pediu dia 5"}',
    });
    await runFollowupTickForCompany("c1", NOW);
    expect(cycles()[0].schedule_source).toBe("policy");
  });
});

describe("tentativas do ciclo", () => {
  it("vencido: envia chamar_novamente contextual fora da janela e agenda a próxima", async () => {
    const r = await runFollowupTickForCompany("c1", NOW); // abre (ref 13/07 10:05 +48h = vencido) e envia
    expect(r).toMatchObject({ opened: 1, sent: 1 });
    expect(tpl.send.mock.calls[0][0]).toMatchObject({
      purpose: "followup_resume",
      variables: { var1: "Conseguiu ver a instalação do ar split?" },
    });
    const c = cycles()[0];
    expect(c).toMatchObject({ attempts: 1, state: "active", last_contact_at: NOW.toISOString() });
    expect(c.next_followup_at).toBe(new Date(brt(20, 11)).toISOString()); // +120h (silêncio, 2ª)
    expect(followUps()[0]).toMatchObject({ status: "sent", cycle_id: c.id, attempt_number: 1 });
  });

  it("dentro da janela envia texto, sem template", async () => {
    db.tables.messages = [msg("m-l1", "lead", brt(15, 7)), msg("m-a1", "agent", brt(15, 7, 5))];
    db.tables.conversations[0].last_message_at = brt(15, 7, 5);
    db.tables.company_settings[0].ai_followup_silence_delay_hours = 2;
    await runFollowupTickForCompany("c1", NOW);
    expect(sendText).toHaveBeenCalledTimes(1);
    expect(tpl.send).not.toHaveBeenCalled();
  });

  it("última tentativa encerra por max_attempts; nossos follow-ups não reabrem a negociação", async () => {
    await runFollowupTickForCompany("c1", NOW);
    const c = cycles()[0];
    Object.assign(c, { attempts: 2, next_followup_at: brt(15, 10) });
    // o follow-up anterior virou mensagem nossa na conversa
    db.tables.messages.push(msg("m-fu1", "agent", brt(14, 10)));
    await runFollowupTickForCompany("c1", NOW);
    expect(c).toMatchObject({
      state: "closed",
      close_reason: "max_attempts",
      attempts: 3,
      next_followup_at: null,
    });

    db.tables.messages.push(msg("m-fu3", "agent", NOW.toISOString()));
    db.tables.conversations[0].last_message_at = NOW.toISOString();
    vi.setSystemTime(new Date(brt(17, 11)));
    const again = await runFollowupTickForCompany("c1", new Date(brt(17, 11)));
    expect(again.opened).toBe(0);
    expect(cycles()).toHaveLength(1);
  });

  it("cliente respondeu: o ciclo encerra e nada é enviado", async () => {
    await runFollowupTickForCompany("c1", NOW);
    const c = cycles()[0];
    Object.assign(c, { next_followup_at: brt(15, 10) });
    db.tables.messages.push(msg("m-l9", "lead", brt(15, 10, 30), "Oi, voltei"));
    tpl.send.mockClear();
    await runFollowupTickForCompany("c1", NOW);
    expect(c).toMatchObject({ state: "closed", close_reason: "client_replied" });
    expect(tpl.send).not.toHaveBeenCalled();
  });

  it.each([
    [{ status: "fechado" }, "sale_closed"],
    [{ lost_at: brt(15, 8) }, "sale_lost"],
  ])("lead %o: o ciclo encerra (%s)", async (patch, reason) => {
    db.tables.messages[1].at = brt(15, 9);
    db.tables.conversations[0].last_message_at = brt(15, 9);
    await runFollowupTickForCompany("c1", NOW); // abre
    const c = cycles()[0];
    Object.assign(c, { next_followup_at: brt(15, 10) });
    Object.assign(db.tables.leads[0], patch);
    await runFollowupTickForCompany("c1", NOW);
    expect(c).toMatchObject({ state: "closed", close_reason: reason });
    expect(tpl.send).not.toHaveBeenCalled();
  });

  it("nova negociação depois do encerramento abre outro ciclo para o mesmo lead", async () => {
    await runFollowupTickForCompany("c1", NOW);
    Object.assign(cycles()[0], {
      state: "closed",
      close_reason: "max_attempts",
      closed_at: brt(15, 11),
      next_followup_at: null,
    });
    // cliente voltou, negociamos de novo e mandamos um orçamento novo
    db.tables.messages.push(msg("m-l5", "lead", brt(16, 9)), msg("m-a5", "agent", brt(16, 9, 5)));
    db.tables.quotes.push({
      id: "q2",
      company_id: "c1",
      conversation_id: "conv-1",
      sent: true,
      sent_at: brt(16, 9, 10),
      status: "enviado",
    });
    db.tables.conversations[0].last_message_at = brt(16, 9, 10);
    vi.setSystemTime(new Date(brt(16, 11)));
    const r = await runFollowupTickForCompany("c1", new Date(brt(16, 11)));
    expect(r.opened).toBe(1);
    expect(cycles()[1]).toMatchObject({
      reason: "quote_no_reply",
      reference_key: "quote:q2",
      state: "active",
      attempts: 0,
    });
  });

  it("equipe falou de novo depois do último contato: reagenda sem zerar tentativas", async () => {
    await runFollowupTickForCompany("c1", NOW);
    const c = cycles()[0];
    Object.assign(c, { next_followup_at: brt(15, 10), last_contact_at: brt(14, 10) });
    db.tables.messages.push(msg("m-human", "agent", brt(15, 8), "Separei duas opções pra você"));
    tpl.send.mockClear();
    const r = await runFollowupTickForCompany("c1", NOW);
    expect(tpl.send).not.toHaveBeenCalled();
    expect(r.skipped[0].reason).toMatch(/reagendada/);
    expect(c.attempts).toBe(1);
    expect(Date.parse(c.next_followup_at)).toBeGreaterThan(NOW.getTime());
  });

  it("falha de envio tenta de novo em 1h útil; 3 falhas encerram o ciclo", async () => {
    tpl.send.mockResolvedValue({ ok: false, simulated: false, error: "HTTP 500" });
    await runFollowupTickForCompany("c1", NOW);
    const c = cycles()[0];
    expect(c).toMatchObject({
      failures: 1,
      attempts: 0,
      next_followup_at: new Date(brt(15, 12)).toISOString(),
    });
    expect(followUps()[0]).toMatchObject({ status: "failed" });
    for (const h of [12, 13]) {
      vi.setSystemTime(new Date(brt(15, h)));
      await runFollowupTickForCompany("c1", new Date(brt(15, h)));
    }
    expect(c).toMatchObject({ state: "closed", close_reason: "send_failed", failures: 3 });
  });

  it("sem template aprovado: registra 'blocked' (aceito pelo banco) e tenta no dia seguinte", async () => {
    tpl.approved = {};
    await runFollowupTickForCompany("c1", NOW);
    expect(followUps()[0]).toMatchObject({ status: "blocked" });
    expect(cycles()[0]).toMatchObject({
      failures: 1,
      next_followup_at: new Date(brt(16, 11)).toISOString(),
    });
  });

  it("fora do horário útil: abre ciclos, mas não envia", async () => {
    const night = new Date(brt(15, 21));
    vi.setSystemTime(night);
    const r = await runFollowupTickForCompany("c1", night);
    expect(r.opened).toBe(1);
    expect(r.errors).toContain("fora do horário comercial");
    expect(tpl.send).not.toHaveBeenCalled();
    expect(sendText).not.toHaveBeenCalled();
  });

  it("gate fechado (sem integração) não envia", async () => {
    integration.connected = false;
    const r = await runFollowupTickForCompany("c1", NOW);
    expect(r.sent).toBe(0);
    expect(tpl.send).not.toHaveBeenCalled();
  });

  it("isolamento: ciclos de outra empresa não são processados", async () => {
    db.tables.followup_cycles.push({
      id: "other",
      company_id: "c2",
      conversation_id: "conv-x",
      lead_id: "lead-x",
      reason: "lead_silent",
      reference_key: "msg:x",
      reference_at: brt(1, 10),
      state: "active",
      attempts: 0,
      max_attempts: 3,
      failures: 0,
      next_followup_at: brt(15, 9),
      metadata: {},
    });
    await runFollowupTickForCompany("c1", NOW);
    expect(tpl.send.mock.calls.every((c) => c[0].companyId === "c1")).toBe(true);
    expect(db.tables.followup_cycles.find((c) => c.id === "other")).toMatchObject({ attempts: 0 });
  });
});

describe("Follow-up agora", () => {
  it("cliente esperando resposta: não é follow-up", async () => {
    db.tables.messages.push(msg("m-l2", "lead", brt(15, 10), "Oi?"));
    const out = await runManualFollowup({
      companyId: "c1",
      userId: "admin",
      conversationId: "conv-1",
    });
    expect(out.eligible).toBe(false);
    expect(out.blockedReason).toMatch(/atendimento pendente/);
    expect(tpl.send).not.toHaveBeenCalled();
  });

  it("sem ciclo: abre pelas mesmas regras, envia já e agenda a próxima", async () => {
    db.tables.messages[1].at = brt(15, 10, 30); // nossa msg de meia hora atrás
    const out = await runManualFollowup({
      companyId: "c1",
      userId: "admin",
      conversationId: "conv-1",
    });
    expect(out).toMatchObject({ eligible: true, sendStatus: "sent", attempt: 1, via: "template" });
    expect(out.nextFollowupAt).toBe(new Date(brt(20, 11)).toISOString());
    expect(cycles()[0]).toMatchObject({ attempts: 1, state: "active" });
    expect(followUps()[0]).toMatchObject({
      trigger_reason: "manual_admin",
      cycle_id: cycles()[0].id,
    });
  });

  it("com ciclo ativo: só antecipa a próxima tentativa do mesmo ciclo", async () => {
    await runFollowupTickForCompany("c1", NOW); // tentativa 1
    const c = cycles()[0];
    vi.setSystemTime(new Date(brt(16, 10)));
    const out = await runManualFollowup({
      companyId: "c1",
      userId: "admin",
      conversationId: "conv-1",
    });
    expect(out).toMatchObject({ sendStatus: "sent", attempt: 2 });
    expect(cycles()).toHaveLength(1);
    expect(c.attempts).toBe(2);
  });

  it("venda fechada: bloqueado", async () => {
    db.tables.leads[0].status = "fechado";
    const out = await runManualFollowup({
      companyId: "c1",
      userId: "admin",
      conversationId: "conv-1",
    });
    expect(out).toMatchObject({ eligible: false, blockedReason: "venda fechada ou perdida" });
  });
});

describe("reativação", () => {
  beforeEach(() => {
    db.tables.leads.push(
      {
        id: "lead-old",
        company_id: "c1",
        name: "Bruno",
        status: "morno",
        updated_at: brt(1, 10, 0, 5),
        reactivated_at: null,
      },
      {
        id: "lead-old2",
        company_id: "c1",
        name: "Carla",
        status: "frio",
        updated_at: brt(1, 10, 0, 5),
        reactivated_at: null,
      },
      {
        id: "lead-old3",
        company_id: "c1",
        name: "Davi",
        status: "frio",
        updated_at: brt(1, 10, 0, 5),
        reactivated_at: null,
      },
    );
    for (const [i, id] of ["lead-old", "lead-old2", "lead-old3"].entries()) {
      db.tables.conversations.push({
        id: `conv-r${i}`,
        company_id: "c1",
        lead_id: id,
        ai_status: null,
        ai_handling: false,
        human_takeover_at: null,
        last_message_at: brt(1, 10, 0, 5),
      });
      db.tables.messages.push(msg(`m-r${i}`, "lead", brt(1, 9, 0, 5), "oi", `conv-r${i}`));
    }
    tpl.approved = { returning_customer: { ...CHAMAR, name: "reativacao_cliente" } };
  });

  it("fora da janela sai por template aprovado, nunca texto livre; respeita o máximo do dia", async () => {
    const out = await runReactivation("c1", NOW);
    expect(out.sent).toBe(2); // máximo por dia = 2
    expect(sendText).not.toHaveBeenCalled();
    expect(tpl.send).toHaveBeenCalledTimes(2);
    expect(tpl.send.mock.calls[0][0].purpose).toBe("returning_customer");
    expect(followUps().every((f) => f.trigger_reason === "reactivation")).toBe(true);

    const again = await runReactivation("c1", NOW);
    expect(again.sent).toBe(0);
    expect(again.skipped[0].reason).toMatch(/limite diário/);
  });

  it("não se mete em negociação com ciclo ativo", async () => {
    db.tables.followup_cycles.push({
      id: "cy",
      company_id: "c1",
      conversation_id: "conv-r0",
      state: "active",
    });
    db.tables.company_settings[0].ai_followup_reactivation_daily_max = 5;
    const out = await runReactivation("c1", NOW);
    expect(out.skipped.some((s) => s.leadId === "lead-old" && /ciclo ativo/.test(s.reason))).toBe(
      true,
    );
  });
});
