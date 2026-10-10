import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { getRecipe } from "../studio/carousel-recipes";
import { normalizeDocument } from "../studio/document";
import { allowedNumbers, buildFacts, fitWords, formatBRL, groundText, priceLine, proposalTexts, proposeCarousel, type ProposalProduct, type ProposalPromotion } from "../studio/proposal";

const P = "33333333-3333-4333-8333-333333333333";
const product = (over: Partial<ProposalProduct> = {}): ProposalProduct => ({
  id: P,
  name: "Sofá Viena 3 lugares",
  description: "Sofá retrátil em tecido suede. Estrutura de eucalipto.",
  price: 2499.9,
  promo_price: null,
  included_items: ["2 almofadas", "Pés de madeira"],
  images: ["co/p/sofa-1.jpg", "co/p/sofa-2.jpg"],
  ...over,
});
const promotion = (over: Partial<ProposalPromotion> = {}): ProposalPromotion => ({
  id: "44444444-4444-4444-8444-444444444444",
  title: "Semana do estofado",
  description: "Frete grátis para a cidade.",
  price_original: 2499.9,
  price_promo: 1999,
  discount_percent: 20,
  ends_at: "2026-11-30T23:59:00Z",
  whatsapp_cta_text: "Chame no WhatsApp",
  cover_media_id: null,
  ...over,
});

const allText = (doc: { pages: Array<{ text: { headline: string; subheadline: string; cta: string } }> }) => doc.pages.flatMap((p) => Object.values(p.text)).join(" | ");

describe("proposta de carrossel a partir do cadastro", () => {
  it("usa só campos do banco: título, preço, descrição, itens, chamada e validade", () => {
    const facts = buildFacts(product(), promotion());
    const doc = proposeCarousel(facts, getRecipe("oferta"));
    const [impacto, apresentacao, beneficio, diferencial, cta] = doc.pages.map((p) => p.text);
    expect(impacto).toEqual({ headline: "Semana do estofado", subheadline: "De R$ 2.499,90 por R$ 1.999,00", cta: "" });
    expect(apresentacao).toEqual({ headline: "Sofá Viena 3 lugares", subheadline: "Sofá retrátil em tecido suede.", cta: "" });
    expect(beneficio).toEqual({ headline: "Inclui", subheadline: "2 almofadas, Pés de madeira", cta: "" });
    expect(diferencial).toEqual({ headline: "", subheadline: "Frete grátis para a cidade.", cta: "" });
    expect(cta).toEqual({ headline: "", subheadline: "Válido até 30/11/2026", cta: "Chame no WhatsApp" });
    // Fotos do produto, na ordem do cadastro.
    expect(doc.pages.slice(0, 2).map((p) => p.image)).toEqual([
      { origin: "product", productId: P, imagePath: "co/p/sofa-1.jpg", framing: null },
      { origin: "product", productId: P, imagePath: "co/p/sofa-2.jpg", framing: null },
    ]);
    expect(normalizeDocument(JSON.parse(JSON.stringify(doc)))).toEqual(doc);
  });

  it("SEM PREÇO no cadastro, nenhum preço, desconto ou cifrão aparece", () => {
    const facts = buildFacts(product({ price: null }), null);
    expect(priceLine(facts)).toBe("");
    const doc = proposeCarousel(facts, getRecipe("produto"));
    const text = allText(doc);
    expect(text).not.toMatch(/R\$|%|desconto|\d{3,}/i);
    expect(doc.pages[0].text).toEqual({ headline: "Sofá Viena 3 lugares", subheadline: "", cta: "" });
    // Preço zero ou inválido conta como "sem preço".
    for (const price of [0, -5, Number.NaN]) expect(priceLine(buildFacts(product({ price }), null))).toBe("");
  });

  it("cada informação ausente simplesmente não aparece", () => {
    const bare = proposeCarousel(buildFacts(product({ description: null, included_items: [], images: [] }), null), getRecipe("produto"));
    expect(bare.pages.map((p) => p.text)).toEqual([
      { headline: "Sofá Viena 3 lugares", subheadline: "R$ 2.499,90", cta: "" },
      { headline: "", subheadline: "", cta: "" },
      { headline: "", subheadline: "", cta: "" },
      { headline: "", subheadline: "", cta: "" },
      { headline: "", subheadline: "", cta: "" },
    ]);
    expect(bare.pages.every((p) => p.image === null)).toBe(true);
    // Promoção sem data, sem chamada e sem desconto.
    const texts = proposalTexts(buildFacts(null, promotion({ ends_at: null, whatsapp_cta_text: null, discount_percent: null, price_original: null, price_promo: null, description: null })));
    expect(texts.cta).toEqual({ headline: "", subheadline: "", cta: "" });
    expect(texts.impacto).toEqual({ headline: "Semana do estofado", subheadline: "", cta: "" });
  });

  it("linha de preço: de/por só quando o original é maior; só desconto quando não há valores", () => {
    expect(priceLine(buildFacts(product({ price: 100, promo_price: 80 }), null))).toBe("De R$ 100,00 por R$ 80,00");
    expect(priceLine(buildFacts(product({ price: 100, promo_price: 120 }), null))).toBe("R$ 120,00");
    expect(priceLine(buildFacts(null, promotion({ price_original: null, price_promo: null, discount_percent: 15 })))).toBe("15% de desconto");
    expect(priceLine(buildFacts(null, promotion({ price_original: null, price_promo: 49.9 })))).toBe("R$ 49,90");
    expect(formatBRL(1234567.5)).toBe("R$ 1.234.567,50");
  });

  it("textos longos são cortados em palavra inteira, nunca reescritos", () => {
    const long = "Conjunto completo de móveis planejados para sala de estar e jantar integrada";
    const facts = buildFacts(product({ name: long, description: `${long} com acabamento premium e montagem inclusa em toda a região metropolitana.` }), null);
    const texts = proposalTexts(facts);
    expect(texts.impacto.headline.length).toBeLessThanOrEqual(40);
    expect(long.startsWith(texts.impacto.headline)).toBe(true);
    expect(texts.impacto.headline.endsWith(" ")).toBe(false);
    expect(texts.apresentacao.subheadline.length).toBeLessThanOrEqual(60);
    expect(fitWords("Supercalifragilisticoespialidoso", 10)).toBe("");
  });

  it("todo texto da proposta existe no cadastro (ou é rótulo fixo)", () => {
    const p = product();
    const promo = promotion();
    const source = [p.name, p.description, ...p.included_items, promo.title, promo.description, promo.whatsapp_cta_text].join(" ");
    const doc = proposeCarousel(buildFacts(p, promo), getRecipe("oferta"));
    for (const page of doc.pages) {
      for (const value of Object.values(page.text)) {
        if (!value || value === "Inclui" || value.startsWith("De R$") || value.startsWith("Válido até")) continue;
        for (const word of value.split(/[\s,]+/).filter((w) => w.length > 3)) expect(source).toContain(word);
      }
    }
  });
});

