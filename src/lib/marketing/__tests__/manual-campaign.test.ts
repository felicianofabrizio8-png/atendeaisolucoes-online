import { describe, it, expect } from "vitest";
import {
  buildManualOverlay,
  composeManualCaption,
  buildContactBlock,
  normalizeHashtags,
  manualFormatsToRoles,
  MANUAL_LIMITS,
} from "../manual-campaign";
import { classifyAiFailure, aiFailureMessage } from "../ai-failure";
import {
  THEME_PRESETS,
  getThemePreset,
  layoutForTheme,
} from "../video-editor/theme-presets";
import { getScene } from "../video-editor/scenes/registry";

describe("modo manual — overlays", () => {
  it("usa os textos digitados sem qualquer IA", () => {
    const o = buildManualOverlay({
      title: "Piscina 3x2",
      subtitle: "Instalação inclusa",
      cta_text: "Peça já",
    });
    expect(o).toEqual({
      overlay_headline: "Piscina 3x2",
      overlay_subheadline: "Instalação inclusa",
      overlay_cta: "Peça já",
    });
  });

  it("cai para texto promocional e depois preço quando não há subtítulo", () => {
    expect(
      buildManualOverlay({ title: "T", promo_text: "20% off", price: "R$ 10" })
        .overlay_subheadline,
    ).toBe("20% off");
    expect(
      buildManualOverlay({ title: "T", price: "R$ 10" }).overlay_subheadline,
    ).toBe("R$ 10");
    expect(buildManualOverlay({ title: "T" }).overlay_subheadline).toBeNull();
  });

  it("respeita os limites aceitos pela aprovação", () => {
    const long = "x".repeat(200);
    const o = buildManualOverlay({ title: long, subtitle: long, cta_text: long });
    expect(o.overlay_headline.length).toBeLessThanOrEqual(MANUAL_LIMITS.headline);
    expect(o.overlay_subheadline!.length).toBeLessThanOrEqual(MANUAL_LIMITS.subheadline);
    expect(o.overlay_cta!.length).toBeLessThanOrEqual(MANUAL_LIMITS.cta);
  });
});

describe("modo manual — legenda e contatos", () => {
  it("compõe legenda determinística com todos os blocos", () => {
    const caption = composeManualCaption({
      title: "Oferta",
      subtitle: "Só hoje",
      description: "Detalhes do produto",
      promo_text: "Frete grátis",
      price: "R$ 99",
      cta_text: "Chame no zap",
      whatsapp: "11999999999",
      instagram: "empresa",
      website: "site.com",
      phone: "1130001000",
    });
    expect(caption).toContain("Oferta");
    expect(caption).toContain("Valor: R$ 99");
    expect(caption).toContain("WhatsApp: 11999999999");
    expect(caption).toContain("Instagram: @empresa");
    expect(caption).toContain("Site: site.com");
  });

  it("ignora campos vazios", () => {
    expect(composeManualCaption({ title: "Só título" })).toBe("Só título");
    expect(buildContactBlock({ title: "x" })).toEqual([]);
  });

  it("normaliza hashtags sem duplicar", () => {
    expect(normalizeHashtags("#sol, sol  #verao")).toEqual(["#sol", "#verao"]);
    expect(normalizeHashtags([])).toEqual([]);
  });

  it("mapeia formatos escolhidos para roles", () => {
    expect(manualFormatsToRoles("feed")).toEqual(["feed"]);
    expect(manualFormatsToRoles("story")).toEqual(["story"]);
    expect(manualFormatsToRoles("feed_story")).toEqual(["feed", "story"]);
  });
});

describe("fallback automático da IA", () => {
  it.each([
    ["HTTP 401 unauthorized", "unauthorized"],
    ["Request failed 403 credit_hard_block_workspace", "forbidden"],
    ["429 rate limit exceeded", "rate_limited"],
    ["500 internal server error", "server_error"],
    ["Request timeout after 30s", "timeout"],
    ["TypeError: Failed to fetch", "network"],
  ])("classifica %s", (msg, expected) => {
    expect(classifyAiFailure(new Error(msg))).toBe(expected);
  });

  it("usa status numérico quando disponível", () => {
    expect(classifyAiFailure({ status: 402 })).toBe("no_credits");
    expect(classifyAiFailure({ status: 503 })).toBe("server_error");
  });

  it("nunca deixa o usuário sem caminho — erro desconhecido também oferece manual", () => {
    const kind = classifyAiFailure(new Error("algo estranho"));
    expect(kind).toBe("unknown");
    expect(aiFailureMessage(kind)).toContain("indisponível");
  });
});

describe("biblioteca de temas", () => {
  it("todo tema aponta para uma cena real do Render Engine", () => {
    for (const t of THEME_PRESETS) {
      expect(getScene(t.template).id).toBeTruthy();
      expect(t.colors.accent).toMatch(/^#[0-9A-Fa-f]{6}$/);
    }
  });

  it("expõe temas de ocasião esperados", () => {
    const ids = THEME_PRESETS.map((t) => t.id);
    for (const id of ["promocao", "oferta", "lancamento", "natal", "black_friday"]) {
      expect(ids).toContain(id);
    }
  });

  it("troca de tema muda o layout base sem trocar de motor", () => {
    const a = layoutForTheme("promocao");
    const b = layoutForTheme("institucional");
    expect(a.template).not.toBe(b.template);
    expect(getThemePreset("inexistente")).toBeNull();
  });
});
