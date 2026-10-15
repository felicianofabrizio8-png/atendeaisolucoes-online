// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FocalPointEditor } from "@/components/marketing/campaign/FocalPointEditor";
import { FEED_FRAME, STORY_FRAME, computeFocalCrop, panFocalPoint } from "@/lib/render-engine/focal-geometry";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const IMAGE = { width: 1920, height: 1080 };

/** Simula o carregamento da imagem com as dimensões reais informadas. */
function stubImageSize(width: number, height: number) {
  class FakeImage {
    onload: (() => void) | null = null;
    naturalWidth = width;
    naturalHeight = height;
    set src(_value: string) {
      queueMicrotask(() => this.onload?.());
    }
  }
  vi.stubGlobal("Image", FakeImage);
}

function renderEditor(initialFocal = { x: 0.4, y: 0.6, zoom: 1.2 }) {
  const onSave = vi.fn();
  render(
    <FocalPointEditor
      open
      imageUrl="https://example.test/image.jpg"
      initialFocal={initialFocal}
      onCancel={vi.fn()}
      onSave={onSave}
    />,
  );
  return onSave;
}

function frameWithSize(width: number, height: number) {
  const frame = screen.getByTestId("focal-frame");
  frame.getBoundingClientRect = () => ({ left: 0, top: 0, right: width, bottom: height, width, height, x: 0, y: 0, toJSON: () => ({}) });
  return frame;
}

function drag(frame: HTMLElement, dx: number, dy: number) {
  fireEvent.pointerDown(frame, { pointerId: 1, clientX: 50, clientY: 50, buttons: 1 });
  fireEvent.pointerMove(frame, { pointerId: 1, clientX: 50 + dx, clientY: 50 + dy, buttons: 1 });
  fireEvent.pointerUp(frame, { pointerId: 1, clientX: 50 + dx, clientY: 50 + dy });
}

