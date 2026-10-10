import { describe, expect, it } from "vitest";
import { CAROUSEL_RECIPES, ROLE_HINTS, applyRecipe, buildCarousel, getRecipe, narrativeRoles } from "../studio/carousel-recipes";
import { documentFromVideo, normalizeDocument, toCarousel } from "../studio/document";
import { SCENE_FORMATS, SCENE_PURPOSES, buildSceneOverlaySvgWithMeta, getScene, hasNoText, isFullyVisible, placeImage } from "../video-editor/scenes/registry";

const M = (n: number) => `${String(n).repeat(8)}-1111-4111-8111-111111111111`;
const images = [1, 2, 3].map((n) => ({ origin: "marketing" as const, mediaId: M(n) }));

describe("sequências narrativas de carrossel", () => {
  it("há uma sequência para cada finalidade comercial, com cinco papéis na ordem da narrativa", () => {
    expect(CAROUSEL_RECIPES.map((r) => r.id).sort()).toEqual(Object.keys(SCENE_PURPOSES).sort());
    for (const recipe of CAROUSEL_RECIPES) {
      expect(recipe.steps.map((s) => s.role)).toEqual(["impacto", "apresentacao", "beneficio", "diferencial", "cta"]);
      // Todo modelo existe (um id errado cairia no modelo padrão em silêncio).
      for (const step of recipe.steps) expect(getScene(step.template).id).toBe(step.template);
      // Modelos variados: pelo menos quatro diferentes nas cinco páginas.
      expect(new Set(recipe.steps.map((s) => s.template)).size).toBeGreaterThanOrEqual(4);
      // A capa é um modelo pensado para a finalidade.
      expect(getScene(recipe.steps[0].template).purposes).toContain(recipe.id);
    }
    expect(getRecipe("não-existe").id).toBe("oferta");
  });

  it("a narrativa sempre começa no impacto e termina na chamada", () => {
    expect(narrativeRoles(1)).toEqual(["impacto"]);
    expect(narrativeRoles(2)).toEqual(["impacto", "cta"]);
    expect(narrativeRoles(5)).toEqual(["impacto", "apresentacao", "beneficio", "diferencial", "cta"]);
    const ten = narrativeRoles(10);
    expect(ten[0]).toBe("impacto");
    expect(ten[9]).toBe("cta");
    expect(ten.slice(1, 9).every((r) => ["apresentacao", "beneficio", "diferencial"].includes(r))).toBe(true);
  });

  it("carrossel novo não inventa texto: só o que o usuário informou, no lugar certo", () => {
    const doc = buildCarousel({ recipe: getRecipe("oferta"), format: "square", images, text: { headline: "Semana do cliente", cta: "Chame no WhatsApp" } });
    expect(doc.kind).toBe("carousel");
    expect(doc.format).toBe("square");
    expect(doc.pages).toHaveLength(5);
    expect(doc.pages.map((p) => p.role)).toEqual(["impacto", "apresentacao", "beneficio", "diferencial", "cta"]);
    expect(doc.pages.map((p) => p.layout.template)).toEqual(["oferta", "split", "etiqueta", "moderno", "impacto"]);
    expect(doc.pages[0].text).toEqual({ headline: "Semana do cliente", subheadline: "", cta: "" });
    expect(doc.pages[4].text).toEqual({ headline: "", subheadline: "", cta: "Chame no WhatsApp" });
    for (const page of doc.pages.slice(1, 4)) expect(page.text).toEqual({ headline: "", subheadline: "", cta: "" });
    // Fotos na ordem escolhida; páginas além das fotos ficam sem imagem.
    expect(doc.pages.map((p) => (p.image?.origin === "marketing" ? p.image.mediaId : null))).toEqual([M(1), M(2), M(3), null, null]);
    // Modelos diferentes, uma paleta só (a da capa).
    const cover = getScene("oferta").palette;
    for (const page of doc.pages) {
      expect(page.layout.colors?.accent).toBe(cover.accent);
      expect(page.layout.colors?.background).toBe(cover.background);
      expect(page.layout.colorMode).toBe("template");
    }
    // Sem nada informado, nenhum texto aparece — nem preço, nem promessa.
    const empty = buildCarousel({ recipe: getRecipe("luxo") });
    expect(empty.pages.every((p) => !p.text.headline && !p.text.subheadline && !p.text.cta)).toBe(true);
    expect(empty.format).toBe("portrait");
    expect(normalizeDocument(JSON.parse(JSON.stringify(doc)))).toEqual(doc);
  });

  it("respeita os limites: mínimo de 2 e máximo de 10 páginas", () => {
    expect(buildCarousel({ recipe: getRecipe("produto"), pages: 1 }).pages).toHaveLength(2);
    const many = buildCarousel({ recipe: getRecipe("produto"), images: Array.from({ length: 14 }, (_, i) => ({ origin: "marketing" as const, mediaId: M(i % 9) })) });
    expect(many.pages).toHaveLength(10);
    expect(many.pages.every((p) => p.image)).toBe(true);
  });

  it("aplicar uma sequência troca só o modelo: fotos, textos, cores e logo ficam", () => {
    const video = documentFromVideo({
      layout: { ...getScene("moderno").defaultLayout, colors: { ...getScene("moderno").palette, accent: "#12AB34" }, colorMode: "custom", logo: { ...getScene("moderno").defaultLayout.logo, visible: false } },
      text: { headline: "Novo", subheadline: "Chegou", cta: "Veja" },
      scenes: images.map((image) => ({ image, framing: null })),
    });
    const car = toCarousel(video);
    const next = applyRecipe(car, getRecipe("servico"), null);
    expect(next.pages.map((p) => p.role)).toEqual(car.pages.map((p) => p.role));
    expect(next.pages.map((p) => p.layout.template)).toEqual(["bloco", "lateral", "glass"]);
    expect(next.pages.map((p) => p.text)).toEqual(car.pages.map((p) => p.text));
    expect(next.pages.map((p) => p.image)).toEqual(car.pages.map((p) => p.image));
    for (const page of next.pages) {
      expect(page.layout.colorMode).toBe("custom");
      expect(page.layout.logo.visible).toBe(false);
    }
    // Com papéis livres, a narrativa é distribuída pela ordem.
    const free = { ...car, pages: car.pages.map((p) => ({ ...p, role: "livre" as const })) };
    expect(applyRecipe(free, getRecipe("oferta"), null).pages.map((p) => p.layout.template)).toEqual(["moderno", "moderno", "moderno"]);
    expect(applyRecipe(free, getRecipe("oferta"), null, true).pages.map((p) => p.role)).toEqual(["impacto", "apresentacao", "cta"]);
  });

  it("as dicas de cada papel orientam, mas nunca viram texto da página", () => {
    for (const hint of Object.values(ROLE_HINTS)) {
      expect(hint.purpose.length).toBeGreaterThan(10);
      expect(hint.headline.length).toBeGreaterThan(5);
    }
    const doc = buildCarousel({ recipe: getRecipe("oferta") });
    const allText = JSON.stringify(doc.pages.map((p) => p.text));
    for (const hint of Object.values(ROLE_HINTS)) expect(allText).not.toContain(hint.headline);
  });
});

