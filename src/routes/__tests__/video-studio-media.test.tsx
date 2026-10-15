// @vitest-environment jsdom
// Regressão do Estúdio de Vídeo IA: imagem da publicação na prévia, estados de
// carregamento, falha, timeout e "tentar novamente".
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const approve = vi.fn(async (_input: Record<string, unknown>) => ({ job_id: "job-1" }));
vi.mock("@/data/marketingRepo", () => ({
  apiApproveCampaignAndRender: (input: Record<string, unknown>) => approve(input),
  apiRegenerateCampaignTexts: vi.fn(async () => ({ contents: [] })),
  campaignMediaDeps: {},
}));
// O seletor real é o Acervo da empresa; aqui basta um botão que devolve uma imagem.
vi.mock("@/components/marketing/MarketingLibrary", () => ({
  MarketingLibrary: ({ onToggleSelect }: { onToggleSelect: (sel: unknown) => void }) => (
    <button type="button" onClick={() => onToggleSelect({ origin: "marketing", id: "99999999-9999-4999-8999-999999999999", mediaType: "image" })}>
      Imagem do acervo
    </button>
  ),
}));

vi.mock("@/hooks/useBrandLogo", () => ({
  useBrandLogo: () => ({ logoUrl: null, loading: false, isPlaceholder: true, brandColors: null, brandPublished: false, canManage: false, saving: false, error: null, saveLogo: vi.fn(), removeLogo: vi.fn() }),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));

globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver;

// Imagem controlável: cada teste decide se a URL carrega, falha ou fica pendurada.
type Outcome = "load" | "error" | "hang";
let outcomeFor: (url: string) => Outcome = () => "load";
class FakeImage {
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  naturalWidth = 1080;
  naturalHeight = 1920;
  set src(url: string) {
    const outcome = outcomeFor(url);
    queueMicrotask(() => {
      if (outcome === "load") this.onload?.();
      if (outcome === "error") this.onerror?.();
    });
  }
}
const RealImage = globalThis.Image;

import { CampaignVideoEditor, type CampaignEditorImage } from "@/components/marketing/campaign/editor/CampaignVideoEditor";
import { CampaignImageList } from "@/components/marketing/campaign/CampaignImageList";
import { MEDIA_ERROR_MESSAGE, MEDIA_IMAGE_TIMEOUT_MS } from "@/lib/marketing/campaign-media";
import type { MarketingContentRow } from "@/lib/marketing/marketing.types";

const CONTENT = { id: "c1", campaign_role: "feed", overlay_headline: "Verão", overlay_subheadline: null, overlay_cta: "Peça já", duration_seconds: 15 } as unknown as MarketingContentRow;
const M1 = "11111111-1111-4111-8111-111111111111";
const P1 = "33333333-3333-4333-8333-333333333333";
const image = (over: Partial<CampaignEditorImage> = {}): CampaignEditorImage => ({ key: `marketing:${M1}`, origin: "marketing", mediaId: M1, previewUrl: "https://cdn.test/a.jpg", focalPoint: null, ...over });

function setup(images: CampaignEditorImage[], extra: Partial<Parameters<typeof CampaignVideoEditor>[0]> = {}) {
  return render(
    <CampaignVideoEditor campaignId="camp-1" contents={[CONTENT]} previewImageUrl={images[0]?.previewUrl ?? null} imageSequence={images} onImageSequenceChange={vi.fn()} onApproved={vi.fn()} {...extra} />,
  );
}
const stageImages = () => Array.from(screen.getByTestId("video-studio").querySelectorAll<HTMLImageElement>(".lg\\:order-2 img")).map((i) => i.getAttribute("src"));

beforeEach(() => {
  approve.mockClear();
  outcomeFor = () => "load";
  globalThis.Image = FakeImage as unknown as typeof Image;
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  globalThis.Image = RealImage;
});

describe("imagem da publicação na prévia", () => {
  it("mostra a imagem vinculada (não 'sem imagem') e some o aviso de carregamento", async () => {
    setup([image()]);
    expect(stageImages()).toContain("https://cdn.test/a.jpg");
    await waitFor(() => expect(screen.queryByText("Carregando imagem…")).toBeNull());
    expect(screen.queryByText("sem imagem")).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("foto de produto como imagem principal também aparece", async () => {
    setup([image({ key: `product:${P1}:0`, origin: "product", mediaId: undefined, productId: P1, imagePath: "co/p.jpg", previewUrl: "https://cdn.test/produto.jpg" })]);
    expect(stageImages()).toContain("https://cdn.test/produto.jpg");
  });

  it("a imagem exibida é a enviada ao render (mesmas referências, mesma ordem)", async () => {
    const images = [
      image(),
      image({ key: `product:${P1}:1`, origin: "product", mediaId: undefined, productId: P1, imagePath: "co/p.jpg", previewUrl: "https://cdn.test/b.jpg", focalPoint: { x: 0.2, y: 0.8, zoom: 1.5 } }),
    ];
    setup(images);
    await userEvent.setup().click(screen.getByRole("button", { name: "Gerar vídeo" }));
    await waitFor(() => expect(approve).toHaveBeenCalledTimes(1));
    expect(approve.mock.calls[0][0].images).toEqual([
      // Sem enquadramento salvo: o padrão seguro (imagem inteira) que a prévia mostra.
      { origin: "marketing", media_id: M1, focal_point: { x: 0.5, y: 0.5, zoom: 1, fit: "contain", fill: "blur" } },
      // Corte antigo escolhido à mão continua como "preencher", com o mesmo foco.
      { origin: "product", product_id: P1, image_path: "co/p.jpg", focal_point: { x: 0.2, y: 0.8, zoom: 1.5, fit: "cover", fill: "blur" } },
    ]);
  });
});

describe("estados de carregamento e falha", () => {
  it("enquanto a imagem não abre, mostra 'Carregando imagem…'", async () => {
    outcomeFor = () => "hang";
    setup([image()]);
    expect((await screen.findByRole("status")).textContent).toContain("Carregando imagem…");
  });

  it("REGRESSÃO: carregamento pendurado vira timeout com opção de tentar novamente", async () => {
    vi.useFakeTimers();
    outcomeFor = () => "hang";
    setup([image()]);
    expect(screen.getByRole("status").textContent).toContain("Carregando imagem…");
    await act(async () => {
      vi.advanceTimersByTime(MEDIA_IMAGE_TIMEOUT_MS + 50);
    });
    expect(screen.getByRole("alert").textContent).toContain(MEDIA_ERROR_MESSAGE.timeout);
    expect(screen.getByRole("button", { name: "Tentar novamente" })).toBeTruthy();
  });

  it("imagem que o navegador não abre mostra o erro; tentar novamente pede novo link e recarrega", async () => {
    let fail = true;
    outcomeFor = () => (fail ? "error" : "load");
    const onRetryImage = vi.fn(async () => {
      fail = false;
    });
    setup([image()], { onRetryImage });
    expect((await screen.findByRole("alert")).textContent).toContain(MEDIA_ERROR_MESSAGE.image_failed);
    await userEvent.setup().click(screen.getByRole("button", { name: "Tentar novamente" }));
    expect(onRetryImage).toHaveBeenCalledWith(`marketing:${M1}`);
    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
    expect(screen.queryByText("Carregando imagem…")).toBeNull();
  });

  it("link que não pôde ser obtido mostra o motivo e permite nova tentativa", async () => {
    const onRetryImage = vi.fn();
    setup([image({ previewUrl: null, loadError: "timeout" })], { onRetryImage, previewImageUrl: null });
    expect(screen.getByRole("alert").textContent).toContain(MEDIA_ERROR_MESSAGE.timeout);
    await userEvent.setup().click(screen.getByRole("button", { name: "Tentar novamente" }));
    expect(onRetryImage).toHaveBeenCalledTimes(1);
  });

  it("mídia que não existe mais no acervo explica o motivo e não oferece tentativa inútil", () => {
    setup([image({ previewUrl: null, loadError: "not_found" })], { previewImageUrl: null });
    expect(screen.getByRole("alert").textContent).toContain(MEDIA_ERROR_MESSAGE.not_found);
    expect(screen.queryByRole("button", { name: "Tentar novamente" })).toBeNull();
  });
});

describe("lista de imagens ao montar a publicação", () => {
  const handlers = { onReorder: vi.fn(), onRemove: vi.fn(), onMakePrimary: vi.fn(), onEditFocal: vi.fn() };

  it("item carregando mostra indicador; item com falha mostra o motivo e tenta de novo", async () => {
    const onRetryPreview = vi.fn();
    render(
      <CampaignImageList
        {...handlers}
        onRetryPreview={onRetryPreview}
        items={[
          { key: "m:a", origin: "marketing", media_id: "a", previewUrl: "https://cdn.test/a.jpg" },
          { key: "m:b", origin: "marketing", media_id: "b", previewUrl: null, loadingPreview: true },
          { key: "m:c", origin: "marketing", media_id: "c", previewUrl: null, loadingPreview: false, previewError: "timeout" },
        ]}
      />,
    );
    const items = screen.getAllByRole("listitem");
    expect(items[1].querySelector(".animate-spin")).toBeTruthy();
    expect(items[2].querySelector(".animate-spin")).toBeNull();
    expect(items[2].textContent).toContain(MEDIA_ERROR_MESSAGE.timeout);
    await userEvent.setup().click(screen.getByRole("button", { name: "Tentar carregar a imagem 3 novamente" }));
    expect(onRetryPreview).toHaveBeenCalledWith("m:c");
  });
});
