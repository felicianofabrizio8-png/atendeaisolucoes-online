// Vendedora IA · Fase 0 — regressões das guardas puras.
import { describe, expect, it, vi } from "vitest";

vi.mock("@/integrations/supabase/client.server", () => ({ supabaseAdmin: { from: vi.fn() } }));
vi.mock("@/lib/outbound/MetaOutbound.server", () => ({ postGraph: vi.fn() }));

import {
  hasUnansweredLeadMessage,
  isWithinBusinessHours,
  shouldAutoReply,
  type AgentConversation,
} from "../ai-agent.server";
import type { AgentSettings } from "../sales-agent-core";
import { resolveWhatsappSendCredentials } from "../whatsapp/send-credentials";
import { buildSuggestProductCatalog } from "../product-suggestion";

const settings: AgentSettings = {
  company_id: "company-a",
  ai_auto_reply_enabled: true,
  ai_after_hours_only: false,
  ai_initial_message: null,
  ai_max_auto_replies: 5,
  ai_handoff_timeout_minutes: 30,
  ai_agent_name: "Atendente",
  business_hours_start: "08:00:00",
  business_hours_end: "18:00:00",
};

const conversation: AgentConversation = {
  id: "conv-1",
  company_id: "company-a",
  lead_id: "lead-1",
  channel: "whatsapp",
  ai_handling: false,
  ai_status: null,
  auto_reply_count: 0,
  last_auto_reply_at: null,
  human_takeover_at: null,
};

describe("horário comercial no fuso da empresa", () => {
  it("usa o fuso da empresa, não o UTC do Worker", () => {
    // 20:00 UTC = 17:00 em São Paulo → dentro do horário (UTC puro diria fora).
    expect(isWithinBusinessHours(settings, new Date("2026-09-30T20:00:00Z"))).toBe(true);
    // 10:00 UTC = 07:00 em São Paulo → fora (UTC puro diria dentro).
    expect(isWithinBusinessHours(settings, new Date("2026-09-30T10:00:00Z"))).toBe(false);
  });

  it("respeita o fuso configurado por empresa", () => {
    const lisbon = { ...settings, ai_followup_timezone: "Europe/Lisbon" };
    // 08:30 UTC = 09:30 em Lisboa (horário de verão).
    expect(isWithinBusinessHours(lisbon, new Date("2026-09-30T08:30:00Z"))).toBe(true);
    const manaus = { ...settings, ai_followup_timezone: "America/Manaus" };
    // 11:30 UTC = 07:30 em Manaus.
    expect(isWithinBusinessHours(manaus, new Date("2026-09-30T11:30:00Z"))).toBe(false);
  });

  it("fuso inválido cai no padrão da plataforma sem lançar", () => {
    const broken = { ...settings, ai_followup_timezone: "Not/AZone" };
    expect(() => isWithinBusinessHours(broken, new Date("2026-09-30T20:00:00Z"))).not.toThrow();
    expect(isWithinBusinessHours(broken, new Date("2026-09-30T20:00:00Z"))).toBe(true);
  });

  it("suporta faixa que atravessa a meia-noite", () => {
    const night = { ...settings, business_hours_start: "18:00", business_hours_end: "02:00" };
    expect(isWithinBusinessHours(night, new Date("2026-09-30T02:30:00Z"))).toBe(true); // 23:30 SP
    expect(isWithinBusinessHours(night, new Date("2026-09-30T15:00:00Z"))).toBe(false); // 12:00 SP
  });

  it("after_hours_only avalia o horário local", () => {
    const afterHours = { ...settings, ai_after_hours_only: true };
    expect(shouldAutoReply(conversation, afterHours, new Date("2026-09-30T20:00:00Z"), 0)).toEqual({
      ok: false,
      reason: "business_hours",
    });
    expect(shouldAutoReply(conversation, afterHours, new Date("2026-09-30T23:30:00Z"), 0)).toEqual({
      ok: true,
    });
  });
});

