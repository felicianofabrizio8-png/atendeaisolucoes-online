// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CampaignRenderProgress } from "@/components/marketing/campaign/CampaignRenderProgress";
import { RENDER_STALL_MESSAGE } from "@/lib/marketing/render-status";
import type { TrackedCampaign } from "@/lib/marketing/useCampaignRenderTracker";

afterEach(cleanup);

function tracked(story: Partial<TrackedCampaign["story"]>): TrackedCampaign {
  const role = { status: "queued", progress: 0, errorCode: null, videoId: null, jobId: "job-1", stall: null };
  return { campaignId: "c1", createdAt: 0, finishedAt: null, done: false, hasFailure: false, feed: { ...role, status: "completed", videoId: "v-feed", progress: 100 }, story: { ...role, ...story } };
}

describe("progresso do render", () => {
  it("na fila normal mostra o andamento, sem alerta", () => {
    render(<CampaignRenderProgress tracked={tracked({})} onRetry={vi.fn()} />);
    expect(screen.getByRole("progressbar", { name: "Progresso Story 9:16" })).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("REGRESSÃO: fila parada vira aviso com nova tentativa, em vez de girar para sempre", async () => {
    const onRetry = vi.fn();
    render(<CampaignRenderProgress tracked={tracked({ stall: "queue_stalled" })} onRetry={onRetry} />);
    const alert = screen.getByRole("alert");
    expect(alert.textContent).toContain(RENDER_STALL_MESSAGE.queue_stalled);
    expect(screen.queryByRole("progressbar", { name: "Progresso Story 9:16" })).toBeNull();
    await userEvent.setup().click(within(alert).getByRole("button", { name: "Tentar de novo" }));
    expect(onRetry).toHaveBeenCalledWith("story");
  });

  it("processamento que parou no meio também avisa", () => {
    render(<CampaignRenderProgress tracked={tracked({ status: "processing", progress: 40, stall: "processing_stalled" })} onRetry={vi.fn()} />);
    expect(screen.getByRole("alert").textContent).toContain(RENDER_STALL_MESSAGE.processing_stalled);
  });
});
