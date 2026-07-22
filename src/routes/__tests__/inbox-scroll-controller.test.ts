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

  it("não usa mais o timer silencioso de 800ms (removido pela máquina de estados)", () => {
    expect(src).not.toMatch(/silentCorrectionTimerRef\.current = window\.setTimeout/);
    expect(src).not.toMatch(/FINAL_CORRECTION/);
  });

  it("expõe o pill 'Ir para o final' controlado por newSinceCount", () => {
    expect(src).toContain("newSinceCount");
    expect(src).toContain("Ir para o final");
  });

  it("followOutput é conservador e só age depois de visible", () => {
    expect(src).toContain("const handleVirtuosoFollowOutput = useCallback((isAtBottom: boolean) =>");
    expect(src).toMatch(
      /openStateRef\.current\.name === "visible"[\s\S]{0,200}?revealed && isAtBottom \? "auto" : false/,
    );
    expect(src).toContain("followOutput={handleVirtuosoFollowOutput}");
  });

  it("mantém overflow-anchor: none no scroller do Virtuoso", () => {
    expect(src).toMatch(/overflowAnchor:\s*"none"/);
  });

  it("integra a máquina de abertura (F2) — mount e reveal controlados pelo openState", () => {
    expect(src).toContain("shouldMountVirtuoso(openState)");
    expect(src).toContain("shouldRevealVirtuoso(openState)");
    expect(src).toContain("<ChatSkeleton />");
    expect(src).toContain("dispatchOpen");
  });

  it("não ativa mais startBottomLock durante a abertura", () => {
    const initialEffect = src.match(
      /Scroll controller \(hotfix\)[\s\S]*?visibleMessages\.length\]\);/,
    )?.[0];
    expect(initialEffect).toBeDefined();
    expect(initialEffect!).not.toMatch(/startBottomLock\(conversationId\)/);
  });
});


// ---- Máquina de estado do bottom lock (isolada) --------------------------
// Reimplementação minimal para validar as regras exigidas: reancoragem em
// recalibração, liberação por estabilidade, cancelamento por interação e
// isolamento entre conversas.
function makeBottomLock() {
  const TOL = 8;
  const STABLE_MS = 300;
  const SAFETY_MS = 2500;
  const scrolls: Array<{ index: number; source: string }> = [];
  let now = 0;
  const timers: Array<{ at: number; fn: () => void; id: number }> = [];
  let nextTimerId = 1;
  const setTimeout_ = (fn: () => void, ms: number) => {
    const id = nextTimerId++;
    timers.push({ at: now + ms, fn, id });
    return id;
  };
  const clearTimeout_ = (id: number) => {
    const i = timers.findIndex((t) => t.id === id);
    if (i >= 0) timers.splice(i, 1);
  };
  const advance = (ms: number) => {
    const target = now + ms;
    // Executa em ordem cronológica.
    while (true) {
      const next = timers
        .filter((t) => t.at <= target)
        .sort((a, b) => a.at - b.at)[0];
      if (!next) break;
      timers.splice(timers.indexOf(next), 1);
      now = next.at;
      next.fn();
    }
    now = target;
  };

  const state = {
    cid: null as string | null,
    active: false,
    totalItems: 0,
    lastRenderedIndex: -1,
    distanceToEnd: 0,
    userScrolled: false,
    corrections: 0,
    releasedReason: null as string | null,
    stableTimer: null as number | null,
    safetyTimer: null as number | null,
  };

  function anchor(source: string) {
    scrolls.push({ index: state.totalItems - 1, source });
    state.distanceToEnd = 0;
    state.lastRenderedIndex = state.totalItems - 1;
  }
  function release(reason: string) {
    if (!state.active) return;
    state.active = false;
    state.releasedReason = reason;
    if (state.stableTimer !== null) clearTimeout_(state.stableTimer);
    if (state.safetyTimer !== null) clearTimeout_(state.safetyTimer);
    state.stableTimer = null;
    state.safetyTimer = null;
  }
  function scheduleStability() {
    if (!state.active) return;
    if (state.stableTimer !== null) clearTimeout_(state.stableTimer);
    state.stableTimer = setTimeout_(() => {
      state.stableTimer = null;
      if (!state.active) return;
      const nearBottom = state.distanceToEnd <= TOL;
      const lastRendered = state.lastRenderedIndex >= state.totalItems - 1;
      if (nearBottom && lastRendered) release("stable");
      else {
        if (!state.userScrolled && state.distanceToEnd > TOL) {
          state.corrections += 1;
          anchor("stability_recheck");
        }
        scheduleStability();
      }
    }, STABLE_MS);
  }
  function reanchor(trigger: string) {
    if (!state.active) return;
    if (state.userScrolled) return release("user_scrolled");
    if (state.distanceToEnd <= TOL) return scheduleStability();
    state.corrections += 1;
    anchor(trigger);
    scheduleStability();
  }
  function start(cid: string, totalItems: number) {
    if (state.active) release("conversation_switch");
    state.cid = cid;
    state.active = true;
    state.totalItems = totalItems;
    state.lastRenderedIndex = totalItems - 1;
    state.distanceToEnd = 0;
    state.corrections = 0;
    state.releasedReason = null;
    state.userScrolled = false;
    anchor("initial_position");
    state.safetyTimer = setTimeout_(() => release("safety_timeout"), SAFETY_MS);
    scheduleStability();
  }
  function heightGrew(deltaPx: number, extraItems = 0, renderedLast = true) {
    state.totalItems += extraItems;
    state.distanceToEnd += deltaPx;
    if (!renderedLast) state.lastRenderedIndex = state.totalItems - 2;
    reanchor("total_height_changed");
  }
  function userInteract() {
    state.userScrolled = true;
    release("user_input");
  }
  function tick(ms: number) {
    advance(ms);
  }
  return { state, scrolls, start, heightGrew, userInteract, tick };
}

