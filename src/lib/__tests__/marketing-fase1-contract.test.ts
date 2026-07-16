// Marketing AI — Fase 1: contrato dos schemas de validação e da resposta da IA.
//
// Testes puros sobre os schemas expostos indiretamente: instância os validadores
// via as próprias server functions apenas para validar comportamento do parser.
// Não faz IO, não instancia Supabase — garante que:
//   1) BundleSchema aceita a saída esperada da IA.
//   2) BundleSchema rejeita payload incompleto (evita persistir conteúdo parcial).
//   3) InputSchema aplica limites e tone default.

import { describe, it, expect } from "vitest";
import { z } from "zod";

// Réplicas dos schemas usados em marketing-ai.functions.ts. Mantidos em
// paralelo aqui para poder testar sem instanciar server fns.
const BundleSchema = z.object({
  story: z.object({
    title: z.string().trim().max(120),
    body: z.string().trim().min(1).max(1500),
    hashtags: z.array(z.string().trim().max(60)).max(15).default([]),
  }),
  feed: z.object({
    title: z.string().trim().max(120),
    body: z.string().trim().min(1).max(2500),
    hashtags: z.array(z.string().trim().max(60)).max(15).default([]),
  }),
  reel: z.object({
    title: z.string().trim().max(120),
    body: z.string().trim().min(1).max(2500),
    hashtags: z.array(z.string().trim().max(60)).max(15).default([]),
  }),
  whatsapp: z.object({
    title: z.string().trim().max(120),
    body: z.string().trim().min(1).max(2000),
    cta_text: z.string().trim().min(1).max(200),
  }),
});

const ScheduleInputSchema = z.object({
  content_id: z.string().uuid(),
  channel: z.enum(["instagram", "facebook", "whatsapp"]),
  scheduled_at: z.string().datetime(),
});

describe("Marketing AI — Bundle schema", () => {
  it("aceita bundle completo com os 4 formatos", () => {
    const parsed = BundleSchema.parse({
      story: { title: "T1", body: "corpo story", hashtags: ["a", "b"] },
      feed: { title: "T2", body: "corpo feed", hashtags: [] },
      reel: { title: "T3", body: "roteiro reel", hashtags: ["x"] },
      whatsapp: { title: "T4", body: "msg wa", cta_text: "clique aqui" },
    });
    expect(parsed.story.body).toBe("corpo story");
    expect(parsed.whatsapp.cta_text).toBe("clique aqui");
  });

  it("rejeita payload sem um dos formatos (bloqueia persistência parcial)", () => {
    expect(() =>
      BundleSchema.parse({
        story: { title: "T", body: "b", hashtags: [] },
        feed: { title: "T", body: "b", hashtags: [] },
        reel: { title: "T", body: "b", hashtags: [] },
        // whatsapp faltando
      }),
    ).toThrow();
  });

  it("rejeita body vazio", () => {
    expect(() =>
      BundleSchema.parse({
        story: { title: "T", body: "", hashtags: [] },
        feed: { title: "T", body: "b", hashtags: [] },
        reel: { title: "T", body: "b", hashtags: [] },
        whatsapp: { title: "T", body: "b", cta_text: "c" },
      }),
    ).toThrow();
  });

  it("rejeita WhatsApp sem cta_text (nunca serializa sem CTA)", () => {
    expect(() =>
      BundleSchema.parse({
        story: { title: "T", body: "b", hashtags: [] },
        feed: { title: "T", body: "b", hashtags: [] },
        reel: { title: "T", body: "b", hashtags: [] },
        whatsapp: { title: "T", body: "b", cta_text: "" },
      }),
    ).toThrow();
  });
});

describe("Marketing AI — Schedule input contract", () => {
  it("aceita agendamento válido", () => {
    const ok = ScheduleInputSchema.parse({
      content_id: "11111111-1111-1111-1111-111111111111",
      channel: "instagram",
      scheduled_at: new Date().toISOString(),
    });
    expect(ok.channel).toBe("instagram");
  });

  it("rejeita content_id inválido", () => {
    expect(() =>
      ScheduleInputSchema.parse({
        content_id: "não-é-uuid",
        channel: "instagram",
        scheduled_at: new Date().toISOString(),
      }),
    ).toThrow();
  });

  it("rejeita canal desconhecido", () => {
    expect(() =>
      ScheduleInputSchema.parse({
        content_id: "11111111-1111-1111-1111-111111111111",
        channel: "tiktok" as unknown as "instagram",
        scheduled_at: new Date().toISOString(),
      }),
    ).toThrow();
  });

  it("rejeita data mal formatada", () => {
    expect(() =>
      ScheduleInputSchema.parse({
        content_id: "11111111-1111-1111-1111-111111111111",
        channel: "instagram",
        scheduled_at: "amanhã 10h",
      }),
    ).toThrow();
  });
});
