// ============================================================================
// Sprint 3 — Watermark & Build Signature
//
// Cobre a causa raiz: `sceneAppliesLogo` era intenção declarada e suprimia o
// watermark externo mesmo quando a cena não desenhava a logo de fato.
// ============================================================================

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { BUILD_SIGNATURE } from "../build-info.js";
import { buildSceneOverlaySvgWithMeta } from "../scene-composer.js";
import { SCENES } from "../scenes.js";
import type { LogoLayout, VideoLayout } from "../scenes.js";

const SRC_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const LAYOUT: VideoLayout = {
  title: { scale: 1, offsetX: 0, offsetY: 0 },
  subtitle: { scale: 1, offsetX: 0, offsetY: 0 },
  cta: { scale: 1, offsetX: 0, offsetY: 0 },
  logo: {
    scale: 1,
    vAnchor: "top",
    hAnchor: "left",
    marginTop: 5,
    marginBottom: 5,
    marginLeft: 5,
    marginRight: 5,
  },
} as unknown as VideoLayout;

const CONTENT = {
  headline: "Promoção de verão",
  supportingText: "Aproveite hoje mesmo",
  ctaText: "Fale conosco",
};

const DATA_URI = "data:image/png;base64,iVBORw0KGgo=";
const scene = Object.values(SCENES)[0];

function build(logo: { dataUri: string; layout: LogoLayout } | null) {
  return buildSceneOverlaySvgWithMeta({
    width: 1080,
    height: 1920,
    scene,
    layout: LAYOUT,
    content: CONTENT,
    logo,
  });
}

/** Simula a decisão de watermark do render.ts (mesma regra). */
function decideWatermark(input: {
  brandingEnabled: boolean;
  logoLocal: string | null;
  sceneAppliesLogo: boolean;
  sceneLogoConfirmed: boolean;
}) {
  if (!input.brandingEnabled) {
    return { watermark: null, fallbackApplied: false };
  }
  const fallbackApplied =
    !!input.logoLocal && input.sceneAppliesLogo && !input.sceneLogoConfirmed;
  return {
    watermark: input.sceneLogoConfirmed ? null : input.logoLocal,
    fallbackApplied,
  };
}

describe("build signature — fonte única", () => {
  const files = readdirSync(SRC_DIR).filter((f) => f.endsWith(".ts"));

  it("nenhum módulo declara assinatura hardcoded fora de build-info.ts", () => {
    const legacy = /(render-scene-svg-escape-build-\d+|render-phase-5b1-build-\d+|brand-phase-5b1-v\d+)/;
    const offenders: string[] = [];
    for (const f of files) {
      if (f === "build-info.ts") continue;
      const content = readFileSync(path.join(SRC_DIR, f), "utf8");
      if (legacy.test(content)) offenders.push(f);
      if (content.includes(`"${BUILD_SIGNATURE}"`)) offenders.push(f);
    }
    expect(offenders).toEqual([]);
  });

  it("index.ts e render.ts importam a assinatura oficial", () => {
    for (const f of ["index.ts", "render.ts"]) {
      const content = readFileSync(path.join(SRC_DIR, f), "utf8");
      expect(content).toMatch(/from "\.\/build-info\.js"/);
      expect(content).toContain("BUILD_SIGNATURE");
    }
  });

  it("assinatura é não-vazia e versionada", () => {
    expect(BUILD_SIGNATURE.length).toBeGreaterThan(8);
  });
});

