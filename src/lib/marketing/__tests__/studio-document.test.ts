import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  KIND_PAGE_LIMITS,
  STUDIO_DOC_VERSION,
  addPage,
  blankPage,
  documentFromVideo,
  documentImages,
  duplicatePage,
  movePage,
  newDocument,
  normalizeDocument,
  removePage,
  setFormat,
  toCarousel,
  updatePage,
  type StudioDocument,
} from "../studio/document";
import { contentFormatFor, contentTitleFor, documentFromContentRow, documentMediaIds, documentProductImages, studioKindOf } from "../studio/content-mapping";
import { getScene } from "../video-editor/scenes/registry";
import type { MarketingContentRow } from "../marketing.types";

const root = resolve(process.cwd());
const M1 = "11111111-1111-4111-8111-111111111111";
const M2 = "22222222-2222-4222-8222-222222222222";
const P1 = "33333333-3333-4333-8333-333333333333";

function videoDoc(): StudioDocument {
  return documentFromVideo({
    layout: getScene("oferta").defaultLayout,
    text: { headline: "Semana do cliente", subheadline: "Só até sábado", cta: "Peça pelo WhatsApp" },
    scenes: [
      { image: { origin: "marketing", mediaId: M1 }, framing: null },
      { image: { origin: "product", productId: P1, imagePath: "p/a.jpg" }, framing: { x: 0.2, y: 0.5, zoom: 1.5, fit: "cover", fill: "blur" } },
      { image: { origin: "marketing", mediaId: M2 }, framing: null },
    ],
  });
}

describe("documento do estúdio: normalização", () => {
  it("recusa o que não é um documento da versão atual", () => {
    for (const bad of [null, 1, "x", [], {}, { version: 2, kind: "art", pages: [{}] }, { version: 1, kind: "outro", pages: [{}] }, { version: 1, kind: "art", pages: [] }]) {
      expect(normalizeDocument(bad)).toBeNull();
    }
  });

  it("corrige formato inválido para o padrão do tipo e limita o número de páginas", () => {
    const doc = normalizeDocument({ version: 1, kind: "carousel", format: "story", pages: Array.from({ length: 30 }, () => ({})) })!;
    expect(doc.format).toBe("portrait");
    expect(doc.pages).toHaveLength(KIND_PAGE_LIMITS.carousel.max);
    expect(normalizeDocument({ version: 1, kind: "art", format: "square", pages: [{}, {}, {}] })!.pages).toHaveLength(1);
  });

  it("corta textos nos limites do banco, remove caracteres de controle e descarta imagens malformadas", () => {
    const doc = normalizeDocument({
      version: 1,
      kind: "art",
      format: "square",
      pages: [{ text: { headline: "a".repeat(200), subheadline: "linha\u0000dois", cta: 42 }, image: { origin: "marketing", mediaId: "não-é-uuid" }, layout: { template: "inexistente" }, role: "x" }],
    })!;
    const page = doc.pages[0];
    expect(page.text.headline).toHaveLength(40);
    expect(page.text.subheadline).toBe("linha dois");
    expect(page.text.cta).toBe("");
    expect(page.image).toBeNull();
    expect(page.role).toBe("livre");
    // Modelo desconhecido cai no padrão, sem quebrar.
    expect(getScene(page.layout.template).id).toBe(page.layout.template);
  });

  it("é idempotente e sobrevive a JSON (o que vai para a coluna design)", () => {
    const doc = toCarousel(videoDoc());
    const again = normalizeDocument(JSON.parse(JSON.stringify(doc)));
    expect(again).toEqual(doc);
    expect(normalizeDocument(again)).toEqual(doc);
  });

  it("ids repetidos são trocados para não confundir o editor", () => {
    const doc = normalizeDocument({ version: 1, kind: "carousel", pages: [{ id: "a" }, { id: "a" }, { id: "a" }] })!;
    expect(new Set(doc.pages.map((p) => p.id)).size).toBe(3);
  });
});

