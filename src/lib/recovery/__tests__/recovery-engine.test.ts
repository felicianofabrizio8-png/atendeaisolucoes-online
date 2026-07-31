// ============================================================================
// SPRINT 6 · FASE 6.1 — Testes do Recovery Engine (motor puro).
//
// Cobrem: janela aberta/fechada, score composto, chance, explainability,
// sugestão de ação, template obrigatório, fila e cards do dashboard.
// Nenhum teste toca banco — o motor é puro por construção, e o isolamento
// por empresa é garantido na camada de leitura (uma única company_id).
// ============================================================================

import { describe, expect, it } from "vitest";
import {
  ACTION_LABEL,
  assessRecovery,
  buildDashboardCards,
  buildRecoveryQueue,
  classifyRecoveryState,
  computeRecoveryScore,
  computeRecoveryWindow,
  estimateRecoveryChance,
  recoveryFingerprint,
  scoreToTier,
  suggestTemplate,
  type ApprovedTemplate,
  type RecoverySnapshot,
} from "@/lib/recovery";

const NOW = Date.parse("2026-08-01T12:00:00.000Z");
const H = 3_600_000;
const D = 24 * H;

function iso(msAgo: number): string {
  return new Date(NOW - msAgo).toISOString();
}

function snap(over: Partial<RecoverySnapshot> = {}): RecoverySnapshot {
  return {
    conversationId: "conv-1",
    leadId: "lead-1",
    leadName: "Maria Souza",
    product: "Piscina 8x4",
    channel: "whatsapp",
    leadStatus: "quente",
    temperature: "quente",
    estimatedValue: 45000,
    source: "indicacao",
    tags: [],
    assignedTo: null,
    assignedToName: null,
    lastInboundAt: iso(3 * D),
    lastOutboundAt: iso(2.5 * D),
    lastMessageAt: iso(2.5 * D),
    firstMessageAt: iso(20 * D),
    messageCount: 14,
    quote: { sentAt: iso(3 * D), viewedAt: iso(2.8 * D), status: "enviado", total: 45000 },
    visit: null,
    lastFollowUpAt: null,
    followUpResponded: false,
    coachRiskScore: null,
    coachUrgency: null,
    lostAt: null,
    closedAt: null,
    reactivatedAt: null,
    ...over,
  };
}

const TEMPLATES: ApprovedTemplate[] = [
  { id: "t1", name: "followup_orcamento", status: "APPROVED" },
  { id: "t2", name: "reativacao_cliente", status: "approved" },
  { id: "t3", name: "promo_rejeitada", status: "REJECTED" },
];

// ---------------------------------------------------------------- janela ----
describe("janela do WhatsApp", () => {
  it("aberta quando o cliente falou há menos de 24h", () => {
    const w = computeRecoveryWindow("whatsapp", iso(2 * H), NOW);
    expect(w.state).toBe("open");
    expect(w.requiresTemplate).toBe(false);
    expect(w.remainingMs).toBeGreaterThan(21 * H);
  });

  it("marca closing_soon nas últimas 3 horas", () => {
    expect(computeRecoveryWindow("whatsapp", iso(22 * H), NOW).state).toBe("closing_soon");
  });

  it("fechada exige template e informa há quanto tempo fechou", () => {
    const w = computeRecoveryWindow("whatsapp", iso(3 * D), NOW);
    expect(w.state).toBe("closed");
    expect(w.requiresTemplate).toBe(true);
    expect(Math.round(w.sinceClosedMs / D)).toBe(2);
    expect(w.remainingMs).toBe(0);
  });

  it("nunca aberta quando não há mensagem do cliente", () => {
    const w = computeRecoveryWindow("whatsapp", null, NOW);
    expect(w.state).toBe("never_opened");
    expect(w.requiresTemplate).toBe(true);
  });

  it("não se aplica fora do WhatsApp", () => {
    const w = computeRecoveryWindow("instagram", iso(3 * D), NOW);
    expect(w.state).toBe("not_applicable");
    expect(w.requiresTemplate).toBe(false);
  });
});

