// Regras que impedem um carrossel de entrar na fila (ou de ser enviado) sem
// condições de publicar. Tudo puro: nenhuma chamada sai daqui.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { carouselContentProblem, carouselImagesProblem, missingPublishScope } from "../carousel-readiness";
import { PublisherRepository } from "../PublisherRepository.server";
import { stableJson, staleExportPatch } from "@/lib/marketing/studio/studio.functions";
import { documentFromVideo, normalizeDocument, toCarousel, updatePage } from "@/lib/marketing/studio/document";
import { getScene } from "@/lib/marketing/video-editor/scenes/registry";

vi.mock("@/integrations/supabase/client.server", () => ({ supabaseAdmin: { from: () => ({}) } }));

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");
const ids = (n: number) => Array.from({ length: n }, (_, i) => `m${i + 1}`);
const design = (pages: number, format = "portrait") => ({ version: 1, kind: "carousel", format, pages: Array.from({ length: pages }, (_, i) => ({ id: `p${i}` })) });
const jpeg = (width: number | null, height: number | null) => ({ width, height, mime_type: "image/jpeg" });

describe("conteúdo do carrossel", () => {
  it("aceita quando há uma imagem exportada por página", () => {
    expect(carouselContentProblem({ media_ids: ids(3), design: design(3) }, "instagram")).toBeNull();
    expect(carouselContentProblem({ media_ids: ids(3), design: design(3) }, "facebook")).toBeNull();
  });

  it("REGRESSÃO: páginas alteradas depois da exportação não são publicadas com as imagens antigas", () => {
    expect(carouselContentProblem({ media_ids: ids(3), design: design(4) }, "instagram")).toMatchObject({ code: "carousel_export_outdated" });
    expect(carouselContentProblem({ media_ids: ids(3), design: design(2) }, "facebook")).toMatchObject({ code: "carousel_export_outdated" });
    expect(carouselContentProblem({ media_ids: [], design: design(3) }, "instagram")).toMatchObject({ code: "carousel_export_outdated" });
    expect(carouselContentProblem({ media_ids: null, design: null }, "instagram")).toMatchObject({ code: "carousel_export_outdated" });
  });

  it("exige de 2 a 10 imagens e recusa 9:16 no Instagram", () => {
    expect(carouselContentProblem({ media_ids: ids(1), design: null }, "instagram")).toMatchObject({ code: "carousel_too_few_images" });
    expect(carouselContentProblem({ media_ids: ids(11), design: null }, "facebook")).toMatchObject({ code: "carousel_too_many_images" });
    expect(carouselContentProblem({ media_ids: ids(3), design: design(3, "story") }, "instagram")).toMatchObject({ code: "carousel_aspect_unsupported" });
    expect(carouselContentProblem({ media_ids: ids(3), design: design(3, "story") }, "facebook")).toBeNull();
  });
});

describe("arquivos do carrossel", () => {
  it("Instagram: aceita 4:5, 1:1 e 1,91:1; recusa 9:16 e informa a página", () => {
    expect(carouselImagesProblem([jpeg(1080, 1350), jpeg(1080, 1080), jpeg(1080, 566)], "instagram")).toBeNull();
    const problem = carouselImagesProblem([jpeg(1080, 1350), jpeg(1080, 1920)], "instagram");
    expect(problem).toMatchObject({ code: "carousel_aspect_unsupported" });
    expect(problem!.message).toContain("página 2");
    expect(problem!.message).toContain("1080×1920");
    expect(carouselImagesProblem([jpeg(2000, 1000)], "instagram")).toMatchObject({ code: "carousel_aspect_unsupported" });
  });

  it("Instagram só aceita JPEG; medidas ou tipo desconhecidos não bloqueiam", () => {
    expect(carouselImagesProblem([jpeg(1080, 1350), { width: 1080, height: 1350, mime_type: "image/png" }], "instagram")).toMatchObject({ code: "carousel_image_not_jpeg" });
    expect(carouselImagesProblem([{ width: null, height: null, mime_type: null }], "instagram")).toBeNull();
  });

  it("Facebook não restringe proporção nem tipo", () => {
    expect(carouselImagesProblem([{ width: 1080, height: 1920, mime_type: "image/png" }], "facebook")).toBeNull();
  });
});

describe("permissão registrada na conexão", () => {
  it("aponta a permissão que falta em cada canal", () => {
    expect(missingPublishScope(["pages_manage_posts", "instagram_basic"], "instagram")).toBe("instagram_content_publish");
    expect(missingPublishScope(["instagram_content_publish"], "instagram")).toBeNull();
    expect(missingPublishScope(["instagram_business_content_publish"], "instagram")).toBeNull();
    expect(missingPublishScope(["instagram_content_publish"], "facebook")).toBe("pages_manage_posts");
    expect(missingPublishScope(["pages_manage_posts"], "facebook")).toBeNull();
  });

  it("sem escopos registrados não bloqueia (conexões antigas): a Meta decide", () => {
    expect(missingPublishScope([], "instagram")).toBeNull();
    expect(missingPublishScope(null, "facebook")).toBeNull();
  });
});

