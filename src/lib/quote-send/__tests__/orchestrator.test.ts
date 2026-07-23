import { describe, it, expect, vi } from "vitest";
import { runQuoteSendBatch, type BlockSendResult } from "../orchestrator";
import type { NormalizedQuoteSendError } from "../errors";

const okResult = (): BlockSendResult => ({ ok: true, externalMessageId: `wamid.${Math.random()}` });
const failResult = (code: NormalizedQuoteSendError["code"] = "network_error", retryable = true): BlockSendResult => ({
  ok: false,
  normalized: {
    code,
    message: "x",
    step: "invoke",
    status: 500,
    retryable,
    technicalDetails: {},
  },
});

type K = "photos" | "base" | "inclusos";
const blocks: Array<{ key: K }> = [{ key: "photos" }, { key: "base" }, { key: "inclusos" }];

describe("orchestrator — envio em lote", () => {
  it("1. blocos são enviados em ordem", async () => {
    const seen: K[] = [];
    const out = await runQuoteSendBatch<K>({
      blocks,
      sendOne: async (b) => {
        seen.push(b.key);
        return okResult();
      },
    });
    expect(seen).toEqual(["photos", "base", "inclusos"]);
    expect(out.completed).toBe(3);
    expect(out.failedAt).toBeNull();
  });

  it("2. bloco seguinte NÃO executa quando o atual falha", async () => {
    const seen: K[] = [];
    const out = await runQuoteSendBatch<K>({
      blocks,
      sendOne: async (b) => {
        seen.push(b.key);
        if (b.key === "base") return failResult("graph_api_rejected", false);
        return okResult();
      },
    });
    expect(seen).toEqual(["photos", "base"]);
    expect(out.completed).toBe(1);
    expect(out.failedAt?.key).toBe("base");
    expect(out.failedAt?.blockIndex).toBe(1);
  });

  it("3. sendOne recebe sempre o mesmo attemptId da tentativa", async () => {
    const ids = new Set<string>();
    await runQuoteSendBatch<K>({
      blocks,
      sendOne: async (_b, ctx) => {
        ids.add(ctx.attemptId);
        return okResult();
      },
    });
    expect(ids.size).toBe(1);
  });

  it("4. tentativa nova recebe novo attemptId", async () => {
    const spy = vi.fn(async () => okResult());
    const a = await runQuoteSendBatch<K>({ blocks, sendOne: spy });
    const b = await runQuoteSendBatch<K>({ blocks, sendOne: spy });
    expect(a.attemptId).not.toBe(b.attemptId);
  });

  it("5. attemptId explícito é preservado (continuação de retry manual)", async () => {
    const out = await runQuoteSendBatch<K>({
      blocks: [{ key: "photos" }],
      attemptId: "qs_test_ABCDEF12",
      sendOne: async () => okResult(),
    });
    expect(out.attemptId).toBe("qs_test_ABCDEF12");
  });

  it("6. falha no bloco 2 preserva evidência de que o bloco 1 foi concluído", async () => {
    const out = await runQuoteSendBatch<K>({
      blocks,
      sendOne: async (b) => (b.key === "base" ? failResult() : okResult()),
    });
    expect(out.completedKeys).toEqual(["photos"]);
    expect(out.completed).toBe(1);
    expect(out.total).toBe(3);
  });

  it("7. retry do lote é INSEGURO quando ao menos um bloco foi concluído (risco de duplicidade)", async () => {
    const out = await runQuoteSendBatch<K>({
      blocks,
      sendOne: async (b) => (b.key === "base" ? failResult() : okResult()),
    });
    expect(out.canRetryWithoutDuplication).toBe(false);
  });

  it("8. retry do lote é SEGURO quando falha ocorre já no primeiro bloco", async () => {
    const out = await runQuoteSendBatch<K>({
      blocks,
      sendOne: async () => failResult("session_expired", true),
    });
    expect(out.completed).toBe(0);
    expect(out.canRetryWithoutDuplication).toBe(true);
  });

  it("9. sucesso completo => canRetryWithoutDuplication=false (não há falha)", async () => {
    const out = await runQuoteSendBatch<K>({
      blocks,
      sendOne: async () => okResult(),
    });
    expect(out.failedAt).toBeNull();
    expect(out.canRetryWithoutDuplication).toBe(false);
  });

  it("10. onProgress recebe cada resultado em ordem", async () => {
    const events: number[] = [];
    await runQuoteSendBatch<K>({
      blocks,
      sendOne: async () => okResult(),
      onProgress: (evt) => events.push(evt.blockIndex),
    });
    expect(events).toEqual([0, 1, 2]);
  });
});
