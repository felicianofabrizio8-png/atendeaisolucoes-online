// Regressão: imagem da publicação que não aparecia no estúdio ("sem imagem")
// e carregamento que nunca terminava ao adicionar imagens.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const createSignedUrl = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { storage: { from: () => ({ createSignedUrl, getPublicUrl: () => ({ data: { publicUrl: "" } }) }) } },
}));

import {
  MEDIA_ERROR_MESSAGE,
  MediaTimeoutError,
  campaignImageRefs,
  resolveCampaignMedia,
  withTimeout,
  type MediaResolverDeps,
} from "../campaign-media";
import { getSignedMediaUrl } from "@/lib/storage";
import { fitTemplateGrid } from "@/components/marketing/campaign/editor/StudioPanels";
import { SCENE_LIST } from "../video-editor/scenes/registry";

const M1 = "11111111-1111-4111-8111-111111111111";
const M2 = "22222222-2222-4222-8222-222222222222";
const P1 = "33333333-3333-4333-8333-333333333333";
const never = <T,>() => new Promise<T>(() => {});

function deps(over: Partial<MediaResolverDeps> = {}): MediaResolverDeps {
  return {
    mediaPaths: async (ids) => Object.fromEntries(ids.map((id) => [id, `co/${id}.jpg`])),
    signMarketing: async (path) => `https://signed/${path}`,
    signProduct: async (path) => `https://signed-product/${path}`,
    timeoutMs: 30,
    ...over,
  };
}

describe("quais imagens a campanha usa (mesma regra do render)", () => {
  it("usa a sequência salva, na ordem, com o enquadramento de cada imagem", () => {
    const { refs, sequenceInvalid } = campaignImageRefs({
      primary_image_media_id: M1,
      ai_prompt: {
        image_sequence: [
          { position: 0, primary: true, source: "marketing_media", image_id: M1, focal_point: { x: 0.2, y: 0.3, zoom: 1.5 } },
          { position: 1, primary: false, source: "product_image", product_id: P1, product_image_path: "co/p.jpg", focal_point: null },
        ],
      },
    });
    expect(sequenceInvalid).toBe(false);
    expect(refs).toEqual([
      { key: `marketing:${M1}`, origin: "marketing", mediaId: M1, focalPoint: { x: 0.2, y: 0.3, zoom: 1.5 } },
      { key: `product:${P1}:1`, origin: "product", productId: P1, imagePath: "co/p.jpg", focalPoint: null },
    ]);
  });

  it("sem sequência, usa a imagem principal do acervo", () => {
    expect(campaignImageRefs({ primary_image_media_id: M1, ai_prompt: {} }).refs).toEqual([
      { key: `marketing:${M1}`, origin: "marketing", mediaId: M1, focalPoint: null },
    ]);
  });

  it("REGRESSÃO: imagem principal que é foto de produto também vira prévia", () => {
    const { refs } = campaignImageRefs({
      primary_image_media_id: null,
      primary_image_product_ref: { product_id: P1, image_path: "co/produto.jpg" },
      ai_prompt: { focal_point: { x: 0.4, y: 0.6 } },
    });
    expect(refs).toEqual([
      { key: `product:${P1}:0`, origin: "product", productId: P1, imagePath: "co/produto.jpg", focalPoint: { x: 0.4, y: 0.6, zoom: 1 } },
    ]);
  });

  it("sequência corrompida não some em silêncio: avisa e cai na imagem principal", () => {
    const { refs, sequenceInvalid } = campaignImageRefs({ primary_image_media_id: M1, ai_prompt: { image_sequence: [{ nada: true }] } });
    expect(sequenceInvalid).toBe(true);
    expect(refs.map((r) => r.key)).toEqual([`marketing:${M1}`]);
  });

  it("conteúdo sem imagem não inventa uma", () => {
    expect(campaignImageRefs({ ai_prompt: null }).refs).toEqual([]);
  });
});