describe("edição × imagens exportadas", () => {
  // Como no servidor: o documento comparado é sempre o normalizado.
  const doc = normalizeDocument(
   toCarousel(
    documentFromVideo({
      layout: getScene("oferta").defaultLayout,
      text: { headline: "Verão", subheadline: "", cta: "Peça já" },
      scenes: [1, 2, 3].map((n) => ({ image: { origin: "marketing" as const, mediaId: `${n}1111111-1111-4111-8111-111111111111` }, framing: null })),
    }),
   ),
  )!;
  // Como o banco devolve: mesmas chaves, em outra ordem.
  const reordered = (value: unknown): unknown =>
    Array.isArray(value) ? value.map(reordered) : value && typeof value === "object" ? Object.fromEntries(Object.entries(value).reverse().map(([k, v]) => [k, reordered(v)])) : value;

  it("o mesmo documento com as chaves em outra ordem não conta como alteração", () => {
    const stored = reordered(JSON.parse(JSON.stringify(doc)));
    expect(JSON.stringify(stored)).not.toBe(JSON.stringify(doc));
    expect(stableJson(normalizeDocument(stored))).toBe(stableJson(doc));
    expect(staleExportPatch({ design: stored, media_ids: ids(3) }, doc, false)).toEqual({});
  });

  it("REGRESSÃO: arte alterada e salva sem concluir de novo perde as imagens antigas", () => {
    const edited = updatePage(doc, doc.pages[0].id, (page) => ({ ...page, text: { ...page.text, headline: "Inverno" } }));
    expect(staleExportPatch({ design: JSON.parse(JSON.stringify(doc)), media_ids: ids(3) }, edited, false)).toEqual({ media_ids: [], primary_image_media_id: null });
  });

  it("com exportação nova, ou sem imagens anteriores, nada é apagado", () => {
    const edited = updatePage(doc, doc.pages[0].id, (page) => ({ ...page, text: { ...page.text, headline: "Inverno" } }));
    expect(staleExportPatch({ design: JSON.parse(JSON.stringify(doc)), media_ids: ids(3) }, edited, true)).toEqual({});
    expect(staleExportPatch({ design: JSON.parse(JSON.stringify(doc)), media_ids: [] }, edited, false)).toEqual({});
  });

  it("o salvamento aplica a regra só ao conteúdo da própria empresa", () => {
    const source = read("src/lib/marketing/studio/studio.functions.ts");
    const fn = source.slice(source.indexOf("export const saveStudioContent"), source.indexOf("export const getStudioContent"));
    expect(fn).toContain("staleExportPatch(current, doc, !!exported)");
    expect(fn).toContain(".update({ ...patch, ...staleExport,");
    expect(fn.match(/\.eq\("company_id", companyId\)/g)!.length).toBeGreaterThanOrEqual(3);
  });
});

describe("ligação das regras ao agendamento e ao publicador", () => {
  it("o agendamento confere o carrossel depois da chave e antes de gravar, restrito à empresa", () => {
    const source = read("src/lib/marketing/marketing.functions.ts");
    const fn = source.slice(source.indexOf("export const scheduleMarketingContent"), source.indexOf("export async function carouselScheduleProblem"));
    const order = ["!isCarouselPublishEnabled()", "carouselScheduleProblem(supabase, companyId, content, data.channel)", '.from("marketing_schedule")'].map((s) => fn.indexOf(s));
    expect(order.every((i) => i > -1)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    const helper = source.slice(source.indexOf("export async function carouselScheduleProblem"), source.indexOf("export async function assertFacebookPublishAllowed"));
    expect(helper).toContain('.eq("company_id", companyId)');
    expect(helper).toContain('missingPublishScope(ig.granted_scopes, "instagram")');
  });

  it("o publicador repete a conferência e testa cada link antes de enviar à Meta", () => {
    const publisher = read("src/lib/marketing-publisher/MetaPublisher.server.ts");
    const images = publisher.slice(publisher.indexOf("private async resolveCarouselImages"), publisher.indexOf("private async publishCarousel"));
    expect(images).toContain("carouselContentProblem(");
    expect(images).toContain("carouselImagesProblem(ordered, channel)");
    expect(images).toContain('this.isUrlAccessible(url, "image/")');
    expect(images).toContain('.eq("id", content.contentId).eq("company_id", content.companyId)');
  });
});

describe("andamento da publicação", () => {
  it("falha ao gravar o andamento é informada a quem chamou (não é engolida)", async () => {
    const chain = (result: unknown) => {
      const q: Record<string, unknown> = {};
      for (const m of ["select", "eq", "update"]) q[m] = () => q;
      q.maybeSingle = async () => ({ data: { platform_response: null }, error: null });
      q.then = (ok: (v: unknown) => unknown) => Promise.resolve(result).then(ok);
      return q;
    };
    const client = await import("@/integrations/supabase/client.server");
    const admin = client.supabaseAdmin as unknown as { from: () => unknown };
    const repo = new PublisherRepository();
    admin.from = () => chain({ error: { message: "boom" } });
    await expect(repo.savePending("pub-1", { carousel: { photo_ids: ["x"] } })).rejects.toThrow("pending_save_failed");
    admin.from = () => chain({ error: null });
    await expect(repo.savePending("pub-1", { carousel: { photo_ids: ["x"] } })).resolves.toBeUndefined();
  });
});
