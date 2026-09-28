import { beforeEach, describe, expect, it, vi } from "vitest";

// Banco com uma conversa longa; o builder respeita order/limit como o PostgREST.
const db = vi.hoisted(() => ({
  messages: [] as Array<Record<string, unknown>>,
  orders: [] as Array<{ column: string; ascending: boolean }>,
}));

vi.mock("@/integrations/supabase/client", () => {
  function query() {
    const state = { conversationId: "", ascending: true, limit: Infinity };
    const builder = {
      select: () => builder,
      eq: (_column: string, value: string) => {
        state.conversationId = value;
        return builder;
      },
      order: (column: string, opts: { ascending: boolean }) => {
        db.orders.push({ column, ascending: opts.ascending });
        state.ascending = opts.ascending;
        return builder;
      },
      limit: (n: number) => {
        state.limit = n;
        return builder;
      },
      then: (resolve: (value: unknown) => unknown) => {
        const rows = db.messages
          .filter((m) => m.conversation_id === state.conversationId)
          .sort((a, b) => String(a.at).localeCompare(String(b.at)) * (state.ascending ? 1 : -1))
          .slice(0, state.limit);
        return Promise.resolve({ data: rows, error: null }).then(resolve);
      },
    };
    return builder;
  }
  return { supabase: { from: () => query() } };
});

import { getMessagesFor, refetchConversationMessages, setRepoMode } from "@/data/leadRepo";

function row(i: number) {
  return {
    id: `msg-${i}`,
    conversation_id: "conv-long",
    role: i % 2 ? "agent" : "lead",
    text: `mensagem ${i}`,
    at: new Date(Date.UTC(2026, 8, 1, 0, i)).toISOString(),
  };
}

describe("refetchConversationMessages", () => {
  beforeEach(() => {
    db.orders = [];
    db.messages = Array.from({ length: 250 }, (_, i) => row(i));
    setRepoMode("remote");
  });

  it("traz a mensagem mais nova mesmo em conversa com mais de 200 mensagens", async () => {
    await refetchConversationMessages("conv-long");

    expect(db.orders).toEqual([{ column: "at", ascending: false }]);
    const ids = getMessagesFor("conv-long").map((m) => m.id);
    expect(ids).toContain("msg-249");
    // O índice continua em ordem cronológica, apesar da busca decrescente.
    const times = getMessagesFor("conv-long").map((m) => m.at);
    expect([...times].sort()).toEqual(times);
  });
});
