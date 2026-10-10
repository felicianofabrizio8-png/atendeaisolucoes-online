// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const save = vi.fn(async (_input: Record<string, unknown>) => ({ id: "content-1", body: "", title: "x" }));
const uploads: File[] = [];
let mediaSeq = 0;
vi.mock("@/data/marketingRepo", () => ({
  apiSaveStudioContent: (input: Record<string, unknown>) => save(input),
  campaignMediaDeps: {},
  uploadMarketingFile: vi.fn(async (_company: string, file: File) => {
    uploads.push(file);
    return `co/marketing/${file.name}`;
  }),
  apiRegisterMedia: vi.fn(async () => ({ id: `aaaaaaaa-aaaa-4aaa-8aaa-00000000000${++mediaSeq}` })),
}));
const brand = {
  logoUrl: "https://cdn.test/logo.png" as string | null,
  loading: false,
  isPlaceholder: false,
  brandColors: { primary: "#0B3D2E", secondary: "#F2E8CF", accent: "#C81E1E" },
  brandPublished: true,
  canManage: true,
  saving: false,
  error: null as string | null,
  saveLogo: vi.fn(async (_file: File) => true),
  removeLogo: vi.fn(async () => true),
};
vi.mock("@/hooks/useBrandLogo", () => ({ useBrandLogo: () => brand }));
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() }));
vi.mock("sonner", () => ({ toast }));
// O seletor real é o Acervo; aqui basta um botão que devolve uma imagem.
vi.mock("@/components/marketing/MarketingLibrary", () => ({
  MarketingLibrary: ({ onToggleSelect }: { onToggleSelect: (sel: unknown) => void }) => (
    <button type="button" onClick={() => onToggleSelect({ origin: "marketing", id: "99999999-9999-4999-8999-999999999999", mediaType: "image" })}>
      Imagem do acervo
    </button>
  ),
}));

globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver;

import { CreativeStudio } from "@/components/marketing/studio/CreativeStudio";
import * as repo from "@/data/marketingRepo";
import { documentFromVideo, newDocument, toCarousel, type StudioDocument } from "@/lib/marketing/studio/document";
import { getScene } from "@/lib/marketing/video-editor/scenes/registry";
import type { MediaResolverDeps } from "@/lib/marketing/campaign-media";

const M = ["11111111-1111-4111-8111-111111111111", "22222222-2222-4222-8222-222222222222", "33333333-3333-4333-8333-333333333333"];
const deps: MediaResolverDeps = {
  mediaPaths: async (ids) => Object.fromEntries(ids.map((id) => [id, `co/${id}.jpg`])),
  signMarketing: async (path) => `https://cdn.test/${path}`,
  signProduct: async (path) => `https://cdn.test/${path}`,
};

function carousel(): StudioDocument {
  return toCarousel(
    documentFromVideo({
      layout: getScene("oferta").defaultLayout,
      text: { headline: "Verão com desconto", subheadline: "Entrega rápida", cta: "Peça já" },
      scenes: M.map((mediaId) => ({ image: { origin: "marketing" as const, mediaId }, framing: null })),
    }),
  );
}

const renderPage = vi.fn(async (input: { page: { id: string }; format: string; imageUrl: string | null; logoUrl: string | null; type?: string }) => ({
  blob: new Blob([`img-${input.page.id}`], { type: input.type === "jpeg" ? "image/jpeg" : "image/png" }),
  width: 1080,
  height: input.format === "square" ? 1080 : 1350,
  mimeType: input.type === "jpeg" ? "image/jpeg" : "image/png",
}));