describe("resolução do link da imagem", () => {
  const refs = [
    { key: "a", origin: "marketing" as const, mediaId: M1 },
    { key: "b", origin: "product" as const, imagePath: "co/p.jpg" },
  ];

  it("busca o caminho da mídia pelo id (sem depender de lista em cache) e assina", async () => {
    const mediaPaths = vi.fn(deps().mediaPaths);
    const out = await resolveCampaignMedia(refs, deps({ mediaPaths }));
    expect(mediaPaths).toHaveBeenCalledWith([M1]);
    expect(out).toEqual({
      a: { previewUrl: `https://signed/co/${M1}.jpg`, error: null },
      b: { previewUrl: "https://signed-product/co/p.jpg", error: null },
    });
  });

  it("mídia removida do acervo vira erro identificado, não 'sem imagem' mudo", async () => {
    const out = await resolveCampaignMedia(
      [{ key: "a", origin: "marketing", mediaId: M1 }, { key: "c", origin: "marketing", mediaId: M2 }],
      deps({ mediaPaths: async () => ({ [M1]: "co/ok.jpg" }) }),
    );
    expect(out.a.previewUrl).toBe("https://signed/co/ok.jpg");
    expect(out.c).toEqual({ previewUrl: null, error: "not_found" });
    expect(MEDIA_ERROR_MESSAGE.not_found).toContain("acervo");
  });

  it("REGRESSÃO: assinatura que nunca responde termina em timeout (não carrega para sempre)", async () => {
    const out = await resolveCampaignMedia(refs, deps({ signMarketing: () => never<string>() }));
    expect(out.a).toEqual({ previewUrl: null, error: "timeout" });
    // Uma imagem travada não segura as outras.
    expect(out.b.previewUrl).toBe("https://signed-product/co/p.jpg");
  });

  it("consulta de caminhos que nunca responde também termina em timeout", async () => {
    const out = await resolveCampaignMedia(refs, deps({ mediaPaths: () => never<Record<string, string>>() }));
    expect(out.a.error).toBe("timeout");
    expect(out.b.error).toBeNull();
  });

  it("falha do storage (null ou exceção) vira url_failed", async () => {
    const out = await resolveCampaignMedia(
      refs,
      deps({ signMarketing: async () => null, signProduct: async () => { throw new Error("403"); } }),
    );
    expect(out.a.error).toBe("url_failed");
    expect(out.b.error).toBe("url_failed");
  });

  it("tentar novamente pede link novo (fresh) e usa o storagePath já conhecido", async () => {
    const signMarketing = vi.fn(async (path: string) => `https://signed/${path}`);
    const mediaPaths = vi.fn(deps().mediaPaths);
    await resolveCampaignMedia([{ key: "a", origin: "marketing", mediaId: M1, storagePath: "co/x.jpg" }], deps({ signMarketing, mediaPaths }), { fresh: true });
    expect(signMarketing).toHaveBeenCalledWith("co/x.jpg", true);
    expect(mediaPaths).not.toHaveBeenCalled();
  });

  it("withTimeout rejeita com MediaTimeoutError e repassa valor/erro quando chega a tempo", async () => {
    await expect(withTimeout(never(), 10)).rejects.toBeInstanceOf(MediaTimeoutError);
    await expect(withTimeout(Promise.resolve(7), 10)).resolves.toBe(7);
    await expect(withTimeout(Promise.reject(new Error("x")), 10)).rejects.toThrow("x");
  });
});

describe("links assinados do storage", () => {
  beforeEach(() => createSignedUrl.mockReset());

  it("REGRESSÃO: um pedido pendurado não bloqueia a nova tentativa", async () => {
    createSignedUrl.mockImplementationOnce(() => never());
    const stuck = getSignedMediaUrl("marketing-media", "co/travado.jpg");
    // Sem `fresh`, um segundo pedido reaproveita o que está pendurado.
    expect(getSignedMediaUrl("marketing-media", "co/travado.jpg")).toStrictEqual(stuck);
    createSignedUrl.mockResolvedValueOnce({ data: { signedUrl: "https://signed/novo" }, error: null });
    await expect(getSignedMediaUrl("marketing-media", "co/travado.jpg", { fresh: true })).resolves.toBe("https://signed/novo");
    // E o link novo passa a valer para os próximos pedidos.
    await expect(getSignedMediaUrl("marketing-media", "co/travado.jpg")).resolves.toBe("https://signed/novo");
  });

  it("erro do storage devolve null (o chamador mostra o erro e oferece nova tentativa)", async () => {
    createSignedUrl.mockResolvedValueOnce({ data: null, error: { message: "Object not found" } });
    await expect(getSignedMediaUrl("marketing-media", "co/sumiu.jpg")).resolves.toBeNull();
  });
});

