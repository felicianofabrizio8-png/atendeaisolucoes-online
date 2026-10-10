// Publicação de carrossel — tudo com envio FALSO. Nenhuma chamada sai daqui
// para a Meta: `post` é uma função de teste que registra o que seria enviado.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { CAROUSEL_LIMITS, publishFacebookCarousel, publishInstagramCarousel, validateCarouselImages, type CarouselPending, type CarouselPost } from "../CarouselPublisher.server";
import { CAROUSEL_PUBLISH_ENV, isCarouselPublishEnabled } from "../carousel-flag";

const GRAPH = "https://graph.test/v25.0";
const urls = (n: number) => Array.from({ length: n }, (_, i) => `https://cdn.test/co/p${i + 1}.jpg?sig=abc`);

type Call = { action: string; url: string; body: URLSearchParams; logicalPayload?: Record<string, unknown> };

/** Envio falso: devolve ids em sequência; `failAt` simula uma falha na N-ésima chamada. */
function fakePost(options: { failAt?: number; retryable?: boolean; simulate?: boolean } = {}) {
  const calls: Call[] = [];
  const post: CarouselPost = async (input) => {
    calls.push({ action: input.action, url: input.url, body: new URLSearchParams(input.body), logicalPayload: input.logicalPayload });
    const n = calls.length;
    if (options.simulate) return { success: true, simulated: true, environment: "staging", externalRequestSent: false, simulationId: "sim", would: { url: input.url, method: "POST" } };
    if (options.failAt === n) return { success: false, simulated: false, environment: "production", externalRequestSent: true, error: "erro da Meta", status: 500, retryable: options.retryable ?? true };
    const raw = { id: `id-${n}` };
    return { success: true, simulated: false, environment: "production", externalRequestSent: true, externalId: input.extractExternalId?.(raw) ?? null, status: 200, raw };
  };
  return { post, calls };
}

const base = (post: CarouselPost, n = 3) => ({ companyId: "co", graph: GRAPH, accessToken: "TOKEN", imageUrls: urls(n), caption: "Legenda do post", post });