describe("documento do estúdio: páginas", () => {
  it("respeita os limites de cada tipo", () => {
    const art = newDocument("art");
    expect(art.pages).toHaveLength(1);
    expect(addPage(art)).toBe(art);
    expect(removePage(art, art.pages[0].id)).toBe(art);

    let car = newDocument("carousel");
    expect(car.pages).toHaveLength(2);
    expect(removePage(car, car.pages[0].id)).toBe(car);
    for (let i = 0; i < 20; i++) car = addPage(car);
    expect(car.pages).toHaveLength(10);
  });

  it("duplicar copia a página logo depois da original, com id novo", () => {
    let doc = newDocument("carousel", "oferta");
    doc = updatePage(doc, doc.pages[0].id, (p) => ({ ...p, text: { ...p.text, headline: "Oferta" }, image: { origin: "marketing", mediaId: M1, framing: null } }));
    const next = duplicatePage(doc, doc.pages[0].id);
    expect(next.pages).toHaveLength(3);
    expect(next.pages[1].text.headline).toBe("Oferta");
    expect(next.pages[1].image).toEqual(doc.pages[0].image);
    expect(next.pages[1].id).not.toBe(doc.pages[0].id);
    // Cópia independente.
    expect(next.pages[1].text).not.toBe(next.pages[0].text);
  });

  it("mover troca com a vizinha e ignora as bordas; página nova herda cores e modelo", () => {
    const doc = toCarousel(videoDoc());
    const [a, b, c] = doc.pages.map((p) => p.id);
    expect(movePage(doc, a, -1)).toBe(doc);
    expect(movePage(doc, c, 1)).toBe(doc);
    expect(movePage(doc, a, 1).pages.map((p) => p.id)).toEqual([b, a, c]);

    const custom = updatePage(doc, a, (p) => ({ ...p, layout: { ...p.layout, colors: { ...getScene("oferta").palette, accent: "#123456" }, colorMode: "custom" } }));
    const added = addPage(custom, a);
    expect(added.pages[1].layout.template).toBe("oferta");
    expect(added.pages[1].layout.colors?.accent).toBe("#123456");
    expect(added.pages[1].image).toBeNull();
  });

  it("só aceita formatos do tipo", () => {
    const car = newDocument("carousel");
    expect(setFormat(car, "square").format).toBe("square");
    expect(setFormat(car, "story")).toBe(car);
    expect(setFormat(newDocument("art"), "story").format).toBe("story");
  });
});

describe("converter vídeo em carrossel", () => {
  it("mantém fotos, enquadramento, modelo e cores; não inventa texto", () => {
    const video = videoDoc();
    const car = toCarousel(video, "square");
    expect(car.kind).toBe("carousel");
    expect(car.format).toBe("square");
    expect(car.pages.map((p) => p.image)).toEqual(video.pages.map((p) => p.image));
    expect(car.pages.every((p) => p.layout.template === "oferta")).toBe(true);
    // Narrativa: impacto → apresentação → chamada final.
    expect(car.pages.map((p) => p.role)).toEqual(["impacto", "apresentacao", "cta"]);
    expect(car.pages[0].text).toEqual({ headline: "Semana do cliente", subheadline: "Só até sábado", cta: "" });
    expect(car.pages[1].text).toEqual({ headline: "", subheadline: "", cta: "" });
    expect(car.pages[2].text).toEqual({ headline: "", subheadline: "", cta: "Peça pelo WhatsApp" });
    // Todo texto do carrossel já existia no vídeo.
    const original = new Set(Object.values(video.pages[0].text));
    for (const p of car.pages) for (const value of Object.values(p.text)) if (value) expect(original.has(value)).toBe(true);
    // O vídeo de origem não é alterado.
    expect(video.pages[1].text.headline).toBe("Semana do cliente");
  });

  it("vídeo de uma cena vira carrossel de duas páginas (mínimo), a segunda só com a chamada", () => {
    const one = documentFromVideo({ layout: getScene("moderno").defaultLayout, text: { headline: "Novo", subheadline: "", cta: "Saiba mais" }, scenes: [{ image: { origin: "marketing", mediaId: M1 }, framing: null }] });
    const car = toCarousel(one);
    expect(car.pages).toHaveLength(2);
    expect(car.pages[0].text.headline).toBe("Novo");
    expect(car.pages[1].image).toBeNull();
    expect(car.pages[1].text).toEqual({ headline: "", subheadline: "", cta: "Saiba mais" });
  });
});

