/**
 * Testes do orquestrador Fase 4.1 — apply-brand-composition.browser.ts.
 * Usa injeção de dependências (measureImage/prepare/rasterize) para rodar em
 * ambiente Node sem DOM.
 */

import { describe, expect, it, vi } from "vitest";
import { applyBrandCompositionToDataUrl } from "@/lib/marketing/apply-brand-composition.browser";
import type { StaticBrandCompositionPlan } from "@/lib/marketing/static-brand-composer";

const BASE_DATA_URL = "data:image/png;base64,AAAA";

function planStub(withLogo: boolean): StaticBrandCompositionPlan {
  return {
    canvas: { width: 1080, height: 1080, format: "feed_1_1" },
    logo: withLogo
      ? {
          href: "https://signed.example/logo",
          mimeType: "image/png",
          position: "bottom-right",
          x: 900, y: 900, width: 150, height: 150,
          widthFraction: 0.14, safeMargin: 32,
        }
      : null,
    overlays: [],
    textRegions: [],
    typography: {
      headingFamily: "Inter", bodyFamily: "Inter", displayFamily: "Inter",
      fallbackFamily: "system-ui", weights: [400, 700],
      usedFallback: false, unavailable: [],
    },
    colors: {
      primary: "#111", secondary: "#222", accent: "#333",
      background: "#fff", surface: "#f8f8f8", text: "#000", textInverse: "#fff",
    },
    appliedElements: withLogo ? ["logo"] : [],
    warnings: [],
    svgOverlay: "<svg/>",
  };
}

const measureOk = vi.fn(async () => ({ width: 1024, height: 1024, mimeType: "image/png" }));

function rasterizeOk() {
  return vi.fn(async () => ({
    blob: new Blob(["fake"], { type: "image/jpeg" }),
    width: 1080, height: 1080, mimeType: "image/jpeg",
    warnings: [] as string[],
  }));
}

describe("applyBrandCompositionToDataUrl", () => {
  it("bypassa quando formato não é suportado", async () => {
    const prepare = vi.fn();
    const res = await applyBrandCompositionToDataUrl(
      { dataUrl: BASE_DATA_URL, format: "facebook_feed" },
      { prepareBrandComposition: prepare as never, measureImage: measureOk, rasterize: rasterizeOk() as never },
    );
    expect(res.applied).toBe(false);
    expect(res.dataUrl).toBe(BASE_DATA_URL);
    expect(res.fallbackReason).toBe("format_unsupported");
    expect(prepare).not.toHaveBeenCalled();
  });

  it("mantém imagem-base quando empresa não publicou marca", async () => {
    const prepare = vi.fn(async () => ({
      applied: false, plan: null, snapshot: null,
      reason: "no_brand_published" as const, warnings: [],
    }));
    const res = await applyBrandCompositionToDataUrl(
      { dataUrl: BASE_DATA_URL, format: "feed_1080" },
      { prepareBrandComposition: prepare as never, measureImage: measureOk, rasterize: rasterizeOk() as never },
    );
    expect(res.applied).toBe(false);
    expect(res.dataUrl).toBe(BASE_DATA_URL);
    expect(res.fallbackReason).toBe("no_brand_published");
  });

  it("rasteriza e devolve dataURL final quando há marca", async () => {
    const prepare = vi.fn(async () => ({
      applied: true, plan: planStub(true), snapshot: { schemaVersion: 1 } as never, warnings: [],
    }));
    const rasterize = rasterizeOk();
    const res = await applyBrandCompositionToDataUrl(
      {
        dataUrl: BASE_DATA_URL, format: "feed_1080",
        content: { headline: "Oferta", price: "R$ 99" },
      },
      { prepareBrandComposition: prepare as never, measureImage: measureOk, rasterize: rasterize as never },
    );
    expect(res.applied).toBe(true);
    expect(res.dataUrl.startsWith("data:image/jpeg")).toBe(true);
    expect(rasterize).toHaveBeenCalledTimes(1);
    expect(prepare).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ format: "feed_1_1", canvas: { width: 1080, height: 1080 } }),
    }));
  });

  it("mapeia story_1920 e whatsapp_status para story_9_16 1080x1920", async () => {
    const prepare = vi.fn(async () => ({
      applied: false, plan: null, snapshot: null,
      reason: "no_brand_published" as const, warnings: [],
    }));
    for (const format of ["story_1920", "whatsapp_status"] as const) {
      prepare.mockClear();
      await applyBrandCompositionToDataUrl(
        { dataUrl: BASE_DATA_URL, format },
        { prepareBrandComposition: prepare as never, measureImage: measureOk, rasterize: rasterizeOk() as never },
      );
      expect(prepare).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({
          format: "story_9_16",
          canvas: { width: 1080, height: 1920 },
        }),
      }));
    }
  });

  it("faz fallback silencioso quando prepare falha", async () => {
    const prepare = vi.fn(async () => { throw new Error("boom"); });
    const res = await applyBrandCompositionToDataUrl(
      { dataUrl: BASE_DATA_URL, format: "feed_1080" },
      { prepareBrandComposition: prepare as never, measureImage: measureOk, rasterize: rasterizeOk() as never },
    );
    expect(res.applied).toBe(false);
    expect(res.dataUrl).toBe(BASE_DATA_URL);
    expect(res.fallbackReason).toBe("prepare_failed");
    expect(res.warnings).toContain("brand_prepare_failed");
  });

  it("faz fallback quando rasterize falha", async () => {
    const prepare = vi.fn(async () => ({
      applied: true, plan: planStub(true), snapshot: { schemaVersion: 1 } as never, warnings: [],
    }));
    const rasterize = vi.fn(async () => { throw new Error("canvas_fail"); });
    const res = await applyBrandCompositionToDataUrl(
      { dataUrl: BASE_DATA_URL, format: "feed_1080" },
      { prepareBrandComposition: prepare as never, measureImage: measureOk, rasterize: rasterize as never },
    );
    expect(res.applied).toBe(false);
    expect(res.dataUrl).toBe(BASE_DATA_URL);
    expect(res.fallbackReason).toBe("rasterize_failed");
    expect(res.warnings).toContain("rasterize_failed");
  });

  it("faz fallback quando não é possível medir a imagem-base", async () => {
    const prepare = vi.fn();
    const measureFail = vi.fn(async () => { throw new Error("nope"); });
    const res = await applyBrandCompositionToDataUrl(
      { dataUrl: BASE_DATA_URL, format: "feed_1080" },
      { prepareBrandComposition: prepare as never, measureImage: measureFail, rasterize: rasterizeOk() as never },
    );
    expect(res.applied).toBe(false);
    expect(res.fallbackReason).toBe("base_image_measure_failed");
    expect(prepare).not.toHaveBeenCalled();
  });

  it("nunca inclui signed URL no snapshot devolvido para persistência", async () => {
    const prepare = vi.fn(async () => ({
      applied: true,
      plan: planStub(true),
      snapshot: {
        schemaVersion: 1,
        logo: { present: true, mimeType: "image/png", width: 500, height: 500, widthFraction: 0.14, position: "bottom-right" },
      } as never,
      warnings: [],
    }));
    const res = await applyBrandCompositionToDataUrl(
      { dataUrl: BASE_DATA_URL, format: "feed_1080" },
      { prepareBrandComposition: prepare as never, measureImage: measureOk, rasterize: rasterizeOk() as never },
    );
    const serialized = JSON.stringify(res.snapshot);
    expect(serialized).not.toContain("https://");
    expect(serialized).not.toContain("signed");
  });
});
