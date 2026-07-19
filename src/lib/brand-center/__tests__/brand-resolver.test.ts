import { describe, expect, it } from "vitest";
import {
  DEFAULT_COLORS,
  DEFAULT_TOKENS,
  DEFAULT_TYPOGRAPHY,
} from "../brand-defaults";
import { resolveBrandContext } from "../brand-resolver";
import type { BrandResolverInput } from "../brand.types";

const COMPANY = "00000000-0000-0000-0000-000000000001";

function emptyInput(): BrandResolverInput {
  return { companyId: COMPANY, profile: null, version: null, assets: [] };
}

describe("resolveBrandContext — defaults & fallback", () => {
  it("aplica defaults neutros quando não há identidade configurada", () => {
    const ctx = resolveBrandContext(emptyInput());
    expect(ctx.companyId).toBe(COMPANY);
    expect(ctx.profileId).toBeNull();
    expect(ctx.versionId).toBeNull();
    expect(ctx.status).toBe("draft");
    expect(ctx.isFallback).toBe(true);
    expect(ctx.colors).toEqual(DEFAULT_COLORS);
    expect(ctx.typography).toEqual(DEFAULT_TYPOGRAPHY);
    expect(ctx.tokens).toEqual(DEFAULT_TOKENS);
    expect(ctx.assets.all).toEqual([]);
    expect(ctx.assets.byType.logo_primary).toBeNull();
  });

  it("ausência de logo é válida e não gera erro", () => {
    const ctx = resolveBrandContext({
      ...emptyInput(),
      profile: { id: "p1", visualStyle: "moderno" },
      version: {
        id: "v1",
        status: "published",
        colors: { primary: "#FF0000" },
        typography: {},
        tokens: {},
      },
      assets: [],
    });
    expect(ctx.assets.byType.logo_primary).toBeNull();
    expect(ctx.colors.primary).toBe("#FF0000");
  });
});

describe("resolveBrandContext — configuração completa", () => {
  const full: BrandResolverInput = {
    companyId: COMPANY,
    profile: { id: "p1", visualStyle: "elegante" },
    version: {
      id: "v1",
      status: "published",
      colors: {
        primary: "#0EA5E9",
        secondary: "#1E293B",
        accent: "#F59E0B",
        background: "#FFFFFF",
        surface: "#F8FAFC",
        text: "#0F172A",
        textInverse: "#FFFFFF",
      },
      typography: {
        body: "Inter",
        heading: "Space Grotesk",
        display: "Playfair Display",
        weights: [400, 700],
        fallback: "system-ui, sans-serif",
      },
      tokens: {
        radius: 12,
        shadowIntensity: 0.3,
        spacingBase: 8,
        overlayOpacity: 0.5,
        logoPosition: "bottom-right",
        logoSafeMargin: 32,
        imageStyle: "photographic",
        gradientStyle: "vibrant",
      },
    },
    assets: [
      {
        id: "a1",
        type: "logo_primary",
        storageBucket: "brand-assets",
        storagePath: `${COMPANY}/brand/logo_primary/logo.png`,
        mimeType: "image/png",
        width: 512,
        height: 512,
      },
      {
        id: "a2",
        type: "favicon",
        storageBucket: "brand-assets",
        storagePath: `${COMPANY}/brand/favicon/favicon.ico`,
        mimeType: "image/x-icon",
        width: 32,
        height: 32,
      },
    ],
  };

  it("normaliza cores, tipografia e tokens de uma versão publicada", () => {
    const ctx = resolveBrandContext(full);
    expect(ctx.versionId).toBe("v1");
    expect(ctx.status).toBe("published");
    expect(ctx.isFallback).toBe(false);
    expect(ctx.colors.primary).toBe("#0EA5E9");
    expect(ctx.typography.heading).toBe("Space Grotesk");
    expect(ctx.tokens.radius).toBe(12);
    expect(ctx.visualStyle).toBe("elegante");
  });

  it("assets retornam por referência estável (sem signed URL)", () => {
    const ctx = resolveBrandContext(full);
    expect(ctx.assets.all).toHaveLength(2);
    const logo = ctx.assets.byType.logo_primary!;
    expect(logo.storageBucket).toBe("brand-assets");
    expect(logo.storagePath.startsWith(COMPANY + "/")).toBe(true);
    // Não deve conter chaves de URL assinada
    expect(JSON.stringify(logo)).not.toMatch(/signedUrl|token=|X-Goog|Expires/i);
  });

  it("ignora tipos de asset desconhecidos (não vaza para o contrato)", () => {
    const ctx = resolveBrandContext({
      ...full,
      assets: [
        ...full.assets,
        {
          id: "a3",
          type: "malicious_type",
          storageBucket: "brand-assets",
          storagePath: `${COMPANY}/brand/x/x.png`,
          mimeType: "image/png",
          width: null,
          height: null,
        },
      ],
    });
    expect(ctx.assets.all).toHaveLength(2);
  });
});