describe("trava para texto escrito por IA", () => {
  const facts = buildFacts(product(), promotion());
  const noPrice = buildFacts(product({ price: null, description: "Sofá retrátil." }), null);

  it("aceita texto sem números novos", () => {
    expect(groundText("Conforto para a sua sala", facts, 40)).toEqual({ ok: true, text: "Conforto para a sua sala" });
    expect(groundText("  Sofá de 3 lugares  ", facts, 40)).toEqual({ ok: true, text: "Sofá de 3 lugares" });
    expect(groundText("20% de desconto", facts, 40).ok).toBe(true);
    expect(groundText("Por R$ 1.999,00", facts, 40).ok).toBe(true);
  });

  it("recusa preço, desconto ou número que não está no cadastro", () => {
    expect(groundText("Por apenas R$ 1.499,00", facts, 40)).toEqual({ ok: false, reason: "unknown_number" });
    expect(groundText("50% de desconto", facts, 40)).toEqual({ ok: false, reason: "unknown_number" });
    expect(groundText("Garantia de 5 anos", facts, 40)).toEqual({ ok: false, reason: "unknown_number" });
    expect(groundText("Entrega em 24 horas", facts, 40)).toEqual({ ok: false, reason: "unknown_number" });
    // Sem preço cadastrado, nem menção a preço ou desconto passa.
    expect(groundText("Preço especial em R$", noPrice, 40)).toEqual({ ok: false, reason: "price_without_fact" });
    expect(groundText("Com desconto imperdível", noPrice, 40)).toEqual({ ok: false, reason: "price_without_fact" });
    expect(groundText("Frete grátis", noPrice, 40)).toEqual({ ok: false, reason: "price_without_fact" });
  });

  it("recusa texto vazio ou acima do limite, sem tentar consertar", () => {
    expect(groundText("   ", facts, 40)).toEqual({ ok: false, reason: "empty" });
    expect(groundText("a".repeat(41), facts, 40)).toEqual({ ok: false, reason: "too_long" });
  });

  it("os números autorizados são exatamente os do cadastro", () => {
    const allowed = allowedNumbers(facts);
    for (const n of ["2499.9", "1999", "20", "3", "2", "30", "11", "2026"]) expect(allowed.has(n)).toBe(true);
    expect(allowed.has("1499")).toBe(false);
  });
});

describe("contrato do servidor da proposta", () => {
  const source = readFileSync(resolve(process.cwd(), "src/lib/marketing/studio/studio.functions.ts"), "utf8");
  const block = source.slice(source.indexOf("export const proposeStudioCarousel"));

  it("lê produto e promoção só da empresa da sessão, não chama IA e não grava nada", () => {
    expect(block).toContain('.from("marketing_promotions")');
    expect(block).toContain('.from("products")');
    expect(block.match(/\.eq\("company_id", companyId\)/g)!.length).toBeGreaterThanOrEqual(2);
    expect(block).not.toMatch(/\.insert\(|\.update\(|\.delete\(|fetch\(|LOVABLE_API_KEY/);
    expect(block).toContain("await assertDocumentImagesOwned(supabase, companyId, document)");
    expect(source).not.toContain("company_id: z.");
  });
});
