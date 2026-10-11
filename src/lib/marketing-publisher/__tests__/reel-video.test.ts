// REGRESSÃO (produção): dois Reels gerados como texto (sem vídeo, sem mídia)
// foram aceitos em "Publicar agora". O publicador usou a foto do produto e o
// Instagram respondeu "(#100) The parameter video_url is required".
//
// Regra única: Reel só é publicado com vídeo válido e acessível, no Instagram
// e no Facebook; nunca é trocado por imagem. Feed e Story seguem como eram.
// Todo IO é falso: nada sai daqui para a Meta.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  REEL_NEEDS_VIDEO_MESSAGE,
  missingMediaMessage,
  publishableMediaSource,
  renderedVideoIdFor,
  requiresVideo,
  videoRequirementStatus,
} from "@/lib/marketing/publishable-media";
import { roleFromContentFormat } from "@/lib/marketing/campaign-formats";

type Row = Record<string, unknown>;
const state = {
  contents: [] as Row[],
  media: [] as Row[],
  products: [] as Row[],
  integrations: [] as Row[],
  metaPages: [] as Row[],
  videos: [] as Row[],
  signs: [] as string[],
  /** Como cada link assinado responde ao teste de acesso (padrão: 200 com o tipo certo). */
  head: (_url: string): { status: number; type: string } | null => null,
};

function query(rows: Row[]) {
  const filters: Array<(r: Row) => boolean> = [];
  let limit: number | null = null;
  const run = () => {
    const out = rows.filter((r) => filters.every((f) => f(r)));
    return limit === null ? out : out.slice(0, limit);
  };
  const api: Record<string, unknown> = {
    select: () => api,
    eq: (col: string, val: unknown) => (filters.push((r) => r[col] === val), api),
    in: (col: string, vals: unknown[]) => (filters.push((r) => vals.includes(r[col])), api),
    is: (col: string, val: unknown) => (filters.push((r) => (r[col] ?? null) === val), api),
    order: () => api,
    limit: (n: number) => ((limit = n), api),
    maybeSingle: async () => ({ data: run()[0] ?? null, error: null }),
    then: (ok: (v: unknown) => unknown) => Promise.resolve({ data: run(), error: null }).then(ok),
  };
  return api;
}

vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: {
    from: (table: string) =>
      query(
        { marketing_contents: state.contents, marketing_media: state.media, products: state.products, integrations: state.integrations, meta_pages: state.metaPages, video_library: state.videos }[table] ?? [],
      ),
    storage: {
      from: (bucket: string) => ({
        createSignedUrl: async (path: string) => {
          state.signs.push(`${bucket}/${path}`);
          return { data: { signedUrl: `https://signed.test/${bucket}/${path}` }, error: null };
        },
      }),
    },
  },
}));

const sent: Array<{ action: string; url: string; body: URLSearchParams }> = [];
vi.mock("@/lib/outbound/MetaOutbound.server", () => ({
  postGraph: vi.fn(async (opts: { action: string; url: string; body?: unknown; extractExternalId?: (j: unknown) => string | null }) => {
    sent.push({ action: opts.action, url: opts.url, body: new URLSearchParams(typeof opts.body === "string" ? opts.body : "") });
    const raw = opts.action.includes("container_status") ? { status_code: "FINISHED" } : { id: "META_ID", post_id: "PAGE_POST" };
    return { success: true, simulated: false, environment: "production", externalRequestSent: true, externalId: opts.extractExternalId?.(raw) ?? null, status: 200, raw };
  }),
  deleteGraph: vi.fn(),
}));

import { MetaPublisher } from "../MetaPublisher.server";

const CO = "co-A";
const OTHER = "co-B";