describe("resolveBrandContext — normalização defensiva", () => {
  it("cores inválidas caem para defaults (não vazam para consumidores)", () => {
    const ctx = resolveBrandContext({
      ...emptyInput(),
      profile: { id: "p1", visualStyle: null },
      version: {
        id: "v1",
        status: "published",
        colors: { primary: "not-a-color", secondary: "#00FF00" },
        typography: {},
        tokens: {},
      },
    });
    // Zod rejeita o objeto inteiro quando qualquer campo é inválido:
    // documentamos que o resolver cai integralmente para defaults nesse caso.
    expect(ctx.colors).toEqual(DEFAULT_COLORS);
  });

  it("tipografia mantém weights default quando array vem vazio", () => {
    const ctx = resolveBrandContext({
      ...emptyInput(),
      profile: { id: "p1", visualStyle: null },
      version: {
        id: "v1",
        status: "published",
        colors: {},
        typography: { body: "Roboto", weights: [] },
        tokens: {},
      },
    });
    expect(ctx.typography.body).toBe("Roboto");
    expect(ctx.typography.weights).toEqual(DEFAULT_TYPOGRAPHY.weights);
  });

  it("tokens inválidos caem para defaults", () => {
    const ctx = resolveBrandContext({
      ...emptyInput(),
      profile: { id: "p1", visualStyle: null },
      version: {
        id: "v1",
        status: "published",
        colors: {},
        typography: {},
        tokens: { radius: 9999, overlayOpacity: 2, logoPosition: "hacker" },
      },
    });
    expect(ctx.tokens).toEqual(DEFAULT_TOKENS);
  });
});

describe("resolveBrandContext — versionamento", () => {
  it("rascunho NÃO vira identidade ativa (fica em fallback)", () => {
    const ctx = resolveBrandContext({
      ...emptyInput(),
      profile: { id: "p1", visualStyle: null },
      version: {
        id: "v1",
        status: "draft",
        colors: { primary: "#123456" },
        typography: {},
        tokens: {},
      },
    });
    expect(ctx.status).toBe("draft");
    expect(ctx.versionId).toBeNull();
    // Cores do rascunho NÃO são aplicadas — usa defaults.
    expect(ctx.colors).toEqual(DEFAULT_COLORS);
  });

  it("versão publicada é priorizada sobre defaults", () => {
    const ctx = resolveBrandContext({
      ...emptyInput(),
      profile: { id: "p1", visualStyle: null },
      version: {
        id: "v2",
        status: "published",
        colors: { primary: "#ABCDEF" },
        typography: {},
        tokens: {},
      },
    });
    expect(ctx.status).toBe("published");
    expect(ctx.versionId).toBe("v2");
    expect(ctx.colors.primary).toBe("#ABCDEF");
  });
});

describe("BrandContext — pureza do contrato", () => {
  it("não expõe campos específicos de segmento (piscina, moda, buffet, etc.)", () => {
    const ctx = resolveBrandContext({
      ...emptyInput(),
      profile: { id: "p1", visualStyle: "moderno" },
      version: {
        id: "v1",
        status: "published",
        colors: {},
        typography: {},
        tokens: {},
      },
    });
    const s = JSON.stringify(ctx).toLowerCase();
    for (const forbidden of [
      "piscina",
      "buffet",
      "moda",
      "solario",
      "solário",
      "campanha",
      "campaign",
      "promocao",
      "preco",
      "preço",
    ]) {
      expect(s).not.toContain(forbidden);
    }
  });

  it("companyId é sempre propagado do input", () => {
    const other = "00000000-0000-0000-0000-0000000000AA";
    const ctx = resolveBrandContext({
      companyId: other,
      profile: null,
      version: null,
      assets: [],
    });
    expect(ctx.companyId).toBe(other);
  });
});