// ------------------------------------------------------------ classificação --
describe("classificação complementar", () => {
  it("orçamento enviado e cliente calado → aguardando retorno do orçamento", () => {
    expect(classifyRecoveryState(snap(), NOW)).toBe("aguardando_retorno_orcamento");
  });

  it("cliente falou por último → aguardando vendedor", () => {
    const s = snap({
      quote: null,
      leadStatus: "novo",
      lastInboundAt: iso(2 * D),
      lastOutboundAt: iso(5 * D),
      lastMessageAt: iso(2 * D),
    });
    expect(classifyRecoveryState(s, NOW)).toBe("aguardando_vendedor");
  });

  it("visita futura → aguardando visita (não é abandono)", () => {
    const s = snap({
      visit: { scheduledAt: new Date(NOW + 2 * D).toISOString(), status: "agendada" },
    });
    expect(classifyRecoveryState(s, NOW)).toBe("aguardando_visita");
  });

  it("silêncio de mais de 14 dias sem etapa → abandonado", () => {
    const s = snap({
      quote: null,
      lastInboundAt: iso(40 * D),
      lastOutboundAt: iso(39 * D),
      lastMessageAt: iso(39 * D),
    });
    expect(classifyRecoveryState(s, NOW)).toBe("abandonado");
  });

  it("estados terminais são respeitados sem sobrescrever o lead", () => {
    expect(classifyRecoveryState(snap({ leadStatus: "perdido" }), NOW)).toBe("perdido");
    expect(classifyRecoveryState(snap({ leadStatus: "fechado" }), NOW)).toBe("encerrado");
  });
});

// ----------------------------------------------------------------- score ----
describe("Recovery Score", () => {
  it("fica entre 0 e 100 em qualquer combinação", () => {
    const cases = [
      snap(),
      snap({ leadStatus: "perdido", estimatedValue: 0, messageCount: 1 }),
      snap({ leadStatus: "fechado" }),
      snap({ estimatedValue: 900000, coachUrgency: "critical", messageCount: 90 }),
      snap({ lastInboundAt: null, lastOutboundAt: null, lastMessageAt: null }),
    ];
    for (const c of cases) {
      const r = computeRecoveryScore(c, NOW);
      expect(r.score).toBeGreaterThanOrEqual(0);
      expect(r.score).toBeLessThanOrEqual(100);
    }
  });

  it("nunca depende de um único critério — vários fatores compõem a nota", () => {
    const r = computeRecoveryScore(snap(), NOW);
    const keys = new Set(r.factors.map((f) => f.key));
    expect(keys.size).toBeGreaterThanOrEqual(4);
    expect(keys.has("estado")).toBe(true);
    expect(keys.has("tempo_parado")).toBe(true);
  });

  it("valor alto e lead quente pontuam mais que ticket baixo e frio", () => {
    const alto = computeRecoveryScore(snap(), NOW).score;
    const baixo = computeRecoveryScore(
      snap({ estimatedValue: 800, temperature: "frio", leadStatus: "frio", messageCount: 2 }),
      NOW,
    ).score;
    expect(alto).toBeGreaterThan(baixo);
  });

  it("venda concluída é despriorizada", () => {
    expect(computeRecoveryScore(snap({ leadStatus: "fechado" }), NOW).score).toBeLessThan(20);
  });

  it("faixas do tier são estáveis", () => {
    expect(scoreToTier(95)).toBe("muito_alta");
    expect(scoreToTier(65)).toBe("alta");
    expect(scoreToTier(45)).toBe("media");
    expect(scoreToTier(25)).toBe("baixa");
    expect(scoreToTier(5)).toBe("muito_baixa");
  });
});

