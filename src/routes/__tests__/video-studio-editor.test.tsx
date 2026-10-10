// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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

// Estado da marca controlável por teste (admin ou não, com ou sem logo).
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
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));

// O slider (Radix) mede o próprio tamanho; o jsdom não traz ResizeObserver.
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver;

import { CampaignVideoEditor, type CampaignEditorImage } from "@/components/marketing/campaign/editor/CampaignVideoEditor";
import type { MarketingContentRow } from "@/lib/marketing/marketing.types";

const CONTENT = {
  id: "c1",
  campaign_role: "feed",
  overlay_headline: "Verão com desconto",
  overlay_subheadline: "Entrega rápida",
  overlay_cta: "Peça já",
  duration_seconds: 15,
  video_template: null,
  video_layout: null,
  ai_prompt: null,
} as unknown as MarketingContentRow;

const IMAGES: CampaignEditorImage[] = [
  { key: "a", origin: "marketing", mediaId: "11111111-1111-4111-8111-111111111111", previewUrl: "https://cdn.test/a.jpg", focalPoint: null },
  { key: "b", origin: "marketing", mediaId: "22222222-2222-4222-8222-222222222222", previewUrl: "https://cdn.test/b.jpg", focalPoint: null },
  { key: "c", origin: "marketing", mediaId: "33333333-3333-4333-8333-333333333333", previewUrl: "https://cdn.test/c.jpg", focalPoint: null },
];

const mediaDeps = {
  mediaPaths: async (ids: string[]) => Object.fromEntries(ids.map((id) => [id, `co/${id}.jpg`])),
  signMarketing: async (path: string) => `https://cdn.test/${path}`,
  signProduct: async (path: string) => `https://cdn.test/${path}`,
};

function setup(onImageSequenceChange = vi.fn(), props: Partial<Parameters<typeof CampaignVideoEditor>[0]> = {}) {
  render(
    <CampaignVideoEditor
      campaignId="camp-1"
      contents={[CONTENT]}
      previewImageUrl="https://cdn.test/a.jpg"
      imageSequence={IMAGES}
      onImageSequenceChange={onImageSequenceChange}
      onApproved={vi.fn()}
      companyId="co"
      mediaDeps={mediaDeps}
      {...props}
    />,
  );
  return { user: userEvent.setup(), onImageSequenceChange };
}

const previewSvg = () => screen.getByLabelText("Selecionar título").parentElement!.querySelector(".scene-overlay")!.innerHTML;
const lastPayload = () => approve.mock.calls.at(-1)![0] as { layout: { colorMode: string; transition: string; colors: Record<string, string>; title: Record<string, unknown>; logo: Record<string, unknown> }; template: string; images: Array<{ media_id: string }>; duration_seconds?: number };

beforeEach(() => {
  approve.mockClear();
  brand.saveLogo.mockClear();
  brand.removeLogo.mockClear();
  Object.assign(brand, { logoUrl: "https://cdn.test/logo.png", canManage: true, brandPublished: true, error: null });
});
afterEach(cleanup);

