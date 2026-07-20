import { describe, expect, it } from "vitest";
import { resolveOverlayContentFromRow } from "../overlay-content-resolver";

describe("resolveOverlayContentFromRow (Fase M2)", () => {
  it("prioriza overlay_* quando presentes", () => {
    const r = resolveOverlayContentFromRow({
      title: "Título muito longo que jamais deveria ir para o vídeo",
      body: "Corpo enorme com muitos detalhes e argumentos de vendas que descrevem tudo",
      cta_text: "Fale conosco pelo telefone",
      overlay_headline: "Promo de Inverno",
      overlay_subheadline: "Peças selecionadas com desconto",
      overlay_cta: "Compre agora",
    });
    expect(r.content.headline).toBe("Promo de Inverno");
    expect(r.content.supportingText).toBe("Peças selecionadas com desconto");
    expect(r.content.ctaText).toBe("Compre agora");
    expect(r.telemetry.source).toBe("overlay_fields");
    expect(r.telemetry.legacy_fallback).toBe(false);
    expect(r.telemetry.overlay_fields.headline).toBe("overlay");
  });

  it("cai no fallback quando overlay_* está ausente e nunca corta palavras", () => {
    const r = resolveOverlayContentFromRow({
      title: "Coleção completa de acessórios premium para todas as ocasiões",
      body: "Descubra a nova coleção com produtos exclusivos, entrega rápida e garantia estendida em todos os itens do catálogo atual.",
      cta_text: "Peça já pelo nosso canal oficial de atendimento",
      overlay_headline: null,
      overlay_subheadline: null,
      overlay_cta: null,
    });
    expect(r.telemetry.legacy_fallback).toBe(true);
    for (const v of [r.content.headline, r.content.supportingText, r.content.ctaText]) {
      expect(v).toBeTruthy();
      expect(v).not.toContain("…");
      // nenhuma palavra pode terminar cortada — garantimos que só há espaços
      // entre palavras completas
      expect(v!.split(" ").every((w) => /^[\p{L}\p{N}\p{P}]+$/u.test(w))).toBe(true);
    }
    expect(r.content.headline!.length).toBeLessThanOrEqual(28);
    expect(r.content.supportingText!.length).toBeLessThanOrEqual(45);
    expect(r.content.ctaText!.length).toBeLessThanOrEqual(40);
  });

  it("respeita limite de 5 palavras no headline mesmo em overlay", () => {
    const r = resolveOverlayContentFromRow({
      title: null,
      body: null,
      cta_text: null,
      overlay_headline: "Uma duas três quatro cinco seis sete",
      overlay_subheadline: null,
      overlay_cta: null,
    });
    expect(r.content.headline!.split(" ").length).toBeLessThanOrEqual(5);
  });

  it("mistura overlay + fallback e reporta corretamente", () => {
    const r = resolveOverlayContentFromRow({
      title: "Nova Coleção Verão",
      body: "Detalhes exclusivos para você",
      cta_text: "Compre agora",
      overlay_headline: "Verão Chegou",
      overlay_subheadline: null,
      overlay_cta: null,
    });
    expect(r.telemetry.overlay_fields.headline).toBe("overlay");
    expect(r.telemetry.overlay_fields.subheadline).toMatch(/^legacy/);
    expect(r.telemetry.overlay_fields.cta).toMatch(/^legacy/);
    expect(r.telemetry.legacy_fallback).toBe(true);
  });

  it("retorna null quando não há nenhuma fonte", () => {
    const r = resolveOverlayContentFromRow({
      title: null,
      body: null,
      cta_text: null,
      overlay_headline: null,
      overlay_subheadline: null,
      overlay_cta: null,
    });
    expect(r.content.headline).toBeNull();
    expect(r.content.supportingText).toBeNull();
    expect(r.content.ctaText).toBeNull();
  });
});