// ------------------------------------------------------- explainability -----
describe("explainability", () => {
  it("todo fator tem rótulo legível em pt-BR", () => {
    for (const f of computeRecoveryScore(snap(), NOW).factors) {
      expect(f.label.trim().length).toBeGreaterThan(3);
      expect(f.label).not.toMatch(/undefined|NaN|\[object/);
    }
  });

  it("a explicação cita os motivos de maior peso", () => {
    const r = computeRecoveryScore(snap(), NOW);
    expect(r.explanation).toContain("porque");
    expect(r.explanation.toLowerCase()).toContain("orçamento");
  });

  it("a avaliação completa carrega os drivers da chance como fatores", () => {
    const a = assessRecovery(snap(), NOW, TEMPLATES);
    expect(a.factors.some((f) => f.key === "chance")).toBe(true);
  });
});

// ----------------------------------------------------------------- chance ---
describe("chance de recuperação", () => {
  it("sempre entre 1% e 95%", () => {
    for (const days of [0, 1, 5, 20, 100, 400]) {
      const s = snap({ lastMessageAt: iso(days * D), lastInboundAt: iso(days * D) });
      const st = classifyRecoveryState(s, NOW);
      const c = estimateRecoveryChance(s, st, NOW);
      expect(c.percent).toBeGreaterThanOrEqual(1);
      expect(c.percent).toBeLessThanOrEqual(95);
    }
  });

  it("cai conforme o tempo parado aumenta", () => {
    const recente = assessRecovery(
      snap({ lastMessageAt: iso(2 * D), lastInboundAt: iso(2 * D) }),
      NOW,
      TEMPLATES,
    ).chancePercent;
    const antigo = assessRecovery(
      snap({ lastMessageAt: iso(60 * D), lastInboundAt: iso(60 * D) }),
      NOW,
      TEMPLATES,
    ).chancePercent;
    expect(recente).toBeGreaterThan(antigo);
  });

  it("follow-up ignorado reduz a chance", () => {
    const base = assessRecovery(snap(), NOW, TEMPLATES).chancePercent;
    const ignorado = assessRecovery(
      snap({ lastFollowUpAt: iso(1 * D), followUpResponded: false }),
      NOW,
      TEMPLATES,
    ).chancePercent;
    expect(ignorado).toBeLessThan(base);
  });

  it("explica os drivers usados", () => {
    const s = snap();
    const c = estimateRecoveryChance(s, classifyRecoveryState(s, NOW), NOW);
    expect(c.drivers.length).toBeGreaterThan(0);
  });
});

// -------------------------------------------------------------- templates ---
describe("templates", () => {
  it("janela fechada exige template aprovado e sugere um compatível", () => {
    const a = assessRecovery(snap(), NOW, TEMPLATES);
    expect(a.window.state).toBe("closed");
    expect(a.action.requiresTemplate).toBe(true);
    expect(a.action.suggestedTemplate).toBe("followup_orcamento");
  });

  it("janela aberta libera mensagem livre, sem template", () => {
    const a = assessRecovery(
      snap({ lastInboundAt: iso(2 * H), lastMessageAt: iso(2 * H), quote: null, leadStatus: "novo" }),
      NOW,
      TEMPLATES,
    );
    expect(a.window.state).toBe("open");
    expect(a.action.requiresTemplate).toBe(false);
    expect(a.action.suggestedTemplate).toBeNull();
  });

  it("nunca sugere template reprovado", () => {
    const only = [{ id: "x", name: "promo_rejeitada", status: "REJECTED" }];
    expect(suggestTemplate(snap(), "abandonado", 40 * 24, only)).toBeNull();
  });

  it("sem templates aprovados a ação avisa em vez de prometer envio", () => {
    const a = assessRecovery(snap(), NOW, []);
    expect(a.action.suggestedTemplate).toBeNull();
    expect(a.action.reason).toMatch(/cadastre um/i);
  });
});

// ------------------------------------------------------------------ ação ----
describe("ação sugerida", () => {
  it("cliente esperando orçamento → produzir o orçamento", () => {
    const s = snap({
      quote: null,
      leadStatus: "quente",
      lastInboundAt: iso(2 * D),
      lastOutboundAt: iso(6 * D),
      lastMessageAt: iso(2 * D),
    });
    expect(assessRecovery(s, NOW, TEMPLATES).action.kind).toBe("novo_orcamento");
  });

  it("venda concluída → não insistir", () => {
    expect(assessRecovery(snap({ leadStatus: "fechado" }), NOW, TEMPLATES).action.kind).toBe(
      "nao_insistir",
    );
  });

  it("abandono antigo com chance baixa → aguardar, não perseguir", () => {
    const s = snap({
      quote: null,
      temperature: "frio",
      leadStatus: "frio",
      messageCount: 2,
      lastInboundAt: iso(120 * D),
      lastOutboundAt: iso(119 * D),
      lastMessageAt: iso(119 * D),
    });
    const a = assessRecovery(s, NOW, TEMPLATES);
    expect(["aguardar", "nao_insistir"]).toContain(a.action.kind);
  });

  it("toda ação tem motivo explicado e rótulo conhecido", () => {
    const a = assessRecovery(snap(), NOW, TEMPLATES);
    expect(a.action.reason.length).toBeGreaterThan(10);
    expect(ACTION_LABEL[a.action.kind]).toBeTruthy();
  });
});

// ------------------------------------------------------------------ fila ----
describe("fila de recuperação", () => {
  const items = [
    assessRecovery(snap({ conversationId: "a", leadId: "a" }), NOW, TEMPLATES),
    assessRecovery(
      snap({
        conversationId: "b",
        leadId: "b",
        estimatedValue: 1200,
        temperature: "frio",
        leadStatus: "frio",
        messageCount: 2,
        quote: null,
      }),
      NOW,
      TEMPLATES,
    ),
    assessRecovery(snap({ conversationId: "c", leadId: "c", leadStatus: "fechado" }), NOW, TEMPLATES),
  ];

  it("ordena por score decrescente", () => {
    const q = buildRecoveryQueue(items);
    for (let i = 1; i < q.length; i++) expect(q[i - 1].score).toBeGreaterThanOrEqual(q[i].score);
  });

  it("remove atendimentos encerrados da fila", () => {
    expect(buildRecoveryQueue(items).some((i) => i.conversationId === "c")).toBe(false);
  });

  it("explica a posição de cada item", () => {
    for (const item of buildRecoveryQueue(items)) {
      expect(item.position).toBeGreaterThan(0);
      expect(item.positionReason.length).toBeGreaterThan(10);
    }
  });

  it("desempata pelo valor quando o score é igual", () => {
    const base = snap({ conversationId: "x", leadId: "x" });
    const rico = assessRecovery({ ...base, conversationId: "rico", leadId: "rico" }, NOW, TEMPLATES);
    const pobre = assessRecovery(
      { ...base, conversationId: "pobre", leadId: "pobre" },
      NOW,
      TEMPLATES,
    );
    // Mesmos sinais ⇒ mesmo score; forçamos apenas o valor.
    pobre.estimatedValue = 100;
    const q = buildRecoveryQueue([pobre, rico]);
    expect(q[0].conversationId).toBe("rico");
  });
});

// ------------------------------------------------------------- dashboard ----
describe("cards do dashboard", () => {
  it("os números derivam da mesma fila exibida na lista", () => {
    const all = [
      assessRecovery(snap({ conversationId: "1", leadId: "1" }), NOW, TEMPLATES),
      assessRecovery(
        snap({
          conversationId: "2",
          leadId: "2",
          lastInboundAt: iso(1 * H),
          lastMessageAt: iso(1 * H),
        }),
        NOW,
        TEMPLATES,
      ),
      assessRecovery(snap({ conversationId: "3", leadId: "3", leadStatus: "fechado" }), NOW, TEMPLATES),
    ];
    const queue = buildRecoveryQueue(all);
    const cards = buildDashboardCards(queue, all, NOW);

    expect(cards.windowOpen + cards.windowClosed).toBe(queue.length);
    expect(cards.pending + cards.lost).toBe(queue.length);
    expect(cards.recovered).toBe(1);
    expect(cards.recoveredToday).toBe(1);
    expect(cards.pipelineValue).toBeGreaterThan(0);
  });
});

// ------------------------------------------------------------ incremental ---
describe("processamento incremental", () => {
  it("fingerprint é estável para os mesmos sinais na mesma hora", () => {
    expect(recoveryFingerprint(snap(), NOW)).toBe(recoveryFingerprint(snap(), NOW + 60_000));
  });

  it("fingerprint muda quando chega mensagem nova", () => {
    expect(recoveryFingerprint(snap(), NOW)).not.toBe(
      recoveryFingerprint(snap({ lastMessageAt: iso(1 * H), messageCount: 15 }), NOW),
    );
  });
});

// -------------------------------------------------------------- isolamento --
describe("isolamento", () => {
  it("o motor é puro: não acessa rede, banco nem relógio implícito", () => {
    const a = assessRecovery(snap(), NOW, TEMPLATES);
    const b = assessRecovery(snap(), NOW, TEMPLATES);
    expect(a).toEqual(b);
  });

  it("nenhum campo de outra empresa entra na avaliação", () => {
    const a = assessRecovery(snap(), NOW, TEMPLATES);
    expect(Object.keys(a)).not.toContain("companyId");
    expect(JSON.stringify(a)).not.toMatch(/company_id/);
  });
});