describe("estúdio do Vídeo IA", () => {
  it("tem ferramentas, prévia, propriedades e timeline, e só os painéis rolam", () => {
    setup();
    const studio = screen.getByTestId("video-studio");
    expect(studio.className).toContain("h-full");
    expect(studio.className).toContain("overflow-hidden");
    for (const tool of ["Modelos", "Texto", "Cores", "Mídia", "Vídeo"]) expect(screen.getByRole("tab", { name: tool })).toBeTruthy();
    expect(screen.getByRole("complementary", { name: "Propriedades" })).toBeTruthy();
    expect(screen.getByRole("group", { name: "Cenas do vídeo" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Reproduzir prévia" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Gerar vídeo" })).toBeTruthy();
  });

  it("lista pelo menos 24 modelos e aplica o escolhido na prévia", async () => {
    const { user } = setup();
    const gallery = screen.getByRole("tabpanel", { name: "Modelos" });
    const cards = within(gallery).getAllByRole("button").filter((b) => b.getAttribute("title"));
    expect(cards.length).toBeGreaterThanOrEqual(24);
    const before = previewSvg();
    await user.click(within(gallery).getByRole("button", { name: /Etiqueta/ }));
    expect(previewSvg()).not.toBe(before);
    expect(previewSvg()).toContain('font-family="Archivo Black"');
  });

  it("abre com as cores da marca da empresa e envia exatamente o que a prévia mostra", async () => {
    const { user } = setup();
    await waitFor(() => expect(previewSvg()).toContain("#C81E1E"));
    await user.click(screen.getByRole("button", { name: "Gerar vídeo" }));
    await waitFor(() => expect(approve).toHaveBeenCalledTimes(1));
    const { layout } = lastPayload();
    expect(layout.colorMode).toBe("brand");
    expect(layout.colors.cta).toBe("#C81E1E");
    expect(previewSvg()).toContain(layout.colors.cta);
    // Duração intocada não é reenviada.
    expect(lastPayload().duration_seconds).toBeUndefined();
  });

  it("fonte, alinhamento e posição editados chegam à prévia e ao render", async () => {
    const { user } = setup();
    const props = screen.getByRole("complementary", { name: "Propriedades" });
    await user.click(within(within(props).getByRole("group", { name: "Fonte" })).getByRole("button", { name: "Bebas Neue" }));
    await user.click(within(within(props).getByRole("group", { name: "Alinhamento" })).getByRole("button", { name: "Centro" }));
    await user.click(within(within(props).getByRole("group", { name: "Posição vertical" })).getByRole("button", { name: "Topo" }));
    expect(previewSvg()).toContain('font-family="Bebas Neue"');
    await user.click(screen.getByRole("button", { name: "Gerar vídeo" }));
    await waitFor(() => expect(approve).toHaveBeenCalledTimes(1));
    const { layout } = lastPayload();
    expect(layout.title).toMatchObject({ font: "bebas", align: "center", vAnchor: "top" });
    // A logo sai do topo para não ficar sob o texto.
    expect(layout.logo.vAnchor).toBe("bottom");
  });

  it("cor personalizada, transição e duração são enviadas", async () => {
    const { user } = setup();
    await user.click(screen.getByRole("tab", { name: "Cores" }));
    fireEvent.change(screen.getByLabelText("Botão"), { target: { value: "#00ff88" } });
    expect(previewSvg()).toContain("#00FF88");
    await user.click(screen.getByRole("tab", { name: "Vídeo" }));
    await user.click(screen.getByRole("button", { name: "Deslizar para cima" }));
    await user.click(within(screen.getByRole("group", { name: "Duração do vídeo" })).getByRole("button", { name: "30 s" }));
    await user.click(screen.getByRole("button", { name: "Gerar vídeo" }));
    await waitFor(() => expect(approve).toHaveBeenCalledTimes(1));
    const payload = lastPayload();
    expect(payload.layout.colors.cta).toBe("#00FF88");
    expect(payload.layout.colorMode).toBe("custom");
    expect(payload.layout.transition).toBe("slideup");
    expect(payload.duration_seconds).toBe(30);
  });

  it("reordena e remove cenas; mover outra cena para o início troca a capa", async () => {
    const { user, onImageSequenceChange } = setup();
    await user.click(screen.getByRole("tab", { name: "Mídia" }));
    const keys = () => onImageSequenceChange.mock.calls.at(-1)![0].map((i: CampaignEditorImage) => i.key);
    expect((screen.getByRole("button", { name: "Mover cena 1 para antes" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Mover cena 3 para depois" }) as HTMLButtonElement).disabled).toBe(true);
    await user.click(screen.getByRole("button", { name: "Mover cena 2 para depois" }));
    expect(keys()).toEqual(["a", "c", "b"]);
    // A capa deixou de ser fixa.
    await user.click(screen.getByRole("button", { name: "Mover cena 2 para antes" }));
    expect(keys()).toEqual(["b", "a", "c"]);
    await user.click(screen.getByRole("button", { name: "Remover cena 1" }));
    expect(keys()).toEqual(["b", "c"]);
  });

  it("adiciona e troca imagens pelo acervo da empresa, sem recriar a publicação", async () => {
    const { user, onImageSequenceChange } = setup();
    await user.click(screen.getByRole("tab", { name: "Mídia" }));
    await user.click(screen.getByRole("button", { name: "Adicionar imagem" }));
    await user.click(await screen.findByRole("button", { name: "Imagem do acervo" }));
    await waitFor(() => expect(onImageSequenceChange).toHaveBeenCalledTimes(1));
    const added = onImageSequenceChange.mock.calls[0][0] as CampaignEditorImage[];
    expect(added).toHaveLength(4);
    expect(added[3]).toMatchObject({
      origin: "marketing",
      mediaId: "99999999-9999-4999-8999-999999999999",
      previewUrl: "https://cdn.test/co/99999999-9999-4999-8999-999999999999.jpg",
      focalPoint: null,
    });

    await user.click(screen.getByRole("button", { name: "Trocar a imagem da cena 1" }));
    await user.click(await screen.findByRole("button", { name: "Imagem do acervo" }));
    await waitFor(() => expect(onImageSequenceChange).toHaveBeenCalledTimes(2));
    const replaced = onImageSequenceChange.mock.calls[1][0] as CampaignEditorImage[];
    expect(replaced).toHaveLength(3);
    expect(replaced[0].mediaId).toBe("99999999-9999-4999-8999-999999999999");
    expect(replaced.slice(1).map((i) => i.key)).toEqual(["b", "c"]);
  });

  it("uma cena só não pode ser removida; sem empresa informada o acervo não é oferecido", async () => {
    const { user } = setup(vi.fn(), { imageSequence: IMAGES.slice(0, 1), companyId: undefined });
    await user.click(screen.getByRole("tab", { name: "Mídia" }));
    expect((screen.getByRole("button", { name: "Remover cena 1" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.queryByRole("button", { name: "Adicionar imagem" })).toBeNull();
    expect(screen.queryByRole("button", { name: /Trocar a imagem/ })).toBeNull();
  });

  it("respeita o limite de 8 imagens", async () => {
    const eight = Array.from({ length: 8 }, (_, i) => ({ ...IMAGES[0], key: `k${i}` }));
    const { user } = setup(vi.fn(), { imageSequence: eight });
    await user.click(screen.getByRole("tab", { name: "Mídia" }));
    expect(screen.queryByRole("button", { name: "Adicionar imagem" })).toBeNull();
    expect(screen.getAllByRole("button", { name: /Trocar a imagem da cena/ })).toHaveLength(8);
  });

  it("organiza os modelos por finalidade comercial", async () => {
    const { user } = setup();
    const gallery = screen.getByRole("tabpanel", { name: "Modelos" });
    const filter = within(gallery).getByRole("group", { name: "Finalidade do vídeo" });
    for (const purpose of ["Oferta", "Lançamento", "Produto", "Serviço", "Institucional", "Luxo", "Datas e eventos"]) {
      expect(within(filter).getByRole("button", { name: purpose })).toBeTruthy();
    }
    const count = () => within(gallery).getAllByRole("button").filter((b) => b.getAttribute("title")).length;
    const all = count();
    await user.click(within(filter).getByRole("button", { name: "Luxo" }));
    expect(count()).toBeGreaterThan(0);
    expect(count()).toBeLessThan(all);
    expect(within(gallery).getByRole("button", { name: /Galeria/ })).toBeTruthy();
  });

  it("por padrão a foto aparece inteira e o render recebe esse mesmo enquadramento", async () => {
    const { user } = setup();
    const framed = screen.getByTestId("video-studio").querySelector('.lg\\:order-2 [data-fit]');
    expect(framed?.getAttribute("data-fit")).toBe("contain");
    await user.click(screen.getByRole("button", { name: "Gerar vídeo" }));
    await waitFor(() => expect(approve).toHaveBeenCalledTimes(1));
    for (const img of lastPayload().images as unknown as Array<{ focal_point: Record<string, unknown> }>) {
      expect(img.focal_point).toMatchObject({ x: 0.5, y: 0.5, zoom: 1, fit: "contain" });
    }
  });

  it("enquadramento por cena: preencher, zoom e cor de fundo são pedidos à sequência", async () => {
    const { user, onImageSequenceChange } = setup();
    // O enquadramento é uma propriedade do elemento "Imagem".
    const props = screen.getByRole("complementary", { name: "Propriedades" });
    await user.click(within(within(props).getByRole("group", { name: "Elemento" })).getByRole("button", { name: "Imagem" }));
    await user.click(within(within(props).getByRole("group", { name: "Enquadramento" })).getByRole("button", { name: "Preencher" }));
    expect(onImageSequenceChange.mock.calls.at(-1)![0][0].focalPoint).toMatchObject({ fit: "cover", zoom: 1 });
    await user.click(within(within(props).getByRole("group", { name: "Preenchimento" })).getByRole("button", { name: "Cor do modelo" }));
    expect(onImageSequenceChange.mock.calls.at(-1)![0][0].focalPoint).toMatchObject({ fill: "color" });
    await user.click(within(props).getByRole("button", { name: "Voltar ao padrão do modelo" }));
    expect(onImageSequenceChange.mock.calls.at(-1)![0][0].focalPoint).toBeNull();
  });

  it("logo: ocultar neste vídeo chega ao render; trocar e remover usam o cadastro da empresa", async () => {
    const { user } = setup();
    const props = screen.getByRole("complementary", { name: "Propriedades" });
    await user.click(within(within(props).getByRole("group", { name: "Elemento" })).getByRole("button", { name: "Logo" }));
    expect(previewSvg()).toContain("https://cdn.test/logo.png");

    const file = new File(["x"], "logo.png", { type: "image/png" });
    await user.upload(within(props).getByLabelText("Arquivo da logo"), file);
    expect(brand.saveLogo).toHaveBeenCalledWith(file);

    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    await user.click(within(props).getByRole("button", { name: "Remover do cadastro" }));
    expect(brand.removeLogo).toHaveBeenCalledTimes(1);
    confirm.mockRestore();

    await user.click(within(props).getByLabelText("Mostrar a logo sobre o vídeo"));
    expect(previewSvg()).not.toContain("https://cdn.test/logo.png");
    await user.click(screen.getByRole("button", { name: "Gerar vídeo" }));
    await waitFor(() => expect(approve).toHaveBeenCalledTimes(1));
    expect(lastPayload().layout.logo.visible).toBe(false);
  });

  it("logo: arquivo inválido é recusado antes do envio; quem não é admin não altera o cadastro", async () => {
    const { user } = setup();
    const props = screen.getByRole("complementary", { name: "Propriedades" });
    await user.click(within(within(props).getByRole("group", { name: "Elemento" })).getByRole("button", { name: "Logo" }));
    const input = within(props).getByLabelText("Arquivo da logo") as HTMLInputElement;
    fireEvent.change(input, { target: { files: [new File(["x"], "logo.gif", { type: "image/gif" })] } });
    expect(within(props).getByRole("alert").textContent).toContain("Formato não suportado");
    expect(brand.saveLogo).not.toHaveBeenCalled();

    cleanup();
    brand.canManage = false;
    setup();
    const again = screen.getByRole("complementary", { name: "Propriedades" });
    await user.click(within(within(again).getByRole("group", { name: "Elemento" })).getByRole("button", { name: "Logo" }));
    expect((within(again).getByRole("button", { name: "Trocar logo" }) as HTMLButtonElement).disabled).toBe(true);
    expect((within(again).getByRole("button", { name: "Remover do cadastro" }) as HTMLButtonElement).disabled).toBe(true);
    expect(again.textContent).toContain("Só administradores");
  });

  it("a galeria mostra o nome completo de cada modelo e as miniaturas não exibem marcador de logo", () => {
    brand.logoUrl = null;
    setup();
    const gallery = screen.getByRole("tabpanel", { name: "Modelos" });
    for (const name of ["Oferta relâmpago", "Últimas unidades", "Faixa promocional", "Capa de revista", "Recorte lateral", "Gradiente vivo"]) {
      const label = within(gallery).getByText(name);
      // Sem reticências: o nome quebra em até duas linhas.
      expect(label.className).toContain("line-clamp-2");
      expect(label.className).not.toContain("truncate");
    }
    // Só a prévia principal oferece o marcador de logo; as miniaturas ficam limpas.
    expect(gallery.textContent).not.toMatch(/Logo/i);
  });

  it("clicar na foto da prévia seleciona a imagem e abre o enquadramento", async () => {
    const { user } = setup();
    const framed = screen.getByTestId("video-studio").querySelector('.lg\\:order-2 [data-fit]') as HTMLElement;
    await user.click(framed);
    const props = screen.getByRole("complementary", { name: "Propriedades" });
    expect(within(props).getByRole("group", { name: "Enquadramento" })).toBeTruthy();
  });

  it("não tem botão sem função: todo botão habilitado tem nome", () => {
    setup();
    for (const button of screen.getAllByRole("button")) {
      expect((button.getAttribute("aria-label") ?? button.textContent ?? "").trim()).not.toBe("");
    }
  });
});
