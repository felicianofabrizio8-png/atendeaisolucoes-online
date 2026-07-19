/**
 * Testes do Static Brand Composer (Fase 4).
 * Cobrem: logo (com/sem, posição, safe area, proporção, tamanho máx),
 * overlay/gradiente, cores, tipografia (allowlist + fallback), snapshot
 * sanitizado, validação de canvas/imagem (image bomb), regressão do
 * comportamento fallback.
 */

import { describe, it, expect } from "vitest";
import {
  planStaticBrandComposition,
  buildCompositionSnapshot,
  StaticCompositionError,
  LOGO_MAX_FRACTION,
  LOGO_MIN_FRACTION,
  STATIC_FONT_ALLOWLIST,
  SYSTEM_FALLBACK_FONT,
  type StaticBrandCompositionInput,
} from "../static-brand-composer";
import type { MarketingBrandContext } from "../brand-context-adapter";

const baseColors = {
  primary: "#123456",
  secondary: "#654321",
  accent: "#FFAA00",
  background: "#000000",
  surface: "#111111",
  text: "#FFFFFF",
  textInverse: "#FFFFFF",
};

function makeBrand(overrides: Partial<MarketingBrandContext> = {}): MarketingBrandContext {
  return {
    isFallback: false,
    visualStyle: "moderno",
    colors: baseColors,
    typography: {
      body: "Inter",
      heading: "Inter",
      display: "Poppins",
      fallback: "Arial, sans-serif",
      weights: [400, 700],
    },
    tokens: {
      logoPosition: "bottom-right",
      logoSafeMargin: 32,
      overlayOpacity: 0.25,
      radius: 12,
      gradientStyle: "subtle",
      imageStyle: "photographic",
    },
    logo: {
      url: "https://signed.example/logo.png?token=abc",
      mimeType: "image/png",
      width: 400,
      height: 200,
      expiresAt: new Date(Date.now() + 300_000).toISOString(),
    },
    ...overrides,
  };
}

function makeInput(over: Partial<StaticBrandCompositionInput> = {}): StaticBrandCompositionInput {
  return {
    baseImage: {
      href: "https://signed.example/base.jpg?token=xyz",
      mimeType: "image/jpeg",
      width: 1080,
      height: 1080,
    },
    canvas: { width: 1080, height: 1080, format: "feed_1_1" },
    brand: makeBrand(),
    ...over,
  };
}

describe("planStaticBrandComposition — logo", () => {
  it("aplica logo quando presente", () => {
    const plan = planStaticBrandComposition(makeInput());
    expect(plan.logo).not.toBeNull();
    expect(plan.appliedElements).toContain("logo");
  });

  it("compõe sem logo se ausente", () => {
    const brand = makeBrand({ logo: null });
    const plan = planStaticBrandComposition(makeInput({ brand }));
    expect(plan.logo).toBeNull();
    expect(plan.appliedElements).not.toContain("logo");
  });

  it("preserva a proporção da logo (nunca distorce)", () => {
    const brand = makeBrand({
      logo: {
        url: "x",
        mimeType: "image/png",
        width: 800,
        height: 200,
        expiresAt: new Date().toISOString(),
      },
    });
    const plan = planStaticBrandComposition(makeInput({ brand }));
    const ratio = plan.logo!.width / plan.logo!.height;
    expect(ratio).toBeCloseTo(4, 1);
  });

  it.each([
    ["top-left"],
    ["top-center"],
    ["top-right"],
    ["bottom-left"],
    ["bottom-center"],
    ["bottom-right"],
    ["center"],
  ] as const)("posiciona logo em %s", (position) => {
    const brand = makeBrand({
      tokens: { ...makeBrand().tokens, logoPosition: position },
    });
    const plan = planStaticBrandComposition(makeInput({ brand }));
    expect(plan.logo!.position).toBe(position);
    expect(plan.logo!.x).toBeGreaterThanOrEqual(0);
    expect(plan.logo!.y).toBeGreaterThanOrEqual(0);
    expect(plan.logo!.x + plan.logo!.width).toBeLessThanOrEqual(1080);
    expect(plan.logo!.y + plan.logo!.height).toBeLessThanOrEqual(1080);
  });

  it("largura da logo fica entre 15% e 25% da menor dimensão", () => {
    const plan = planStaticBrandComposition(makeInput());
    const min = Math.min(plan.canvas.width, plan.canvas.height);
    const frac = plan.logo!.width / min;
    expect(frac).toBeGreaterThanOrEqual(LOGO_MIN_FRACTION - 0.001);
    expect(frac).toBeLessThanOrEqual(LOGO_MAX_FRACTION + 0.001);
  });

  it("respeita safe area extra em Story 9:16", () => {
    const brand = makeBrand({
      tokens: { ...makeBrand().tokens, logoPosition: "top-center" },
    });
    const plan = planStaticBrandComposition(
      makeInput({
        canvas: { width: 1080, height: 1920, format: "story_9_16" },
        brand,
      }),
    );
    // Top do IG story cobre ~13% → logo deve começar bem abaixo disso.
    expect(plan.logo!.y).toBeGreaterThanOrEqual(Math.round(1920 * 0.13));
  });

  it("respeita safe area do rodapé em Story", () => {
    const brand = makeBrand({
      tokens: { ...makeBrand().tokens, logoPosition: "bottom-center" },
    });
    const plan = planStaticBrandComposition(
      makeInput({
        canvas: { width: 1080, height: 1920, format: "story_9_16" },
        brand,
      }),
    );
    const bottomLimit = 1920 - Math.round(1920 * 0.19);
    expect(plan.logo!.y + plan.logo!.height).toBeLessThanOrEqual(bottomLimit + 1);
  });

  it("safe margin em Feed usa token do brand + piso proporcional", () => {
    const brand = makeBrand({
      tokens: { ...makeBrand().tokens, logoSafeMargin: 8, logoPosition: "top-left" },
    });
    const plan = planStaticBrandComposition(makeInput({ brand }));
    // piso: max(8, 3% de 1080 = 33)
    expect(plan.logo!.safeMargin).toBeGreaterThanOrEqual(32);
    expect(plan.logo!.x).toBe(plan.logo!.safeMargin);
  });
});