function setup(doc: StudioDocument = carousel(), props: Partial<Parameters<typeof CreativeStudio>[0]> = {}) {
  render(<CreativeStudio companyId="co" initial={doc} mediaDeps={deps} renderPage={renderPage as never} {...props} />);
  return { user: userEvent.setup() };
}
const photosReady = () => waitFor(() => expect(screen.getByTestId("creative-studio").querySelectorAll("[data-fit]").length).toBeGreaterThan(3));
const strip = () => screen.getByRole("list", { name: "Páginas" });
const pages = () => within(strip()).getAllByRole("button", { name: /^Página \d+$/ });
const lastSave = () => save.mock.calls.at(-1)![0] as { id?: string; caption: string; document: StudioDocument };
const previewSvg = () => screen.getByTestId("creative-studio").querySelector('[data-format] .scene-overlay')!.innerHTML;

beforeEach(() => {
  renderPage.mockClear();
  toast.success.mockClear();
  save.mockClear();
  toast.error.mockClear();
  uploads.length = 0;
  mediaSeq = 0;
});
afterEach(cleanup);
// Cada miniatura desenha a cena real (25 modelos + páginas): os cliques em
// sequência passam do limite padrão quando a suíte inteira roda em paralelo.
vi.setConfig({ testTimeout: 30_000 });

