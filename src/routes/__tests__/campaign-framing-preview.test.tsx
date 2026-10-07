// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { CampaignFramingPreview } from "@/components/marketing/campaign/CampaignFramingPreview";

afterEach(cleanup);

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
  });});
