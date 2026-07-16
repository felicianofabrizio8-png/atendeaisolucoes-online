// Testes do PublisherWorker: verifica sucesso, retry com backoff e falha final,
// mockando MetaPublisher e PublisherRepository. Não faz I/O real.

import { describe, it, expect, vi, beforeEach } from "vitest";

// Mocks precisam ser declarados antes de importar o alvo.
vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: {
    from: () => ({
      update: () => ({ eq: () => Promise.resolve({ data: null, error: null }) }),
    }),
  },
}));

import { PublisherWorker } from "../PublisherWorker.server";
import type { PublicationRow } from "../types";

function buildRow(partial: Partial<PublicationRow> = {}): PublicationRow {
  return {
    id: "pub-1",
    company_id: "c1",
    schedule_id: "s1",
    content_id: "ct1",
    channel: "instagram",
    format: "feed",
    status: "publishing",
    platform_post_id: null,
    platform_response: null,
    error_code: null,
    error_message: null,
    retry_count: 0,
    attempt_log: [],
    locked_by: "w1",
    locked_at: new Date().toISOString(),
    available_at: new Date().toISOString(),
    published_at: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...partial,
  };
}

describe("PublisherWorker.tick", () => {
  let repo: any;
  let planner: any;
  let publisher: any;

  beforeEach(() => {
    repo = {
      claimNext: vi.fn(),
      markPublished: vi.fn().mockResolvedValue(undefined),
      markFailedOrRetry: vi.fn(),
    };
    planner = { materializeDue: vi.fn().mockResolvedValue(0) };
    publisher = { publish: vi.fn() };
  });

  it("sucesso: marca publicado e conta em `succeeded`", async () => {
    const row = buildRow();
    repo.claimNext.mockResolvedValueOnce(row).mockResolvedValueOnce(null);
    publisher.publish.mockResolvedValueOnce({
      success: true,
      simulated: false,
      platformPostId: "IG_123",
      platformResponse: { id: "IG_123" },
    });
    const w = new PublisherWorker(repo, planner, publisher);
    const r = await w.tick({ workerId: "w1" });
    expect(r.claimed).toBe(1);
    expect(r.succeeded).toBe(1);
    expect(r.failed).toBe(0);
    expect(repo.markPublished).toHaveBeenCalledTimes(1);
  });

  it("erro retryable: chama markFailedOrRetry e conta em `retriedLater`", async () => {
    const row = buildRow({ retry_count: 0 });
    repo.claimNext.mockResolvedValueOnce(row).mockResolvedValueOnce(null);
    publisher.publish.mockResolvedValueOnce({
      success: false,
      simulated: false,
      platformPostId: null,
      platformResponse: null,
      errorCode: "network_error",
      errorMessage: "timeout",
      retryable: true,
    });
    repo.markFailedOrRetry.mockResolvedValueOnce({ finalStatus: "queued" });
    const w = new PublisherWorker(repo, planner, publisher);
    const r = await w.tick({ workerId: "w1" });
    expect(r.retriedLater).toBe(1);
    expect(r.failed).toBe(0);
    expect(repo.markFailedOrRetry).toHaveBeenCalledWith(
      expect.objectContaining({ retryable: true, errorCode: "network_error" }),
    );
  });

  it("dead-letter: retryCount alto vira 'failed'", async () => {
    const row = buildRow({ retry_count: 3 });
    repo.claimNext.mockResolvedValueOnce(row).mockResolvedValueOnce(null);
    publisher.publish.mockResolvedValueOnce({
      success: false,
      simulated: false,
      platformPostId: null,
      platformResponse: null,
      errorCode: "http_5xx",
      errorMessage: "500",
      retryable: true,
    });
    repo.markFailedOrRetry.mockResolvedValueOnce({ finalStatus: "failed" });
    const w = new PublisherWorker(repo, planner, publisher);
    const r = await w.tick({ workerId: "w1" });
    expect(r.failed).toBe(1);
    expect(r.retriedLater).toBe(0);
  });

  it("simulado (staging): conta em `simulated` e NÃO conta em `succeeded`", async () => {
    const row = buildRow();
    repo.claimNext.mockResolvedValueOnce(row).mockResolvedValueOnce(null);
    publisher.publish.mockResolvedValueOnce({
      success: true,
      simulated: true,
      platformPostId: null,
      platformResponse: { simulated: true },
    });
    const w = new PublisherWorker(repo, planner, publisher);
    const r = await w.tick({ workerId: "w1" });
    expect(r.simulated).toBe(1);
    expect(r.succeeded).toBe(0);
  });

  it("fila vazia: nada a fazer", async () => {
    repo.claimNext.mockResolvedValueOnce(null);
    const w = new PublisherWorker(repo, planner, publisher);
    const r = await w.tick({ workerId: "w1" });
    expect(r.claimed).toBe(0);
  });
});
