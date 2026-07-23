// Testes puros da máquina de estados de abertura da conversa (F2/F3).
// Cobrem os critérios do plano: preview isolado nunca revela; lote inicial
// só revela após calibração; realtime durante loading é absorvido; troca de
// conversa cancela; erro não mostra histórico parcial; cache pula loading.

import { describe, it, expect } from "vitest";
import {
  initialConversationOpenState,
  reduceConversationOpen,
  shouldMountVirtuoso,
  shouldRevealVirtuoso,
  CONVERSATION_OPEN_TOLERANCE_PX,
  type ConversationOpenState,
  type ConversationOpenEvent,
} from "../inbox/conversation-open-machine";

function run(events: ConversationOpenEvent[]): ConversationOpenState {
  return events.reduce(reduceConversationOpen, initialConversationOpenState());
}

const CID = "conv-1";
const OTHER = "conv-2";

describe("[open-machine] fluxo determinístico", () => {
  it("1) preview com 1 mensagem NÃO monta o chat (fica em loading)", () => {
    const s = run([
      { type: "open", cid: CID, cachedTotal: 1 },
      { type: "messages_changed", cid: CID, totalItems: 1 },
    ]);
    expect(s.name).toBe("loading");
    expect(shouldMountVirtuoso(s)).toBe(false);
  });

  it("2) lote inicial (40 msgs) só é revelado após preparação estável", () => {
    let s = run([
      { type: "open", cid: CID, cachedTotal: 0 },
      { type: "load_ok", cid: CID, totalItems: 40 },
    ]);
    expect(s.name).toBe("preparing");
    expect(shouldMountVirtuoso(s)).toBe(true);
    expect(shouldRevealVirtuoso(s)).toBe(false);

    // Um probe com último item ainda não renderizado — permanece preparing.
    s = reduceConversationOpen(s, {
      type: "layout_probe",
      cid: CID,
      totalItems: 40,
      lastRenderedIndex: 30,
      distanceToEnd: 200,
      heightChanged: false,
    });
    expect(s.name).toBe("preparing");

    // Probe estável — transiciona para ready.
    s = reduceConversationOpen(s, {
      type: "layout_probe",
      cid: CID,
      totalItems: 40,
      lastRenderedIndex: 39,
      distanceToEnd: CONVERSATION_OPEN_TOLERANCE_PX,
      heightChanged: false,
    });
    expect(s.name).toBe("ready");
    expect(shouldRevealVirtuoso(s)).toBe(false);

    // reveal → visible.
    s = reduceConversationOpen(s, { type: "reveal", cid: CID });
    expect(s.name).toBe("visible");
    expect(shouldRevealVirtuoso(s)).toBe(true);
  });

  it("3) conversa com 1 msg real (via realtime pós-load) abre corretamente", () => {
    let s = run([
      { type: "open", cid: CID, cachedTotal: 0 },
      { type: "load_ok", cid: CID, totalItems: 1 },
    ]);
    expect(s.name).toBe("preparing");
    s = reduceConversationOpen(s, {
      type: "layout_probe",
      cid: CID,
      totalItems: 1,
      lastRenderedIndex: 0,
      distanceToEnd: 0,
      heightChanged: false,
    });
    expect(s.name).toBe("ready");
  });

  it("4) heightChanged em preparing reseta stableFrames (mídias/decodes)", () => {
    let s = run([
      { type: "open", cid: CID, cachedTotal: 0 },
      { type: "load_ok", cid: CID, totalItems: 20 },
    ]);
    // Estável 1x → seria ready. Mas heightChanged reseta.
    s = reduceConversationOpen(s, {
      type: "layout_probe",
      cid: CID,
      totalItems: 20,
      lastRenderedIndex: 19,
      distanceToEnd: 0,
      heightChanged: true,
    });
    expect(s.name).toBe("preparing");
    // Próximo probe sem heightChanged → ready.
    s = reduceConversationOpen(s, {
      type: "layout_probe",
      cid: CID,
      totalItems: 20,
      lastRenderedIndex: 19,
      distanceToEnd: 4,
      heightChanged: false,
    });
    expect(s.name).toBe("ready");
  });

  it("5) realtime durante loading é absorvido silenciosamente; load_ok promove", () => {
    let s = run([
      { type: "open", cid: CID, cachedTotal: 0 },
      // Realtime chega ANTES do load_ok — mantém loading (não promove).
      { type: "messages_changed", cid: CID, totalItems: 3 },
    ]);
    expect(s.name).toBe("loading");
    // Load termina — agora promove para preparing com o total real.
    s = reduceConversationOpen(s, {
      type: "load_ok",
      cid: CID,
      totalItems: 50,
    });
    expect(s.name).toBe("preparing");
    expect(s.name === "preparing" && s.totalItems).toBe(50);
  });

  it("6) troca rápida de conversa cancela preparação anterior", () => {
    let s = run([
      { type: "open", cid: CID, cachedTotal: 0 },
      { type: "load_ok", cid: CID, totalItems: 30 },
    ]);
    expect(s.name).toBe("preparing");
    s = reduceConversationOpen(s, { type: "close" });
    expect(s.name).toBe("idle");
    s = reduceConversationOpen(s, {
      type: "open",
      cid: OTHER,
      cachedTotal: 0,
    });
    expect(s.name).toBe("loading");
    expect(s.name === "loading" && s.cid).toBe(OTHER);
  });

  it("7) conversa anterior não consegue revelar a atual (eventos de cid alheio são ignorados)", () => {
    let s = run([
      { type: "open", cid: CID, cachedTotal: 0 },
      { type: "load_ok", cid: CID, totalItems: 20 },
    ]);
    // Evento de outra conversa não deve mover a máquina.
    const before = s;
    s = reduceConversationOpen(s, {
      type: "layout_probe",
      cid: OTHER,
      totalItems: 999,
      lastRenderedIndex: 998,
      distanceToEnd: 0,
      heightChanged: false,
    });
    expect(s).toBe(before);
    s = reduceConversationOpen(s, { type: "reveal", cid: OTHER });
    expect(s).toBe(before);
  });

  it("8) load_error vai para error — nunca revela histórico parcial", () => {
    const s = run([
      { type: "open", cid: CID, cachedTotal: 0 },
      { type: "load_error", cid: CID, message: "timeout" },
    ]);
    expect(s.name).toBe("error");
    expect(shouldMountVirtuoso(s)).toBe(false);
    expect(shouldRevealVirtuoso(s)).toBe(false);
  });

  it("9) retry após erro volta a loading (só a conversa atual)", () => {
    let s = run([
      { type: "open", cid: CID, cachedTotal: 0 },
      { type: "load_error", cid: CID, message: "x" },
    ]);
    s = reduceConversationOpen(s, { type: "retry", cid: CID });
    expect(s.name).toBe("loading");
  });

  it("10) cache íntegro (>=2 msgs) pula loading — sem nova rede", () => {
    const s = run([{ type: "open", cid: CID, cachedTotal: 60 }]);
    expect(s.name).toBe("preparing");
    expect(s.name === "preparing" && s.totalItems).toBe(60);
  });

  it("11) preview isolado (cachedTotal=1) NUNCA conta como cache", () => {
    const s = run([{ type: "open", cid: CID, cachedTotal: 1 }]);
    expect(s.name).toBe("loading");
  });

  it("12) após visible, novas mensagens (realtime) mantêm visible", () => {
    let s = run([
      { type: "open", cid: CID, cachedTotal: 0 },
      { type: "load_ok", cid: CID, totalItems: 10 },
      {
        type: "layout_probe",
        cid: CID,
        totalItems: 10,
        lastRenderedIndex: 9,
        distanceToEnd: 0,
        heightChanged: false,
      },
      { type: "reveal", cid: CID },
    ]);
    expect(s.name).toBe("visible");
    s = reduceConversationOpen(s, {
      type: "messages_changed",
      cid: CID,
      totalItems: 11,
    });
    expect(s.name).toBe("visible");
    expect(s.name === "visible" && s.totalItems).toBe(11);
  });

  it("13) probe fora da tolerância mantém preparing (não revela cedo)", () => {
    let s = run([
      { type: "open", cid: CID, cachedTotal: 0 },
      { type: "load_ok", cid: CID, totalItems: 50 },
    ]);
    s = reduceConversationOpen(s, {
      type: "layout_probe",
      cid: CID,
      totalItems: 50,
      lastRenderedIndex: 49,
      distanceToEnd: CONVERSATION_OPEN_TOLERANCE_PX + 1,
      heightChanged: false,
    });
    expect(s.name).toBe("preparing");
  });
});

