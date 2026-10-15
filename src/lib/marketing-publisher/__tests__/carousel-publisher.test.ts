// Publicação de carrossel — tudo com envio FALSO. Nenhuma chamada sai daqui
// para a Meta: `post` é uma função de teste que registra o que seria enviado.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { CAROUSEL_LIMITS, publishFacebookCarousel, publishInstagramCarousel, validateCarouselImages, type CarouselPending, type CarouselPost } from "../CarouselPublisher.server";
import { CAROUSEL_PUBLISH_COMPANIES_ENV, CAROUSEL_PUBLISH_ENV, carouselPublishCompanies, isCarouselPublishEnabled } from "../carousel-flag";

const GRAPH = "https://graph.test/v25.0";
const urls = (n: number) => Array.from({ length: n }, (_, i) => `https://cdn.test/co/p${i + 1}.jpg?sig=abc`);

type Call = { action: string; url: string; body: URLSearchParams; logicalPayload?: Record<string, unknown> };

/**
 * Envio falso. Só as chamadas POST contam para os ids (`id-N`) e para
 * `failAt`; as consultas (GET) respondem pelo roteiro em `statuses`/`lookup`.
 */
function fakePost(
  options: {
    failAt?: number;
    retryable?: boolean;
    failStatus?: number;
    networkFailure?: boolean;
    providerError?: unknown;
    simulate?: boolean;
    /** Estados do container do Instagram, em sequência (o último se repete). Padrão: FINISHED. */
    statuses?: string[];
    statusFailure?: boolean;
    /** Posts devolvidos pela consulta da Página; "fail" = consulta com erro. */
    lookup?: unknown[] | "fail" | "malformed";
  } = {},
) {
  const calls: Call[] = [];
  let posts = 0;
  let statusReads = 0;
  const failure = (status: number, retryable: boolean) =>
    ({ success: false, simulated: false, environment: "production", externalRequestSent: true, error: "erro da Meta", status, retryable, providerError: options.providerError }) as const;
  const post: CarouselPost = async (input) => {
    calls.push({ action: input.action, url: input.url, body: new URLSearchParams(input.body ?? ""), logicalPayload: input.logicalPayload });
    if (options.simulate) return { success: true, simulated: true, environment: "staging", externalRequestSent: false, simulationId: "sim", would: { url: input.url, method: input.method } };
    if (input.method === "GET") {
      if (input.action.endsWith("container_status")) {
        if (options.statusFailure) return failure(500, true);
        const list = options.statuses ?? ["FINISHED"];
        const status_code = list[Math.min(statusReads, list.length - 1)];
        statusReads += 1;
        return { success: true, simulated: false, environment: "production", externalRequestSent: true, externalId: null, status: 200, raw: { status_code } };
      }
      if (options.lookup === "fail") return failure(403, false);
      if (options.lookup === "malformed") return { success: true, simulated: false, environment: "production", externalRequestSent: true, externalId: null, status: 200, raw: {} };
      return { success: true, simulated: false, environment: "production", externalRequestSent: true, externalId: null, status: 200, raw: { data: options.lookup ?? [] } };
    }
    posts += 1;
    if (options.failAt === posts) {
      if (options.networkFailure) return { success: false, simulated: false, environment: "production", externalRequestSent: false, error: "fetch failed", retryable: true };
      return failure(options.failStatus ?? 500, options.retryable ?? true);
    }
    const raw = { id: `id-${posts}` };
    return { success: true, simulated: false, environment: "production", externalRequestSent: true, externalId: input.extractExternalId?.(raw) ?? null, status: 200, raw };
  };
  return { post, calls };
}
const noWait = async () => {};
const last = (action: string) => action.split(".").pop();

const base = (post: CarouselPost, n = 3) => ({ companyId: "co", graph: GRAPH, accessToken: "TOKEN", imageUrls: urls(n), caption: "Legenda do post", post, wait: noWait, now: () => new Date("2026-10-10T12:00:00.000Z") });

