import { describe, expect, it } from "vitest";
import { isActiveMarketingRenderStatus, resolveMarketingRenderState } from "../render-status";

describe("marketing render status", () => {
  it.each(["queued", "processing"] as const)("marks %s as active", (status) => {
    const result = resolveMarketingRenderState({
      jobId: "job-1",
      role: { job_id: "job-1", job: { status, progress: 42, error_code: null }, video_id: null },
    });
    expect(result.status).toBe(status);
    expect(isActiveMarketingRenderStatus(result.status)).toBe(true);
  });

  it.each(["completed", "failed", "cancelled"] as const)("does not mark %s as active", (status) => {
    const result = resolveMarketingRenderState({
      jobId: "job-1",
      role: { job_id: "job-1", job: { status, progress: 100, error_code: status === "failed" ? "ffmpeg_failed" : null }, video_id: null },
    });
    expect(result.status).toBe(status);
    expect(isActiveMarketingRenderStatus(result.status)).toBe(false);
  });

  it("marks a linked but unavailable job as missing", () => {
    const result = resolveMarketingRenderState({ jobId: "job-stale", role: { job_id: "job-stale", job: null, video_id: null } });
    expect(result.status).toBe("missing");
    expect(result.errorCode).toBe("job_not_found");
    expect(isActiveMarketingRenderStatus(result.status)).toBe(false);
  });

  it("does not infer completion from a job id alone", () => {
    const result = resolveMarketingRenderState({ jobId: "job-1", role: { job_id: "job-1", job: { status: "processing" }, video_id: null } });
    expect(result.status).toBe("processing");
    expect(result.videoId).toBeNull();
  });
});