// ---------------------------------------------------------------------------
// HOTFIX React #185 — o reducer PRECISA devolver a mesma referência quando o
// evento não altera nada semanticamente. Sem isso, cada `itemsRendered` do
// Virtuoso provoca um novo objeto de estado, novo render, nova probe, loop.
// ---------------------------------------------------------------------------

describe("[open-machine] idempotência referencial (hotfix React #185)", () => {
  function preparing(totalItems: number) {
    return run([
      { type: "open", cid: CID, cachedTotal: 0 },
      { type: "load_ok", cid: CID, totalItems },
    ]);
  }

  it("R1) layout_probe redundante em janela incompleta retorna a MESMA referência", () => {
    const s = preparing(60);
    const next = reduceConversationOpen(s, {
      type: "layout_probe",
      cid: CID,
      totalItems: 60,
      lastRenderedIndex: 9,
      distanceToEnd: 1200,
      heightChanged: false,
    });
    expect(next).toBe(s);
  });

  it("R2) mesmo totalItems e stableFrames=0 não criam novo estado", () => {
    const s = preparing(40);
    let cur: ConversationOpenState = s;
    for (let i = 0; i < 20; i++) {
      cur = reduceConversationOpen(cur, {
        type: "layout_probe",
        cid: CID,
        totalItems: 40,
        lastRenderedIndex: 15,
        distanceToEnd: 400,
        heightChanged: false,
      });
    }
    expect(cur).toBe(s);
  });

  it("R3) heightChanged=true sem mudança efetiva retorna a MESMA referência", () => {
    const s = preparing(50);
    const next = reduceConversationOpen(s, {
      type: "layout_probe",
      cid: CID,
      totalItems: 50,
      lastRenderedIndex: 40,
      distanceToEnd: 200,
      heightChanged: true,
    });
    expect(next).toBe(s);
  });

  it("R4) mudança real de totalItems retorna nova referência", () => {
    const s = preparing(40);
    const next = reduceConversationOpen(s, {
      type: "layout_probe",
      cid: CID,
      totalItems: 41,
      lastRenderedIndex: 10,
      distanceToEnd: 300,
      heightChanged: false,
    });
    expect(next).not.toBe(s);
    expect(next.name === "preparing" && next.totalItems).toBe(41);
  });

  it("R5) probe estável avança para ready (nova referência) e não muta o anterior", () => {
    const s = preparing(20);
    const snapshotBefore = { ...s };
    const next = reduceConversationOpen(s, {
      type: "layout_probe",
      cid: CID,
      totalItems: 20,
      lastRenderedIndex: 19,
      distanceToEnd: 0,
      heightChanged: false,
    });
    expect(next).not.toBe(s);
    expect(next.name).toBe("ready");
    expect(s).toEqual(snapshotBefore);
  });

  it("R6) probe irrelevante em estado ready NÃO cria novo estado", () => {
    let s = preparing(30);
    s = reduceConversationOpen(s, {
      type: "layout_probe",
      cid: CID,
      totalItems: 30,
      lastRenderedIndex: 29,
      distanceToEnd: 0,
      heightChanged: false,
    });
    expect(s.name).toBe("ready");
    const before = s;
    s = reduceConversationOpen(s, {
      type: "layout_probe",
      cid: CID,
      totalItems: 30,
      lastRenderedIndex: 29,
      distanceToEnd: 0,
      heightChanged: false,
    });
    expect(s).toBe(before);
  });

  it("R7) messages_changed com mesmo total em visible retorna a MESMA referência", () => {
    let s = run([
      { type: "open", cid: CID, cachedTotal: 0 },
      { type: "load_ok", cid: CID, totalItems: 10 },
      {
        type: "layout_probe",
        cid: CID,
        totalItems: 10,
        lastRenderedIndex: 9,
        distanceToEnd: 0,
        heightChanged: false,
      },
      { type: "reveal", cid: CID },
    ]);
    const before = s;
    s = reduceConversationOpen(s, {
      type: "messages_changed",
      cid: CID,
      totalItems: 10,
    });
    expect(s).toBe(before);
  });

  it("R8) close em idle retorna a MESMA referência", () => {
    const s = initialConversationOpenState();
    expect(reduceConversationOpen(s, { type: "close" })).toBe(s);
  });

  it("R9) sequência realista de 100 probes redundantes converge sem novas refs", () => {
    const s = preparing(80);
    let cur: ConversationOpenState = s;
    let transitions = 0;
    for (let i = 0; i < 100; i++) {
      const nxt = reduceConversationOpen(cur, {
        type: "layout_probe",
        cid: CID,
        totalItems: 80,
        lastRenderedIndex: 12,
        distanceToEnd: 800,
        heightChanged: i % 3 === 0,
      });
      if (nxt !== cur) transitions++;
      cur = nxt;
    }
    expect(transitions).toBe(0);
    expect(cur).toBe(s);
  });

  it("R10) conversa curta continua alcançando ready normalmente", () => {
    let s = preparing(3);
    s = reduceConversationOpen(s, {
      type: "layout_probe",
      cid: CID,
      totalItems: 3,
      lastRenderedIndex: 2,
      distanceToEnd: 0,
      heightChanged: false,
    });
    expect(s.name).toBe("ready");
  });

  it("R11) conversa longa alcança ready quando a janela finalmente cobre o último", () => {
    let s = preparing(120);
    // 50 probes com janela pequena → permanece preparing sem loop
    for (let i = 0; i < 50; i++) {
      s = reduceConversationOpen(s, {
        type: "layout_probe",
        cid: CID,
        totalItems: 120,
        lastRenderedIndex: 10,
        distanceToEnd: 2000,
        heightChanged: false,
      });
    }
    expect(s.name).toBe("preparing");
    // Janela finalmente cobre o último item
    s = reduceConversationOpen(s, {
      type: "layout_probe",
      cid: CID,
      totalItems: 120,
      lastRenderedIndex: 119,
      distanceToEnd: 4,
      heightChanged: false,
    });
    expect(s.name).toBe("ready");
  });
});