function content(overrides: Row = {}) {
  state.contents.push({
    id: "c1",
    company_id: CO,
    status: "approved",
    body: "Legenda",
    hashtags: [],
    cta_destination: null,
    media_ids: [],
    product_id: null,
    ai_prompt: null,
    campaign_role: null,
    feed_video_id: null,
    story_video_id: null,
    ...overrides,
  });
}
const media = (id: string, type: "image" | "video", company = CO) => state.media.push({ id, company_id: company, storage_path: `${company}/${id}.${type === "video" ? "mp4" : "jpg"}`, media_type: type, active: true, deleted_at: null });
const video = (id: string, overrides: Row = {}) => state.videos.push({ id, company_id: CO, file_path: `${CO}/${id}/video.mp4`, is_active: true, ...overrides });
const product = () => state.products.push({ id: "prod-1", company_id: CO, images: [`${CO}/produto.jpg`] });
const publish = (channel: "instagram" | "facebook", format: "feed" | "story" | "reel") => new MetaPublisher().publish({ companyId: CO, contentId: "c1", channel, format });
const container = () => sent.find((c) => c.action.endsWith(".container"));

beforeEach(() => {
  for (const key of ["contents", "media", "products", "integrations", "metaPages", "videos", "signs"] as const) state[key].length = 0;
  sent.length = 0;
  state.head = () => null;
  state.integrations.push(
    { id: "i-ig", company_id: CO, channel: "instagram", active: true, is_primary_publisher: true, external_account_id: "IG1", account_metadata: { ig_business_account_id: "IG1", fb_page_id: "PG1" }, token_expires_at: null },
    { id: "i-fb", company_id: CO, channel: "facebook", active: true, is_primary_publisher: true, external_account_id: "PG1", account_metadata: { fb_page_id: "PG1" }, token_expires_at: null },
  );
  state.metaPages.push({ company_id: CO, page_id: "PG1", page_access_token: "TOKEN", ig_business_account_id: "IG1", active: true, updated_at: "2026-10-10T00:00:00Z" });
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    const custom = state.head(url);
    const type = custom?.type ?? (/\.mp4$/.test(url) ? "video/mp4" : "image/jpeg");
    return new Response(null, { status: custom?.status ?? 200, headers: { "content-type": type } });
  }) as never;
});

describe("regra única (pura)", () => {
  it("só Reel exige vídeo", () => {
    expect(requiresVideo("reel")).toBe(true);
    for (const format of ["feed", "story", "carousel", "whatsapp_cta", null]) expect(requiresVideo(format)).toBe(false);
  });

  it("Reel: pronto com vídeo renderizado ou vídeo do acervo; sem vídeo é só o roteiro", () => {
    expect(videoRequirementStatus({ format: "reel", story_video_id: "v1" })).toBe("ready");
    expect(videoRequirementStatus({ format: "reel", media_ids: ["m1"] }, ["image", "video"])).toBe("ready");
    expect(videoRequirementStatus({ format: "reel", media_ids: ["m1"] }, ["image"])).toBe("missing");
    expect(videoRequirementStatus({ format: "reel", media_ids: [] })).toBe("missing");
    // O caso de produção: nenhum vídeo, nenhuma mídia, só o produto vinculado.
    expect(videoRequirementStatus({ format: "reel", media_ids: [], product_id: "prod-1", feed_video_id: null, story_video_id: null })).toBe("missing");
    // A tela não sabe o tipo das mídias do acervo: quem decide é o servidor.
    expect(videoRequirementStatus({ format: "reel", media_ids: ["m1"] })).toBe("unknown");
    expect(videoRequirementStatus({ format: "feed", media_ids: [] })).toBe("not_required");
  });

  it("foto de produto não é mídia de Reel; para Feed e Story continua sendo", () => {
    const withProduct = { media_ids: [], product_id: "prod-1", ai_prompt: { product_media_refs: [{ product_id: "prod-1", image_path: "co/p.jpg" }] } };
    expect(publishableMediaSource({ ...withProduct, format: "reel" })).toBeNull();
    expect(missingMediaMessage({ ...withProduct, format: "reel" }, "Instagram")).toBe(REEL_NEEDS_VIDEO_MESSAGE);
    expect(publishableMediaSource({ ...withProduct, format: "feed" })).toBe("product_media_refs");
    expect(publishableMediaSource({ ...withProduct, format: "story" })).toBe("product_media_refs");
  });

  it("vídeo por formato: Feed usa feed_video_id; Story e Reel usam story_video_id — e o Reel não é mais tratado como 'feed' na campanha", () => {
    const both = { feed_video_id: "v-feed", story_video_id: "v-story" };
    expect(renderedVideoIdFor({ ...both, format: "feed" })).toBe("v-feed");
    expect(renderedVideoIdFor({ ...both, format: "story" })).toBe("v-story");
    expect(renderedVideoIdFor({ ...both, format: "reel" })).toBe("v-story");
    // Só o vídeo do Feed não habilita um Reel.
    expect(videoRequirementStatus({ format: "reel", feed_video_id: "v-feed", story_video_id: null })).toBe("missing");
    expect(roleFromContentFormat("reel")).toBeNull();
    expect(roleFromContentFormat("feed")).toBe("feed");
    expect(roleFromContentFormat("story")).toBe("story");
  });
});

