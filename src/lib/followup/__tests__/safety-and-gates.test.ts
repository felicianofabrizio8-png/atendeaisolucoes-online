// ============================================================================
// Gates globais do follow-up: warmup, horário comercial no fuso da empresa e
// o gate `canSendFollowupNow` — que falha FECHADO.
// Nenhum acesso a rede/banco; nenhum envio real de mensagem.
// ============================================================================

/* eslint-disable @typescript-eslint/no-explicit-any */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { DEFAULT_TEMPLATES, isWithinBusinessHours } from "@/lib/followup/defaults";
import type { FollowupSettings } from "@/lib/followup";

// ---------- Banco falso (eq/in/gte/is + count + update) ----------
const db = vi.hoisted(() => ({
  tables: {} as Record<string, Array<Record<string, any>>>,
  updates: [] as Array<{ table: string; patch: any }>,
  fail: null as string | null,
}));
vi.mock("@/integrations/supabase/client.server", () => {
  function from(table: string) {
    const eqs: Array<[string, unknown]> = [];
    const ins: Array<[string, unknown[]]> = [];
    const gtes: Array<[string, string]> = [];
    const nulls: string[] = [];
    let head = false;
    const rows = () =>
      (db.tables[table] ?? []).filter(
        (r) =>
          eqs.every(([c, v]) => r[c] === v) &&
          ins.every(([c, vs]) => vs.includes(r[c])) &&
          gtes.every(([c, v]) => Date.parse(r[c]) >= Date.parse(v)) &&
          nulls.every((c) => r[c] == null),
      );
    const result = () =>
      db.fail === table
        ? { data: null, count: null, error: { message: "boom" } }
        : { data: head ? null : rows(), count: rows().length, error: null };
    const chain: any = {
      select: (_c: string, opts?: { head?: boolean }) => ((head = !!opts?.head), chain),
      eq: (c: string, v: unknown) => (eqs.push([c, v]), chain),
      in: (c: string, vs: unknown[]) => (ins.push([c, vs]), chain),
      gte: (c: string, v: string) => (gtes.push([c, v]), chain),
      is: (c: string) => (nulls.push(c), chain),
      maybeSingle: async () => ({ data: rows()[0] ?? null, error: null }),
      then: (cb: any) => cb(result()),
      update: (patch: any) => {
        const upd: any = {
          eq: (c: string, v: unknown) => (eqs.push([c, v]), upd),
          is: (c: string) => (nulls.push(c), upd),
          then: (cb: any) => {
            for (const r of rows()) Object.assign(r, patch);
            db.updates.push({ table, patch });
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

const integration = vi.hoisted(() => ({ connected: true, throws: false }));
vi.mock("@/lib/followup/integration", () => ({
  getWhatsappIntegrationStatus: async () => {
    if (integration.throws) throw new Error("graph fora");
    return { connected: integration.connected };
  },
}));

import { canSendFollowupNow, warmupCapacity } from "@/lib/followup/gates";

const baseSettings: FollowupSettings = {
  enabled: true,
  maxPerLead: 3,
  minHoursBetween: 24,
  quoteDelayHours: 24,
  silenceDelayHours: 48,
  visitDelayHours: 24,
  hotDelayHours: 4,
  businessHoursOnly: true,
  businessHoursStart: "09:00:00",
  businessHoursEnd: "18:00:00",
  tone: "amigavel",
  templates: DEFAULT_TEMPLATES,
  initialMessage: null,
  agentName: "Fabrizio",
  timeZone: "America/Sao_Paulo",
  businessDays: [1, 2, 3, 4, 5],
};

describe("gates.warmupCapacity", () => {
  const dailyLimit = 100;

  it("sem data de início → 10% (mínimo do warmup)", () => {
    expect(warmupCapacity(null, dailyLimit)).toBe(10);
  });

  it("< 1 dia → 10%", () => {
    const startedAt = new Date(Date.now() - 2 * 3600 * 1000).toISOString();
    expect(warmupCapacity(startedAt, dailyLimit)).toBe(10);
  });

  it("1-2 dias → 25%", () => {
    const startedAt = new Date(Date.now() - 36 * 3600 * 1000).toISOString();
    expect(warmupCapacity(startedAt, dailyLimit)).toBe(25);
  });

  it("3-6 dias → 50%", () => {
    const startedAt = new Date(Date.now() - 4 * 24 * 3600 * 1000).toISOString();
    expect(warmupCapacity(startedAt, dailyLimit)).toBe(50);
  });

  it(">= 7 dias → 100% (limite total)", () => {
    const startedAt = new Date(Date.now() - 8 * 24 * 3600 * 1000).toISOString();
    expect(warmupCapacity(startedAt, dailyLimit)).toBe(dailyLimit);
  });

  it("nunca ultrapassa o dailyLimit", () => {
    const past = new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString();
    for (const limit of [1, 7, 50, 200]) {
      expect(warmupCapacity(past, limit)).toBe(limit);
    }
  });
});

describe("defaults.isWithinBusinessHours — fuso e dias úteis da empresa", () => {
  // Hora de Brasília (UTC-3) convertida para o instante real.
  const brt = (y: number, mo: number, d: number, h: number, m = 0) =>
    new Date(Date.UTC(y, mo - 1, d, h + 3, m));

  it("usa o fuso da empresa, não o do servidor (UTC)", () => {
    // 09:30 em Brasília = 12:30 UTC → dentro; 07:00 em Brasília = 10:00 UTC → fora.
    expect(isWithinBusinessHours(baseSettings, brt(2026, 7, 15, 9, 30))).toBe(true);
    expect(isWithinBusinessHours(baseSettings, brt(2026, 7, 15, 7))).toBe(false);
    // 17:30 em Brasília (20:30 UTC) ainda é expediente; 18:00 já não.
    expect(isWithinBusinessHours(baseSettings, brt(2026, 7, 15, 17, 30))).toBe(true);
    expect(isWithinBusinessHours(baseSettings, brt(2026, 7, 15, 18))).toBe(false);
  });

  it("fim de semana e feriado nacional não são dias úteis", () => {
    expect(isWithinBusinessHours(baseSettings, brt(2026, 7, 18, 10))).toBe(false); // sábado
    expect(isWithinBusinessHours(baseSettings, brt(2026, 7, 19, 10))).toBe(false); // domingo
    expect(isWithinBusinessHours(baseSettings, brt(2026, 9, 7, 10))).toBe(false); // Independência (seg)
    expect(isWithinBusinessHours(baseSettings, brt(2026, 4, 3, 10))).toBe(false); // Sexta-feira Santa
    expect(
      isWithinBusinessHours(
        { ...baseSettings, businessDays: [1, 2, 3, 4, 5, 6] },
        brt(2026, 7, 18, 10),
      ),
    ).toBe(true);
  });

  it("businessHoursOnly=false → sempre true", () => {
    const off = { ...baseSettings, businessHoursOnly: false };
    expect(isWithinBusinessHours(off, brt(2026, 7, 19, 3))).toBe(true);
  });
});

describe("gates.canSendFollowupNow — falha fechada", () => {
  const NOW = new Date("2026-07-15T15:00:00Z"); // 12:00 em Brasília

  beforeEach(() => {
    integration.connected = true;
    integration.throws = false;
    db.fail = null;
    db.updates = [];
    db.tables = {
      company_settings: [
        {
          company_id: "c1",
          ai_followup_enabled: true,
          ai_followup_timezone: "America/Sao_Paulo",
          ai_followup_daily_limit: 50,
          ai_followup_warmup_enabled: true,
          ai_followup_warmup_started_at: null,
          ai_followup_min_response_rate: 0.05,
        },
      ],
      follow_ups: [],
    };
  });

  it("warmup sem data começa a contar agora (não fica preso em 10%)", async () => {
    const r = await canSendFollowupNow("c1", NOW);
    expect(r).toMatchObject({ ok: true, remainingToday: 5 });
    expect(db.tables.company_settings[0].ai_followup_warmup_started_at).toBe(NOW.toISOString());
  });

  it("limite diário conta a partir da meia-noite no fuso da empresa", async () => {
    db.tables.company_settings[0].ai_followup_warmup_enabled = false;
    db.tables.company_settings[0].ai_followup_daily_limit = 2;
    db.tables.follow_ups = [
      // 22:00 de ontem em Brasília (01:00 UTC de hoje): NÃO é "hoje"
      { company_id: "c1", status: "sent", sent_at: "2026-07-15T01:00:00Z" },
      // 09:10 de hoje em Brasília
      { company_id: "c1", status: "sent", sent_at: "2026-07-15T12:10:00Z" },
      // bloqueado/simulado não contam como envio
      { company_id: "c1", status: "blocked", sent_at: "2026-07-15T12:20:00Z" },
      { company_id: "c1", status: "simulated", sent_at: "2026-07-15T12:30:00Z" },
    ];
    expect(await canSendFollowupNow("c1", NOW)).toMatchObject({ ok: true, remainingToday: 1 });
  });

  it("taxa de resposta considera só o que foi entregue", async () => {
    db.tables.company_settings[0].ai_followup_warmup_enabled = false;
    db.tables.company_settings[0].ai_followup_daily_limit = 500;
    const day = "2026-07-14T15:00:00Z";
    db.tables.follow_ups = [
      ...Array.from({ length: 20 }, () => ({ company_id: "c1", status: "sent", sent_at: day })),
      { company_id: "c1", status: "responded", sent_at: day, responded_at: day },
      { company_id: "c1", status: "responded", sent_at: day, responded_at: day },
      // 100 bloqueios não podem derrubar a taxa (2/22 ≈ 9% > 5%)
      ...Array.from({ length: 100 }, () => ({ company_id: "c1", status: "blocked", sent_at: day })),
    ];
    expect((await canSendFollowupNow("c1", NOW)).ok).toBe(true);
  });

  it("erro ao consultar → bloqueia (não libera às cegas)", async () => {
    db.tables.company_settings[0].ai_followup_warmup_started_at = "2026-07-01T00:00:00Z";
    db.fail = "follow_ups";
    const r = await canSendFollowupNow("c1", NOW);
    expect(r.ok).toBe(false);
  });

  it("integração indisponível (exceção) → bloqueia", async () => {
    integration.throws = true;
    const r = await canSendFollowupNow("c1", NOW);
    expect(r).toMatchObject({ ok: false });
    expect(r.reason).toMatch(/gate indisponível/);
  });

  it("sem configuração → bloqueia", async () => {
    db.tables.company_settings = [];
    expect((await canSendFollowupNow("c1", NOW)).ok).toBe(false);
  });
});
