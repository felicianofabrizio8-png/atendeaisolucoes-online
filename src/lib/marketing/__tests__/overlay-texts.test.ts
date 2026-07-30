import { describe, it, expect } from "vitest";
import {
  normalizeForComparison,
  countWords,
  isIncomplete,
  fitWords,
  summarizeBodyForSubheadline,
  buildOverlayFromFallback,
  buildRecentSignaturesSet,
  normalizeOverlayCandidate,
} from "../overlay-texts";

describe("overlay-texts / normalização e utilitários", () => {
  it("normaliza comparação ignorando acento, caixa, pontuação e espaços", () => {
    expect(normalizeForComparison("Piscina dos Sonhos!"))
      .toBe(normalizeForComparison("piscina  dos, sonhos"));
    expect(normalizeForComparison("Áçãi")).toBe("acai");
  });

  it("conta palavras corretamente", () => {
    expect(countWords("")).toBe(0);
    expect(countWords("   ")).toBe(0);
    expect(countWords("Piscina dos sonhos")).toBe(3);
    expect(countWords("um dois três quatro cinco")).toBe(5);
  });

  it("detecta frase incompleta terminada em conectivo ou pontuação solta", () => {
    expect(isIncomplete("Aproveite o")).toBe(true);
    expect(isIncomplete("Aproveite com")).toBe(true);
    expect(isIncomplete("Aproveite,")).toBe(true);
    expect(isIncomplete("Aproveite hoje")).toBe(false);
  });
});

describe("overlay-texts / fitWords — nunca trunca no meio", () => {
  it("mantém apenas palavras inteiras dentro do limite de caracteres", () => {
    // 5 palavras/28 chars: "Conforto para toda a família" tem 28 chars exatos.
    const out = fitWords("Conforto para toda a família neste verão", 5, 28);
    expect(out.length).toBeLessThanOrEqual(28);
    expect(countWords(out)).toBeGreaterThanOrEqual(2);
    // Não terminou com palavra cortada
    expect(out.endsWith("famí")).toBe(false);
    expect(out.endsWith("verã")).toBe(false);
  });

  it("remove conectivos soltos ao final", () => {
    const out = fitWords("Aproveite o verão com a", 5, 28);
    expect(isIncomplete(out)).toBe(false);
  });

  it("respeita o limite de palavras", () => {
    const out = fitWords("Um dois três quatro cinco seis sete oito", 5, 100);
    expect(countWords(out)).toBeLessThanOrEqual(5);
  });
});

describe("overlay-texts / summarizeBodyForSubheadline", () => {
  it("extrai a primeira frase e reduz para subheadline", () => {
    const body = "Piscinas com pronta entrega em toda a região. Parcele em até 24x.";
    const s = summarizeBodyForSubheadline(body);
    expect(s.length).toBeLessThanOrEqual(45);
    expect(countWords(s)).toBeLessThanOrEqual(8);
    expect(isIncomplete(s)).toBe(false);
  });

  it("retorna vazio para body vazio", () => {
    expect(summarizeBodyForSubheadline("")).toBe("");
  });
});

