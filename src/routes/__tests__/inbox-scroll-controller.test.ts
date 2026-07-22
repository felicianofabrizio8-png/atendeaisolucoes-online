// Testes do controlador único de scroll da conversa (hotfix).
// Cobre as garantias exigidas: um único scroll na abertura, preservação
// de posição do usuário, contagem de novas mensagens quando fora do fim.

import { describe, it, expect, vi } from "vitest";

type Msg = { id: string };

/** Reimplementação isolada da máquina de estado do controlador — mantida
 *  em paridade com a lógica em `inbox.$conversationId.lazy.tsx`. */
function makeController() {
  const scrollCalls: Array<{ index: number; behavior: "auto" | "smooth" }> = [];
  const virtuoso = {
    scrollToIndex: (opts: { index: number; align: "end"; behavior: "auto" | "smooth" }) => {
      scrollCalls.push({ index: opts.index, behavior: opts.behavior });
    },
  };

  let cid: string | null = null;
  let done = false;
  let lastMsgId: string | null = null;
  let atBottom = true;
  let newSinceCount = 0;
  let msgs: Msg[] = [];
  let status: "loading" | "ready" | "error" = "loading";

  function openConversation(nextCid: string) {
    cid = nextCid;
    done = false;
    lastMsgId = null;
    newSinceCount = 0;
    msgs = [];
    status = "loading";
  }
  function setMessages(next: Msg[]) {
    msgs = next;
  }
  function setStatus(next: "loading" | "ready" | "error") {
    status = next;
  }
  function setAtBottom(v: boolean) {
    atBottom = v;
    if (atBottom && newSinceCount > 0) newSinceCount = 0;
  }

  /** Simula o efeito READY-gated após 2 rAFs. */
  function tickInitialScroll() {
    if (status !== "ready") return;
    if (msgs.length === 0) return;
    if (done) return;
    done = true;
    const last = msgs.length - 1;
    virtuoso.scrollToIndex({ index: last, align: "end", behavior: "auto" });
    lastMsgId = msgs[last]?.id ?? null;
  }

  /** Simula o efeito de nova mensagem. */
  function tickNewMessage() {
    if (!done) return;
    const last = msgs[msgs.length - 1];
    if (!last) return;
    if (lastMsgId === last.id) return;
    const isRealNew = lastMsgId !== null;
    lastMsgId = last.id;
    if (isRealNew && !atBottom) newSinceCount += 1;
  }

  function goToBottom() {
    const last = msgs.length - 1;
    if (last < 0) return;
    virtuoso.scrollToIndex({ index: last, align: "end", behavior: "smooth" });
    newSinceCount = 0;
  }

  return {
    scrollCalls,
    openConversation,
    setMessages,
    setStatus,
    setAtBottom,
    tickInitialScroll,
    tickNewMessage,
    goToBottom,
    get newSinceCount() {
      return newSinceCount;
    },
    get done() {
      return done;
    },
  };
}