describe("planStaticBrandComposition — overlay & gradiente & cores", () => {
  it("aplica solid overlay quando overlayOpacity > 0", () => {
    const plan = planStaticBrandComposition(makeInput());
    expect(plan.overlays.some((o) => o.kind === "solid")).toBe(true);
    expect(plan.appliedElements).toContain("overlay");
  });

  it("aplica gradient linear quando gradientStyle != none", () => {
    const plan = planStaticBrandComposition(makeInput());
    expect(plan.overlays.some((o) => o.kind === "linearGradient")).toBe(true);
  });

  it("não aplica overlay quando opacity=0 e gradient=none", () => {
    const brand = makeBrand({
      tokens: { ...makeBrand().tokens, overlayOpacity: 0, gradientStyle: "none" },
    });
    const plan = planStaticBrandComposition(makeInput({ brand }));
    expect(plan.overlays).toHaveLength(0);
    expect(plan.appliedElements).not.toContain("overlay");
  });

  it("cores do brand aparecem no plano", () => {
    const plan = planStaticBrandComposition(makeInput());
    expect(plan.colors.primary).toBe(baseColors.primary);
    expect(plan.colors.accent).toBe(baseColors.accent);
  });
});

describe("planStaticBrandComposition — tipografia", () => {
  it("usa fonte configurada quando está na allowlist", () => {
    const plan = planStaticBrandComposition(makeInput());
    expect(STATIC_FONT_ALLOWLIST.has(plan.typography.headingFamily)).toBe(true);
    expect(plan.typography.usedFallback).toBe(false);
  });

  it("usa fallback determinístico quando a fonte não está na allowlist", () => {
    const brand = makeBrand({
      typography: {
        body: "MinhaFonteExoticaXYZ",
        heading: "OutraCustom",
        display: "Poppins",
        fallback: "Arial, sans-serif",
        weights: [400],
      },
    });
    const plan = planStaticBrandComposition(makeInput({ brand }));
    expect(plan.typography.usedFallback).toBe(true);
    expect(plan.typography.unavailable).toEqual(
      expect.arrayContaining(["MinhaFonteExoticaXYZ", "OutraCustom"]),
    );
    expect(plan.typography.headingFamily).toBe("Arial, sans-serif");
    expect(plan.warnings).toContain("typography_fallback_applied");
  });

  it("usa system fallback quando brand não define fallback", () => {
    const brand = makeBrand({
      typography: {
        body: "X",
        heading: "Y",
        display: "Z",
        fallback: "",
        weights: [],
      },
    });
    const plan = planStaticBrandComposition(makeInput({ brand }));
    expect(plan.typography.fallbackFamily).toBe(SYSTEM_FALLBACK_FONT);
  });
});

describe("planStaticBrandComposition — validação / image bomb", () => {
  it("rejeita canvas com dimensões inválidas", () => {
    expect(() =>
      planStaticBrandComposition(
        makeInput({ canvas: { width: 0, height: 100, format: "feed_1_1" } }),
      ),
    ).toThrow(StaticCompositionError);
  });

  it("rejeita canvas maior que o limite", () => {
    expect(() =>
      planStaticBrandComposition(
        makeInput({ canvas: { width: 10_000, height: 10_000, format: "feed_1_1" } }),
      ),
    ).toThrow(/canvas_too_large/);
  });

  it("rejeita imagem-base sem mime image/*", () => {
    expect(() =>
      planStaticBrandComposition(
        makeInput({
          baseImage: { href: "x", mimeType: "application/pdf", width: 100, height: 100 },
        }),
      ),
    ).toThrow(/base_image_invalid_mime/);
  });

  it("rejeita imagem-base gigante (image bomb)", () => {
    expect(() =>
      planStaticBrandComposition(
        makeInput({
          baseImage: { href: "x", mimeType: "image/jpeg", width: 8000, height: 8000 },
        }),
      ),
    ).toThrow(/base_image_too_large/);
  });
});

