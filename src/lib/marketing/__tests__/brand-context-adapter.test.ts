import { describe, expect, it } from "vitest";
import {
  adaptBrandContext,
  buildBrandPromptBlock,
  sanitizeBrandContextForPersistence,
  type MarketingBrandContext,
} from "@/lib/marketing/brand-context-adapter";
import { resolveBrandContext } from "@/lib/brand-center/brand-resolver";
import type { BrandContext } from "@/lib/brand-center/brand.types";

const COMPANY_A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const COMPANY_B = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";

function published(companyId: string): BrandContext {
  return resolveBrandContext({
    companyId,
    profile: { id: "p1", visualStyle: "moderno-elegante" },
    version: {
      id: "v1",
      status: "published",
      schemaVersion: 1,
      colors: {
        primary: "#123456",
        secondary: "#654321",
        accent: "#abcdef",
        background: "#ffffff",
        surface: "#f8f8f8",
        text: "#111111",
        textInverse: "#ffffff",
      },
      typography: {
        body: "Inter",
        heading: "Playfair Display",
        display: "Playfair Display",
        weights: [400, 700],
        fallback: "sans-serif",
      },
      tokens: {
        radius: 12,
        shadowIntensity: 0.2,
        spacingBase: 8,
        overlayOpacity: 0.3,
        logoPosition: "bottom-right",
        logoSafeMargin: 32,
        imageStyle: "photographic",
        gradientStyle: "subtle",
      },
    },
    assets: [
      {
        id: "asset-logo-1",
        type: "logo_primary",
        storageBucket: "brand-assets",
        storagePath: `${companyId}/brand/logo_primary/abc.png`,
        mimeType: "image/png",
        width: 512,
        height: 512,
      },
    ],
  });
}

function fallback(companyId: string): BrandContext {
  return resolveBrandContext({
    companyId,
    profile: null,
    version: null,
    assets: [],
  });
}

