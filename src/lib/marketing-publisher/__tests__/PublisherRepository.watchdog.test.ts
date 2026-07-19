// Testes do watchdog de publicações órfãs: garante que publicações antigas
// presas em 'publishing' voltem para 'queued', enquanto as recentes não
// sejam tocadas. Não faz I/O real — mocka o client admin.

import { describe, it, expect, vi, beforeEach } from "vitest";

const capturedFilters: Record<string, unknown> = {};
let updatePayload: Record<string, unknown> | null = null;
let returnedRows: { id: string }[] = [];

vi.mock("@/integrations/supabase/client.server", () => {
  return {
    supabaseAdmin: {
      from: (_t: string) => {
        const chain: any = {
          update(payload: Record<string, unknown>) {
            updatePayload = payload;
            return chain;
          },
          eq(k: string, v: unknown) {
            capturedFilters[`eq_${k}`] = v;
            return chain;
          },
          not(k: string, _op: string, v: unknown) {
            capturedFilters[`not_${k}`] = v;
            return chain;
          },
          lte(k: string, v: unknown) {
            capturedFilters[`lte_${k}`] = v;
            return chain;
          },
          is(k: string, v: unknown) {
            capturedFilters[`is_${k}`] = v;
            return chain;
          },
          select() {
            return Promise.resolve({ data: returnedRows, error: null });
          },
        };
        return chain;
      },
    },
  };
});

import { PublisherRepository } from "../PublisherRepository.server";

describe("PublisherRepository.recoverOrphans", () => {
  beforeEach(() => {
    for (const k of Object.keys(capturedFilters)) delete capturedFilters[k];
    updatePayload = null;
    returnedRows = [];
  });

  it("filtra por status=publishing, locked_at antigo e devolve para queued preservando pending", async () => {
    returnedRows = [{ id: "pub-1" }, { id: "pub-2" }];
    const repo = new PublisherRepository();
    const n = await repo.recoverOrphans(10 * 60_000);
    expect(n).toBe(2);
    expect(capturedFilters.eq_status).toBe("publishing");
    expect(capturedFilters.lte_locked_at).toBeDefined();
    expect(updatePayload).toMatchObject({
      status: "queued",
      locked_by: null,
      locked_at: null,
    });
    // Não fabrica ID Meta e não zera platform_response/platform_post_id/retry_count.
    expect(updatePayload).not.toHaveProperty("platform_post_id");
    expect(updatePayload).not.toHaveProperty("platform_response");
    expect(updatePayload).not.toHaveProperty("retry_count");
  });

  it("sem órfãs retorna 0", async () => {
    returnedRows = [];
    const repo = new PublisherRepository();
    const n = await repo.recoverOrphans();
    expect(n).toBe(0);
  });
});