describe("chave da publicação de carrossel", () => {
  it("vem desligada e só liga com o valor exato", () => {
    expect(isCarouselPublishEnabled(null, {})).toBe(false);
    for (const value of ["true", "1", "on", "ENABLED", ""]) expect(isCarouselPublishEnabled(null, { [CAROUSEL_PUBLISH_ENV]: value })).toBe(false);
    expect(isCarouselPublishEnabled(null, { [CAROUSEL_PUBLISH_ENV]: "enabled" })).toBe(true);
  });

  it("teste controlado: a lista libera SÓ as empresas indicadas na configuração", () => {
    const A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    const C = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
    const env = { [CAROUSEL_PUBLISH_COMPANIES_ENV]: ` ${A} , ${B.toUpperCase()},lixo, ,*` };
    expect(carouselPublishCompanies(env)).toEqual([A, B]);
    expect(isCarouselPublishEnabled(A, env)).toBe(true);
    expect(isCarouselPublishEnabled(B, env)).toBe(true);
    expect(isCarouselPublishEnabled(A.toUpperCase(), env)).toBe(true);
    // As demais empresas — e pedidos sem empresa — continuam desligados.
    expect(isCarouselPublishEnabled(C, env)).toBe(false);
    expect(isCarouselPublishEnabled(null, env)).toBe(false);
    expect(isCarouselPublishEnabled(undefined, env)).toBe(false);
    expect(isCarouselPublishEnabled("", env)).toBe(false);
    expect(isCarouselPublishEnabled("*", env)).toBe(false);
    // Lista vazia ou ausente não libera ninguém; a chave geral libera todos.
    expect(isCarouselPublishEnabled(A, {})).toBe(false);
    expect(isCarouselPublishEnabled(A, { [CAROUSEL_PUBLISH_COMPANIES_ENV]: "" })).toBe(false);
    expect(isCarouselPublishEnabled(C, { ...env, [CAROUSEL_PUBLISH_ENV]: "enabled" })).toBe(true);
  });

  it("nenhuma empresa está escrita no código: a liberação vem só do ambiente e da empresa do pedido", () => {
    const root = process.cwd();
    const flag = readFileSync(resolve(root, "src/lib/marketing-publisher/carousel-flag.ts"), "utf8");
    expect(flag).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
    // Agendamento: empresa da sessão. Fila: empresa do agendamento. Envio: empresa da publicação.
    expect(readFileSync(resolve(root, "src/lib/marketing/marketing.functions.ts"), "utf8")).toContain("!isCarouselPublishEnabled(companyId)");
    expect(readFileSync(resolve(root, "src/lib/marketing-publisher/PublisherPlanner.server.ts"), "utf8")).toContain("isCarouselPublishEnabled(s.company_id)");
    expect(readFileSync(resolve(root, "src/lib/marketing-publisher/MetaPublisher.server.ts"), "utf8")).toContain("!isCarouselPublishEnabled(input.companyId)");
  });

  it("com a chave desligada: não agenda, não entra na fila e o publicador recusa antes de qualquer chamada", () => {
    const root = process.cwd();
    const schedule = readFileSync(resolve(root, "src/lib/marketing/marketing.functions.ts"), "utf8");
    const fn = schedule.slice(schedule.indexOf("export const scheduleMarketingContent"), schedule.indexOf("export const listMarketingSchedule"));
    expect(fn).toContain('content.format === "carousel" && !isCarouselPublishEnabled(companyId)');
    expect(fn.indexOf("isCarouselPublishEnabled(companyId)")).toBeLessThan(fn.indexOf('.from("marketing_schedule")'));

    const planner = readFileSync(resolve(root, "src/lib/marketing-publisher/PublisherPlanner.server.ts"), "utf8");
    expect(planner).toContain('s.marketing_contents?.format === "carousel"');
    expect(planner).toContain("isCarouselPublishEnabled(s.company_id)");

    const publisher = readFileSync(resolve(root, "src/lib/marketing-publisher/MetaPublisher.server.ts"), "utf8");
    const branch = publisher.slice(publisher.indexOf('if (input.format === "carousel")'), publisher.indexOf("const media = await this.resolvePrimaryMedia(content, input.format);"));
    expect(branch.indexOf("!isCarouselPublishEnabled(input.companyId)")).toBeGreaterThan(0);
    expect(branch.indexOf("!isCarouselPublishEnabled(input.companyId)")).toBeLessThan(branch.indexOf("this.publishCarousel("));
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
      "marketing_publisher.instagram.carousel.container_status",
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
    // Só publica depois de a Meta dizer que o container está pronto.
    expect(calls[4].url).toContain(`${GRAPH}/id-4?fields=status_code`);
    expect(calls[5].url).toBe(`${GRAPH}/ig1/media_publish`);
    expect(calls[5].body.get("creation_id")).toBe("id-4");
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
    expect(calls.map((c) => last(c.action))).toEqual(["item", "container", "container_status", "publish"]);
    expect(calls[0].body.get("image_url")).toBe(urls(3)[2]);
    expect(calls[1].body.get("children")).toBe("a,b,id-1");
  });

  it("com o container já criado, só confere o estado e publica", async () => {
    const { post, calls } = fakePost();
    const out = await publishInstagramCarousel({ ...base(post), igUserId: "ig1", pending: { children: ["a", "b", "c"], container_id: "cont" } });
    expect(out.success).toBe(true);
    expect(calls.map((c) => last(c.action))).toEqual(["container_status", "publish"]);
    expect(calls[1].body.get("creation_id")).toBe("cont");
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

  it("espera o container ficar pronto antes de publicar", async () => {
    const { post, calls } = fakePost({ statuses: ["IN_PROGRESS", "IN_PROGRESS", "FINISHED"] });
    const wait = vi.fn(async (_ms: number) => {});
    const out = await publishInstagramCarousel({ ...base(post), igUserId: "ig1", wait, poll: { attempts: 5, delayMs: 1234 } });
    expect(out.success).toBe(true);
    expect(calls.filter((c) => last(c.action) === "container_status")).toHaveLength(3);
    expect(wait).toHaveBeenCalledTimes(2);
    expect(wait).toHaveBeenCalledWith(1234);
    expect(last(calls.at(-1)!.action)).toBe("publish");
  });

  it("container que não fica pronto a tempo: não publica e pede nova tentativa com o MESMO container", async () => {
    const { post, calls } = fakePost({ statuses: ["IN_PROGRESS"] });
    const saved: CarouselPending[] = [];
    const out = await publishInstagramCarousel({ ...base(post), igUserId: "ig1", poll: { attempts: 3, delayMs: 1 }, onPending: async (p) => void saved.push(p) });
    expect(out).toMatchObject({ success: false, errorCode: "container_not_ready", retryable: true });
    expect(calls.some((c) => last(c.action) === "publish")).toBe(false);
    expect(saved.at(-1)).toMatchObject({ container_id: "id-4" });
  });

  it("container com ERROR ou EXPIRED: não publica e limpa o andamento para recomeçar do zero", async () => {
    for (const [status, retryable] of [["ERROR", false], ["EXPIRED", true]] as const) {
      const { post, calls } = fakePost({ statuses: [status] });
      const saved: CarouselPending[] = [];
      const out = await publishInstagramCarousel({ ...base(post), igUserId: "ig1", pending: { children: ["a", "b", "c"], container_id: "cont" }, onPending: async (p) => void saved.push(p) });
      expect(out).toMatchObject({ success: false, errorCode: "container_processing_failed", retryable });
      expect(calls.map((c) => last(c.action))).toEqual(["container_status"]);
      expect(saved).toEqual([{ children: [], container_id: null }]);
    }
    // Com o andamento limpo, a tentativa seguinte cria tudo de novo.
    const again = fakePost();
    await publishInstagramCarousel({ ...base(again.post), igUserId: "ig1", pending: { children: [], container_id: null } });
    expect(again.calls.map((c) => last(c.action))).toEqual(["item", "item", "item", "container", "container_status", "publish"]);
  });

  it("container já PUBLICADO por uma tentativa anterior: confirma sem publicar de novo", async () => {
    const { post, calls } = fakePost({ statuses: ["PUBLISHED"] });
    const out = await publishInstagramCarousel({ ...base(post), igUserId: "ig1", pending: { children: ["a", "b", "c"], container_id: "cont" } });
    expect(out).toMatchObject({ success: true, simulated: false, platformPostId: null, platformResponse: { reconciled: true, container_id: "cont" } });
    expect(calls.map((c) => last(c.action))).toEqual(["container_status"]);
  });

  it("falha ao consultar o container não publica às cegas", async () => {
    const { post, calls } = fakePost({ statusFailure: true });
    const out = await publishInstagramCarousel({ ...base(post), igUserId: "ig1" });
    expect(out).toMatchObject({ success: false, errorCode: "container_status_500", retryable: true });
    expect(calls.some((c) => last(c.action) === "publish")).toBe(false);
  });

  it("a mensagem de erro leva o código e o rastreio da Meta, nunca o token", async () => {
    const { post } = fakePost({ failAt: 1, failStatus: 400, retryable: false, providerError: { message: "x", code: 9004, error_subcode: 2207052, fbtrace_id: "ABC", error_user_msg: "A imagem não pôde ser baixada." } });
    const out = await publishInstagramCarousel({ ...base(post), igUserId: "ig1" });
    expect(out).toMatchObject({ success: false, errorCode: "carousel_item_error_400", errorMessage: "A imagem não pôde ser baixada. [code=9004 subcode=2207052 fbtrace_id=ABC]" });
    expect(JSON.stringify(out)).not.toContain("TOKEN");
  });
});

describe("Facebook", () => {
  it("envia cada foto sem publicar e cria um único post com todas anexadas, na ordem", async () => {
    const { post, calls } = fakePost();
    const saved: CarouselPending[] = [];
    const out = await publishFacebookCarousel({ ...base(post), pageId: "pg1", onPending: async (p) => void saved.push(p) });
    expect(out).toMatchObject({ success: true, simulated: false, platformPostId: "id-4" });
    expect(calls.map((c) => last(c.action))).toEqual(["photo", "photo", "photo", "publish"]);
    for (const [i, c] of calls.slice(0, 3).entries()) {
      expect(c.url).toBe(`${GRAPH}/pg1/photos`);
      expect(c.body.get("url")).toBe(urls(3)[i]);
      // Não publicada: senão cada foto viraria um post separado.
      expect(c.body.get("published")).toBe("false");
    }
    expect(calls[3].url).toBe(`${GRAPH}/pg1/feed`);
    expect(calls[3].body.get("message")).toBe("Legenda do post");
    expect([0, 1, 2].map((i) => calls[3].body.get(`attached_media[${i}]`))).toEqual(['{"media_fbid":"id-1"}', '{"media_fbid":"id-2"}', '{"media_fbid":"id-3"}']);
    // A tentativa de criar o post é registrada ANTES do pedido.
    expect(saved.at(-1)).toEqual({ photo_ids: ["id-1", "id-2", "id-3"], photos_uploaded_at: "2026-10-10T12:00:00.000Z", publish_attempted_at: "2026-10-10T12:00:00.000Z" });
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

  it("sem conseguir registrar a tentativa, não pede o post (evita duplicar depois)", async () => {
    const { post, calls } = fakePost();
    const out = await publishFacebookCarousel({ ...base(post), pageId: "pg1", pending: { photo_ids: ["x", "y", "z"] }, onPending: async () => Promise.reject(new Error("db")) });
    expect(out).toMatchObject({ success: false, errorCode: "pending_save_failed", retryable: true });
    expect(calls).toHaveLength(0);
  });

  const attempted = { photo_ids: ["x", "y", "z"], publish_attempted_at: "2026-10-10T11:58:00.000Z" };

  it("REGRESSÃO: resposta perdida + post já criado → a nova tentativa reconhece o post e NÃO cria outro", async () => {
    const { post, calls } = fakePost({
      lookup: [
        { id: "pg1_outro", attachments: { data: [{ target: { id: "foto-alheia" } }] } },
        { id: "pg1_999", attachments: { data: [{ target: { id: "pg1_999" }, subattachments: { data: [{ target: { id: "x" } }, { target: { id: "y" } }] } }] } },
      ],
    });
    const out = await publishFacebookCarousel({ ...base(post), pageId: "pg1", pending: attempted });
    expect(out).toMatchObject({ success: true, simulated: false, platformPostId: "pg1_999", platformResponse: { reconciled: true, matched_by: "photos" } });
    expect(calls.map((c) => last(c.action))).toEqual(["lookup"]);
    expect(calls[0].url).toContain(`${GRAPH}/pg1/published_posts?`);
    // Janela de busca: a partir de pouco antes da tentativa registrada.
    expect(new URL(calls[0].url).searchParams.get("since")).toBe(String(Math.floor(Date.parse(attempted.publish_attempted_at) / 1000) - 120));
  });

  it("tentativa anterior sem post na Página → publica normalmente", async () => {
    const { post, calls } = fakePost({ lookup: [{ id: "pg1_outro", attachments: { data: [{ target: { id: "foto-alheia" } }] } }] });
    const out = await publishFacebookCarousel({ ...base(post), pageId: "pg1", pending: attempted });
    expect(out).toMatchObject({ success: true, platformPostId: "id-1" });
    expect(calls.map((c) => last(c.action))).toEqual(["lookup", "publish"]);
  });

  it("reconhece o post pela legenda idêntica quando as fotos não vêm na resposta; legenda diferente ou post antigo não contam", async () => {
    const same = fakePost({ lookup: [{ id: "pg1_777", message: "  Legenda do post ", created_time: "2026-10-10T11:58:30+0000" }] });
    const out = await publishFacebookCarousel({ ...base(same.post), pageId: "pg1", pending: attempted });
    expect(out).toMatchObject({ success: true, platformPostId: "pg1_777", platformResponse: { reconciled: true, matched_by: "caption" } });
    expect(same.calls.map((c) => last(c.action))).toEqual(["lookup"]);

    const other = fakePost({
      lookup: [
        { id: "pg1_a", message: "Outra legenda", created_time: "2026-10-10T11:59:00+0000" },
        { id: "pg1_b", message: "Legenda do post", created_time: "2026-10-09T08:00:00+0000" },
      ],
    });
    await publishFacebookCarousel({ ...base(other.post), pageId: "pg1", pending: attempted });
    expect(other.calls.map((c) => last(c.action))).toEqual(["lookup", "publish"]);
  });

  it("tentativa de segundos atrás e post ainda não listado: espera em vez de publicar de novo", async () => {
    const { post, calls } = fakePost({ lookup: [] });
    const out = await publishFacebookCarousel({ ...base(post), pageId: "pg1", pending: { ...attempted, publish_attempted_at: "2026-10-10T11:59:40.000Z" } });
    expect(out).toMatchObject({ success: false, errorCode: "facebook_publish_confirming", retryable: true });
    expect(calls.map((c) => last(c.action))).toEqual(["lookup"]);
  });

  it("resposta da consulta sem a lista de posts não é tratada como 'não existe'", async () => {
    const { post, calls } = fakePost({ lookup: "malformed" });
    const out = await publishFacebookCarousel({ ...base(post), pageId: "pg1", pending: attempted });
    expect(out).toMatchObject({ success: false, errorCode: "facebook_publish_unconfirmed", retryable: true });
    expect(calls.map((c) => last(c.action))).toEqual(["lookup"]);
  });

  it("a conferência vem ANTES de qualquer reenvio de foto", async () => {
    const { post, calls } = fakePost({ lookup: [{ id: "pg1_999", attachments: { data: [{ subattachments: { data: [{ target: { id: "x" } }] } }] } }] });
    const out = await publishFacebookCarousel({ ...base(post), pageId: "pg1", pending: { photo_ids: ["x"], publish_attempted_at: attempted.publish_attempted_at } });
    expect(out).toMatchObject({ success: true, platformPostId: "pg1_999" });
    expect(calls.map((c) => last(c.action))).toEqual(["lookup"]);
  });

  it("fotos enviadas há mais de 20 h (descartadas pela Meta) são enviadas de novo; recentes são reaproveitadas", async () => {
    const stale = fakePost();
    await publishFacebookCarousel({ ...base(stale.post), pageId: "pg1", pending: { photo_ids: ["x", "y", "z"], photos_uploaded_at: "2026-10-09T12:00:00.000Z" } });
    expect(stale.calls.map((c) => last(c.action))).toEqual(["photo", "photo", "photo", "publish"]);
    expect(stale.calls[3].body.get("attached_media[0]")).toBe('{"media_fbid":"id-1"}');

    const fresh = fakePost();
    await publishFacebookCarousel({ ...base(fresh.post), pageId: "pg1", pending: { photo_ids: ["x", "y", "z"], photos_uploaded_at: "2026-10-10T09:00:00.000Z" } });
    expect(fresh.calls.map((c) => last(c.action))).toEqual(["publish"]);
  });

  it("sem conseguir conferir a Página, não publica às cegas", async () => {
    const { post, calls } = fakePost({ lookup: "fail" });
    const out = await publishFacebookCarousel({ ...base(post), pageId: "pg1", pending: attempted });
    expect(out).toMatchObject({ success: false, errorCode: "facebook_publish_unconfirmed", retryable: false });
    expect(calls.map((c) => last(c.action))).toEqual(["lookup"]);
  });

  it("recusa definitiva da Meta libera a marca; falha de rede mantém (a próxima tentativa confere antes)", async () => {
    const refused = fakePost({ failAt: 1, failStatus: 400, retryable: false });
    const savedRefused: CarouselPending[] = [];
    await publishFacebookCarousel({ ...base(refused.post), pageId: "pg1", pending: { photo_ids: ["x", "y", "z"] }, onPending: async (p) => void savedRefused.push(p) });
    expect(savedRefused.at(-1)).toEqual({ photo_ids: ["x", "y", "z"], publish_attempted_at: null });

    const network = fakePost({ failAt: 1, networkFailure: true });
    const savedNetwork: CarouselPending[] = [];
    const out = await publishFacebookCarousel({ ...base(network.post), pageId: "pg1", pending: { photo_ids: ["x", "y", "z"] }, onPending: async (p) => void savedNetwork.push(p) });
    expect(out).toMatchObject({ success: false, errorCode: "publish_error_network", retryable: true });
    expect(savedNetwork.at(-1)).toEqual({ photo_ids: ["x", "y", "z"], publish_attempted_at: "2026-10-10T12:00:00.000Z" });

    // 200 sem id: o post pode existir — a marca fica para a conferência.
    const noId: CarouselPending[] = [];
    const out200 = await publishFacebookCarousel({
      ...base(async (input) => ({ success: true, simulated: false, environment: "production", externalRequestSent: true, externalId: input.extractExternalId?.({}) ?? null, status: 200, raw: {} })),
      pageId: "pg1",
      pending: { photo_ids: ["x", "y", "z"] },
      onPending: async (p) => void noId.push(p),
    });
    expect(out200).toMatchObject({ success: false, errorCode: "no_post_id", retryable: false });
    expect(noId.at(-1)).toMatchObject({ publish_attempted_at: "2026-10-10T12:00:00.000Z" });
  });
});