describe("chave da publicação de carrossel", () => {
  it("vem desligada e só liga com o valor exato", () => {
    expect(isCarouselPublishEnabled({})).toBe(false);
    for (const value of ["true", "1", "on", "ENABLED", ""]) expect(isCarouselPublishEnabled({ [CAROUSEL_PUBLISH_ENV]: value })).toBe(false);
    expect(isCarouselPublishEnabled({ [CAROUSEL_PUBLISH_ENV]: "enabled" })).toBe(true);
  });

  it("com a chave desligada: não agenda, não entra na fila e o publicador recusa antes de qualquer chamada", () => {
    const root = process.cwd();
    const schedule = readFileSync(resolve(root, "src/lib/marketing/marketing.functions.ts"), "utf8");
    const fn = schedule.slice(schedule.indexOf("export const scheduleMarketingContent"), schedule.indexOf("export const listMarketingSchedule"));
    expect(fn).toContain('content.format === "carousel" && !isCarouselPublishEnabled()');
    expect(fn.indexOf("isCarouselPublishEnabled()")).toBeLessThan(fn.indexOf('.from("marketing_schedule")'));

    const planner = readFileSync(resolve(root, "src/lib/marketing-publisher/PublisherPlanner.server.ts"), "utf8");
    expect(planner).toContain('s.marketing_contents?.format === "carousel"');
    expect(planner).toContain("isCarouselPublishEnabled()");

    const publisher = readFileSync(resolve(root, "src/lib/marketing-publisher/MetaPublisher.server.ts"), "utf8");
    const branch = publisher.slice(publisher.indexOf('if (input.format === "carousel")'), publisher.indexOf("const media = await this.resolvePrimaryMedia(content, input.format);"));
    expect(branch.indexOf("!isCarouselPublishEnabled()")).toBeGreaterThan(0);
    expect(branch.indexOf("!isCarouselPublishEnabled()")).toBeLessThan(branch.indexOf("this.publishCarousel("));
    // O módulo do carrossel não fala com a rede por conta própria.
    const module = readFileSync(resolve(root, "src/lib/marketing-publisher/CarouselPublisher.server.ts"), "utf8");
    expect(module).not.toMatch(/\bfetch\(|graph\.facebook\.com|supabase/);
    // As imagens são da empresa do conteúdo e saem na ordem das páginas.
    const images = publisher.slice(publisher.indexOf("private async resolveCarouselImages"), publisher.indexOf("private async publishCarousel"));
    expect(images).toContain('.eq("company_id", content.companyId)');
    expect(images).toContain("row.storage_path.startsWith(`${content.companyId}/`)");
    expect(images).toContain("for (const id of content.media_ids)");
  });

  it("a migração da fila só amplia o formato aceito", () => {
    const sql = readFileSync(resolve(process.cwd(), "supabase/migrations/20261010120200_marketing_publications_format_carousel.sql"), "utf8");
    expect(sql).toContain("CHECK (format IN ('feed', 'reel', 'story', 'carousel'))");
    expect(sql).not.toMatch(/DROP TABLE|DROP COLUMN|DELETE FROM|UPDATE public/i);
  });
});

describe("validação das imagens", () => {
  it("exige de 2 a 10 imagens com link https", () => {
    expect(validateCarouselImages(urls(1))).toMatchObject({ ok: false, code: "carousel_too_few_images" });
    expect(validateCarouselImages(urls(11))).toMatchObject({ ok: false, code: "carousel_too_many_images" });
    expect(validateCarouselImages(["https://a/1.jpg", "http://a/2.jpg"])).toMatchObject({ ok: false, code: "carousel_invalid_image_url" });
    expect(validateCarouselImages(urls(CAROUSEL_LIMITS.min))).toEqual({ ok: true });
    expect(validateCarouselImages(urls(CAROUSEL_LIMITS.max))).toEqual({ ok: true });
  });

  it("entrada inválida não gera nenhuma chamada", async () => {
    const { post, calls } = fakePost();
    expect(await publishInstagramCarousel({ ...base(post, 1), igUserId: "ig" })).toMatchObject({ success: false, errorCode: "carousel_too_few_images" });
    expect(await publishFacebookCarousel({ ...base(post, 12), pageId: "pg" })).toMatchObject({ success: false, errorCode: "carousel_too_many_images" });
    expect(calls).toHaveLength(0);
  });
});

describe("Instagram", () => {
  it("cria um item por imagem, depois o container CAROUSEL com a legenda, depois publica — nessa ordem", async () => {
    const { post, calls } = fakePost();
    const saved: CarouselPending[] = [];
    const out = await publishInstagramCarousel({ ...base(post), igUserId: "ig1", onPending: async (p) => void saved.push(p) });
    expect(out).toEqual({ success: true, simulated: false, platformPostId: "id-5", platformResponse: { id: "id-5", images: 3 } });
    expect(calls.map((c) => c.action)).toEqual([
      "marketing_publisher.instagram.carousel.item",
      "marketing_publisher.instagram.carousel.item",
      "marketing_publisher.instagram.carousel.item",
      "marketing_publisher.instagram.carousel.container",
      "marketing_publisher.instagram.carousel.publish",
    ]);
    // Itens: na ordem das páginas, sem legenda.
    expect(calls.slice(0, 3).map((c) => c.body.get("image_url"))).toEqual(urls(3));
    for (const c of calls.slice(0, 3)) {
      expect(c.url).toBe(`${GRAPH}/ig1/media`);
      expect(c.body.get("is_carousel_item")).toBe("true");
      expect(c.body.has("caption")).toBe(false);
    }
    expect(calls[3].body.get("media_type")).toBe("CAROUSEL");
    expect(calls[3].body.get("children")).toBe("id-1,id-2,id-3");
    expect(calls[3].body.get("caption")).toBe("Legenda do post");
    expect(calls[4].url).toBe(`${GRAPH}/ig1/media_publish`);
    expect(calls[4].body.get("creation_id")).toBe("id-4");
    // O token nunca entra no payload lógico (que vai para log/auditoria).
    for (const c of calls) expect(JSON.stringify(c.logicalPayload ?? {})).not.toContain("TOKEN");
    // Cada id é guardado assim que chega.
    expect(saved).toEqual([{ children: ["id-1"] }, { children: ["id-1", "id-2"] }, { children: ["id-1", "id-2", "id-3"] }, { children: ["id-1", "id-2", "id-3"], container_id: "id-4" }]);
  });

  it("falha no meio: para, informa se pode tentar de novo e não publica", async () => {
    const { post, calls } = fakePost({ failAt: 2, retryable: true });
    const out = await publishInstagramCarousel({ ...base(post), igUserId: "ig1" });
    expect(out).toEqual({ success: false, errorCode: "carousel_item_error_500", errorMessage: "erro da Meta", retryable: true });
    expect(calls).toHaveLength(2);
    expect(calls.some((c) => c.action.endsWith(".publish"))).toBe(false);
  });

  it("nova tentativa reaproveita os itens já criados, sem reenviar imagem", async () => {
    const { post, calls } = fakePost();
    const out = await publishInstagramCarousel({ ...base(post), igUserId: "ig1", pending: { children: ["a", "b"] } });
    expect(out.success).toBe(true);
    expect(calls.map((c) => c.action.split(".").pop())).toEqual(["item", "container", "publish"]);
    expect(calls[0].body.get("image_url")).toBe(urls(3)[2]);
    expect(calls[1].body.get("children")).toBe("a,b,id-1");
  });

  it("com o container já criado, só publica (uma chamada)", async () => {
    const { post, calls } = fakePost();
    const out = await publishInstagramCarousel({ ...base(post), igUserId: "ig1", pending: { children: ["a", "b", "c"], container_id: "cont" } });
    expect(out.success).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0].body.get("creation_id")).toBe("cont");
  });

  it("em ambiente de simulação, nada é publicado e o resultado diz que foi simulado", async () => {
    const { post, calls } = fakePost({ simulate: true });
    const out = await publishInstagramCarousel({ ...base(post), igUserId: "ig1" });
    expect(out).toMatchObject({ success: true, simulated: true, platformPostId: null });
    expect(calls).toHaveLength(1);
  });

  it("falha ao salvar o andamento não derruba a publicação", async () => {
    const { post } = fakePost();
    const out = await publishInstagramCarousel({ ...base(post), igUserId: "ig1", onPending: vi.fn(async () => Promise.reject(new Error("db"))) });
    expect(out.success).toBe(true);
  });
});

