// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CampaignImageList, type CampaignImageItem } from "@/components/marketing/campaign/CampaignImageList";

afterEach(cleanup);

const item = (previewUrl: string | null): CampaignImageItem => ({
  key: "media-1",
  origin: "marketing",
  media_id: "media-1",
  previewUrl,
});

describe("CampaignImageList framing action", () => {
  it("keeps a labeled framing action visible and calls the existing callback", async () => {
    const user = userEvent.setup();
    const onEditFocal = vi.fn();
    render(
      <CampaignImageList
        items={[item("https://example.test/image.jpg")]}
        onReorder={vi.fn()}
        onRemove={vi.fn()}
        onMakePrimary={vi.fn()}
        onEditFocal={onEditFocal}
      />,
    );

    const action = screen.getByRole("button", { name: "Ajustar enquadramento da imagem 1" });
    expect(action.hasAttribute("disabled")).toBe(false);
    await user.click(action);
    expect(onEditFocal).toHaveBeenCalledWith("media-1");
  });

  it("keeps the action disabled until the preview URL is ready", () => {
    render(
      <CampaignImageList
        items={[item(null)]}
        onReorder={vi.fn()}
        onRemove={vi.fn()}
        onMakePrimary={vi.fn()}
        onEditFocal={vi.fn()}
      />,
    );

    expect(screen.getByRole("button", { name: "Ajustar enquadramento da imagem 1" }).hasAttribute("disabled")).toBe(true);
  });
});