describe("página só com foto", () => {
  const empty = { headline: null, supportingText: "  ", ctaText: "" };

  it("sem texto e com a opção ligada: nenhuma forma do modelo, só a logo; a foto usa o quadro inteiro", () => {
    expect(hasNoText(empty)).toBe(true);
    for (const id of ["oferta", "luxo", "duotone", "split", "moldura"]) {
      const scene = getScene(id);
      for (const size of Object.values(SCENE_FORMATS)) {
        const built = buildSceneOverlaySvgWithMeta({ width: size.width, height: size.height, scene, layout: scene.defaultLayout, content: empty, logo: { dataUri: "data:image/png;base64,AAAA" }, photoWhenEmpty: true });
        expect(built.svg).not.toMatch(/<(rect|polygon|path|circle|text)\b/);
        expect(built.svg).toContain("<image");
        expect(built.imageAreas.contain).toEqual({ x: 0, y: 0, width: size.width, height: size.height });
        const rect = placeImage({ width: 1600, height: 1200 }, built.imageAreas, { x: 0.5, y: 0.5, zoom: 1, fit: "contain", fill: "blur" });
        expect(isFullyVisible(rect, size)).toBe(true);
        expect(rect.width).toBeCloseTo(size.width, 0);
      }
    }
  });

  it("REGRESSÃO: desenhar uma página só com foto não contamina o modelo normal (cache por formato)", () => {
    const scene = getScene("oferta");
    const base = { width: 1080, height: 1350, scene, layout: scene.defaultLayout };
    const text = { headline: "Oferta", supportingText: null, ctaText: null };
    const before = buildSceneOverlaySvgWithMeta({ ...base, content: text });
    buildSceneOverlaySvgWithMeta({ ...base, content: empty, photoWhenEmpty: true });
    const after = buildSceneOverlaySvgWithMeta({ ...base, content: text });
    expect(after.svg).toBe(before.svg);
    expect(after.imageAreas).toEqual(before.imageAreas);
    expect(after.svg).toMatch(/<polygon\b/);
    // E o inverso: depois do modelo normal, a página sem texto segue limpa.
    expect(buildSceneOverlaySvgWithMeta({ ...base, content: empty, photoWhenEmpty: true }).svg).not.toMatch(/<(rect|polygon|path)\b/);
  });

  it("o vídeo não muda: sem a opção, o modelo desenha as formas mesmo sem texto; com texto, a opção não tem efeito", () => {
    const scene = getScene("oferta");
    const base = { width: 1080, height: 1920, scene, layout: scene.defaultLayout };
    expect(buildSceneOverlaySvgWithMeta({ ...base, content: empty }).svg).toMatch(/<(rect|polygon|path)\b/);
    const text = { headline: "Oferta", supportingText: null, ctaText: null };
    expect(hasNoText(text)).toBe(false);
    expect(buildSceneOverlaySvgWithMeta({ ...base, content: text, photoWhenEmpty: true }).svg).toBe(buildSceneOverlaySvgWithMeta({ ...base, content: text }).svg);
  });
});