describe("Facebook", () => {
  it("envia cada foto sem publicar e cria um único post com todas anexadas, na ordem", async () => {
    const { post, calls } = fakePost();
    const saved: CarouselPending[] = [];
    const out = await publishFacebookCarousel({ ...base(post), pageId: "pg1", onPending: async (p) => void saved.push(p) });
    expect(out).toMatchObject({ success: true, simulated: false, platformPostId: "id-4" });
    expect(calls.map((c) => c.action.split(".").pop())).toEqual(["photo", "photo", "photo", "publish"]);
    for (const [i, c] of calls.slice(0, 3).entries()) {
      expect(c.url).toBe(`${GRAPH}/pg1/photos`);
      expect(c.body.get("url")).toBe(urls(3)[i]);
      // Não publicada: senão cada foto viraria um post separado.
      expect(c.body.get("published")).toBe("false");
    }
    expect(calls[3].url).toBe(`${GRAPH}/pg1/feed`);
    expect(calls[3].body.get("message")).toBe("Legenda do post");
    expect([0, 1, 2].map((i) => calls[3].body.get(`attached_media[${i}]`))).toEqual(['{"media_fbid":"id-1"}', '{"media_fbid":"id-2"}', '{"media_fbid":"id-3"}']);
    expect(saved.at(-1)).toEqual({ photo_ids: ["id-1", "id-2", "id-3"] });
  });

  it("nova tentativa reaproveita as fotos já enviadas; falha não reenviável é informada", async () => {
    const resumed = fakePost();
    await publishFacebookCarousel({ ...base(resumed.post), pageId: "pg1", pending: { photo_ids: ["x", "y", "z"] } });
    expect(resumed.calls).toHaveLength(1);
    expect(resumed.calls[0].body.get("attached_media[2]")).toBe('{"media_fbid":"z"}');

    const failing = fakePost({ failAt: 4, retryable: false });
    const out = await publishFacebookCarousel({ ...base(failing.post), pageId: "pg1" });
    expect(out).toMatchObject({ success: false, errorCode: "publish_error_500", retryable: false });
  });
});
