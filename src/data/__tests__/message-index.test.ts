import { describe, it, expect } from "vitest";
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

describe("message-index (P3)", () => {
  it("upsert insere ordenado por 'at' e sem duplicidade", () => {
    const idx = createMessageIndex();
    upsertMessage(idx, mk("m2", "c1", "2025-01-01T10:00:02Z"));
    upsertMessage(idx, mk("m1", "c1", "2025-01-01T10:00:01Z"));
    upsertMessage(idx, mk("m3", "c1", "2025-01-01T10:00:03Z"));
    // Duplicado: mesmo id — não gera segunda entrada.
    upsertMessage(idx, mk("m2", "c1", "2025-01-01T10:00:02Z", "lead", "atualizado"));

    const list = getMessages(idx, "c1");
    expect(list.map((m) => m.id)).toEqual(["m1", "m2", "m3"]);
    expect(list.find((m) => m.id === "m2")?.text).toBe("atualizado");
  });

  it("upsert reposiciona quando 'at' muda", () => {
    const idx = createMessageIndex();
    upsertMessage(idx, mk("a", "c1", "2025-01-01T10:00:01Z"));
    upsertMessage(idx, mk("b", "c1", "2025-01-01T10:00:02Z"));
    upsertMessage(idx, mk("a", "c1", "2025-01-01T10:00:03Z")); // move p/ o final
    expect(getMessages(idx, "c1").map((m) => m.id)).toEqual(["b", "a"]);
  });

  it("getMessages retorna apenas a conversa pedida", () => {
    const idx = createMessageIndex();
    upsertMessage(idx, mk("x", "c1", "2025-01-01T10:00:01Z"));
    upsertMessage(idx, mk("y", "c2", "2025-01-01T10:00:02Z"));
    upsertMessage(idx, mk("z", "c1", "2025-01-01T10:00:03Z"));
    expect(getMessages(idx, "c1").map((m) => m.id)).toEqual(["x", "z"]);
    expect(getMessages(idx, "c2").map((m) => m.id)).toEqual(["y"]);
    expect(getMessages(idx, "inexistente")).toEqual([]);
  });

  it("removeMessage remove pelo id (com e sem conversationId)", () => {
    const idx = createMessageIndex();
    upsertMessage(idx, mk("a", "c1", "2025-01-01T10:00:01Z"));
    upsertMessage(idx, mk("b", "c1", "2025-01-01T10:00:02Z"));
    upsertMessage(idx, mk("c", "c2", "2025-01-01T10:00:03Z"));

    expect(removeMessage(idx, "a", "c1")).toBe(true);
    expect(getMessages(idx, "c1").map((m) => m.id)).toEqual(["b"]);

    // sem convId — varredura
    expect(removeMessage(idx, "c")).toBe(true);
    expect(getMessages(idx, "c2")).toEqual([]);

    // não existente
    expect(removeMessage(idx, "zzz")).toBe(false);
  });

  it("rebuildIndex agrupa e ordena tudo", () => {
    const idx = createMessageIndex();
    upsertMessage(idx, mk("stale", "c9", "2025-01-01T10:00:01Z")); // será limpo
    rebuildIndex(idx, [
      mk("m3", "c1", "2025-01-01T10:00:03Z"),
      mk("n1", "c2", "2025-01-01T10:00:01Z"),
      mk("m1", "c1", "2025-01-01T10:00:01Z"),
      mk("m2", "c1", "2025-01-01T10:00:02Z"),
    ]);
    expect(getMessages(idx, "c9")).toEqual([]);
    expect(getMessages(idx, "c1").map((m) => m.id)).toEqual(["m1", "m2", "m3"]);
    expect(getMessages(idx, "c2").map((m) => m.id)).toEqual(["n1"]);
  });

  it("empates de 'at' são estáveis por id (sort determinístico)", () => {
    const idx = createMessageIndex();
    const t = "2025-01-01T10:00:00Z";
    upsertMessage(idx, mk("b", "c1", t));
    upsertMessage(idx, mk("a", "c1", t));
    upsertMessage(idx, mk("c", "c1", t));
    expect(getMessages(idx, "c1").map((m) => m.id)).toEqual(["a", "b", "c"]);
  });
});