// ---------------------------------------------------------------------------
// Deduplicação da janela do Virtuoso — extraída como decisão pura para poder
// ser testada sem montar o componente. Reflete a lógica implementada em
// `handleVirtuosoItemsRendered` (src/routes/inbox.$conversationId.lazy.tsx).
// ---------------------------------------------------------------------------

type ProbeWindow = { firstItemIndex: number | null; lastItemIndex: number | null; totalItems: number };

function shouldDispatchProbe(prev: ProbeWindow | null, next: ProbeWindow): boolean {
  if (prev === null) return true;
  return (
    prev.firstItemIndex !== next.firstItemIndex ||
    prev.lastItemIndex !== next.lastItemIndex ||
    prev.totalItems !== next.totalItems
  );
}

describe("[items-rendered] deduplicação da janela renderizada", () => {
  it("D1) mesma janela renderizada duas vezes → um único dispatch", () => {
    const w: ProbeWindow = { firstItemIndex: 0, lastItemIndex: 9, totalItems: 60 };
    expect(shouldDispatchProbe(null, w)).toBe(true);
    expect(shouldDispatchProbe(w, w)).toBe(false);
  });

  it("D2) mudança de firstItemIndex → novo dispatch", () => {
    const prev: ProbeWindow = { firstItemIndex: 0, lastItemIndex: 9, totalItems: 60 };
    const next: ProbeWindow = { firstItemIndex: 1, lastItemIndex: 9, totalItems: 60 };
    expect(shouldDispatchProbe(prev, next)).toBe(true);
  });

  it("D3) mudança de lastItemIndex → novo dispatch", () => {
    const prev: ProbeWindow = { firstItemIndex: 0, lastItemIndex: 9, totalItems: 60 };
    const next: ProbeWindow = { firstItemIndex: 0, lastItemIndex: 10, totalItems: 60 };
    expect(shouldDispatchProbe(prev, next)).toBe(true);
  });

  it("D4) mudança de totalItems → novo dispatch", () => {
    const prev: ProbeWindow = { firstItemIndex: 0, lastItemIndex: 9, totalItems: 60 };
    const next: ProbeWindow = { firstItemIndex: 0, lastItemIndex: 9, totalItems: 61 };
    expect(shouldDispatchProbe(prev, next)).toBe(true);
  });

  it("D5) 100 callbacks iguais durante preparing geram um único dispatch", () => {
    let prev: ProbeWindow | null = null;
    let dispatches = 0;
    const w: ProbeWindow = { firstItemIndex: 0, lastItemIndex: 8, totalItems: 65 };
    for (let i = 0; i < 100; i++) {
      if (shouldDispatchProbe(prev, w)) {
        dispatches++;
        prev = w;
      }
    }
    expect(dispatches).toBe(1);
  });

  it("D6) troca de conversa limpa a janela — primeira probe volta a passar", () => {
    let prev: ProbeWindow | null = { firstItemIndex: 0, lastItemIndex: 9, totalItems: 40 };
    // Simula reset por troca de conversationId
    prev = null;
    const w: ProbeWindow = { firstItemIndex: 0, lastItemIndex: 9, totalItems: 40 };
    expect(shouldDispatchProbe(prev, w)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Teste de regressão integrado: cenário real que dispara React #185.
// ---------------------------------------------------------------------------

describe("[regression] cenário React #185 — 60+ mensagens, janela oculta", () => {
  it("60 callbacks itemsRendered com mesma janela + reducer idempotente → sem cascata", () => {
    // Estado inicial equivalente ao momento da abertura da conversa longa.
    let s: ConversationOpenState = run([
      { type: "open", cid: CID, cachedTotal: 0 },
      { type: "load_ok", cid: CID, totalItems: 62 },
    ]);
    expect(s.name).toBe("preparing");

    let prev: ProbeWindow | null = null;
    let dispatches = 0;
    let stateChanges = 0;

    const w: ProbeWindow = { firstItemIndex: 0, lastItemIndex: 9, totalItems: 62 };
    // Simula 60 emissões do Virtuoso (foi o número observado antes do crash).
    for (let i = 0; i < 60; i++) {
      if (!shouldDispatchProbe(prev, w)) continue;
      prev = w;
      dispatches++;
      const next = reduceConversationOpen(s, {
        type: "layout_probe",
        cid: CID,
        totalItems: w.totalItems,
        lastRenderedIndex: w.lastItemIndex ?? -1,
        distanceToEnd: 1500,
        heightChanged: false,
      });
      if (next !== s) stateChanges++;
      s = next;
    }

    expect(dispatches).toBe(1);
    expect(stateChanges).toBe(0);
    expect(s.name).toBe("preparing");
  });
});

describe("[open-machine] auditoria estática do route file", () => {
  it("route file não usa mais o timer silencioso de 800ms", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const src = fs.readFileSync(
      path.resolve(process.cwd(), "src/routes/inbox.$conversationId.lazy.tsx"),
      "utf-8",
    );
    expect(src).not.toMatch(/setTimeout\([\s\S]{0,200}?"final_correction"/);
    expect(src).not.toMatch(/silentCorrectionTimerRef\.current = window\.setTimeout/);
  });

  it("route file não ativa mais o bottom-lock na abertura", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const src = fs.readFileSync(
      path.resolve(process.cwd(), "src/routes/inbox.$conversationId.lazy.tsx"),
      "utf-8",
    );
    // startBottomLock ainda é definido (dead code isolado), mas não é
    // chamado dentro do efeito de scroll inicial.
    const initialEffect = src.match(
      /Scroll controller \(hotfix\)[\s\S]*?visibleMessages\.length\]\);/,
    )?.[0];
    expect(initialEffect).toBeDefined();
    expect(initialEffect!).not.toMatch(/startBottomLock\(conversationId\)/);
  });

  it("route file monta o Virtuoso com visibility controlada pela máquina", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const src = fs.readFileSync(
      path.resolve(process.cwd(), "src/routes/inbox.$conversationId.lazy.tsx"),
      "utf-8",
    );
    expect(src).toContain("shouldMountVirtuoso(openState)");
    expect(src).toContain("shouldRevealVirtuoso(openState)");
    expect(src).toContain("<ChatSkeleton />");
  });

  it("followOutput só age depois de visible", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const src = fs.readFileSync(
      path.resolve(process.cwd(), "src/routes/inbox.$conversationId.lazy.tsx"),
      "utf-8",
    );
    expect(src).toMatch(
      /openStateRef\.current\.name === "visible"[\s\S]{0,200}?revealed && isAtBottom \? "auto" : false/,
    );
  });
});