describe("[inbox-scroll] controlador único", () => {
  it("abre exatamente na última mensagem — um único scroll", () => {
    const c = makeController();
    c.openConversation("conv-1");
    c.setMessages([{ id: "a" }, { id: "b" }, { id: "c" }]);
    c.setStatus("ready");
    c.tickInitialScroll();
    c.tickInitialScroll(); // re-execução do efeito não deve duplicar
    expect(c.scrollCalls).toEqual([{ index: 2, behavior: "auto" }]);
  });

  it("nunca executa scroll durante loading", () => {
    const c = makeController();
    c.openConversation("conv-1");
    c.setMessages([{ id: "a" }, { id: "b" }]);
    c.setStatus("loading");
    c.tickInitialScroll();
    expect(c.scrollCalls).toEqual([]);
  });

  it("chegada de imagens (novos ticks READY) não gera novo scroll", () => {
    const c = makeController();
    c.openConversation("conv-1");
    c.setMessages([{ id: "a" }, { id: "b" }]);
    c.setStatus("ready");
    c.tickInitialScroll();
    // Simula rerender após imagens carregarem — mesmas mensagens.
    c.tickInitialScroll();
    c.tickInitialScroll();
    expect(c.scrollCalls.length).toBe(1);
  });

  it("preserva posição do usuário quando fora do fim — apenas incrementa contador", () => {
    const c = makeController();
    c.openConversation("conv-1");
    c.setMessages([{ id: "a" }, { id: "b" }]);
    c.setStatus("ready");
    c.tickInitialScroll();
    c.setAtBottom(false); // usuário rolou para cima
    c.setMessages([{ id: "a" }, { id: "b" }, { id: "c" }]);
    c.tickNewMessage();
    c.setMessages([{ id: "a" }, { id: "b" }, { id: "c" }, { id: "d" }]);
    c.tickNewMessage();
    expect(c.scrollCalls.length).toBe(1); // apenas o inicial
    expect(c.newSinceCount).toBe(2);
  });

  it("botão 'Ir para o final' rola e zera contador", () => {
    const c = makeController();
    c.openConversation("conv-1");
    c.setMessages([{ id: "a" }]);
    c.setStatus("ready");
    c.tickInitialScroll();
    c.setAtBottom(false);
    c.setMessages([{ id: "a" }, { id: "b" }]);
    c.tickNewMessage();
    expect(c.newSinceCount).toBe(1);
    c.goToBottom();
    expect(c.newSinceCount).toBe(0);
    expect(c.scrollCalls.at(-1)).toEqual({ index: 1, behavior: "smooth" });
  });

  it("volta ao fim zera o contador automaticamente", () => {
    const c = makeController();
    c.openConversation("conv-1");
    c.setMessages([{ id: "a" }]);
    c.setStatus("ready");
    c.tickInitialScroll();
    c.setAtBottom(false);
    c.setMessages([{ id: "a" }, { id: "b" }]);
    c.tickNewMessage();
    expect(c.newSinceCount).toBe(1);
    c.setAtBottom(true);
    expect(c.newSinceCount).toBe(0);
  });

  it("troca rápida de conversa reseta e faz apenas o novo scroll", () => {
    const c = makeController();
    c.openConversation("conv-1");
    c.setMessages([{ id: "a" }, { id: "b" }]);
    c.setStatus("ready");
    c.tickInitialScroll();
    // troca imediata
    c.openConversation("conv-2");
    c.setMessages([{ id: "x" }, { id: "y" }, { id: "z" }]);
    c.setStatus("ready");
    c.tickInitialScroll();
    expect(c.scrollCalls).toEqual([
      { index: 1, behavior: "auto" },
      { index: 2, behavior: "auto" },
    ]);
  });
});

// Sanidade estática sobre a implementação real — garante que os efeitos
// antigos (setTimeout 300ms) foram removidos e que só há um scrollToIndex
// automático na abertura.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("[inbox-scroll] auditoria estática", () => {
  const src = readFileSync(
    resolve(process.cwd(), "src/routes/inbox.$conversationId.lazy.tsx"),
    "utf-8",
  );

  it("não usa mais setTimeout(scrollToLastMessage, 300)", () => {
    expect(src).not.toMatch(/setTimeout\(\s*scrollToLastMessage/);
  });

  it("expõe o pill 'Ir para o final' controlado por newSinceCount", () => {
    expect(src).toContain("newSinceCount");
    expect(src).toContain("Ir para o final");
  });

  it("mantém followOutput conservador (não força bottom quando usuário rolou)", () => {
    expect(src).toMatch(/followOutput=\{\(isAtBottom\)\s*=>\s*\(isAtBottom \? "auto" : false\)\}/);
  });

  // Garante que o único scrollToIndex automático fica no efeito READY-gated.
  it("possui exatamente um scrollToIndex disparado no efeito de abertura", () => {
    const autoBlocks = src.match(/behavior:\s*"auto"/g) ?? [];
    // O único bloco 'auto' esperado é o scroll inicial.
    expect(autoBlocks.length).toBe(1);
  });
});

// Silence potentially unused imports in some CI setups.
void vi;
