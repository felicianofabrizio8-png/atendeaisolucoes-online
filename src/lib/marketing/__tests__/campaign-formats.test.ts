import { describe, it, expect } from "vitest";
import {
  resolveCampaignFormats,
  roleFromContentFormat,
  formatsTelemetry,
} from "../campaign-formats";
import {
  buildThemeSnapshot,
  sanitizeThemeSnapshot,
  themeIdForTemplate,
} from "../theme-snapshot";
import { THEME_PRESETS } from "../video-editor/theme-presets";

describe("resolveCampaignFormats", () => {
  it("respeita feed apenas", () => {
    const r = resolveCampaignFormats({ formats: ["feed"] });
    expect(r.roles).toEqual(["feed"]);
    expect(r.selection).toBe("feed");
    expect(r.source).toBe("explicit");
  });

  it("respeita story apenas", () => {
    const r = resolveCampaignFormats({ formats: ["story"] });
    expect(r.roles).toEqual(["story"]);
    expect(r.selection).toBe("story");
  });

  it("respeita feed + story", () => {
    const r = resolveCampaignFormats({ formats: ["story", "feed"] });
    expect(r.roles).toEqual(["feed", "story"]);
    expect(r.selection).toBe("feed+story");
  });

  it("campanha legada sem formats cai no fallback feed+story", () => {
    const r = resolveCampaignFormats({ promotion_id: "x" });
    expect(r.roles).toEqual(["feed", "story"]);
    expect(r.source).toBe("legacy_fallback");
  });

  it("ai_prompt nulo ou inválido também cai no fallback", () => {
    expect(resolveCampaignFormats(null).source).toBe("legacy_fallback");
    expect(resolveCampaignFormats("nope").source).toBe("legacy_fallback");
    expect(resolveCampaignFormats({ formats: [] }).source).toBe("legacy_fallback");
    expect(resolveCampaignFormats({ formats: ["tiktok"] }).source).toBe(
      "legacy_fallback",
    );
  });

  it("normaliza duplicatas e valores desconhecidos", () => {
    const r = resolveCampaignFormats({ formats: ["feed", "feed", "bogus"] });
    expect(r.roles).toEqual(["feed"]);
  });

  it("mapeia formato de conteúdo para role", () => {
    expect(roleFromContentFormat("feed")).toBe("feed");
    expect(roleFromContentFormat("story")).toBe("story");
    expect(roleFromContentFormat("reel")).toBe("story");
    expect(roleFromContentFormat("whatsapp_cta")).toBeNull();
  });

  it("telemetria não vaza PII e é JSON válido", () => {
    const line = formatsTelemetry("campaign_formats_resolved", {
      campaign_id: "c1",
      company_id: "co1",
      formats: "feed",
      source: "explicit",
    });
    const parsed = JSON.parse(line) as Record<string, unknown>;
    expect(parsed.event).toBe("campaign_formats_resolved");
    expect(parsed.formats).toBe("feed");
    expect(Object.keys(parsed)).not.toContain("title");
  });
});

describe("theme snapshot", () => {
  it("gera snapshot com cores hex válidas para todos os temas", () => {
    for (const preset of THEME_PRESETS) {
      const snap = buildThemeSnapshot(preset.id);
      expect(snap).not.toBeNull();
      expect(snap!.id).toBe(preset.id);
      expect(snap!.accentColor).toMatch(/^#[0-9a-f]{6}$/i);
      expect(snap!.textColor).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });

  it("tema desconhecido não gera snapshot (cena mantém cores nativas)", () => {
    expect(buildThemeSnapshot("nao-existe")).toBeNull();
    expect(buildThemeSnapshot(null)).toBeNull();
  });

  it("sanitiza snapshot inválido vindo do banco", () => {
    expect(sanitizeThemeSnapshot({ id: "x", accentColor: "azul" })!.accentColor).toMatch(/^#[0-9A-F]{6}$/);
    expect(sanitizeThemeSnapshot(null)).toBeNull();
    expect(sanitizeThemeSnapshot("promo")).toBeNull();
  });

  it("preserva contraste mínimo entre texto e fundo", () => {
    for (const preset of THEME_PRESETS) {
      const snap = buildThemeSnapshot(preset.id)!;
      expect(snap.textColor.toLowerCase()).not.toBe(snap.backgroundColor.toLowerCase());
    }
  });

  it("deriva tema a partir do template do editor", () => {
    const withTemplate = THEME_PRESETS[0];
    expect(themeIdForTemplate(withTemplate.template)).toBeTypeOf("string");
    expect(themeIdForTemplate(null)).toBeNull();
  });
});