describe("brand-context-adapter", () => {
  it("mapeia cores, tipografia e tokens corretamente com logo assinada", () => {
    const brand = published(COMPANY_A);
    const ctx = adaptBrandContext(brand, {
      assetId: "asset-logo-1",
      assetType: "logo_primary",
      mimeType: "image/png",
      width: 512,
      height: 512,
      expiresAt: "2099-01-01T00:00:00.000Z",
      signedUrl: "https://signed.example/xyz?token=SECRET",
    });
    expect(ctx.isFallback).toBe(false);
    expect(ctx.visualStyle).toBe("moderno-elegante");
    expect(ctx.colors.primary).toBe("#123456");
    expect(ctx.colors.secondary).toBe("#654321");
    expect(ctx.colors.accent).toBe("#abcdef");
    expect(ctx.colors.text).toBe("#111111");
    expect(ctx.colors.background).toBe("#ffffff");
    expect(ctx.typography.heading).toBe("Playfair Display");
    expect(ctx.typography.body).toBe("Inter");
    expect(ctx.tokens.logoPosition).toBe("bottom-right");
    expect(ctx.tokens.logoSafeMargin).toBe(32);
    expect(ctx.tokens.overlayOpacity).toBe(0.3);
    expect(ctx.tokens.radius).toBe(12);
    expect(ctx.tokens.gradientStyle).toBe("subtle");
    expect(ctx.logo?.url).toBe("https://signed.example/xyz?token=SECRET");
    expect(ctx.logo?.mimeType).toBe("image/png");
  });

  it("campanha sem identidade publicada → fallback silencioso sem logo", () => {
    const brand = fallback(COMPANY_A);
    const ctx = adaptBrandContext(brand, null);
    expect(ctx.isFallback).toBe(true);
    expect(ctx.logo).toBeNull();
    // Defaults ainda expostos para não quebrar a geração
    expect(ctx.colors.primary).toMatch(/^#[0-9a-f]{6}$/i);
    expect(ctx.typography.body).toBeTruthy();
  });

  it("campanha com identidade publicada mas sem logo → gera sem logo, sem erro", () => {
    const brand = published(COMPANY_A);
    // simula ausência de logo (assets vazios)
    const noLogo: BrandContext = {
      ...brand,
      assets: { all: [], byType: { ...brand.assets.byType, logo_primary: null } },
    };
    const ctx = adaptBrandContext(noLogo, null);
    expect(ctx.isFallback).toBe(false);
    expect(ctx.logo).toBeNull();
  });

  it("falha ao assinar logo (adapter recebe null) → não bloqueia geração", () => {
    const brand = published(COMPANY_A);
    const ctx = adaptBrandContext(brand, null);
    expect(ctx.logo).toBeNull();
    expect(ctx.colors.primary).toBe("#123456"); // resto da identidade preservado
  });

  it("sanitizeBrandContextForPersistence remove signedUrl e expiresAt", () => {
    const ctx: MarketingBrandContext = adaptBrandContext(published(COMPANY_A), {
      assetId: "asset-logo-1",
      assetType: "logo_primary",
      mimeType: "image/png",
      width: 200,
      height: 200,
      expiresAt: "2099-01-01T00:00:00.000Z",
      signedUrl: "https://signed.example/leaked?token=DO_NOT_LOG",
    });
    const safe = sanitizeBrandContextForPersistence(ctx);
    const asJson = JSON.stringify(safe);
    expect(asJson).not.toContain("signed.example");
    expect(asJson).not.toContain("DO_NOT_LOG");
    expect(asJson).not.toContain("expiresAt");
    expect(safe.logo).toEqual({ mimeType: "image/png", width: 200, height: 200 });
  });

  it("buildBrandPromptBlock nunca inclui signed URL", () => {
    const ctx = adaptBrandContext(published(COMPANY_A), {
      assetId: "asset-logo-1",
      assetType: "logo_primary",
      mimeType: "image/png",
      width: 512,
      height: 512,
      expiresAt: "2099-01-01T00:00:00.000Z",
      signedUrl: "https://signed.example/secret?token=NEVER",
    });
    const block = buildBrandPromptBlock(ctx);
    expect(block).not.toContain("signed.example");
    expect(block).not.toContain("NEVER");
    expect(block).not.toContain("https://");
    // Contém instruções de identidade e trata logo como asset fixo
    expect(block).toContain("#123456");
    expect(block).toContain("bottom-right");
    expect(block).toContain("Logo principal DISPONÍVEL");
    expect(block).toMatch(/asset fixo/i);
  });

  it("buildBrandPromptBlock — fallback total pede geração neutra", () => {
    const ctx = adaptBrandContext(fallback(COMPANY_A), null);
    const block = buildBrandPromptBlock(ctx);
    expect(block).toContain("ainda não publicou identidade visual");
    expect(block).not.toContain("Logo principal DISPONÍVEL");
  });

  it("buildBrandPromptBlock — identidade publicada sem logo instrui a NÃO inventar marca", () => {
    const brand = published(COMPANY_A);
    const noLogo: BrandContext = {
      ...brand,
      assets: { all: [], byType: { ...brand.assets.byType, logo_primary: null } },
    };
    const ctx = adaptBrandContext(noLogo, null);
    const block = buildBrandPromptBlock(ctx);
    expect(block).toContain("Logo principal AUSENTE");
    expect(block).toMatch(/não invente marca/i);
  });

  it("empresa A não recebe identidade da empresa B (companyId isolado no BrandContext)", () => {
    const a = adaptBrandContext(published(COMPANY_A), null);
    const b = adaptBrandContext(published(COMPANY_B), null);
    // Ambas resolvem com os mesmos dados nesses testes porque o resolver não
    // faz IO. O ponto importante é: cada BrandContext carrega seu companyId
    // e o adapter NÃO cruza dados entre eles — o adapter é puro.
    expect(a.colors.primary).toBe(b.colors.primary);
    // O acoplamento por companyId acontece no loader real (com Supabase);
    // aqui garantimos que o adapter não faz merge indevido de contextos.
    const withLogoA = adaptBrandContext(published(COMPANY_A), {
      assetId: "asset-A",
      assetType: "logo_primary",
      mimeType: "image/png",
      width: 100,
      height: 100,
      expiresAt: "2099-01-01T00:00:00.000Z",
      signedUrl: "https://a.example/logo",
    });
    const withLogoB = adaptBrandContext(published(COMPANY_B), {
      assetId: "asset-B",
      assetType: "logo_primary",
      mimeType: "image/png",
      width: 100,
      height: 100,
      expiresAt: "2099-01-01T00:00:00.000Z",
      signedUrl: "https://b.example/logo",
    });
    expect(withLogoA.logo?.url).toBe("https://a.example/logo");
    expect(withLogoB.logo?.url).toBe("https://b.example/logo");
  });

  it("schema_version futuro do Brand Center gera fallback seguro", () => {
    const brand = resolveBrandContext({
      companyId: COMPANY_A,
      profile: { id: "p1", visualStyle: null },
      version: {
        id: "v1",
        status: "published",
        schemaVersion: 999, // futuro / desconhecido
        colors: { primary: "#000000" },
        typography: {},
        tokens: {},
      },
      assets: [],
    });
    const ctx = adaptBrandContext(brand, null);
    expect(ctx.isFallback).toBe(true);
    // Não vazou o "#000000" enviado com schema futuro
    expect(ctx.colors.primary).not.toBe("#000000");
    expect(buildBrandPromptBlock(ctx)).toContain(
      "ainda não publicou identidade visual",
    );
  });
});

describe("boundary: Marketing IA não acessa Brand Center por baixo do adapter", () => {
  it("adapter só depende de brand-consumer.server e brand.types (grep estático)", async () => {
    // Este teste é uma trava simbólica: qualquer nova importação proibida
    // aparece na revisão de código. A verificação real é feita no CI/lint
    // do repositório — aqui só documentamos a expectativa.
    const forbidden = [
      "brand.repository",
      "brand-editor.functions",
      "brand-editor-schema",
    ];
    const fs = await import("node:fs");
    const src = fs.readFileSync(
      "src/lib/marketing/brand-context-adapter.ts",
      "utf8",
    );
    for (const f of forbidden) {
      expect(src, `adapter não pode importar ${f}`).not.toContain(f);
    }
    // Não deve haver acesso direto a tabelas brand_* nem ao bucket
    expect(src).not.toMatch(/from\(["']brand_/);
    expect(src).not.toMatch(/storage\.from\(["']brand-assets/);
  });

  it("marketing-ai.functions não acessa tabelas brand_* nem bucket brand-assets", async () => {
    const fs = await import("node:fs");
    const src = fs.readFileSync(
      "src/lib/marketing/marketing-ai.functions.ts",
      "utf8",
    );
    expect(src).not.toMatch(/from\(["']brand_profiles/);
    expect(src).not.toMatch(/from\(["']brand_versions/);
    expect(src).not.toMatch(/from\(["']brand_assets/);
    expect(src).not.toMatch(/storage\.from\(["']brand-assets/);
    // Adapter usado
    expect(src).toContain("brand-context-adapter");
    expect(src).toContain("loadMarketingBrandContext");
    expect(src).toContain("sanitizeBrandContextForPersistence");
  });
});