describe("telas que carregam imagens de campanha", () => {
  const read = (file: string) => readFileSync(resolve(process.cwd(), file), "utf8");

  it("o estúdio (Publicar) e a criação usam o resolvedor com timeout, sem engolir falhas", () => {
    const approvals = read("src/components/marketing/MarketingApprovals.tsx");
    const open = approvals.slice(approvals.indexOf("async function loadEditorImages"), approvals.indexOf("function closeVideoEditor"));
    expect(open).toContain("campaignImageRefs(row)");
    expect(open).toContain("resolveCampaignMedia(refs, campaignMediaDeps");
    expect(open).toContain("loadError:");
    expect(open).not.toContain("catch(() => null)");
    // O "Carregando editor…" sempre termina.
    expect(open).toMatch(/finally \{[\s\S]*setEditorLoading\(false\)/);

    const generator = read("src/components/marketing/campaign/MarketingCampaignGenerator.tsx");
    const resolve_ = generator.slice(generator.indexOf("const resolveSlotPreview"), generator.indexOf("const retryPreviewByKey"));
    expect(resolve_).toContain("resolveCampaignMedia([ref], campaignMediaDeps");
    // REGRESSÃO: o estado de carregamento é marcado pelo item, nunca pela posição na lista.
    expect(resolve_).not.toMatch(/i === idx/);
    expect(resolve_).toContain("sameSelection(s.selection, selection) ? { ...s, loading: true");
    expect(generator).toContain("onRetryPreview={retryPreviewByKey}");
    expect(generator).toContain("imageSequence={editorImages}");
  });

  it("a busca de caminhos de mídia é restrita à empresa autenticada", () => {
    const source = read("src/lib/marketing/marketing.functions.ts");
    const fn = source.slice(source.indexOf("export const getMarketingMediaPaths"), source.indexOf("const UpdateMediaSchema"));
    expect(fn).toContain("requireSupabaseAuth");
    expect(fn).toContain('.eq("company_id", companyId)');
    expect(fn).toContain('.is("deleted_at", null)');
  });
});

describe("grade compacta de modelos", () => {
  it("cabe os 25 modelos sem rolagem em painéis de desktop, com a maior miniatura possível", () => {
    for (const [w, h] of [[580, 760], [420, 520], [330, 560]] as const) {
      const g = fitTemplateGrid(w, h, SCENE_LIST.length);
      expect(g.fits).toBe(true);
      const rows = Math.ceil(SCENE_LIST.length / g.columns);
      expect(rows * ((g.cell * 16) / 9 + 15) + 6 * (rows - 1)).toBeLessThanOrEqual(h);
      expect(g.columns * g.cell + 6 * (g.columns - 1)).toBeLessThanOrEqual(w);
      expect(g.cell).toBeGreaterThanOrEqual(46);
      // Uma coluna a menos já não caberia: é a maior miniatura possível.
      if (g.columns > 1 && g.cell < 132) {
        const fewer = g.columns - 1;
        const cell = Math.min(132, Math.floor((w - 6 * (fewer - 1)) / fewer));
        const r = Math.ceil(SCENE_LIST.length / fewer);
        expect(r * ((cell * 16) / 9 + 15) + 6 * (r - 1)).toBeGreaterThan(h);
      }
    }
  });

  it("com menos modelos (filtro) as miniaturas crescem; sem altura, a lista rola com tamanho legível", () => {
    expect(fitTemplateGrid(420, 520, 6).cell).toBeGreaterThan(fitTemplateGrid(420, 520, 25).cell);
    const short = fitTemplateGrid(340, 200, 25);
    expect(short.fits).toBe(false);
    expect(short.cell).toBeGreaterThanOrEqual(46);
    expect(fitTemplateGrid(0, 0, 25).fits).toBe(false);
  });
});