describe("overlay-texts / normalizeOverlayCandidate — regras da spec", () => {
  const fallback = {
    title: "Piscina dos sonhos",
    body: "Instalação rápida com garantia total de fábrica. Peça seu orçamento hoje.",
    cta_text: "Peça orçamento agora mesmo",
  };
  const emptyRecent = new Set<string>();

  it("aceita candidato IA que já respeita os limites", () => {
    const r = normalizeOverlayCandidate(
      {
        headline: "Seu verão começa",
        subheadline: "Piscinas com pronta entrega",
        cta: "Peça orçamento",
      },
      fallback,
      emptyRecent,
    );
    expect(r.overlay_headline).toBe("Seu verão começa");
    expect(r.overlay_subheadline).toBe("Piscinas com pronta entrega");
    expect(r.overlay_cta).toBe("Peça orçamento");
    expect(r.telemetry.source).toBe("ai");
    expect(r.telemetry.repeated_recent).toBe(false);
  });

  it("reescreve headline muito longo sem cortar palavra", () => {
    const r = normalizeOverlayCandidate(
      {
        headline: "Aproveite a nossa incrível super promoção de piscinas hoje mesmo agora",
        subheadline: "Condições únicas neste mês",
        cta: "Fale conosco",
      },
      fallback,
      emptyRecent,
    );
    expect(r.overlay_headline.length).toBeLessThanOrEqual(28);
    expect(countWords(r.overlay_headline)).toBeLessThanOrEqual(5);
    expect(countWords(r.overlay_headline)).toBeGreaterThanOrEqual(2);
    expect(isIncomplete(r.overlay_headline)).toBe(false);
    expect(r.telemetry.reasons).toContain("headline_rewritten");
  });

  it("recorre ao fallback quando headline é impossível de sanear", () => {
    const r = normalizeOverlayCandidate(
      { headline: "a", subheadline: "", cta: "" },
      fallback,
      emptyRecent,
    );
    expect(r.telemetry.source).toBe("fallback");
    expect(r.telemetry.reasons).toContain("headline_fallback");
    expect(countWords(r.overlay_headline)).toBeGreaterThanOrEqual(2);
  });

  it("gera subheadline a partir do body quando ausente", () => {
    const r = normalizeOverlayCandidate(
      { headline: "Piscina dos sonhos", subheadline: "", cta: "Fale conosco" },
      fallback,
      emptyRecent,
    );
    expect(r.overlay_subheadline).not.toBeNull();
    expect(r.overlay_subheadline!.length).toBeLessThanOrEqual(45);
    expect(r.telemetry.reasons).toContain("subheadline_from_body");
  });

  it("descarta subheadline igual ao headline", () => {
    const r = normalizeOverlayCandidate(
      {
        headline: "Piscina dos sonhos",
        subheadline: "PISCINA DOS SONHOS!",
        cta: null,
      },
      fallback,
      emptyRecent,
    );
    // Precisa ter sido reescrita/substituída — não pode repetir literalmente.
    expect(
      normalizeForComparison(r.overlay_subheadline ?? ""),
    ).not.toBe(normalizeForComparison(r.overlay_headline));
  });

  it("limita CTA a 4 palavras", () => {
    const r = normalizeOverlayCandidate(
      {
        headline: "Seu verão começa",
        subheadline: "Piscinas com pronta entrega",
        cta: "Fale com nosso time de vendas agora mesmo",
      },
      fallback,
      emptyRecent,
    );
    expect(countWords(r.overlay_cta ?? "")).toBeLessThanOrEqual(4);
    expect(r.telemetry.reasons).toContain("cta_rewritten");
  });

  it("detecta repetição normalizada contra histórico e substitui o headline", () => {
    const recent = buildRecentSignaturesSet([
      { overlay_headline: "Seu Verão Começa!", overlay_subheadline: null },
    ]);
    const r = normalizeOverlayCandidate(
      {
        headline: "seu verão começa",
        subheadline: "com desconto especial hoje",
        cta: "Peça orçamento",
      },
      fallback,
      recent,
    );
    expect(r.telemetry.repeated_recent).toBe(true);
    expect(r.telemetry.reasons).toContain("headline_switched_to_fallback");
    expect(normalizeForComparison(r.overlay_headline)).not.toBe(
      normalizeForComparison("Seu Verão Começa!"),
    );
  });

  it("nunca produz frase incompleta ao reescrever", () => {
    const r = normalizeOverlayCandidate(
      {
        headline: "Aproveite o verão com a nossa",
        subheadline: "Peça hoje mesmo o seu",
        cta: "Fale com o",
      },
      fallback,
      emptyRecent,
    );
    expect(isIncomplete(r.overlay_headline)).toBe(false);
    if (r.overlay_subheadline) expect(isIncomplete(r.overlay_subheadline)).toBe(false);
    if (r.overlay_cta) expect(isIncomplete(r.overlay_cta)).toBe(false);
  });
});

describe("overlay-texts / fallback determinístico", () => {
  it("usa title/body/cta_text respeitando limites", () => {
    const fb = buildOverlayFromFallback({
      title: "Nossa fantástica coleção de piscinas familiares",
      body: "Modelos exclusivos com instalação rápida. Garantia total de 5 anos.",
      cta_text: "Solicite hoje mesmo o seu orçamento personalizado",
    });
    expect(fb.headline.length).toBeLessThanOrEqual(28);
    expect(countWords(fb.headline)).toBeLessThanOrEqual(5);
    if (fb.subheadline) expect(fb.subheadline.length).toBeLessThanOrEqual(45);
    if (fb.cta) expect(countWords(fb.cta)).toBeLessThanOrEqual(4);
  });

  it("substitui headline vazio por 'Novidade exclusiva'", () => {
    const fb = buildOverlayFromFallback({ title: "", body: "Detalhe", cta_text: null });
    expect(fb.headline).toBe("Novidade exclusiva");
  });
});

// Fase M1 — Prova: Feed e Story devem persistir exatamente o mesmo overlay.
describe("overlay-texts / Feed e Story compartilham o mesmo texto visual", () => {
  it("uma única normalização produz o mesmo objeto para Feed e Story", () => {
    const single = normalizeOverlayCandidate(
      {
        headline: "Mais lazer para família",
        subheadline: "Piscina instalada em até 15 dias",
        cta: "Peça orçamento",
      },
      { title: "T", body: "B", cta_text: null },
      new Set(),
    );
    const feedOverlay = {
      overlay_headline: single.overlay_headline,
      overlay_subheadline: single.overlay_subheadline,
      overlay_cta: single.overlay_cta,
    };
    const storyOverlay = {
      overlay_headline: single.overlay_headline,
      overlay_subheadline: single.overlay_subheadline,
      overlay_cta: single.overlay_cta,
    };
    expect(feedOverlay).toEqual(storyOverlay);
  });
});

