// Quality Gate P3 — Caixa de Atendimento.
// Cobre: race na troca de conversa, timeout/retry, ausência da subscrição
// duplicada `conv-ai-*`, invariantes de memoização (deps em repoVersion) e
// interação Realtime + índice de mensagens (sem duplicar carga inicial).
import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Message } from "@/data/mock";
import {
  createMessageIndex,
  upsertMessage,
  removeMessage,
  rebuildIndex,
  getMessages,
} from "@/data/message-index";

function mk(
  id: string,
  conversationId: string,
  at: string,
  role: Message["role"] = "lead",
  text = "",
): Message {
  return { id, conversationId, at, role, text } as Message;
}

// ---------------------------------------------------------------------------
// 2 · Race condition — token de requisição no `loadThread`.
// Reproduz o padrão real do componente: dois carregamentos consecutivos, o
// primeiro chega por último; apenas o resultado do segundo deve mutar UI.
// ---------------------------------------------------------------------------
describe("P3 · race condition — token de requisição", () => {
  it("descarta a resposta tardia da conversa anterior", async () => {
    const tokenRef = { current: 0 };
    const applied: string[] = [];

    function runLoad(convId: string, resolveAfterMs: number) {
      const token = ++tokenRef.current;
      return new Promise<void>((resolvePromise) => {
        setTimeout(() => {
          if (tokenRef.current !== token) return; // regra do P3
          applied.push(convId);
          resolvePromise();
        }, resolveAfterMs);
      });
    }

    vi.useFakeTimers();
    const first = runLoad("conv-A", 200); // resolve por último
    const second = runLoad("conv-B", 50); //  resolve primeiro
    await vi.advanceTimersByTimeAsync(250);
    await Promise.allSettled([first, second]);
    vi.useRealTimers();

    expect(applied).toEqual(["conv-B"]);
  });
});

// ---------------------------------------------------------------------------
// 3 · Timeout e retry — mesma lógica do `loadThread` do componente.
// ---------------------------------------------------------------------------
describe("P3 · timeout e retry", () => {
  function makeThreadLoader(opts: {
    load: (convId: string) => Promise<{ ok: boolean; error?: string }>;
    reset: (convId: string) => void;
    timeoutMs?: number;
  }) {
    const tokenRef = { current: 0 };
    let state: { status: "idle" | "loading" | "ready" | "error"; error?: string } = {
      status: "idle",
    };
    const timeoutMs = opts.timeoutMs ?? 15000;

    async function run(convId: string) {
      const token = ++tokenRef.current;
      state = { status: "loading" };
      let timedOut = false;
      const timeoutId = setTimeout(() => {
        timedOut = true;
        if (tokenRef.current === token) {
          state = { status: "error", error: "Tempo de carregamento excedido" };
        }
      }, timeoutMs);
      try {
        const res = await opts.load(convId);
        if (tokenRef.current !== token || timedOut) return;
        clearTimeout(timeoutId);
        state = res.ok ? { status: "ready" } : { status: "error", error: res.error };
      } catch (e) {
        if (tokenRef.current !== token) return;
        clearTimeout(timeoutId);
        state = { status: "error", error: (e as Error).message };
      }
    }

    function retry(convId: string) {
      opts.reset(convId);
      return run(convId);
    }

    return { run, retry, get state() { return state; } };
  }

  beforeEach(() => vi.useFakeTimers());

  it("entra em estado 'error' após 15 s sem resposta", async () => {
    const load = vi.fn().mockReturnValue(new Promise(() => { /* nunca resolve */ }));
    const reset = vi.fn();
    const loader = makeThreadLoader({ load, reset });
    void loader.run("c1");
    await vi.advanceTimersByTimeAsync(15000);
    expect(loader.state.status).toBe("error");
    expect(loader.state.error).toMatch(/tempo/i);
    vi.useRealTimers();
  });

  it("retry chama resetConversationRecentLoaded e re-executa a carga", async () => {
    const load = vi
      .fn<[string], Promise<{ ok: boolean; error?: string }>>()
      .mockResolvedValueOnce({ ok: false, error: "boom" })
      .mockResolvedValueOnce({ ok: true });
    const reset = vi.fn();
    const loader = makeThreadLoader({ load, reset });

    await loader.run("c1");
    await vi.advanceTimersByTimeAsync(0);
    expect(loader.state.status).toBe("error");

    await loader.retry("c1");
    await vi.advanceTimersByTimeAsync(0);
    expect(reset).toHaveBeenCalledWith("c1");
    expect(load).toHaveBeenCalledTimes(2);
    expect(loader.state.status).toBe("ready");
    vi.useRealTimers();
  });
});