describe("planStaticBrandComposition — formatos", () => {
  it.each([
    ["feed_1_1", 1080, 1080],
    ["feed_4_5", 1080, 1350],
    ["story_9_16", 1080, 1920],
  ] as const)("formato %s mantém dimensões", (format, w, h) => {
    const plan = planStaticBrandComposition(
      makeInput({
        canvas: { width: w, height: h, format },
        baseImage: { href: "x", mimeType: "image/jpeg", width: w, height: h },
      }),
    );
    expect(plan.canvas.width).toBe(w);
    expect(plan.canvas.height).toBe(h);
  });
});

describe("buildCompositionSnapshot — sanitização", () => {
  it("não contém signed URL nem storage_path", () => {
    const input = makeInput();
    const plan = planStaticBrandComposition(input);
    const snap = buildCompositionSnapshot(input, plan);
    const asStr = JSON.stringify(snap);
    expect(asStr).not.toContain("signed.example");
    expect(asStr).not.toContain("token=");
    expect(asStr).not.toContain("expiresAt");
    expect(asStr).not.toContain(input.baseImage.href);
    expect(asStr).not.toContain(input.brand.logo!.url);
  });

  it("preserva metadados úteis para auditoria", () => {
    const input = makeInput();
    const plan = planStaticBrandComposition(input);
    const snap = buildCompositionSnapshot(input, plan);
    expect(snap.schemaVersion).toBe(1);
    expect(snap.colors.primary).toBe(baseColors.primary);
    expect(snap.logo.present).toBe(true);
    expect(snap.logo.position).toBe("bottom-right");
    expect(snap.tokens.overlayOpacity).toBe(0.25);
    expect(snap.appliedElements).toContain("logo");
  });

  it("snapshot sem logo quando ausente", () => {
    const input = makeInput({ brand: makeBrand({ logo: null }) });
    const plan = planStaticBrandComposition(input);
    const snap = buildCompositionSnapshot(input, plan);
    expect(snap.logo.present).toBe(false);
    expect(snap.logo.position).toBeNull();
  });
});

describe("planStaticBrandComposition — svg overlay", () => {
  it("gera SVG bem-formado, sem signed URL, com slot para logo", () => {
    const input = makeInput();
    const plan = planStaticBrandComposition(input);
    expect(plan.svgOverlay.startsWith("<svg")).toBe(true);
    expect(plan.svgOverlay).toContain('data-logo-slot="1"');
    expect(plan.svgOverlay).not.toContain(input.brand.logo!.url);
    expect(plan.svgOverlay).not.toContain(input.baseImage.href);
  });

  it("sem logo, SVG não contém slot", () => {
    const plan = planStaticBrandComposition(
      makeInput({ brand: makeBrand({ logo: null }) }),
    );
    expect(plan.svgOverlay).not.toContain("data-logo-slot");
  });
});

describe("planStaticBrandComposition — regressão / fallback brand", () => {
  it("brand em fallback ainda produz plano válido sem quebrar", () => {
    const brand = makeBrand({
      isFallback: true,
      logo: null,
      visualStyle: null,
      tokens: {
        logoPosition: "bottom-right",
        logoSafeMargin: 24,
        overlayOpacity: 0,
        radius: 8,
        gradientStyle: "none",
        imageStyle: "photographic",
      },
    });
    const plan = planStaticBrandComposition(makeInput({ brand }));
    expect(plan.logo).toBeNull();
    expect(plan.overlays).toHaveLength(0);
    expect(plan.appliedElements).not.toContain("logo");
    expect(plan.appliedElements).not.toContain("overlay");
  });

  it("textos são renderizados quando fornecidos e não sobrepõem a logo", () => {
    const plan = planStaticBrandComposition(
      makeInput({
        content: {
          headline: "Promoção da Semana",
          subheadline: "Aproveite descontos exclusivos",
          price: "R$ 199,90",
          callToAction: "Compre agora",
        },
      }),
    );
    expect(plan.appliedElements).toContain("text");
    expect(plan.textRegions.length).toBe(4);
    // Nenhuma região deve invadir a área da logo.
    for (const r of plan.textRegions) {
      const yTop = r.y - r.fontSizePx;
      const yBottom = r.y;
      const overlaps =
        yBottom >= plan.logo!.y &&
        yTop <= plan.logo!.y + plan.logo!.height &&
        r.x >= plan.logo!.x &&
        r.x <= plan.logo!.x + plan.logo!.width;
      expect(overlaps).toBe(false);
    }
  });
});