describe("publicador: Reel", () => {
  it("REGRESSÃO: Reel só com foto de produto NÃO chama a Meta — nem no Instagram nem no Facebook", async () => {
    product();
    content({ product_id: "prod-1", ai_prompt: { product_media_refs: [{ product_id: "prod-1", image_path: `${CO}/produto.jpg` }] } });
    for (const channel of ["instagram", "facebook"] as const) {
      const out = await publish(channel, "reel");
      expect(out).toMatchObject({ success: false, errorCode: "reel_requires_video", errorMessage: REEL_NEEDS_VIDEO_MESSAGE, retryable: false });
    }
    expect(sent).toHaveLength(0);
    // Nenhuma imagem chegou a ser preparada para envio.
    expect(state.signs).toHaveLength(0);
  });

  it("Reel só com imagem no acervo também é recusado (imagem não vira Reel)", async () => {
    media("img-1", "image");
    content({ media_ids: ["img-1"] });
    expect(await publish("instagram", "reel")).toMatchObject({ success: false, errorCode: "reel_requires_video" });
    expect(await publish("facebook", "reel")).toMatchObject({ success: false, errorCode: "reel_requires_video" });
    expect(sent).toHaveLength(0);
  });

  it("Instagram: Reel com vídeo renderizado envia video_url e REELS, sem image_url", async () => {
    video("v-story");
    media("img-1", "image");
    content({ story_video_id: "v-story", media_ids: ["img-1"] });
    const out = await publish("instagram", "reel");
    expect(out.success).toBe(true);
    const body = container()!.body;
    expect(body.get("media_type")).toBe("REELS");
    expect(body.get("video_url")).toBe(`https://signed.test/video-library/${CO}/v-story/video.mp4`);
    expect(body.has("image_url")).toBe(false);
    expect(sent.some((c) => c.action.includes("container_status"))).toBe(true);
  });

  it("Facebook: Reel com vídeo é enviado como vídeo (file_url), nunca como foto", async () => {
    video("v-story");
    content({ story_video_id: "v-story" });
    const out = await publish("facebook", "reel");
    expect(out.success).toBe(true);
    expect(sent).toHaveLength(1);
    expect(sent[0].url).toContain("/PG1/videos");
    expect(sent[0].body.get("file_url")).toContain("/video-library/");
    expect(sent.some((c) => c.url.includes("/photos"))).toBe(false);
  });

  it("vídeo do acervo serve: usa o primeiro VÍDEO de media_ids, mesmo com imagem antes", async () => {
    media("img-1", "image");
    media("vid-1", "video");
    content({ media_ids: ["img-1", "vid-1"] });
    expect((await publish("instagram", "reel")).success).toBe(true);
    expect(container()!.body.get("video_url")).toBe(`https://signed.test/marketing-media/${CO}/vid-1.mp4`);
    expect(container()!.body.has("image_url")).toBe(false);
  });

  it("vídeo inacessível NÃO é trocado por imagem: falha reenviável, sem chamada à Meta", async () => {
    video("v-story");
    media("img-1", "image");
    product();
    content({ story_video_id: "v-story", media_ids: ["img-1"], product_id: "prod-1" });
    for (const head of [{ status: 404, type: "application/json" }, { status: 200, type: "image/jpeg" }]) {
      state.head = (url) => (url.includes("/video-library/") ? head : null);
      for (const channel of ["instagram", "facebook"] as const) {
        expect(await publish(channel, "reel")).toMatchObject({ success: false, errorCode: "reel_video_inaccessible", retryable: true });
      }
    }
    expect(sent).toHaveLength(0);
    expect(state.signs.some((s) => s.startsWith("marketing-media/") || s.startsWith("product-images/"))).toBe(false);
  });

  it("vídeo inativo, apagado ou fora da pasta da empresa: recusado sem cair para imagem", async () => {
    media("img-1", "image");
    const cases: Array<() => void> = [
      () => video("v-story", { is_active: false }),
      () => undefined, // não existe mais na biblioteca
      () => video("v-story", { file_path: `${OTHER}/v-story/video.mp4` }),
    ];
    for (const seed of cases) {
      state.videos.length = 0;
      state.contents.length = 0;
      seed();
      content({ story_video_id: "v-story", media_ids: ["img-1"] });
      expect(await publish("instagram", "reel")).toMatchObject({ success: false, errorCode: "reel_video_unavailable", retryable: false });
    }
    expect(sent).toHaveLength(0);
  });

  it("isolamento: vídeo e mídias de OUTRA empresa não habilitam o Reel", async () => {
    state.videos.push({ id: "v-alheio", company_id: OTHER, file_path: `${OTHER}/v-alheio/video.mp4`, is_active: true });
    content({ story_video_id: "v-alheio" });
    expect(await publish("instagram", "reel")).toMatchObject({ success: false, errorCode: "reel_video_unavailable" });

    state.contents.length = 0;
    media("vid-alheio", "video", OTHER);
    content({ media_ids: ["vid-alheio"] });
    expect(await publish("facebook", "reel")).toMatchObject({ success: false, errorCode: "reel_requires_video" });
    expect(sent).toHaveLength(0);
    expect(state.signs).toHaveLength(0);
  });

  it("só o vídeo do Feed não serve para o Reel (coluna errada não é usada)", async () => {
    video("v-feed");
    content({ feed_video_id: "v-feed" });
    expect(await publish("instagram", "reel")).toMatchObject({ success: false, errorCode: "reel_requires_video" });
    expect(sent).toHaveLength(0);
  });
});

