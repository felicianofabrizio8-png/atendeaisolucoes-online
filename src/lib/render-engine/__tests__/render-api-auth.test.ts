import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  authenticateRenderWorker,
  safeEqualSecret,
  deriveOutputVideoPath,
} from "../RenderApiAuth.server";

const SECRET = "test-secret-with-enough-entropy-1234567890";

describe("RenderApiAuth", () => {
  const orig = process.env.RENDER_WORKER_SECRET;
  beforeEach(() => {
    process.env.RENDER_WORKER_SECRET = SECRET;
  });
  afterEach(() => {
    if (orig === undefined) delete process.env.RENDER_WORKER_SECRET;
    else process.env.RENDER_WORKER_SECRET = orig;
  });

  it("safeEqualSecret rejeita valores diferentes", () => {
    expect(safeEqualSecret("a", "b")).toBe(false);
    expect(safeEqualSecret("", "b")).toBe(false);
    expect(safeEqualSecret("abc", "abcd")).toBe(false);
    expect(safeEqualSecret(SECRET, SECRET)).toBe(true);
  });

  it("401 sem header", () => {
    const req = new Request("http://x/api/public/render/claim", { method: "POST" });
    const res = authenticateRenderWorker(req);
    expect(res?.status).toBe(401);
  });

  it("401 com header incorreto", () => {
    const req = new Request("http://x/api/public/render/claim", {
      method: "POST",
      headers: { "x-render-worker-secret": "wrong-value-completely-different-length-x" },
    });
    const res = authenticateRenderWorker(req);
    expect(res?.status).toBe(401);
  });

  it("autoriza com secret correto", () => {
    const req = new Request("http://x/api/public/render/claim", {
      method: "POST",
      headers: { "x-render-worker-secret": SECRET },
    });
    const res = authenticateRenderWorker(req);
    expect(res).toBeNull();
  });

  it("401 quando secret do servidor não está configurado", () => {
    delete process.env.RENDER_WORKER_SECRET;
    const req = new Request("http://x/api/public/render/claim", {
      method: "POST",
      headers: { "x-render-worker-secret": SECRET },
    });
    const res = authenticateRenderWorker(req);
    expect(res?.status).toBe(401);
  });

  it("deriveOutputVideoPath usa company + video id", () => {
    expect(deriveOutputVideoPath("comp-1", "vid-1")).toBe("comp-1/vid-1/video.mp4");
  });
});
