// Fase 6.4 — provas do Learning Engine em SHADOW MODE.
import { describe, it, expect } from "vitest";
import {
  buildDataset,
  buildLearningReport,
  buildShadowRanking,
  deserializeModel,
  detectDrift,
  buildCalibration,
  featuresOfQueueItem,
  serializeModel,
  toLearningEvent,
  trainShadowModel,
  aggregateGroups,
  type AttemptLike,
  type RecoveryLearningEvent,
} from "@/lib/recovery-learning";

const BASE: AttemptLike = {
  id: "a1",
  company_id: "c1",
  lead_id: "l1",
  conversation_id: "cv1",
  status: "recovered",
  recovery_score: 70,
  recovery_chance: 60,
  recovery_tier: "alta",
  strategy_fingerprint: "prova_social",
  selected_message_style: "consultivo",
  selected_message_text: "Oi Maria, o senhor ainda tem interesse na piscina de fibra?",
  template_id: null,
  template_name: null,
  window_state: "open",
  initiated_by: "u1",
  sent_at: "2026-01-10T13:00:00.000Z",
  replied_at: "2026-01-10T14:00:00.000Z",
  response_status: "replied",
  outcome: "recovered",
  outcome_at: "2026-01-11T10:00:00.000Z",
  created_at: "2026-01-10T12:55:00.000Z",
  product: "Piscina de fibra",
  source: "instagram",
  estimated_value: 30000,
  stalled_hours: 50,
  attempt_index: 1,
};

function attempt(over: Partial<AttemptLike>, i: number): AttemptLike {
  return { ...BASE, id: `a${i}`, conversation_id: `cv${i}`, lead_id: `l${i}`, ...over };
}

function events(list: AttemptLike[]): RecoveryLearningEvent[] {
  return list.map(toLearningEvent).filter((e): e is RecoveryLearningEvent => e !== null);
}

describe("dataset e privacidade", () => {
  it("nunca guarda o texto da mensagem, apenas fingerprint e faixa", () => {
    const event = toLearningEvent(BASE)!;
    const serialized = JSON.stringify(event);
    expect(serialized).not.toContain("Maria");
    expect(serialized).not.toContain("piscina de fibra?");
    expect(event.messageFingerprint).toBeTruthy();
    expect(event.messageLengthBucket).toBe("curta");
  });

  it("fingerprint é estável para o mesmo texto e distinto para outro", () => {
    const a = toLearningEvent(BASE)!;
    const b = toLearningEvent({ ...BASE, id: "a2" })!;
    const c = toLearningEvent({ ...BASE, id: "a3", selected_message_text: "outro texto" })!;
    expect(a.messageFingerprint).toBe(b.messageFingerprint);
    expect(a.messageFingerprint).not.toBe(c.messageFingerprint);
  });

  it("ignora tentativas ainda em andamento", () => {
    expect(toLearningEvent({ ...BASE, status: "draft" })).toBeNull();
    expect(toLearningEvent({ ...BASE, status: "confirmed" })).toBeNull();
    expect(toLearningEvent({ ...BASE, status: "sending" })).toBeNull();
  });

  it("classifica desfechos observáveis", () => {
    expect(toLearningEvent({ ...BASE, status: "failed", outcome: null })!.outcome).toBe("failed");
    expect(
      toLearningEvent({
        ...BASE,
        status: "sent",
        outcome: null,
        replied_at: null,
        response_status: null,
      })!.outcome,
    ).toBe("no_reply");
  });
});