describe("documento ↔ conteúdo", () => {
  it("formato e título da linha", () => {
    expect(contentFormatFor({ kind: "carousel", format: "portrait" })).toBe("carousel");
    expect(contentFormatFor({ kind: "art", format: "square" })).toBe("feed");
    expect(contentFormatFor({ kind: "art", format: "story" })).toBe("story");
    const doc = toCarousel(videoDoc());
    expect(contentTitleFor(doc)).toBe("Semana do cliente");
    expect(contentTitleFor(doc, "  Black Friday ")).toBe("Black Friday");
    expect(contentTitleFor(newDocument("art"))).toBe("Arte");
  });

  it("lista as imagens que o servidor precisa conferir", () => {
    const doc = toCarousel(videoDoc());
    expect(documentMediaIds(doc)).toEqual([M1, M2]);
    expect([...documentProductImages(doc)]).toEqual([[P1, new Set(["p/a.jpg"])]]);
    expect(documentImages(duplicatePage(doc, doc.pages[0].id))).toHaveLength(3);
  });

  it("vídeo anterior ao estúdio abre como documento equivalente, sem gravar nada", () => {
    const row = {
      id: "c1",
      campaign_id: "camp",
      format: "story",
      overlay_headline: "Promo",
      overlay_subheadline: null,
      overlay_cta: "Chame",
      video_template: "oferta",
      video_layout: null,
      primary_image_media_id: M1,
      ai_prompt: {
        image_sequence: [
          { source: "marketing_media", image_id: M1, focal_point: null },
          { source: "product_image", product_id: P1, product_image_path: "p/a.jpg", focal_point: { x: 0.3, y: 0.4, zoom: 2 } },
        ],
      },
    } as unknown as MarketingContentRow;
    const doc = documentFromContentRow(row)!;
    expect(doc.kind).toBe("video");
    expect(doc.format).toBe("story");
    expect(doc.pages).toHaveLength(2);
    expect(doc.pages[0].text).toEqual({ headline: "Promo", subheadline: "", cta: "Chame" });
    expect(doc.pages[0].layout.template).toBe("oferta");
    // Corte antigo (sem `fit`) continua sendo um corte.
    expect(doc.pages[1].image?.framing).toMatchObject({ x: 0.3, y: 0.4, zoom: 2, fit: "cover" });
    expect(row.design).toBeUndefined();

    // Sem sequência salva: usa a imagem principal.
    expect(documentFromContentRow({ ...row, ai_prompt: null } as MarketingContentRow)!.pages[0].image).toMatchObject({ origin: "marketing", mediaId: M1 });
    // Post de texto não vira documento.
    expect(documentFromContentRow({ ...row, campaign_id: null } as MarketingContentRow)).toBeNull();
  });

  it("design salvo tem prioridade e define se o conteúdo é do estúdio", () => {
    const doc = newDocument("art", "luxo", "square");
    const row = { id: "c2", format: "feed", design: JSON.parse(JSON.stringify(doc)) } as unknown as MarketingContentRow;
    expect(documentFromContentRow(row)).toEqual(doc);
    expect(studioKindOf(row)).toBe("art");
    expect(studioKindOf({ design: null })).toBeNull();
    expect(studioKindOf({ design: { kind: "video" } })).toBeNull();
  });

  it("página em branco usa o modelo pedido", () => {
    expect(blankPage("luxo").layout.template).toBe("luxo");
    expect(STUDIO_DOC_VERSION).toBe(1);
  });
});

describe("contrato do servidor do estúdio", () => {
  const source = readFileSync(resolve(root, "src/lib/marketing/studio/studio.functions.ts"), "utf8");

  it("a empresa vem da sessão e restringe toda leitura e escrita", () => {
    expect(source).not.toMatch(/company_id:\s*z\./);
    expect(source).toContain('.from("profiles").select("company_id").eq("id", userId)');
    const queries = source.split('.from("marketing_contents")').slice(1);
    expect(queries.length).toBeGreaterThanOrEqual(4);
    for (const q of queries) {
      const head = q.slice(0, 420);
      expect(head.includes('.eq("company_id", companyId)') || head.includes("company_id: companyId")).toBe(true);
    }
    expect(source).toContain("requireSupabaseAuth");
  });

  it("normaliza o documento, confere a posse das imagens e não sobrescreve vídeo nem post antigo", () => {
    expect(source).toContain("normalizeDocument(data.document)");
    expect(source).toContain("await assertDocumentImagesOwned(supabase, companyId, doc)");
    expect(source).toContain('throw new Error("studio_kind_not_supported")');
    expect(source).toContain('throw new Error("studio_content_not_editable")');
    expect(source).toContain('status: "draft"');
  });

  it("trocar a capa do vídeo atualiza a imagem principal da campanha, restrita à empresa", () => {
    const approve = readFileSync(resolve(root, "src/lib/marketing/marketing-campaign.functions.ts"), "utf8");
    const block = approve.slice(approve.indexOf("// Capa trocada no editor"), approve.indexOf("const persistedSequence"));
    // A nova capa passou por validateOneImage (posse por empresa) antes de chegar aqui.
    expect(approve.indexOf("await validateOneImage(supabase, companyId, data.images[i], i, i === 0)")).toBeLessThan(approve.indexOf("// Capa trocada no editor"));
    expect(block).toContain("primary_image_media_id: first.image_id, primary_image_product_ref: null");
    expect(block).toContain('.eq("id", row.id).eq("company_id", companyId)');
    expect(block).toContain("Object.assign(baseRow, primaryPatch)");
    expect(block).not.toContain('throw new Error("campaign_image_sequence_invalid:primary_mismatch");\n      }\n      const');
  });

  it("a migração é aditiva e mantém conteúdos antigos válidos", () => {
    const sql = readFileSync(resolve(root, "supabase/migrations/20261010120000_marketing_content_design.sql"), "utf8");
    expect(sql).toContain("ADD COLUMN IF NOT EXISTS design jsonb");
    expect(sql).toContain("design IS NULL");
    expect(sql).not.toMatch(/DROP COLUMN|DELETE FROM|UPDATE public|NOT NULL/i);
    const enumSql = readFileSync(resolve(root, "supabase/migrations/20261010120100_marketing_content_format_carousel.sql"), "utf8");
    expect(enumSql).toContain("ADD VALUE IF NOT EXISTS 'carousel'");
  });
});
