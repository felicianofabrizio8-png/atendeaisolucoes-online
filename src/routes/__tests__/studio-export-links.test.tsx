// @vitest-environment jsdom
// REGRESSÃO (produção): exportar um carrossel falhava com "Não foi possível
// abrir uma das imagens" embora a prévia mostrasse as fotos. Os links
// assinados expiram em minutos; a prévia segue exibindo a foto já carregada,
// mas a exportação baixa o arquivo de novo — com o link antigo.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const save = vi.fn(async (_input: Record<string, unknown>) => ({ id: "content-1", body: "", title: "x" }));
vi.mock("@/data/marketingRepo", () => ({
  apiSaveStudioContent: (input: Record<string, unknown>) => save(input),
  campaignMediaDeps: {},
  uploadMarketingFile: vi.fn(async (_c: string, file: File) => `co/marketing/${file.name}`),
  apiRegisterMedia: vi.fn(async () => ({ id: "aaaaaaaa-aaaa-4aaa-8aaa-000000000001" })),
}));
const freshLogoUrl = vi.fn(async () => "https://cdn.test/logo.png?token=NOVO" as string | null);
const brand = {
  logoUrl: "https://cdn.test/logo.png?token=ANTIGO" as string | null,
  loading: false,
  isPlaceholder: false,
  brandColors: null,
  brandPublished: true,
  canManage: false,
  saving: false,
  error: null,
  saveLogo: vi.fn(async () => true),
  removeLogo: vi.fn(async () => true),
  freshLogoUrl,
};
vi.mock("@/hooks/useBrandLogo", () => ({ useBrandLogo: () => brand }));
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() }));
vi.mock("sonner", () => ({ toast }));
vi.mock("@/components/marketing/MarketingLibrary", () => ({ MarketingLibrary: () => null }));

globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver;

import { CreativeStudio } from "@/components/marketing/studio/CreativeStudio";
import { documentFromVideo, toCarousel } from "@/lib/marketing/studio/document";
import { ExportError, exportErrorMessage, renderPageImage } from "@/lib/marketing/studio/export-image";
import { getScene } from "@/lib/marketing/video-editor/scenes/registry";
import type { MediaResolverDeps } from "@/lib/marketing/campaign-media";

const M = ["11111111-1111-4111-8111-111111111111", "22222222-2222-4222-8222-222222222222", "33333333-3333-4333-8333-333333333333"];
const doc = () =>
  toCarousel(
    documentFromVideo({
      layout: getScene("oferta").defaultLayout,
      text: { headline: "Verão", subheadline: "", cta: "Peça já" },
      scenes: M.map((mediaId) => ({ image: { origin: "marketing" as const, mediaId }, framing: null })),
    }),
  );

/** Cada pedido "fresh" devolve um link novo; o primeiro (da prévia) é o antigo. */
function expiringDeps(failFresh: string[] = []): MediaResolverDeps & { calls: Array<{ path: string; fresh: boolean }> } {
  const calls: Array<{ path: string; fresh: boolean }> = [];
  return {
    calls,
    mediaPaths: async (ids) => Object.fromEntries(ids.map((id) => [id, `co/${id}.jpg`])),
    signMarketing: async (path, fresh) => {
      calls.push({ path, fresh });
      if (fresh && failFresh.some((id) => path.includes(id))) return null;
      return `https://cdn.test/${path}?token=${fresh ? "NOVO" : "ANTIGO"}`;
    },
    signProduct: async (path, fresh) => `https://cdn.test/${path}?token=${fresh ? "NOVO" : "ANTIGO"}`,
  };
}

const renderPage = vi.fn(async (input: { imageUrl: string | null; logoUrl: string | null; type?: string }) => ({
  blob: new Blob(["x"], { type: "image/jpeg" }),
  width: 1080,
  height: 1350,
  mimeType: input.type === "jpeg" ? "image/jpeg" : "image/png",
}));

function setup(deps: MediaResolverDeps) {
  render(<CreativeStudio companyId="co" initial={doc()} mediaDeps={deps} renderPage={renderPage as never} />);
  return userEvent.setup();
}
const photosReady = () => waitFor(() => expect(screen.getByTestId("creative-studio").querySelectorAll("[data-fit]").length).toBeGreaterThan(3));

beforeEach(() => {
  renderPage.mockClear();
  save.mockClear();
  freshLogoUrl.mockClear();
  toast.error.mockClear();
});
afterEach(cleanup);
vi.setConfig({ testTimeout: 30_000 });