// 5 exemplos reais processados através do pipeline (validação + reescrita).
describe("overlay-texts / 5 combinações reais válidas", () => {
  const cases: Array<{
    label: string;
    raw: { headline: string; subheadline: string; cta: string };
  }> = [
    {
      label: "verão / lazer",
      raw: {
        headline: "Seu verão começa",
        subheadline: "Piscinas com pronta entrega",
        cta: "Peça orçamento",
      },
    },
    {
      label: "família",
      raw: {
        headline: "Mais lazer família",
        subheadline: "Instalação em até 15 dias",
        cta: "Conheça os modelos",
      },
    },
    {
      label: "qualidade",
      raw: {
        headline: "Qualidade Solário",
        subheadline: "Garantia de fábrica de 5 anos",
        cta: "Fale conosco",
      },
    },
    {
      label: "aspiracional",
      raw: {
        headline: "Piscina dos sonhos",
        subheadline: "Transforme seu quintal neste mês",
        cta: "Quero conhecer",
      },
    },
    {
      label: "urgência",
      raw: {
        headline: "Últimas unidades",
        subheadline: "Condição especial válida essa semana",
        cta: "Garanta a sua",
      },
    },
  ];

  it.each(cases)("$label — respeita todos os limites", ({ raw }) => {
    const r = normalizeOverlayCandidate(
      raw,
      { title: "x", body: "y", cta_text: null },
      new Set(),
    );
    expect(r.overlay_headline.length).toBeLessThanOrEqual(28);
    expect(countWords(r.overlay_headline)).toBeGreaterThanOrEqual(2);
    expect(countWords(r.overlay_headline)).toBeLessThanOrEqual(5);
    expect(isIncomplete(r.overlay_headline)).toBe(false);
    if (r.overlay_subheadline) {
      expect(r.overlay_subheadline.length).toBeLessThanOrEqual(45);
      expect(countWords(r.overlay_subheadline)).toBeGreaterThanOrEqual(3);
      expect(countWords(r.overlay_subheadline)).toBeLessThanOrEqual(8);
      expect(isIncomplete(r.overlay_subheadline)).toBe(false);
    }
    if (r.overlay_cta) {
      expect(countWords(r.overlay_cta)).toBeLessThanOrEqual(4);
      expect(isIncomplete(r.overlay_cta)).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------
// Sprint 1 · Item 3 — CTA truncado
// Regressão: `ctaOk` validava apenas contagem de palavras e comprimento, então
// CTAs curtos porém sintaticamente incompletos ("Fale com o") passavam intactos.
// ---------------------------------------------------------------------------

describe("overlay-texts / CTA nunca pode ficar truncado", () => {
  const fallback = {
    title: "Piscina dos sonhos",
    body: "Instalação rápida com garantia total de fábrica. Peça seu orçamento hoje.",
    cta_text: "Peça orçamento agora mesmo",
  };
  const emptyRecent = new Set<string>();

  const truncados = ["Fale com o", "Entre em", "Peça pelo", "Compre na", "Garanta o seu com a"];

  for (const entrada of truncados) {
    it(`sanea CTA terminado em conectivo: "${entrada}"`, () => {
      const r = normalizeOverlayCandidate(
        {
          headline: "Piscina dos sonhos",
          subheadline: "Condições únicas neste mês",
          cta: entrada,
        },
        fallback,
        emptyRecent,
      );
      // Ou o CTA sai completo, ou é descartado — nunca truncado.
      if (r.overlay_cta) {
        expect(isIncomplete(r.overlay_cta)).toBe(false);
        expect(countWords(r.overlay_cta)).toBeLessThanOrEqual(4);
      }
      expect(r.telemetry.reasons.some((x) => x.startsWith("cta_"))).toBe(true);
    });
  }

  it("CTA vazio não gera texto incompleto e recorre ao fallback", () => {
    const r = normalizeOverlayCandidate(
      { headline: "Piscina dos sonhos", subheadline: "Condições únicas neste mês", cta: "" },
      fallback,
      emptyRecent,
    );
    if (r.overlay_cta) expect(isIncomplete(r.overlay_cta)).toBe(false);
  });

  it("CTA já válido é preservado sem reescrita", () => {
    const r = normalizeOverlayCandidate(
      {
        headline: "Piscina dos sonhos",
        subheadline: "Condições únicas neste mês",
        cta: "Peça orçamento",
      },
      fallback,
      emptyRecent,
    );
    expect(r.overlay_cta).toBe("Peça orçamento");
    expect(r.telemetry.reasons).not.toContain("cta_rewritten");
    expect(r.telemetry.reasons).not.toContain("cta_dropped");
  });

  it("CTA composto apenas de conectivos é descartado, não truncado", () => {
    const r = normalizeOverlayCandidate(
      { headline: "Piscina dos sonhos", subheadline: "Condições únicas neste mês", cta: "com o a" },
      fallback,
      emptyRecent,
    );
    if (r.overlay_cta) expect(isIncomplete(r.overlay_cta)).toBe(false);
  });
});