describe("publicador: Feed e Story continuam como eram", () => {
  it("Instagram Feed com imagem publica a imagem", async () => {
    media("img-1", "image");
    content({ media_ids: ["img-1"] });
    expect((await publish("instagram", "feed")).success).toBe(true);
    expect(container()!.body.get("image_url")).toContain("/marketing-media/");
    expect(container()!.body.has("video_url")).toBe(false);
    expect(container()!.body.has("media_type")).toBe(false);
  });

  it("Instagram Story com imagem publica como STORIES com image_url", async () => {
    media("img-1", "image");
    content({ media_ids: ["img-1"] });
    expect((await publish("instagram", "story")).success).toBe(true);
    expect(container()!.body.get("media_type")).toBe("STORIES");
    expect(container()!.body.get("image_url")).toContain("/marketing-media/");
  });

  it("Instagram Feed com vídeo renderizado usa feed_video_id; Story usa story_video_id", async () => {
    video("v-feed");
    video("v-story");
    content({ feed_video_id: "v-feed", story_video_id: "v-story" });
    expect((await publish("instagram", "feed")).success).toBe(true);
    expect(container()!.body.get("video_url")).toContain(`/${CO}/v-feed/`);
    expect(container()!.body.get("share_to_feed")).toBe("true");
    sent.length = 0;
    expect((await publish("instagram", "story")).success).toBe(true);
    expect(container()!.body.get("video_url")).toContain(`/${CO}/v-story/`);
    expect(container()!.body.get("media_type")).toBe("STORIES");
  });

  it("Feed e Story só com foto de produto continuam publicáveis (a regra nova é só do Reel)", async () => {
    product();
    content({ product_id: "prod-1" });
    expect((await publish("instagram", "feed")).success).toBe(true);
    expect(container()!.body.get("image_url")).toContain("/product-images/");
    sent.length = 0;
    expect((await publish("facebook", "feed")).success).toBe(true);
    expect(sent[0].url).toContain("/PG1/photos");
  });

  it("Facebook Feed com imagem vai para /photos; com vídeo, para /videos", async () => {
    media("img-1", "image");
    content({ media_ids: ["img-1"] });
    expect((await publish("facebook", "feed")).success).toBe(true);
    expect(sent[0].url).toContain("/PG1/photos");

    sent.length = 0;
    state.contents.length = 0;
    video("v-feed");
    content({ feed_video_id: "v-feed" });
    expect((await publish("facebook", "feed")).success).toBe(true);
    expect(sent[0].url).toContain("/PG1/videos");
  });
});

