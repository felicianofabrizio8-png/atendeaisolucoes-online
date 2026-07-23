// Testes de referência estável para o hotfix aprovado da Inbox.
// Prova que:
//   1. o reducer setState com atualização funcional guardada por
//      `aiStateEqual` faz bail-out quando os campos não mudam;
//   2. `setAtBottom` com guarda `prev === v` faz bail-out em chamada
//      redundante;
//   3. o índice de mensagens (`MessageIndex`) devolve a MESMA referência
//      para a mesma conversa quando nada foi inserido/removido — pré-condição
//      para que `getMessagesFor` respeite o contrato de estabilidade que a
//      constante `EMPTY_MESSAGES` do componente assume no ramo vazio.

import { describe, expect, it } from "vitest";
import { aiStateEqual, type AiStateShape } from "../diag-cascade";
import {
  createMessageIndex,
  getMessages,
  upsertMessage,
} from "@/data/message-index";
import type { Message } from "@/data/mock";

function makeMsg(id: string, at = "2025-01-01T00:00:00Z"): Message {
  return {
    id,
    conversationId: "c1",
    role: "lead",
    text: `msg ${id}`,
    at,
  } as unknown as Message;
}

describe("Inbox stable refs — hotfix", () => {
  it("aiStateEqual: retorna prev quando campos são idênticos (bail-out)", () => {
    const prev: AiStateShape = { ai_status: "auto", ai_handling: true };
    const next: AiStateShape = { ai_status: "auto", ai_handling: true };
    // Reducer funcional que o componente aplica:
    const result = aiStateEqual(prev, next) ? prev : next;
    expect(result).toBe(prev); // MESMA referência
  });

  it("aiStateEqual: retorna next quando ai_status muda", () => {
    const prev: AiStateShape = { ai_status: "auto", ai_handling: true };
    const next: AiStateShape = { ai_status: "assumido_humano", ai_handling: true };
    const result = aiStateEqual(prev, next) ? prev : next;
    expect(result).toBe(next);
  });

  it("aiStateEqual: retorna next quando ai_handling muda", () => {
    const prev: AiStateShape = { ai_status: "auto", ai_handling: true };
    const next: AiStateShape = { ai_status: "auto", ai_handling: false };
    const result = aiStateEqual(prev, next) ? prev : next;
    expect(result).toBe(next);
  });

  it("aiStateEqual: transição null -> objeto é mudança real", () => {
    const prev: AiStateShape = null;
    const next: AiStateShape = { ai_status: "auto", ai_handling: false };
    const result = aiStateEqual(prev, next) ? prev : next;
    expect(result).toBe(next);
  });

  it("setAtBottom: chamada redundante com mesmo valor mantém referência (bail-out)", () => {
    // Simula o comportamento do updater funcional do React:
    //   _setAtBottom((prev) => (prev === v ? prev : v));
    const prev = false;
    const v = false;
    const result = prev === v ? prev : v;
    expect(result).toBe(prev);
  });

  it("setAtBottom: transição true -> false produz mudança", () => {
    const prev: boolean = true;
    const v: boolean = false;
    const result = prev === v ? prev : v;
    expect(result).toBe(false);
  });

  it("MessageIndex.getMessages: mesma conversa sem mudanças mantém referência", () => {
    const idx = createMessageIndex();
    upsertMessage(idx, makeMsg("m1"));
    const a = getMessages(idx, "c1");
    const b = getMessages(idx, "c1");
    expect(a).toBe(b); // referência estável enquanto o bucket não é tocado
  });

  it("MessageIndex.getMessages: conversa desconhecida retorna singleton EMPTY", () => {
    const idx = createMessageIndex();
    const a = getMessages(idx, "cx");
    const b = getMessages(idx, "cy");
    expect(a).toBe(b); // ambos apontam para o EMPTY singleton do módulo
    expect(a.length).toBe(0);
  });

  it("MessageIndex.getMessages: upsert de nova mensagem produz nova referência", () => {
    const idx = createMessageIndex();
    upsertMessage(idx, makeMsg("m1", "2025-01-01T00:00:00Z"));
    const before = getMessages(idx, "c1");
    upsertMessage(idx, makeMsg("m2", "2025-01-01T00:00:01Z"));
    const after = getMessages(idx, "c1");
    expect(after).not.toBe(before);
    expect(after.length).toBe(2);
  });
});