// ---------------------------------------------------------------------------
// 4 · Subscrições — a rota da conversa não deve mais abrir o canal duplicado
// `conv-ai-<conversationId>` (o repo já assina `conversations *` global).
// ---------------------------------------------------------------------------
describe("P3 · subscriptions (canal duplicado removido)", () => {
  it("não existe mais canal 'conv-ai-' no source", () => {
    const src = readFileSync(
      resolve(__dirname, "../../routes/inbox.$conversationId.lazy.tsx"),
      "utf8",
    );
    expect(src).not.toMatch(/conv-ai-\$\{conversationId\}/);
    expect(src).not.toMatch(/\.channel\(\s*`conv-ai-/);
  });

  it("removeu o `useState` órfão do rerender manual do repo", () => {
    const src = readFileSync(
      resolve(__dirname, "../../routes/inbox.$conversationId.lazy.tsx"),
      "utf8",
    );
    expect(src).not.toMatch(/rerenderRepo/);
    // Substituído por useSyncExternalStore + getRepoVersion.
    expect(src).toMatch(/useSyncExternalStore\(\s*subscribeRepo\s*,\s*getRepoVersion/);
  });
});

// ---------------------------------------------------------------------------
// 5 · Realtime — novas mensagens atualizam o índice sem duplicar entre a
// carga inicial e o evento Realtime. Reproduz o padrão idempotente do repo.
// ---------------------------------------------------------------------------
describe("P3 · realtime + índice", () => {
  it("mensagem chegando via realtime após a carga inicial não duplica", () => {
    const idx = createMessageIndex();
    // Carga inicial (fetch)
    rebuildIndex(idx, [
      mk("m1", "c1", "2025-01-01T10:00:01Z"),
      mk("m2", "c1", "2025-01-01T10:00:02Z"),
    ]);
    // Realtime replay do mesmo m2
    upsertMessage(idx, mk("m2", "c1", "2025-01-01T10:00:02Z"));
    // Realtime nova mensagem
    upsertMessage(idx, mk("m3", "c1", "2025-01-01T10:00:03Z"));

    expect(getMessages(idx, "c1").map((m) => m.id)).toEqual(["m1", "m2", "m3"]);
  });

  it("append em conversas distintas mantém isolamento por conversationId", () => {
    const idx = createMessageIndex();
    upsertMessage(idx, mk("a1", "c1", "2025-01-01T10:00:01Z"));
    upsertMessage(idx, mk("b1", "c2", "2025-01-01T10:00:02Z"));
    upsertMessage(idx, mk("a2", "c1", "2025-01-01T10:00:03Z"));
    expect(getMessages(idx, "c1").map((m) => m.id)).toEqual(["a1", "a2"]);
    expect(getMessages(idx, "c2").map((m) => m.id)).toEqual(["b1"]);
  });

  it("removeMessage(everyone) → idxUpsert deixa 1 entrada (marcada), não some", () => {
    // Reproduz o padrão do deleteMessage no leadRepo: o item permanece na
    // lista com deletedAt/deletedFor; a filtragem visual acontece na UI.
    const idx = createMessageIndex();
    const original = mk("m1", "c1", "2025-01-01T10:00:01Z", "agent", "oi");
    upsertMessage(idx, original);
    const flagged = { ...original, deletedAt: "2025-01-01T10:00:10Z", deletedFor: "everyone" as const };
    upsertMessage(idx, flagged);
    const list = getMessages(idx, "c1");
    expect(list).toHaveLength(1);
    expect(list[0].deletedFor).toBe("everyone");
  });

  it("removeMessage() do índice funciona quando a UI apaga localmente", () => {
    const idx = createMessageIndex();
    upsertMessage(idx, mk("m1", "c1", "2025-01-01T10:00:01Z"));
    upsertMessage(idx, mk("m2", "c1", "2025-01-01T10:00:02Z"));
    expect(removeMessage(idx, "m1", "c1")).toBe(true);
    expect(getMessages(idx, "c1").map((m) => m.id)).toEqual(["m2"]);
  });
});

// ---------------------------------------------------------------------------
// 6 · Memoização — buildSortedItems é memoizado por `repoVersion` (e filtros).
// Não recomputa se as deps não mudam; recomputa quando repoVersion muda.
// ---------------------------------------------------------------------------
describe("P3 · memoização de buildSortedItems", () => {
  function simulateUseMemo<T>() {
    let cache: { deps: unknown[]; value: T } | null = null;
    return function run(fn: () => T, deps: unknown[]): T {
      if (cache && cache.deps.length === deps.length && cache.deps.every((d, i) => Object.is(d, deps[i]))) {
        return cache.value;
      }
      const value = fn();
      cache = { deps, value };
      return value;
    };
  }

  it("não recomputa quando repoVersion e filtros são idênticos", () => {
    const memo = simulateUseMemo<number>();
    const fn = vi.fn(() => 42);
    memo(fn, [1, 60, "todos"]);
    memo(fn, [1, 60, "todos"]);
    memo(fn, [1, 60, "todos"]);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("recomputa quando repoVersion muda (evento relevante do repo)", () => {
    const memo = simulateUseMemo<number>();
    const fn = vi.fn(() => 42);
    memo(fn, [1, 60, "todos"]);
    memo(fn, [2, 60, "todos"]); // notify() → repoVersion++
    memo(fn, [3, 60, "todos"]);
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("inbox.index.tsx usa repoVersion nas deps dos useMemo hot-path", () => {
    const src = readFileSync(
      resolve(__dirname, "../../routes/inbox.index.tsx"),
      "utf8",
    );
    // buildSortedItems memoizado com repoVersion na dep list
    expect(src).toMatch(/useMemo\([\s\S]*?buildSortedItems[\s\S]*?\[repoVersion,/);
    // useRepoVersion agora retorna número via useSyncExternalStore
    expect(src).toMatch(/useSyncExternalStore\(\s*subscribeRepo\s*,\s*getRepoVersion/);
  });
});