describe("agregação e rigor estatístico", () => {
  const many = Array.from({ length: 30 }, (_, i) =>
    attempt(
      i < 15
        ? { product: "Piscina de fibra", outcome: "recovered", status: "recovered" }
        : {
            product: "Deck",
            outcome: "not_recovered",
            status: "not_recovered",
            replied_at: null,
            response_status: null,
          },
      i,
    ),
  );

  it("calcula lift contra a taxa base da empresa", () => {
    const dataset = buildDataset(events(many));
    const groups = aggregateGroups(dataset);
    const fibra = groups.produto.find((g) => g.value === "Piscina de fibra")!;
    expect(dataset.baseRecoveryRate).toBeCloseTo(0.5, 5);
    expect(fibra.recoveryRate).toBe(1);
    expect(fibra.liftPp).toBe(50);
  });

  it("não gera insight sem amostra mínima", () => {
    const few = Array.from({ length: 5 }, (_, i) => attempt({}, i));
    const { report } = buildLearningReport(events(few), {
      windowLabel: "últimos 90 dias",
      now: Date.parse("2026-02-01T00:00:00Z"),
      driftSplitAt: Date.parse("2026-01-01T00:00:00Z"),
    });
    expect(report.insights).toHaveLength(0);
  });

  it("insights usam linguagem probabilística, sem causalidade", () => {
    const { report } = buildLearningReport(events(many), {
      windowLabel: "últimos 90 dias",
      now: Date.parse("2026-02-01T00:00:00Z"),
      driftSplitAt: Date.parse("2026-01-01T00:00:00Z"),
    });
    expect(report.insights.length).toBeGreaterThan(0);
    for (const insight of report.insights) {
      expect(insight.text).toMatch(/associação observada, não causa comprovada/);
      expect(insight.samples).toBeGreaterThanOrEqual(8);
      expect(insight.text).not.toMatch(/\bporque\b/);
    }
  });
});

describe("shadow mode não altera produção", () => {
  const many = Array.from({ length: 24 }, (_, i) =>
    attempt(
      i % 2 === 0
        ? { source: "instagram", outcome: "recovered", status: "recovered" }
        : {
            source: "facebook",
            outcome: "not_recovered",
            status: "not_recovered",
            replied_at: null,
            response_status: null,
          },
      i,
    ),
  );

  const dataset = buildDataset(events(many));
  const model = trainShadowModel(aggregateGroups(dataset), dataset.baseRecoveryRate, dataset.total);

  it("preserva o array de entrada da fila", () => {
    const items = [
      { conversationId: "x", leadName: "A", score: 40, position: 1, features: [] },
      { conversationId: "y", leadName: "B", score: 80, position: 2, features: [] },
    ];
    const snapshot = JSON.stringify(items);
    buildShadowRanking(model, items);
    expect(JSON.stringify(items)).toBe(snapshot);
  });

  it("shadow score fica limitado a ±30 pontos", () => {
    const ranking = buildShadowRanking(model, [
      {
        conversationId: "x",
        leadName: "A",
        score: 50,
        position: 1,
        features: [
          { key: "origem", value: "instagram" },
          { key: "produto", value: "Piscina de fibra" },
          { key: "tom", value: "consultivo" },
          { key: "estrategia", value: "prova_social" },
        ],
      },
    ]);
    const move = [...ranking.wouldRiseTop, ...ranking.wouldFallTop][0];
    if (move) expect(Math.abs(move.learnedScore - move.currentScore)).toBeLessThanOrEqual(30);
  });

  it("modelo sobrevive à serialização para o cliente", () => {
    const restored = deserializeModel(serializeModel(model));
    expect(restored.weights.size).toBe(model.weights.size);
    expect(restored.baseRate).toBe(model.baseRate);
  });

  it("fila idêntica produz correlação 1", () => {
    const items = Array.from({ length: 5 }, (_, i) => ({
      conversationId: `c${i}`,
      leadName: `L${i}`,
      score: 90 - i * 10,
      position: i + 1,
      features: [],
    }));
    const ranking = buildShadowRanking(model, items);
    expect(ranking.changedItems).toBe(0);
    expect(ranking.spearman).toBe(1);
  });
});