describe("ligação: agendamento e tela", () => {
  const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

  it("o agendamento confere o vídeo do Reel no banco, restrito à empresa, antes de gravar", () => {
    const source = read("src/lib/marketing/marketing.functions.ts");
    const fn = source.slice(source.indexOf("export const scheduleMarketingContent"), source.indexOf("export async function reelVideoProblem"));
    const order = ["if (!publishableMediaSource(content)) {", "reelVideoProblem(supabase, companyId, content)", ".insert({"].map((s) => fn.indexOf(s));
    expect(order.every((i) => i > -1)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(fn).toContain('requiresVideo(content.format) && (data.channel === "instagram" || data.channel === "facebook")');

    const helper = source.slice(source.indexOf("export async function reelVideoProblem"), source.indexOf("export async function carouselScheduleProblem"));
    expect(helper.match(/\.eq\("company_id", companyId\)/g)!.length).toBe(2);
    expect(helper).toContain("video.file_path.startsWith(`${companyId}/`)");
    expect(helper).toContain("renderedVideoIdFor(content)");
    expect(helper).toContain('videoRequirementStatus(content, types) === "ready"');
  });

  it("servidor e publicador usam a MESMA definição de vídeo por formato", () => {
    const publisher = read("src/lib/marketing-publisher/MetaPublisher.server.ts");
    expect(publisher).not.toContain('format === "feed" ? content.feed_video_id : content.story_video_id');
    expect(publisher.match(/renderedVideoIdFor\(/g)!.length).toBe(2);
    // O ramo do Reel vem antes de qualquer busca de imagem.
    const publish = publisher.slice(publisher.indexOf("async publish(input: PublishInput)"), publisher.indexOf("private async publishInstagram"));
    expect(publish.indexOf("if (requiresVideo(input.format))")).toBeGreaterThan(-1);
    expect(publish.indexOf("this.resolveReelVideo(content)")).toBeLessThan(publish.indexOf("this.resolvePrimaryMedia(content, input.format)"));
    const reel = publisher.slice(publisher.indexOf("private async resolveReelVideo"), publisher.indexOf("private async resolvePrimaryMedia"));
    expect(reel).not.toContain("product");
    expect(reel).not.toContain('type: "image"');
  });

  it("a tela mostra o roteiro de Reel como roteiro: sem Publicar nem Agendar, com aviso; o editor de vídeo só aparece no fluxo de campanha que já existia", () => {
    const approvals = read("src/components/marketing/MarketingApprovals.tsx");
    expect(approvals).toContain('const reelScript = !isVideo && videoRequirementStatus(row) === "missing";');
    expect(approvals).toContain("{REEL_SCRIPT_HINT}");
    expect(approvals).toContain('{reelScript ? " · roteiro (sem vídeo)" : ""}');
    const actions = approvals.slice(approvals.indexOf('data-testid="card-actions"'), approvals.indexOf("<DropdownMenu>"));
    const script = actions.indexOf('row.status === "approved" && reelScript ? (');
    const normal = actions.indexOf('row.status === "approved" ? (');
    expect(script).toBeGreaterThan(-1);
    expect(script).toBeLessThan(normal);
    expect(actions.slice(script, normal)).toContain("Copiar roteiro");
    expect(actions.slice(script, normal)).not.toMatch(/onPublishNow|onSchedule|onOpenVideoEditor/);
    // O botão "Editar vídeo" continua restrito a conteúdo de campanha (isVideo).
    expect(actions.indexOf("isVideo && !videoReady ? (")).toBeLessThan(script);
    for (const name of ["function publishNow(", "function openSchedule("]) {
      const body = approvals.slice(approvals.indexOf(name), approvals.indexOf(name) + 1100);
      expect(body).toContain('videoRequirementStatus(row) === "missing"');
      expect(body).toContain("toast.error(REEL_NEEDS_VIDEO_MESSAGE)");
    }
  });
});