describe("exportação renova os links assinados", () => {
  it("a prévia usa o link recebido; Concluir pede links novos de TODAS as fotos e da logo antes de gerar", async () => {
    const deps = expiringDeps();
    const user = setup(deps);
    await photosReady();
    expect(screen.getByTestId("creative-studio").innerHTML).toContain("token=ANTIGO");
    expect(deps.calls.every((c) => !c.fresh)).toBe(true);

    await user.click(screen.getByRole("button", { name: "Concluir" }));
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));

    expect(deps.calls.filter((c) => c.fresh).map((c) => c.path)).toEqual(M.map((id) => `co/${id}.jpg`));
    expect(renderPage).toHaveBeenCalledTimes(3);
    for (const [i, call] of renderPage.mock.calls.entries()) {
      expect(call[0].imageUrl).toBe(`https://cdn.test/co/${M[i]}.jpg?token=NOVO`);
      expect(call[0].logoUrl).toBe("https://cdn.test/logo.png?token=NOVO");
    }
    expect(freshLogoUrl).toHaveBeenCalledTimes(1);
  });

  it("Baixar também renova os links", async () => {
    Object.assign(URL, { createObjectURL: vi.fn(() => "blob:x"), revokeObjectURL: vi.fn() });
    const user = setup(expiringDeps());
    await photosReady();
    await user.click(screen.getByRole("button", { name: "Baixar as páginas em PNG" }));
    await waitFor(() => expect(renderPage).toHaveBeenCalledTimes(3));
    expect(renderPage.mock.calls.every((c) => String(c[0].imageUrl).endsWith("token=NOVO"))).toBe(true);
    expect(save).not.toHaveBeenCalled();
  });

  it("se o acesso a uma foto não puder ser renovado, nada é gerado nem salvo e a página é indicada", async () => {
    const user = setup(expiringDeps([M[1]]));
    await photosReady();
    await user.click(screen.getByRole("button", { name: "Concluir" }));
    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    expect(String(toast.error.mock.calls[0][0])).toContain("imagem da página 2");
    expect(renderPage).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
  });

  it("se a logo não puder ser renovada, segue com o link atual em vez de travar", async () => {
    freshLogoUrl.mockResolvedValueOnce(null);
    const user = setup(expiringDeps());
    await photosReady();
    await user.click(screen.getByRole("button", { name: "Concluir" }));
    await waitFor(() => expect(renderPage).toHaveBeenCalledTimes(3));
    expect(renderPage.mock.calls[0][0].logoUrl).toBe("https://cdn.test/logo.png?token=ANTIGO");
  });
});

describe("diagnóstico da falha de exportação", () => {
  it("a mensagem diz o motivo real: link recusado, rede ou arquivo ilegível", () => {
    expect(exportErrorMessage(new ExportError("export_image_failed", "http_400"))).toContain("o link de acesso ao arquivo expirou ou foi recusado (http_400)");
    expect(exportErrorMessage(new ExportError("export_image_failed", "http_500"))).toContain("o armazenamento respondeu com erro (http_500)");
    expect(exportErrorMessage(new ExportError("export_image_failed", "network"))).toContain("falha de rede ou bloqueio do navegador");
    expect(exportErrorMessage(new ExportError("export_image_failed", "decode"))).toContain("não pôde ser lido como imagem (decode)");
    expect(exportErrorMessage(new ExportError("export_logo_failed", "http_403"))).toContain("logo da empresa");
    expect(exportErrorMessage(new Error("qualquer"))).toBe("Não foi possível exportar. Tente novamente.");
  });

  it("link expirado (HTTP 400) vira erro identificado; a foto é sempre buscada na rede, sem cache", async () => {
    const page = doc().pages[0];
    const ctx = new Proxy({}, { get: (_t, prop) => (prop === "filter" ? "none" : () => undefined), set: () => true });
    const getContext = vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(ctx as never);
    const fetchMock = vi.fn(async (url: string, _init?: RequestInit) =>
      url.includes("/fonts/")
        ? ({ ok: true, status: 200, blob: async () => new Blob(["font"], { type: "font/ttf" }) } as Response)
        : ({ ok: false, status: 400, blob: async () => new Blob([]) } as Response),
    );
    vi.stubGlobal("fetch", fetchMock);
    try {
      const failure = await renderPageImage({ page, format: "portrait", imageUrl: "https://cdn.test/co/a.jpg?token=ANTIGO", logoUrl: null }).catch((e) => e);
      expect(failure).toBeInstanceOf(ExportError);
      expect(failure.message).toBe("export_image_failed");
      expect(failure.detail).toBe("http_400");
      const photoCall = fetchMock.mock.calls.find((c) => c[0].includes("a.jpg"))!;
      expect(photoCall[1]).toEqual({ cache: "no-store" });
      // Fontes (mesma origem) podem usar o cache normal.
      expect(fetchMock.mock.calls.find((c) => c[0].includes("/fonts/"))![1]).toBeUndefined();

      fetchMock.mockImplementation(async (url: string) => {
        if (url.includes("/fonts/")) return { ok: true, status: 200, blob: async () => new Blob(["font"], { type: "font/ttf" }) } as Response;
        throw new TypeError("Failed to fetch");
      });
      const network = await renderPageImage({ page, format: "portrait", imageUrl: "https://cdn.test/co/b.jpg", logoUrl: null }).catch((e) => e);
      expect(network.detail).toBe("network");
    } finally {
      vi.unstubAllGlobals();
      getContext.mockRestore();
    }
  });
});
