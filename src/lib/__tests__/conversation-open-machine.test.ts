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

  it("5) realtime durante loading é incorporado ANTES de revelar", () => {
    let s = run([
      { type: "open", cid: CID, cachedTotal: 0 },
      // realtime chega antes do load
      { type: "messages_changed", cid: CID, totalItems: 3 },
    ]);
    expect(s.name).toBe("preparing");
    // load termina — não regride
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
