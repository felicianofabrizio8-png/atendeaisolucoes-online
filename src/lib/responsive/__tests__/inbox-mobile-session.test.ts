// Fase 5.2 — contrato do estado efêmero da Inbox mobile (rascunhos + scroll).
//
// O valor destes testes é comportamental, não estrutural: o vendedor não pode
// perder texto digitado ao navegar, e o storage indisponível (SSR, Safari
// privado, iframe sem cookies) precisa degradar em silêncio, nunca lançar.

import { describe, it, expect } from "vitest";
import {
  MAX_DRAFT_LENGTH,
  clearDraft,
  draftKey,
  readDraft,
  readListScroll,
  saveDraft,
  saveListScroll,
  type SessionLike,
} from "@/lib/inbox/mobile-session";

/** Storage em memória, equivalente ao contrato mínimo usado pelo módulo. */
function memoryStorage(): SessionLike & { map: Map<string, string> } {
  const map = new Map<string, string>();
  return {
    map,
    getItem: (k) => (map.has(k) ? (map.get(k) as string) : null),
    setItem: (k, v) => void map.set(k, v),
    removeItem: (k) => void map.delete(k),
  };
}

/** Storage que sempre falha — modo privado do Safari / cota estourada. */
const hostileStorage: SessionLike = {
  getItem() {
    throw new Error("storage blocked");
  },
  setItem() {
    throw new Error("quota exceeded");
  },
  removeItem() {
    throw new Error("storage blocked");
  },
};

describe("rascunho por conversa", () => {
  it("isola rascunhos entre conversas distintas", () => {
    const s = memoryStorage();
    saveDraft("conv-a", "orçamento da piscina", s);
    saveDraft("conv-b", "vou verificar o estoque", s);

    expect(readDraft("conv-a", s)).toBe("orçamento da piscina");
    expect(readDraft("conv-b", s)).toBe("vou verificar o estoque");
    expect(draftKey("conv-a")).not.toBe(draftKey("conv-b"));
  });

  it("devolve string vazia quando não há nada salvo", () => {
    expect(readDraft("conv-nova", memoryStorage())).toBe("");
  });

  it("limpar o campo remove o rascunho em vez de guardar espaços", () => {
    const s = memoryStorage();
    saveDraft("conv-a", "texto", s);
    saveDraft("conv-a", "   ", s);

    expect(s.map.has(draftKey("conv-a"))).toBe(false);
    expect(readDraft("conv-a", s)).toBe("");
  });

  it("trunca colagens gigantes para não estourar a cota", () => {
    const s = memoryStorage();
    saveDraft("conv-a", "x".repeat(MAX_DRAFT_LENGTH + 500), s);

    expect(readDraft("conv-a", s)).toHaveLength(MAX_DRAFT_LENGTH);
  });

  it("clearDraft apaga apenas a conversa alvo", () => {
    const s = memoryStorage();
    saveDraft("conv-a", "a", s);
    saveDraft("conv-b", "b", s);
    clearDraft("conv-a", s);

    expect(readDraft("conv-a", s)).toBe("");
    expect(readDraft("conv-b", s)).toBe("b");
  });

  it("degrada em silêncio sem storage (SSR) e com storage hostil", () => {
    expect(() => saveDraft("conv-a", "x", null)).not.toThrow();
    expect(readDraft("conv-a", null)).toBe("");
    expect(() => saveDraft("conv-a", "x", hostileStorage)).not.toThrow();
    expect(readDraft("conv-a", hostileStorage)).toBe("");
    expect(() => clearDraft("conv-a", hostileStorage)).not.toThrow();
  });

  it("ignora conversationId vazio", () => {
    const s = memoryStorage();
    saveDraft("", "orfão", s);
    expect(s.map.size).toBe(0);
    expect(readDraft("", s)).toBe("");
  });
});

describe("posição de rolagem da lista", () => {
  it("faz ida e volta da posição salva", () => {
    const s = memoryStorage();
    saveListScroll(842.6, s);
    expect(readListScroll(s)).toBe(843);
  });

  it("normaliza valores negativos e não finitos", () => {
    const s = memoryStorage();
    saveListScroll(-120, s);
    expect(readListScroll(s)).toBe(0);

    saveListScroll(Number.NaN, s);
    expect(readListScroll(s)).toBe(0);
  });

  it("retorna 0 quando ausente, corrompido ou sem storage", () => {
    const s = memoryStorage();
    expect(readListScroll(s)).toBe(0);
    s.map.set("atendeai:inbox:list-scroll", "não-é-número");
    expect(readListScroll(s)).toBe(0);
    expect(readListScroll(null)).toBe(0);
    expect(readListScroll(hostileStorage)).toBe(0);
  });
});