describe("drift", () => {
  it("detecta queda de desempenho entre janelas", () => {
    const older = Array.from({ length: 12 }, (_, i) =>
      attempt(
        {
          created_at: "2026-01-02T12:00:00.000Z",
          sent_at: "2026-01-02T12:00:00.000Z",
          outcome: "recovered",
          status: "recovered",
        },
        i,
      ),
    );
    const newer = Array.from({ length: 12 }, (_, i) =>
      attempt(
        {
          created_at: "2026-02-02T12:00:00.000Z",
          sent_at: "2026-02-02T12:00:00.000Z",
          outcome: "not_recovered",
          status: "not_recovered",
          replied_at: null,
          response_status: null,
        },
        i + 100,
      ),
    );
    const dataset = buildDataset(events([...older, ...newer]));
    const alerts = detectDrift(dataset.rows, { splitAt: Date.parse("2026-01-20T00:00:00Z") });
    expect(alerts.length).toBeGreaterThan(0);
    expect(alerts[0].deltaPp).toBeLessThan(0);
    expect(alerts[0].text).toMatch(/queda/);
  });
});

describe("calibração", () => {
  it("aponta faixa superestimada quando a chance não se confirma", () => {
    const rows = buildDataset(
      events(
        Array.from({ length: 20 }, (_, i) =>
          attempt(
            {
              recovery_chance: 90,
              outcome: "not_recovered",
              status: "not_recovered",
              replied_at: null,
              response_status: null,
            },
            i,
          ),
        ),
      ),
    ).rows;
    const report = buildCalibration(rows);
    expect(report.samples).toBe(20);
    expect(report.brier).toBeGreaterThan(0.5);
    expect(report.notes.join(" ")).toMatch(/superestimada/);
  });

  it("recomendação nunca é aplicada automaticamente", () => {
    const many = Array.from({ length: 24 }, (_, i) =>
      attempt(
        i % 2 === 0
          ? { outcome: "recovered", status: "recovered", recovery_chance: 20 }
          : {
              outcome: "not_recovered",
              status: "not_recovered",
              recovery_chance: 95,
              replied_at: null,
              response_status: null,
            },
        i,
      ),
    );
    const { report } = buildLearningReport(events(many), {
      windowLabel: "últimos 90 dias",
      now: Date.parse("2026-02-01T00:00:00Z"),
      driftSplitAt: Date.parse("2026-01-01T00:00:00Z"),
    });
    for (const rec of report.recommendations) {
      expect(rec.autoApplied).toBe(false);
    }
  });
});

describe("features da fila viva", () => {
  it("deriva as mesmas dimensões do dataset sem expor PII", () => {
    const feats = featuresOfQueueItem(
      {
        conversationId: "cv1",
        leadName: "Maria Silva",
        product: "Piscina de fibra",
        channel: "whatsapp",
        score: 72,
        estimatedValue: 30000,
        stalledHours: 50,
        position: 1,
        window: { state: "open" },
        action: { requiresTemplate: false },
      },
      Date.parse("2026-01-10T13:00:00Z"),
    );
    const json = JSON.stringify(feats);
    expect(json).not.toContain("Maria");
    expect(feats.find((f) => f.key === "faixa_score")?.value).toBe("70-79");
    expect(feats.find((f) => f.key === "janela")?.value).toBe("aberta");
    expect(feats.find((f) => f.key === "tempo_parado")?.value).toBe("1_3_dias");
  });
});

describe("determinismo", () => {
  it("mesmos eventos e mesmo relógio produzem o mesmo relatório", () => {
    const list = events(Array.from({ length: 20 }, (_, i) => attempt({}, i)));
    const opts = {
      windowLabel: "últimos 90 dias",
      now: Date.parse("2026-02-01T00:00:00Z"),
      driftSplitAt: Date.parse("2026-01-01T00:00:00Z"),
    };
    expect(JSON.stringify(buildLearningReport(list, opts).report)).toBe(
      JSON.stringify(buildLearningReport(list, opts).report),
    );
  });
});