describe("FocalPointEditor responsive layout", () => {
  it("keeps the desktop modal within the viewport and exposes primary controls", () => {
    window.innerWidth = 1440;
    renderEditor();

    const dialog = screen.getByRole("dialog");
    expect(dialog.className).toContain("max-h-[92vh]");
    expect(dialog.className).toContain("overflow-hidden");
    expect(screen.getByRole("tab", { name: "Feed 4:5" })).toBeTruthy();
    expect(screen.getByRole("tab", { name: "Story 9:16" })).toBeTruthy();
    expect(screen.getByRole("slider", { name: "Zoom do enquadramento" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Salvar enquadramento" })).toBeTruthy();
  });

  it("uses a width-constrained Story frame and keeps controls available on mobile", async () => {
    window.innerWidth = 390;
    renderEditor();

    const story = screen.getByRole("tab", { name: "Story 9:16" });
    await userEvent.setup().click(story);

    const mainImage = screen.getByAltText("Ajuste de enquadramento para Story 9:16");
    const frame = mainImage.parentElement;
    expect(frame?.className).toContain("max-w-full");
    expect(frame?.className).toContain("h-[48vh]");
    expect(frame?.className).toContain("max-h-[calc(100vw-2rem)]");
    expect(frame?.getAttribute("style")).toContain("aspect-ratio: 0.5625 / 1");
    expect(screen.getByRole("button", { name: "Redefinir" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Salvar enquadramento" })).toBeTruthy();
  });
});

describe("FocalPointEditor — geometria do render", () => {
  it("imagem e marcador seguem o corte do worker para o formato ativo", async () => {
    stubImageSize(IMAGE.width, IMAGE.height);
    const focal = { x: 0.1, y: 0.5, zoom: 1 };
    renderEditor(focal);

    const marker = await screen.findByTestId("focal-marker");
    const story = computeFocalCrop(IMAGE, STORY_FRAME, focal)!;
    const main = screen.getByAltText("Ajuste de enquadramento para Story 9:16");
    expect(parseFloat(main.style.left)).toBeCloseTo(story.leftPct, 3);
    expect(parseFloat(main.style.width)).toBeCloseTo(story.widthPct, 3);
    // foco perto da borda: o corte trava e o marcador aparece onde o foco está de fato
    expect(parseFloat(marker.style.left)).toBeCloseTo(story.markerXPct, 1);
    expect(story.markerXPct).toBeLessThan(50);
    expect(parseFloat(marker.style.top)).toBeCloseTo(50, 1);

    await userEvent.setup().click(screen.getByRole("tab", { name: "Feed 4:5" }));
    const feed = computeFocalCrop(IMAGE, FEED_FRAME, focal)!;
    const feedMain = screen.getByAltText("Ajuste de enquadramento para Feed 4:5");
    expect(parseFloat(feedMain.style.width)).toBeCloseTo(feed.widthPct, 3);
    expect(parseFloat(screen.getByTestId("focal-marker").style.left)).toBeCloseTo(feed.markerXPct, 1);
    // as miniaturas mostram os dois formatos com o mesmo foco
    expect(parseFloat(screen.getByAltText("Prévia Story 9:16").style.width)).toBeCloseTo(story.widthPct, 3);
    expect(parseFloat(screen.getByAltText("Prévia Feed 4:5").style.width)).toBeCloseTo(feed.widthPct, 3);
  });

  it("arrastar move a imagem com o cursor e salva o foco correspondente", async () => {
    stubImageSize(IMAGE.width, IMAGE.height);
    const start = { x: 0.5, y: 0.3, zoom: 1 };
    const onSave = renderEditor(start);
    await screen.findByTestId("focal-marker");

    const frame = frameWithSize(180, 320);
    drag(frame, 36, 64); // 20% do quadro em cada eixo
    await userEvent.setup().click(screen.getByRole("button", { name: "Salvar enquadramento" }));

    const expected = panFocalPoint(IMAGE, STORY_FRAME, start, 0.2, 0.2);
    expect(onSave).toHaveBeenCalledWith(expected);
    expect(expected.x).toBeLessThan(0.5);
    // paisagem em Story não tem sobra vertical: o y salvo é preservado
    expect(expected.y).toBe(0.3);
    const before = computeFocalCrop(IMAGE, STORY_FRAME, start)!;
    const after = computeFocalCrop(IMAGE, STORY_FRAME, expected)!;
    expect(after.leftPct - before.leftPct).toBeCloseTo(20, 1);
  });

  it("arraste além da borda trava no limite", async () => {
    stubImageSize(IMAGE.width, IMAGE.height);
    const onSave = renderEditor({ x: 0.5, y: 0.5, zoom: 1 });
    await screen.findByTestId("focal-marker");

    drag(frameWithSize(180, 320), 5000, 0);
    await userEvent.setup().click(screen.getByRole("button", { name: "Salvar enquadramento" }));

    const saved = onSave.mock.calls[0][0];
    expect(computeFocalCrop(IMAGE, STORY_FRAME, saved)!.leftPct).toBeCloseTo(0, 1);
    expect(saved.x).toBeGreaterThan(0);
  });

  it("sem dimensões da imagem o arraste não altera o foco salvo", async () => {
    const start = { x: 0.4, y: 0.6, zoom: 1.2 };
    const onSave = renderEditor(start);
    expect(screen.queryByTestId("focal-marker")).toBeNull();

    drag(frameWithSize(180, 320), 60, 60);
    await userEvent.setup().click(screen.getByRole("button", { name: "Salvar enquadramento" }));
    expect(onSave).toHaveBeenCalledWith(start);
  });

  it("abrir e salvar sem mexer preserva exatamente o foco existente", async () => {
    stubImageSize(IMAGE.width, IMAGE.height);
    const start = { x: 0.03, y: 0.97, zoom: 2.35 };
    const onSave = renderEditor(start);
    await waitFor(() => expect(screen.getByTestId("focal-marker")).toBeTruthy());
    await userEvent.setup().click(screen.getByRole("button", { name: "Salvar enquadramento" }));
    expect(onSave).toHaveBeenCalledWith(start);
  });
});
