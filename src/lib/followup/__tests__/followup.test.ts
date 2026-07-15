// ============================================================================
// Testes de integração — módulo Follow-up (Fase A).
// Cobrem as funções puras (defaults, humanizer, jitter) e garantem que o
// barrel `@/lib/followup` expõe a mesma superfície pública das fachadas
// legadas `ai-followup.server` e `ai-followup-v2.server` — evitando qualquer
// regressão de assinatura durante a consolidação.
// ============================================================================

import { describe, it, expect } from "vitest";

import * as barrel from "@/lib/followup";
import {
  DEFAULT_TEMPLATES,
  firstName,
  renderTemplate,
  isWithinBusinessHours,
} from "@/lib/followup/defaults";
import { humanizeTemplate, jitterDelayMs } from "@/lib/followup/humanizer";
import type { FollowupSettings } from "@/lib/followup";

describe("defaults", () => {
  it("DEFAULT_TEMPLATES cobre todas as regras", () => {
    const rules = [
      "quote_no_reply",
      "lead_silent",
      "visit_no_return",
      "hot_lead_idle",
      "returning_customer",
    ] as const;
    for (const r of rules) {
      expect(DEFAULT_TEMPLATES[r]).toBeTruthy();
      // não pode conter termos promocionais reprovados pela WhatsApp Utility
      expect(DEFAULT_TEMPLATES[r]).not.toMatch(
        /desconto|promoç|oferta|últimas unidades/i,
      );
    }
  });

  it("firstName retorna primeiro nome ou fallback amigável", () => {
    expect(firstName("João da Silva")).toBe("João");
    expect(firstName("  Maria  Antonia ")).toBe("Maria");
    expect(firstName(null)).toBe("tudo bem");
    expect(firstName("")).toBe("tudo bem");
  });

  it("renderTemplate substitui placeholders declarados", () => {
    expect(renderTemplate("Oi {{nome}}, sobre {{produto}}", { nome: "Ana", produto: "X" }))
      .toBe("Oi Ana, sobre X");
    // Placeholder não fornecido vira string vazia
    expect(renderTemplate("Oi {{nome}}!", {})).toBe("Oi !");
  });

  it("isWithinBusinessHours respeita janela e flag off", () => {
    const base: FollowupSettings = {
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
    };
    const at = (h: number, m = 0) => new Date(2026, 6, 15, h, m, 0);
    expect(isWithinBusinessHours(base, at(10))).toBe(true);
    expect(isWithinBusinessHours(base, at(8, 59))).toBe(false);
    expect(isWithinBusinessHours(base, at(18, 1))).toBe(false);
    // Quando desligado, sempre true independentemente do horário
    expect(isWithinBusinessHours({ ...base, businessHoursOnly: false }, at(23))).toBe(true);
  });
});

describe("humanizer", () => {
  it("humanizeTemplate é determinístico para mesmo seed/attempt", () => {
    const a = humanizeTemplate("Olá {{nome}}, tudo bem?", 2, 42, { nome: "Ana" });
    const b = humanizeTemplate("Olá {{nome}}, tudo bem?", 2, 42, { nome: "Ana" });
    expect(a.text).toBe(b.text);
    expect(a.variant).toBe(b.variant);
  });

  it("humanizeTemplate nunca vaza placeholders {{...}}", () => {
    for (let attempt = 1; attempt <= 3; attempt++) {
      for (let seed = 0; seed < 20; seed++) {
        const { text } = humanizeTemplate(
          "Olá {{nome}}, sobre {{produto}}.",
          attempt,
          seed,
          { nome: "Ana", produto: "kit" },
        );
        expect(text).not.toMatch(/\{\{\w+\}\}/);
      }
    }
  });

  it("humanizeTemplate adiciona CTA na 2ª+ tentativa", () => {
    const { text } = humanizeTemplate("Olá {{nome}}.", 2, 5, { nome: "Ana" });
    expect(text.split("\n\n").length).toBeGreaterThanOrEqual(2);
  });
});

describe("jitterDelayMs", () => {
  it("nunca retorna negativo", () => {
    for (let i = 0; i < 50; i++) {
      expect(jitterDelayMs(0, 30)).toBeGreaterThanOrEqual(0);
      expect(jitterDelayMs(1000, 60)).toBeGreaterThanOrEqual(0);
    }
  });

  it("respeita a amplitude máxima do jitter", () => {
    const base = 10 * 60 * 1000;
    const jitterMin = 5;
    for (let i = 0; i < 50; i++) {
      const v = jitterDelayMs(base, jitterMin);
      expect(v).toBeLessThanOrEqual(base + jitterMin * 60 * 1000);
    }
  });
});

describe("barrel — superfície pública compatível com legado", () => {
  it("exporta todas as funções da v1 (ai-followup.server)", () => {
    const expected = [
      "getFollowupSettings",
      "runFollowupTickForCompany",
      "runFollowupTickAll",
      "reconcileResponses",
      "findCandidates",
    ] as const;
    for (const name of expected) {
      expect(typeof (barrel as Record<string, unknown>)[name]).toBe("function");
    }
  });

  it("exporta todas as funções da v2 (ai-followup-v2.server)", () => {
    const expected = [
      "getFollowupV2Settings",
      "humanizeTemplate",
      "jitterDelayMs",
      "computeLeadScore",
      "getLeadTemperatureSummary",
      "getWhatsappIntegrationStatus",
      "canSendFollowupNow",
      "getAdvancedAnalytics",
      "runReactivation",
    ] as const;
    for (const name of expected) {
      expect(typeof (barrel as Record<string, unknown>)[name]).toBe("function");
    }
  });

  it("expõe o novo núcleo manual", () => {
    expect(typeof barrel.runManualFollowup).toBe("function");
  });

  it("fachadas legadas re-exportam a mesma referência de função", async () => {
    const v1 = await import("@/lib/ai-followup.server");
    const v2 = await import("@/lib/ai-followup-v2.server");
    expect(v1.getFollowupSettings).toBe(barrel.getFollowupSettings);
    expect(v1.runFollowupTickForCompany).toBe(barrel.runFollowupTickForCompany);
    expect(v2.canSendFollowupNow).toBe(barrel.canSendFollowupNow);
    expect(v2.humanizeTemplate).toBe(barrel.humanizeTemplate);
  });
});
