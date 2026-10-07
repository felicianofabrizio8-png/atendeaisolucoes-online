// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CampaignFramingPreview } from "@/components/marketing/campaign/CampaignFramingPreview";
import { FEED_FRAME, STORY_FRAME, computeFocalCrop } from "@/lib/render-engine/focal-geometry";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

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

describe("CampaignFramingPreview", () => {
  it("renders both formats when an image is selected", () => {
    render(
      <CampaignFramingPreview
        imageUrl="https://example.test/photo.jpg"
        focalPoint={{ x: 0.35, y: 0.65, zoom: 1.4 }}
      />,
    );

    expect(screen.getByTestId("framing-4/5")).toBeTruthy();
    expect(screen.getByTestId("framing-9/16")).toBeTruthy();
    expect(screen.getAllByRole("img")).toHaveLength(2);
  });

  it("mostra a imagem centralizada até conhecer as dimensões reais", () => {
    render(<CampaignFramingPreview imageUrl="https://example.test/photo.jpg" focalPoint={{ x: 0.1, y: 0.9, zoom: 2 }} />);

    for (const img of screen.getAllByRole("img")) {
      expect(img.className).toContain("object-cover");
      expect(img.style.left).toBe("");
      expect(img.style.width).toBe("");
    }
  });

  it("posiciona cada formato com o mesmo corte do render, usando as dimensões reais", async () => {
    const image = { width: 1920, height: 1080 };
    const focal = { x: 0.25, y: 0.65, zoom: 1.4 };
    stubImageSize(image.width, image.height);
    render(<CampaignFramingPreview imageUrl="https://example.test/photo.jpg" focalPoint={focal} />);

    const cases = [
      ["Enquadramento Feed 4:5 (1080×1350)", FEED_FRAME],
      ["Enquadramento Story 9:16 (1080×1920)", STORY_FRAME],
    ] as const;
    for (const [alt, frame] of cases) {
      const crop = computeFocalCrop(image, frame, focal)!;
      await waitFor(() => expect(screen.getByAltText(alt).style.width).not.toBe(""));
      const img = screen.getByAltText(alt);
      expect(parseFloat(img.style.left)).toBeCloseTo(crop.leftPct, 3);
      expect(parseFloat(img.style.top)).toBeCloseTo(crop.topPct, 3);
      expect(parseFloat(img.style.width)).toBeCloseTo(crop.widthPct, 3);
      expect(parseFloat(img.style.height)).toBeCloseTo(crop.heightPct, 3);
      expect(img.style.maxWidth).toBe("none");
      expect(img.className).not.toContain("object-cover");
    }
    // Feed e Story recebem cortes diferentes para o mesmo foco.
    expect(screen.getByAltText(cases[0][0]).style.width).not.toBe(screen.getByAltText(cases[1][0]).style.width);
  });

  it("compacta os frames sem perder as proporções e empilha no mobile", () => {
    render(<CampaignFramingPreview imageUrl="https://example.test/photo.jpg" compact />);

    const feed = screen.getByTestId("framing-4/5");
    const story = screen.getByTestId("framing-9/16");
    const grid = feed.parentElement?.parentElement;

    expect(grid?.className).toContain("grid-cols-1");
    expect(grid?.className).toContain("sm:grid-cols-2");
    expect(feed.className).toContain("h-[150px]");
    expect(feed.getAttribute("style")).toContain("aspect-ratio: 4 / 5");
    expect(story.getAttribute("style")).toContain("aspect-ratio: 9 / 16");
  });
});
