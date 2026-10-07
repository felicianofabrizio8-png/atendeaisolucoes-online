// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FocalPointEditor } from "@/components/marketing/campaign/FocalPointEditor";

afterEach(cleanup);

function renderEditor() {
  return render(
    <FocalPointEditor
      open
      imageUrl="https://example.test/image.jpg"
      initialFocal={{ x: 0.4, y: 0.6, zoom: 1.2 }}
      onCancel={vi.fn()}
      onSave={vi.fn()}
    />,
  );
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
