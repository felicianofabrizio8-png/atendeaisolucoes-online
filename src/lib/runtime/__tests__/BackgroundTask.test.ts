import { describe, expect, it, vi } from "vitest";
import { scheduleBackgroundTask } from "../BackgroundTask.server";

function cloudflareRequest(waitUntil: unknown): Request {
  // Igual ao augmentReq do preset cloudflare-module do Nitro.
  const request = new Request("https://app.test/api/public/hooks/agent-trigger", {
    method: "POST",
  });
  (request as Request & { waitUntil?: unknown }).waitUntil = waitUntil;
  return request;
}

describe("scheduleBackgroundTask", () => {
  it("registra a tarefa no waitUntil exposto pela requisição", () => {
    const waitUntil = vi.fn();
    const task = vi.fn().mockResolvedValue(undefined);
    expect(scheduleBackgroundTask(cloudflareRequest(waitUntil), task)).toBe(true);
    expect(task).toHaveBeenCalledOnce();
    expect(waitUntil).toHaveBeenCalledWith(expect.any(Promise));
  });

  it("não deixa rejeição da tarefa escapar do waitUntil", async () => {
    const waitUntil = vi.fn();
    scheduleBackgroundTask(cloudflareRequest(waitUntil), () => Promise.reject(new Error("boom")));
    await expect(waitUntil.mock.calls[0][0]).resolves.toBeUndefined();
  });

  it("retorna false sem executar quando o runtime não tem waitUntil", () => {
    const task = vi.fn();
    expect(scheduleBackgroundTask(new Request("https://app.test/"), task)).toBe(false);
    expect(scheduleBackgroundTask(cloudflareRequest(undefined), task)).toBe(false);
    expect(task).not.toHaveBeenCalled();
  });
});