describe("estúdio criativo: carrossel", () => {
  it("usa a mesma estrutura do estúdio de vídeo, com faixa de páginas no lugar da timeline", () => {
    setup();
    const studio = screen.getByTestId("creative-studio");
    expect(studio.getAttribute("data-kind")).toBe("carousel");
    for (const tool of ["Modelos", "Texto", "Cores", "Mídia"]) expect(screen.getByRole("tab", { name: tool })).toBeTruthy();
    expect(screen.queryByRole("tab", { name: "Vídeo" })).toBeNull();
    expect(screen.getByRole("complementary", { name: "Propriedades" })).toBeTruthy();
    expect(pages()).toHaveLength(3);
    // Prévia e miniaturas no formato do documento (4:5), não 9:16.
    expect(studio.querySelectorAll('[data-format="portrait"]').length).toBeGreaterThan(3);
    expect(studio.querySelector('[data-format="story"]')).toBeNull();
  });

  it("troca de formato entre 4:5 e 1:1 (9:16 não é oferecido para carrossel)", async () => {
    const { user } = setup();
    const formats = screen.getByRole("group", { name: "Formato" });
    expect(within(formats).queryByRole("button", { name: "9:16" })).toBeNull();
    await user.click(within(formats).getByRole("button", { name: "1:1" }));
    expect(screen.getByTestId("creative-studio").querySelector('[data-format="portrait"]')).toBeNull();
    await user.click(screen.getByRole("button", { name: "Salvar" }));
    await waitFor(() => expect(save).toHaveBeenCalled());
    expect(lastSave().document.format).toBe("square");
  });

  it("cada página tem o próprio texto; a prévia acompanha a página selecionada", async () => {
    const { user } = setup();
    expect(previewSvg().toUpperCase()).toContain("VERÃO");
    await user.click(pages()[1]);
    expect(previewSvg().toUpperCase()).not.toContain("VERÃO");
    await user.click(screen.getByRole("tab", { name: "Texto" }));
    fireEvent.change(screen.getByLabelText("Título"), { target: { value: "Qualidade garantida" } });
    expect(previewSvg().toUpperCase()).toContain("QUALIDADE");
    await user.click(pages()[0]);
    expect(previewSvg().toUpperCase()).toContain("VERÃO");

    await user.click(screen.getByRole("button", { name: "Salvar" }));
    await waitFor(() => expect(save).toHaveBeenCalled());
    expect(lastSave().document.pages.map((p) => p.text.headline)).toEqual(["Verão com desconto", "Qualidade garantida", ""]);
  });

  it("adiciona, duplica, move e remove páginas dentro dos limites", async () => {
    const { user } = setup();
    await user.click(screen.getByRole("button", { name: "Duplicar página" }));
    expect(pages()).toHaveLength(4);
    // A cópia fica selecionada e mantém o texto.
    expect(pages()[1].getAttribute("aria-current")).toBe("true");
    expect(previewSvg().toUpperCase()).toContain("VERÃO");

    await user.click(screen.getByRole("button", { name: "Adicionar página" }));
    expect(pages()).toHaveLength(5);

    await user.click(pages()[0]);
    expect((screen.getByRole("button", { name: "Mover página para antes" }) as HTMLButtonElement).disabled).toBe(true);
    await user.click(screen.getByRole("button", { name: "Mover página para depois" }));
    expect(pages()[1].getAttribute("aria-current")).toBe("true");

    for (let i = 0; i < 3; i++) await user.click(screen.getByRole("button", { name: "Remover página" }));
    expect(pages()).toHaveLength(2);
    // Carrossel precisa de pelo menos duas páginas.
    expect((screen.getByRole("button", { name: "Remover página" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("não passa de 10 páginas", async () => {
    const { user } = setup();
    for (let i = 0; i < 7; i++) await user.click(screen.getByRole("button", { name: "Adicionar página" }));
    expect(pages()).toHaveLength(10);
    expect(screen.queryByRole("button", { name: "Adicionar página" })).toBeNull();
    expect((screen.getByRole("button", { name: "Duplicar página" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("o modelo vale para a página; 'Aplicar a todas' leva às demais; as cores valem para todas", async () => {
    const { user } = setup();
    const gallery = screen.getByRole("tabpanel", { name: "Modelos" });
    await user.click(within(gallery).getByRole("button", { name: /Galeria/ }));
    await user.click(screen.getByRole("button", { name: "Salvar" }));
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    expect(lastSave().document.pages.map((p) => p.layout.template)).toEqual(["luxo", "oferta", "oferta"]);

    await user.click(screen.getByRole("button", { name: "Aplicar a todas" }));
    await user.click(screen.getByRole("tab", { name: "Cores" }));
    await user.click(screen.getByRole("button", { name: "Cores do modelo" }));
    await user.click(screen.getByRole("button", { name: "Salvar" }));
    await waitFor(() => expect(save).toHaveBeenCalledTimes(2));
    const doc = lastSave().document;
    expect(doc.pages.every((p) => p.layout.template === "luxo")).toBe(true);
    expect(doc.pages.every((p) => p.layout.colorMode === "template")).toBe(true);
  });

  it("abre um documento novo com as cores da marca da empresa", async () => {
    setup(newDocument("carousel", "oferta"));
    await waitFor(() => expect(previewSvg()).toContain("#C81E1E"));
  });

  it("escolhe, troca e remove a imagem da página pelo acervo da empresa", async () => {
    const { user } = setup(newDocument("carousel", "moderno"));
    expect(screen.getByTestId("creative-studio").querySelector('[data-testid="framed-image"]')).toBeNull();
    await user.click(screen.getByRole("tab", { name: "Mídia" }));
    await user.click(within(screen.getByRole("tabpanel", { name: "Mídia" })).getByRole("button", { name: /Escolher imagem/ }));
    await user.click(await screen.findByRole("button", { name: "Imagem do acervo" }));
    await waitFor(() => expect(screen.getByRole("button", { name: /Trocar imagem/ })).toBeTruthy());

    await user.click(screen.getByRole("button", { name: "Salvar" }));
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    expect(lastSave().document.pages[0].image).toEqual({ origin: "marketing", mediaId: "99999999-9999-4999-8999-999999999999", framing: null });
    expect(lastSave().document.pages[1].image).toBeNull();

    await user.click(screen.getByRole("button", { name: /Remover$/ }));
    await user.click(screen.getByRole("button", { name: "Salvar" }));
    await waitFor(() => expect(save).toHaveBeenCalledTimes(2));
    expect(lastSave().document.pages[0].image).toBeNull();
  });

  it("enquadramento por página: preencher e voltar ao padrão", async () => {
    const { user } = setup();
    const props = screen.getByRole("complementary", { name: "Propriedades" });
    await user.click(within(within(props).getByRole("group", { name: "Elemento" })).getByRole("button", { name: "Imagem" }));
    expect(within(props).getByText("Enquadramento da página 1")).toBeTruthy();
    await user.click(within(within(props).getByRole("group", { name: "Enquadramento" })).getByRole("button", { name: "Preencher" }));
    await user.click(screen.getByRole("button", { name: "Salvar" }));
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    expect(lastSave().document.pages[0].image?.framing).toMatchObject({ fit: "cover" });
    expect(lastSave().document.pages[1].image?.framing).toBeNull();
  });

  it("salvar envia o documento e a legenda; o segundo salvar atualiza o mesmo conteúdo", async () => {
    const { user } = setup();
    await user.click(screen.getByRole("tab", { name: "Texto" }));
    fireEvent.change(screen.getByLabelText("Legenda do post"), { target: { value: "Só esta semana." } });
    await user.click(screen.getByRole("button", { name: "Salvar" }));
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    expect(lastSave().id).toBeUndefined();
    expect(lastSave().caption).toBe("Só esta semana.");
    expect(lastSave().document.kind).toBe("carousel");
    // Nada mudou desde o último salvar.
    await waitFor(() => expect((screen.getByRole("button", { name: "Salvar" }) as HTMLButtonElement).disabled).toBe(true));

    fireEvent.change(screen.getByLabelText("Título"), { target: { value: "Novo título" } });
    await user.click(screen.getByRole("button", { name: "Salvar" }));
    await waitFor(() => expect(save).toHaveBeenCalledTimes(2));
    expect(lastSave().id).toBe("content-1");
  });

  it("explica quando o banco ainda não recebeu a atualização do estúdio", async () => {
    save.mockRejectedValueOnce(new Error("studio_migration_pending"));
    const { user } = setup();
    await user.click(screen.getByRole("button", { name: "Salvar" }));
    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    expect(String(toast.error.mock.calls[0][0])).toContain("ainda não foi atualizado");
  });
});

describe("estúdio criativo: exportar e concluir", () => {
  const registered = () =>
    (repo.apiRegisterMedia as unknown as ReturnType<typeof vi.fn>).mock.calls.map(
      (c) => c[0] as { storage_path: string; media_type: string; mime_type: string; width: number; height: number; tags: string[] },
    );

  it("Concluir gera uma imagem por página, guarda no acervo da empresa e vincula ao conteúdo", async () => {
    (repo.apiRegisterMedia as unknown as ReturnType<typeof vi.fn>).mockClear();
    const { user } = setup();
    // As fotos precisam ter link antes de exportar.
    await photosReady();
    await user.click(screen.getByRole("button", { name: "Concluir" }));
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));

    expect(renderPage).toHaveBeenCalledTimes(3);
    for (const call of renderPage.mock.calls) {
      expect(call[0].format).toBe("portrait");
      expect(call[0].type).toBe("jpeg");
      expect(call[0].imageUrl!.startsWith("https://cdn.test/co/")).toBe(true);
      expect(call[0].logoUrl).toBe("https://cdn.test/logo.png");
    }
    expect(uploads.map((f) => f.name)).toEqual(["carrossel-pagina-1.jpg", "carrossel-pagina-2.jpg", "carrossel-pagina-3.jpg"]);
    expect(registered()).toHaveLength(3);
    expect(registered().every((m) => m.media_type === "image" && m.mime_type === "image/jpeg" && m.width === 1080 && m.height === 1350 && m.tags.includes("carrossel"))).toBe(true);
    const payload = save.mock.calls[0][0] as { exported_media_ids: string[]; document: StudioDocument };
    expect(payload.exported_media_ids).toEqual(["aaaaaaaa-aaaa-4aaa-8aaa-000000000001", "aaaaaaaa-aaaa-4aaa-8aaa-000000000002", "aaaaaaaa-aaaa-4aaa-8aaa-000000000003"]);
    expect(payload.document.pages).toHaveLength(3);

    // Concluído: só volta a ficar disponível depois de uma nova edição.
    await waitFor(() => expect((screen.getByRole("button", { name: "Concluir" }) as HTMLButtonElement).disabled).toBe(true));
    await user.click(screen.getByRole("tab", { name: "Texto" }));
    fireEvent.change(screen.getByLabelText("Título"), { target: { value: "Mudou" } });
    expect((screen.getByRole("button", { name: "Concluir" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("logo oculta na página não vai para a imagem exportada", async () => {
    const doc = carousel();
    doc.pages[1] = { ...doc.pages[1], layout: { ...doc.pages[1].layout, logo: { ...doc.pages[1].layout.logo, visible: false } } };
    const { user } = setup(doc);
    await photosReady();
    await user.click(screen.getByRole("button", { name: "Concluir" }));
    await waitFor(() => expect(renderPage).toHaveBeenCalledTimes(3));
    expect(renderPage.mock.calls.map((c) => c[0].logoUrl)).toEqual(["https://cdn.test/logo.png", null, "https://cdn.test/logo.png"]);
  });

  it("Baixar gera PNG e não salva nem envia nada ao acervo", async () => {
    const createObjectURL = vi.fn(() => "blob:x");
    Object.assign(URL, { createObjectURL, revokeObjectURL: vi.fn() });
    const { user } = setup();
    await photosReady();
    await user.click(screen.getByRole("button", { name: "Baixar as páginas em PNG" }));
    await waitFor(() => expect(createObjectURL).toHaveBeenCalledTimes(3));
    expect(renderPage.mock.calls.every((c) => c[0].type === "png")).toBe(true);
    expect(save).not.toHaveBeenCalled();
    expect(uploads).toHaveLength(0);
  });

  it("não exporta enquanto a foto de uma página não carregou, nem um documento vazio", async () => {
    const never: MediaResolverDeps = { ...deps, mediaPaths: () => new Promise(() => {}) };
    const { user } = setup(carousel(), { mediaDeps: never });
    await user.click(screen.getByRole("button", { name: "Concluir" }));
    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    expect(String(toast.error.mock.calls[0][0])).toContain("ainda não carregou");
    expect(renderPage).not.toHaveBeenCalled();
    cleanup();

    toast.error.mockClear();
    const blank = setup(newDocument("art", "moderno"));
    await blank.user.click(screen.getByRole("button", { name: "Concluir" }));
    expect(String(toast.error.mock.calls[0][0])).toContain("Adicione uma imagem ou um título");
    expect(renderPage).not.toHaveBeenCalled();
  });

  it("falha ao gerar a imagem é explicada e nada é salvo pela metade", async () => {
    renderPage.mockRejectedValueOnce(new Error("export_image_failed"));
    const { user } = setup();
    await photosReady();
    await user.click(screen.getByRole("button", { name: "Concluir" }));
    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    expect(String(toast.error.mock.calls[0][0])).toContain("Não foi possível abrir uma das imagens");
    expect(uploads).toHaveLength(0);
    expect(save).not.toHaveBeenCalled();
    expect((screen.getByRole("button", { name: "Concluir" }) as HTMLButtonElement).disabled).toBe(false);
  });
});

describe("estúdio criativo: arte", () => {
  it("é uma página só, sem faixa de páginas, e aceita 4:5, 1:1 e 9:16", async () => {
    const { user } = setup(newDocument("art", "luxo", "square"));
    expect(screen.getByTestId("creative-studio").getAttribute("data-kind")).toBe("art");
    expect(screen.queryByTestId("page-strip")).toBeNull();
    expect(screen.queryByRole("button", { name: "Aplicar a todas" })).toBeNull();
    const formats = screen.getByRole("group", { name: "Formato" });
    await user.click(within(formats).getByRole("button", { name: "9:16" }));
    expect(screen.getByTestId("creative-studio").querySelectorAll('[data-format="story"]').length).toBeGreaterThan(1);
  });
});