describe("shouldAutoReply", () => {
  const now = new Date("2026-09-30T23:00:00Z");

  it("não descarta resposta rápida do cliente logo após a resposta da IA", () => {
    const justReplied = {
      ...conversation,
      last_auto_reply_at: new Date(now.getTime() - 5_000).toISOString(),
    };
    expect(shouldAutoReply(justReplied, settings, now, 1)).toEqual({ ok: true });
  });

  it("limite de respostas é por janela, não vitalício", () => {
    const longConversation = { ...conversation, auto_reply_count: 40 };
    expect(shouldAutoReply(longConversation, settings, now, 2)).toEqual({ ok: true });
    expect(shouldAutoReply(longConversation, settings, now, 5)).toEqual({
      ok: false,
      reason: "rate_limit",
    });
  });

  it("aguardando_humano bloqueia a IA", () => {
    expect(
      shouldAutoReply({ ...conversation, ai_status: "aguardando_humano" }, settings, now, 0),
    ).toEqual({
      ok: false,
      reason: "human_pending",
    });
  });

  it("assumido_humano e human_takeover_at continuam bloqueando", () => {
    expect(
      shouldAutoReply({ ...conversation, ai_status: "assumido_humano" }, settings, now, 0),
    ).toEqual({
      ok: false,
      reason: "human_active",
    });
    expect(
      shouldAutoReply({ ...conversation, human_takeover_at: now.toISOString() }, settings, now, 0),
    ).toEqual({ ok: false, reason: "human_active" });
  });
});

describe("hasUnansweredLeadMessage", () => {
  it("detecta mensagem do cliente ainda sem resposta", () => {
    expect(hasUnansweredLeadMessage([{ role: "agent" }, { role: "lead" }])).toBe(true);
    expect(hasUnansweredLeadMessage([{ role: "lead" }, { role: "system" }])).toBe(true);
  });

  it("mensagem já respondida (IA ou humano) não gera novo turno", () => {
    expect(hasUnansweredLeadMessage([{ role: "lead" }, { role: "agent" }])).toBe(false);
    expect(hasUnansweredLeadMessage([])).toBe(false);
  });
});

describe("credenciais WhatsApp por empresa", () => {
  const env = {
    WHATSAPP_ACCESS_TOKEN: "GLOBAL-TOKEN",
    WHATSAPP_PHONE_NUMBER_ID: "PLATFORM-NUMBER",
  };

  it("usa sempre a integração da empresa quando tem token", () => {
    expect(
      resolveWhatsappSendCredentials(
        { access_token: "TENANT-TOKEN", external_account_id: "TENANT-NUMBER" },
        env,
      ),
    ).toEqual({
      ok: true,
      accessToken: "TENANT-TOKEN",
      phoneNumberId: "TENANT-NUMBER",
      source: "integration",
    });
  });

  it("empresa sem integração nunca usa o número global", () => {
    expect(resolveWhatsappSendCredentials(null, env)).toEqual({
      ok: false,
      reason: "no_integration",
    });
  });

  it("integração de outro número sem token não herda o token global", () => {
    expect(
      resolveWhatsappSendCredentials(
        { access_token: null, external_account_id: "TENANT-NUMBER" },
        env,
      ),
    ).toEqual({ ok: false, reason: "no_access_token" });
  });

  it("integração sem phone_number_id não herda o número global", () => {
    expect(
      resolveWhatsappSendCredentials(
        { access_token: "TENANT-TOKEN", external_account_id: null },
        env,
      ),
    ).toEqual({ ok: false, reason: "no_phone_number_id" });
  });

  it("token global só completa a integração do mesmo número", () => {
    expect(
      resolveWhatsappSendCredentials(
        { access_token: null, external_account_id: "PLATFORM-NUMBER" },
        env,
      ),
    ).toEqual({
      ok: true,
      accessToken: "GLOBAL-TOKEN",
      phoneNumberId: "PLATFORM-NUMBER",
      source: "env_same_number",
    });
  });
});

describe("catálogo da sugestão de produto", () => {
  it("usa somente produtos ativos da empresa do usuário", () => {
    const catalog = buildSuggestProductCatalog(
      [
        {
          id: "a-1",
          company_id: "company-a",
          active: true,
          name: "Produto A",
          category: "Cat",
          description: "",
        },
        { id: "a-2", company_id: "company-a", active: false, name: "Inativo" },
        { id: "b-1", company_id: "company-b", active: true, name: "Produto de outra empresa" },
        { id: "", company_id: "company-a", active: true, name: "Sem id" },
      ],
      "company-a",
    );
    expect(catalog).toEqual([{ id: "a-1", name: "Produto A", category: "Cat", description: null }]);
  });

  it("sem company_id não devolve catálogo", () => {
    expect(
      buildSuggestProductCatalog([{ id: "x", company_id: "", active: true, name: "X" }], ""),
    ).toEqual([]);
  });
});
