// @vitest-environment jsdom
import React from "react";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { CampaignRenderProgress } from "@/components/marketing/campaign/CampaignRenderProgress";
import type { TrackedCampaign } from "@/lib/marketing/useCampaignRenderTracker";

beforeEach(() => {
  vi.stubGlobal("matchMedia", () => ({
    matches: true,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
  }));
});
afterEach(cleanup);
const base = (): TrackedCampaign => ({
  campaignId: "sample",
  createdAt: 1,
  finishedAt: null,
  done: false,
  hasFailure: false,
  feed: { status: "rendering", progress: 37, errorCode: null, videoId: null, jobId: "feed-job" },
  story: { status: "queued", progress: 0, errorCode: null, videoId: null, jobId: "story-job" },
});

describe("Lume render feedback", () => {
  it("keeps the actual progress accessible while animating its visual representation", () => {
    render(<CampaignRenderProgress tracked={base()} onRetry={vi.fn()} />);
    expect(
      screen.getByRole("progressbar", { name: "Progresso Feed 4:5" }).getAttribute("aria-valuenow"),
    ).toBe("37");
    expect(
      screen
        .getByRole("progressbar", { name: "Progresso Story 9:16" })
        .getAttribute("aria-valuenow"),
    ).toBe("0");
    expect(screen.queryByRole("button", { name: "Tentar de novo" })).toBeNull();
  });
  it("retries only the failed format and does not offer retry for the completed video", () => {
    const tracked = base();
    tracked.done = true;
    tracked.hasFailure = true;
    tracked.feed.status = "failed";
    tracked.feed.errorCode = "render_failed";
    tracked.story.videoId = "ready";
    const retry = vi.fn();
    render(<CampaignRenderProgress tracked={tracked} onRetry={retry} />);
    fireEvent.click(screen.getByRole("button", { name: "Tentar de novo" }));
    expect(retry).toHaveBeenCalledExactlyOnceWith("feed");
    expect(screen.getByText("Vídeo pronto")).toBeTruthy();
    expect(screen.queryByRole("progressbar")).toBeNull();
  });
  it("shows completion only when the tracker reports both outputs done", () => {
    const tracked = base();
    tracked.done = true;
    tracked.feed.videoId = "feed";
    tracked.story.videoId = "story";
    render(<CampaignRenderProgress tracked={tracked} onRetry={vi.fn()} />);
    expect(screen.getAllByText("Vídeo pronto")).toHaveLength(2);
    expect(screen.getByText("Concluído")).toBeTruthy();
  });
});
