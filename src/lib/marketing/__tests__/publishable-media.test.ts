// Regressão: Story de vídeo aprovado, com vídeo renderizado, recusado ao
// publicar/agendar ("Selecione ao menos uma imagem ou vídeo") e "Ver vídeo"
// sempre respondendo "Vídeo ainda não disponível".
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { missingMediaMessage, publishableMediaSource, renderedVideoIdFor } from "../publishable-media";
import { validateScheduleForm } from "../schedule-form";

const VIDEO = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const read = (file: string) => readFileSync(resolve(process.cwd(), file), "utf8");

describe("mídia publicável (mesma ordem do publicador)", () => {
  it("REGRESSÃO: campanha manual só com foto de produto + vídeo pronto É publicável", () => {
    // Exatamente o que `generateManualCampaign` grava: media_ids vazio e
    // ai_prompt sem product_media_refs; a foto fica em primary_image_product_ref.
    const story = { campaign_id: "c1", format: "story", media_ids: [], ai_prompt: { mode: "manual", media_ids: [] }, story_video_id: VIDEO, feed_video_id: null };
    expect(publishableMediaSource(story)).toBe("rendered_video");
    expect(renderedVideoIdFor(story)).toBe(VIDEO);
  });

  it("usa o vídeo do formato certo: Feed → feed_video_id; Story/Reel → story_video_id", () => {
    expect(renderedVideoIdFor({ format: "feed", feed_video_id: "f", story_video_id: "s" })).toBe("f");
    expect(renderedVideoIdFor({ format: "story", feed_video_id: "f", story_video_id: "s" })).toBe("s");
    expect(renderedVideoIdFor({ format: "reel", feed_video_id: "f", story_video_id: "s" })).toBe("s");
    // Vídeo só do outro formato não serve (o publicador também não o usaria).
    expect(publishableMediaSource({ format: "story", feed_video_id: "f", story_video_id: null, media_ids: [] })).toBeNull();
  });

  it("sem vídeo, segue a ordem: acervo, fotos de produto, produto vinculado", () => {
    expect(publishableMediaSource({ format: "feed", media_ids: ["m1"] })).toBe("marketing_media");
    expect(publishableMediaSource({ format: "feed", media_ids: [], ai_prompt: { product_media_refs: [{ product_id: "p", image_path: "x" }] } })).toBe("product_media_refs");
    expect(publishableMediaSource({ format: "feed", media_ids: [], product_id: "p1" })).toBe("product");
    expect(publishableMediaSource({ format: "feed", media_ids: [], ai_prompt: { product_media_refs: [] } })).toBeNull();
    expect(publishableMediaSource({})).toBeNull();
  });

  it("quando falta mídia, diz o motivo certo", () => {
    expect(missingMediaMessage({ campaign_id: "c1", format: "story" }, "Instagram")).toContain("ainda não foi gerado");
    expect(missingMediaMessage({ campaign_id: null, format: "feed" }, "Facebook")).toContain("Selecione ao menos uma imagem ou vídeo");
    expect(missingMediaMessage({ campaign_id: "c1", format: "whatsapp_cta" }, "Instagram")).toContain("Selecione ao menos");
  });

  it("o formulário de agendamento aceita o conteúdo com vídeo e repassa a mensagem específica", () => {
    const base = { scheduleFor: "id-1", scheduleAt: "2030-01-01T10:00", channel: "instagram" as const };
    expect(validateScheduleForm({ ...base, mediaCount: 1 }).ok).toBe(true);
    const fail = validateScheduleForm({ ...base, mediaCount: 0, missingMediaMessage: "O vídeo desta publicação ainda não foi gerado." });
    expect(fail.ok).toBe(false);
    if (!fail.ok) expect(fail.errors.map((e) => e.message)).toContain("O vídeo desta publicação ainda não foi gerado.");
  });
});

describe("validação no servidor e na tela usam a mesma regra", () => {
  it("o servidor valida pela regra compartilhada, com as colunas de vídeo, restrito à empresa", () => {
    const source = read("src/lib/marketing/marketing.functions.ts");
    const fn = source.slice(source.indexOf("export const scheduleMarketingContent"), source.indexOf("export async function assertFacebookPublishAllowed"));
    expect(fn).toContain("feed_video_id, story_video_id");
    expect(fn).toContain("if (!publishableMediaSource(content)) {");
    expect(fn).toContain("content.company_id !== companyId");
    expect(fn).toContain('content.status !== "approved"');
    // A contagem antiga (só media_ids + product_media_refs) não pode voltar.
    expect(fn).not.toContain("marketingCount === 0 && productRefs.length === 0");
  });

  it("a tela de Publicar usa o mesmo helper ao agendar", () => {
    const approvals = read("src/components/marketing/MarketingApprovals.tsx");
    expect(approvals).toContain("target && publishableMediaSource(target) ? 1 : 0");
  });

  it("a regra bate com a ordem real do publicador", () => {
    const publisher = read("src/lib/marketing-publisher/MetaPublisher.server.ts");
    const resolveMedia = publisher.slice(publisher.indexOf("private async resolvePrimaryMedia"), publisher.indexOf("private async isUrlAccessible"));
    expect(resolveMedia).toContain('format === "feed" ? content.feed_video_id : content.story_video_id');
    const order = ['.from("video_library")', "content.media_ids.length > 0", "content.product_media_refs", "content.product_id"].map((s) => resolveMedia.indexOf(s));
    expect(order.every((i) => i > -1)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });
});

describe("ver o vídeo renderizado", () => {
  it("REGRESSÃO: o link vem da video_library, não do índice do acervo de mídias", () => {
    const approvals = read("src/components/marketing/MarketingApprovals.tsx");
    const view = approvals.slice(approvals.indexOf("onViewVideo={async () => {"), approvals.indexOf("tracked={c.campaign_id"));
    expect(view).toContain("apiGetRenderedVideoUrl(vid)");
    expect(view).not.toContain("ensureMediaIndex");
    expect(view).not.toContain("urlForMarketingPath");
  });

  it("o servidor só assina vídeo da empresa logada, ativo e dentro da pasta dela", () => {
    const source = read("src/lib/render-engine/render-job.functions.ts");
    const fn = source.slice(source.indexOf("export const getVideoSignedUrl"), source.indexOf("export const setVideoActive"));
    expect(fn).toContain("requireSupabaseAuth");
    expect(fn).toContain('video.company_id !== prof.company_id');
    expect(fn).toContain("!video.is_active");
    expect(fn).toContain("video.file_path.startsWith(`${prof.company_id}/`)");
    expect(fn).toContain('.from("video-library")');
  });
});