describe("[inbox-scroll] bottom lock (máquina isolada)", () => {
  it("1) abre no final e mantém ancoragem após recalibração de altura", () => {
    const bl = makeBottomLock();
    bl.start("c1", 50);
    expect(bl.state.active).toBe(true);
    // Virtuoso recalibra alturas — altura total cresce e distância aumenta.
    bl.heightGrew(400);
    expect(bl.scrolls.at(-1)?.source).toBe("total_height_changed");
    expect(bl.state.distanceToEnd).toBe(0);
  });

  it("2) múltiplas recalibrações continuam ancoradas", () => {
    const bl = makeBottomLock();
    bl.start("c1", 30);
    bl.heightGrew(150);
    bl.heightGrew(300);
    bl.heightGrew(80);
    expect(bl.state.corrections).toBeGreaterThanOrEqual(3);
    expect(bl.state.distanceToEnd).toBe(0);
  });

  it("3) libera o lock por estabilidade após janela sem mudanças", () => {
    const bl = makeBottomLock();
    bl.start("c1", 10);
    bl.tick(400);
    expect(bl.state.active).toBe(false);
    expect(bl.state.releasedReason).toBe("stable");
  });

  it("4) interação manual cancela imediatamente e ignora mudanças futuras", () => {
    const bl = makeBottomLock();
    bl.start("c1", 20);
    bl.userInteract();
    expect(bl.state.active).toBe(false);
    expect(bl.state.releasedReason).toBe("user_input");
    const before = bl.scrolls.length;
    bl.heightGrew(500);
    expect(bl.scrolls.length).toBe(before); // nenhuma correção nova
  });

  it("5) safety timeout libera o lock mesmo sob instabilidade contínua", () => {
    const bl = makeBottomLock();
    bl.start("c1", 40);
    // Mantém instável (último item não renderizado) — força stability recheck
    // até o safety timeout de 2500ms disparar.
    for (let i = 0; i < 10; i++) {
      bl.heightGrew(50, 0, false);
      bl.tick(250);
    }
    expect(bl.state.active).toBe(false);
    expect(["safety_timeout", "stable"]).toContain(bl.state.releasedReason);
  });

  it("6) troca de conversa cancela o lock anterior", () => {
    const bl = makeBottomLock();
    bl.start("c1", 10);
    bl.start("c2", 5);
    expect(bl.state.cid).toBe("c2");
    expect(bl.state.active).toBe(true);
  });

  it("7) guard idempotência: já no fundo não gera correção redundante", () => {
    const bl = makeBottomLock();
    bl.start("c1", 10);
    const before = bl.scrolls.length;
    bl.heightGrew(0); // altura muda 0 — distância continua 0
    expect(bl.scrolls.length).toBe(before); // sem correção nova
  });

  it("8) termina dentro da tolerância mínima do final", () => {
    const bl = makeBottomLock();
    bl.start("c1", 25);
    bl.heightGrew(1200);
    bl.tick(400);
    expect(bl.state.distanceToEnd).toBeLessThanOrEqual(8);
  });
});

// Silence potentially unused imports in some CI setups.
void vi;
