import { describe, expect, it } from "vitest";
import { buildBottomPanelSvg, buildOutroCardSvg } from "../brand-composer";

const colors = {
  primary: "#111",
  secondary: "#222",
  accent: "#e11d48",
  text: "#000",
  textInverse: "#fff",
  background: "#f8f8f8",
};

describe("Fase M3 — CTA visual", () => {
  const content = {
    headline: "Promo de Inverno",
    supportingText: "Peças selecionadas com desconto",
    ctaText: "Compre agora",
    companyName: "Empresa X",
  };

  it("painel inferior NÃO contém o CTA visual", () => {
    const svg = buildBottomPanelSvg({ width: 1080, height: 1920, colors, content });
    expect(svg).not.toContain("Compre agora");
    // Guarda estrutural: nenhum <rect> arredondado com fill=accent (CTA button).
    expect(svg).not.toMatch(/fill="#e11d48"/i);
  });

  it("painel inferior preserva headline e subheadline", () => {
    const svg = buildBottomPanelSvg({ width: 1080, height: 1920, colors, content });
    expect(svg).toContain("Promo de Inverno");
    expect(svg).toContain("Peças selecionadas com desconto");
  });

  it("tela final CONTINUA renderizando o CTA", () => {
    const svg = buildOutroCardSvg({
      width: 1080,
      height: 1920,
      colors,
      content,
      logoDataUri: null,
    });
    expect(svg).toContain("Compre agora");
    expect(svg).toContain("Empresa X");
  });

  it("painel inferior funciona sem CTA (retrocompat)", () => {
    const svg = buildBottomPanelSvg({
      width: 1080,
      height: 1920,
      colors,
      content: { ...content, ctaText: null },
    });
    expect(svg).toContain("Promo de Inverno");
    expect(svg).not.toContain("undefined");
  });
});