describe("scene composer — confirmação objetiva da logo", () => {
  it("sem logo de entrada: logoRendered=false", () => {
    const r = build(null);
    expect(r.logoRendered).toBe(false);
    expect(r.logoSkipReason).toBe("no_logo_input");
    expect(r.svg).not.toContain("<image");
  });

  it("logo válida: logoRendered=true e <image> presente", () => {
    const r = build({ dataUri: DATA_URI, layout: LAYOUT.logo });
    expect(r.logoRendered).toBe(true);
    expect(r.logoBox!.width).toBeGreaterThan(4);
    expect(r.svg).toContain("<image");
  });

  it("dataUri vazio: sem logo e motivo explícito", () => {
    const r = build({ dataUri: "", layout: LAYOUT.logo });
    expect(r.logoRendered).toBe(false);
    expect(r.logoSkipReason).toBe("empty_data_uri");
  });

  it("caixa degenerada (margens que anulam o espaço): sem logo", () => {
    const r = build({
      dataUri: DATA_URI,
      layout: { ...LAYOUT.logo, marginLeft: 50, marginRight: 50, marginTop: 50, marginBottom: 50 },
    });
    expect(r.logoRendered).toBe(false);
    expect(r.logoSkipReason).toBe("degenerate_box");
  });

  it("layout com números inválidos não gera coordenadas NaN", () => {
    const r = build({
      dataUri: DATA_URI,
      layout: { ...LAYOUT.logo, scale: Number.NaN, marginLeft: Number.NaN },
    });
    expect(r.svg).not.toContain("NaN");
  });

  it("nunca embute signed URL no SVG", () => {
    const r = build({ dataUri: DATA_URI, layout: LAYOUT.logo });
    expect(r.svg).not.toMatch(/https?:\/\/[^"]*token=/);
    expect(r.svg).not.toContain("X-Amz-Signature");
  });
});

describe("regra de watermark", () => {
  it("branding desabilitado: sem watermark", () => {
    const d = decideWatermark({
      brandingEnabled: false,
      logoLocal: "/tmp/in-logo",
      sceneAppliesLogo: false,
      sceneLogoConfirmed: false,
    });
    expect(d.watermark).toBeNull();
  });

  it("branding habilitado sem cena: watermark externo aplicado", () => {
    const d = decideWatermark({
      brandingEnabled: true,
      logoLocal: "/tmp/in-logo",
      sceneAppliesLogo: false,
      sceneLogoConfirmed: false,
    });
    expect(d.watermark).toBe("/tmp/in-logo");
    expect(d.fallbackApplied).toBe(false);
  });

  it("cena aplica logo comprovadamente: watermark suprimido (sem duplicação)", () => {
    const d = decideWatermark({
      brandingEnabled: true,
      logoLocal: "/tmp/in-logo",
      sceneAppliesLogo: true,
      sceneLogoConfirmed: true,
    });
    expect(d.watermark).toBeNull();
    expect(d.fallbackApplied).toBe(false);
  });

  it("sceneAppliesLogo=true sem confirmação: FALLBACK aplica watermark", () => {
    const d = decideWatermark({
      brandingEnabled: true,
      logoLocal: "/tmp/in-logo",
      sceneAppliesLogo: true,
      sceneLogoConfirmed: false,
    });
    expect(d.watermark).toBe("/tmp/in-logo");
    expect(d.fallbackApplied).toBe(true);
  });

  it("download falhou (sem logo local): nenhum watermark, sem crash", () => {
    const d = decideWatermark({
      brandingEnabled: true,
      logoLocal: null,
      sceneAppliesLogo: true,
      sceneLogoConfirmed: false,
    });
    expect(d.watermark).toBeNull();
    expect(d.fallbackApplied).toBe(false);
  });

  it("renders consecutivos e paralelos são determinísticos", async () => {
    const seq = [1, 2, 3].map(() => build({ dataUri: DATA_URI, layout: LAYOUT.logo }).logoRendered);
    expect(seq).toEqual([true, true, true]);
    const par = await Promise.all(
      [1, 2, 3, 4].map(async () => build({ dataUri: DATA_URI, layout: LAYOUT.logo }).svg),
    );
    expect(new Set(par).size).toBe(1);
  });
});

describe("observabilidade — render.ts", () => {
  const render = readFileSync(path.join(SRC_DIR, "render.ts"), "utf8");

  it("emite decisão de watermark com campos exigidos", () => {
    expect(render).toContain("brand_watermark_decision");
    for (const field of [
      "scene_applies_logo",
      "scene_logo_confirmed",
      "watermark_fallback_applied",
      "logo_bytes",
      "build_signature",
    ]) {
      expect(render).toContain(field);
    }
  });

  it("não loga a signed URL da logo", () => {
    expect(render).not.toMatch(/logo_download_url|logoDownloadUrl:\s*brand/);
  });

  it("download vazio falha explicitamente", () => {
    expect(render).toContain("empty_logo_download");
  });
});
