// ============================================================================
// FASE 6.3.1 — Reconciliação de status, precedência, métricas e timeline.
// Todos os testes são sobre módulos PUROS: nenhuma I/O, nenhum disparo.
// ============================================================================

import { describe, it, expect } from "vitest";
import {
  reconcileDeliveryStatus,
  normalizeProviderStatus,
  deliveryRank,
  DELIVERY_PRECEDENCE,
} from "../reconcile";
import { buildAttemptMetrics } from "../metrics";
import { buildTimeline } from "../timeline";
import type { RecoveryAttempt, RecoveryAttemptEvent } from "../types";

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2026, 6, 31, 12, 0, 0);

function attempt(over: Partial<RecoveryAttempt>): RecoveryAttempt {
  return {
    id: over.id ?? "a1",
    conversationId: "c1",
    leadId: "l1",
    status: "sent",
    score: null,
    chance: null,
    tier: null,
    strategyFingerprint: null,
    messageStyle: null,
    messageText: null,
    templateId: null,
    templateName: null,
    templateVariables: {},
    windowState: null,
    initiatedBy: null,
    initiatedAt: new Date(NOW).toISOString(),
    confirmedAt: null,
    sentAt: null,
    messageId: null,
    deliveryStatus: null,
    responseStatus: null,
    repliedAt: null,
    outcome: null,
    outcomeAt: null,
    failureCode: null,
    failureMessage: null,
    sendAttempts: 1,
    source: "recovery_queue",
    idempotencyKey: "k",
    createdAt: new Date(NOW).toISOString(),
    updatedAt: new Date(NOW).toISOString(),
    ...over,
  };
}

describe("normalização e precedência", () => {
  it("mapeia rótulos do provedor", () => {
    expect(normalizeProviderStatus("DELIVERED")).toBe("delivered");
    expect(normalizeProviderStatus("accepted")).toBe("sent");
    expect(normalizeProviderStatus("undelivered")).toBe("failed");
    expect(normalizeProviderStatus("deleted")).toBeNull();
    expect(normalizeProviderStatus(undefined)).toBeNull();
  });

  it("mantém ordem explícita sent < delivered < read", () => {
    expect(DELIVERY_PRECEDENCE.sent).toBeLessThan(DELIVERY_PRECEDENCE.delivered);
    expect(DELIVERY_PRECEDENCE.delivered).toBeLessThan(DELIVERY_PRECEDENCE.read);
    expect(deliveryRank("read")).toBe(3);
    expect(deliveryRank(null)).toBe(0);
  });
});

describe("reconciliação de entrega", () => {
  it("aplica o primeiro status recebido", () => {
    const d = reconcileDeliveryStatus({ currentMessageStatus: null, incoming: "sent" });
    expect(d.changed).toBe(true);
    expect(d.nextMessageStatus).toBe("sent");
    expect(d.reason).toBe("primeiro_status");
  });

  it("avança sent → delivered e move a tentativa", () => {
    const d = reconcileDeliveryStatus({
      currentMessageStatus: "sent",
      incoming: "delivered",
      attemptStatus: "sent",
    });
    expect(d.changed).toBe(true);
    expect(d.nextAttemptStatus).toBe("delivered");
  });

  it("avança para read e move a tentativa", () => {
    const d = reconcileDeliveryStatus({
      currentMessageStatus: "delivered",
      incoming: "read",
      attemptStatus: "delivered",
    });
    expect(d.nextAttemptStatus).toBe("read");
  });

  it("é idempotente com callback duplicado", () => {
    const d = reconcileDeliveryStatus({ currentMessageStatus: "delivered", incoming: "delivered" });
    expect(d.changed).toBe(false);
    expect(d.reason).toBe("evento_duplicado");
  });

  it("não regride read → delivered (evento fora de ordem)", () => {
    const d = reconcileDeliveryStatus({
      currentMessageStatus: "read",
      incoming: "delivered",
      attemptStatus: "read",
    });
    expect(d.changed).toBe(false);
    expect(d.reason).toBe("evento_atrasado_fora_de_ordem");
  });

  it("aceita read antes de delivered e termina em read", () => {
    const first = reconcileDeliveryStatus({
      currentMessageStatus: "sent",
      incoming: "read",
      attemptStatus: "sent",
    });
    expect(first.nextMessageStatus).toBe("read");
    expect(first.nextAttemptStatus).toBe("read");
    const late = reconcileDeliveryStatus({
      currentMessageStatus: "read",
      incoming: "delivered",
      attemptStatus: "read",
    });
    expect(late.changed).toBe(false);
  });

  it("não regride sent atrasado depois de delivered", () => {
    const d = reconcileDeliveryStatus({ currentMessageStatus: "delivered", incoming: "sent" });
    expect(d.changed).toBe(false);
  });

  it("registra failed apenas quando ainda não houve entrega", () => {
    const ok = reconcileDeliveryStatus({ currentMessageStatus: "sent", incoming: "failed" });
    expect(ok.changed).toBe(true);
    expect(ok.nextMessageStatus).toBe("failed");
    expect(ok.nextAttemptStatus).toBeNull();

    const afterRead = reconcileDeliveryStatus({ currentMessageStatus: "read", incoming: "failed" });
    expect(afterRead.changed).toBe(false);
    expect(afterRead.reason).toBe("falha_apos_entrega_ignorada");

    const dup = reconcileDeliveryStatus({ currentMessageStatus: "failed", incoming: "failed" });
    expect(dup.changed).toBe(false);
  });

  it("ignora status desconhecido", () => {
    const d = reconcileDeliveryStatus({ currentMessageStatus: "sent", incoming: "banana" });
    expect(d.changed).toBe(false);
    expect(d.reason).toBe("status_desconhecido");
  });

  it("não move tentativa já respondida ou finalizada", () => {
    for (const status of ["replied", "recovered", "not_recovered"] as const) {
      const d = reconcileDeliveryStatus({
        currentMessageStatus: "delivered",
        incoming: "read",
        attemptStatus: status,
      });
      expect(d.changed).toBe(true);
      expect(d.nextAttemptStatus).toBeNull();
    }
  });

  it("atualiza a mensagem mesmo sem tentativa vinculada", () => {
    const d = reconcileDeliveryStatus({ currentMessageStatus: "sent", incoming: "delivered" });
    expect(d.changed).toBe(true);
    expect(d.nextAttemptStatus).toBeNull();
  });
});

describe("métricas operacionais", () => {
  const attempts: RecoveryAttempt[] = [
    attempt({ id: "1", status: "sent" }),
    attempt({ id: "2", status: "delivered" }),
    attempt({ id: "3", status: "read" }),
    attempt({ id: "4", status: "replied", responseStatus: "replied" }),
    attempt({ id: "5", status: "recovered", responseStatus: "replied", outcome: "recovered" }),
    attempt({ id: "6", status: "not_recovered", outcome: "not_recovered" }),
    attempt({ id: "7", status: "failed" }),
    attempt({ id: "8", status: "draft", createdAt: new Date(NOW - 5 * DAY).toISOString() }),
  ];

  it("conta cada desfecho a partir de tentativas reais", () => {
    const m = buildAttemptMetrics(attempts, NOW);
    expect(m.sent).toBe(6);
    expect(m.failed).toBe(1);
    expect(m.replied).toBe(2);
    expect(m.recovered).toBe(1);
    expect(m.notRecovered).toBe(1);
    expect(m.waitingReply).toBe(3);
  });

  it("calcula taxas de resposta e recuperação", () => {
    const m = buildAttemptMetrics(attempts, NOW);
    expect(m.replyRate).toBe(33);
    expect(m.recoveryRate).toBe(17);
  });

  it("conta apenas o período de hoje em `today`", () => {
    const m = buildAttemptMetrics(attempts, NOW);
    expect(m.today).toBe(7);
  });

  it("respeita o recorte por período (lista já filtrada)", () => {
    const recentOnly = attempts.filter(
      (a) => NOW - new Date(a.createdAt).getTime() <= DAY,
    );
    const m = buildAttemptMetrics(recentOnly, NOW);
    expect(m.today).toBe(7);
  });

  it("empresa sem tentativas devolve tudo zerado", () => {
    const m = buildAttemptMetrics([], NOW);
    expect(m).toMatchObject({ sent: 0, replyRate: 0, recoveryRate: 0 });
  });
});

describe("timeline amigável", () => {
  const ev = (t: RecoveryAttemptEvent["eventType"], i: number): RecoveryAttemptEvent => ({
    id: `e${i}`,
    attemptId: "a1",
    conversationId: "c1",
    eventType: t,
    metadata: {},
    createdAt: new Date(NOW + i * 1000).toISOString(),
  });

  it("descreve entrega, leitura, resposta e desfecho sem jargão técnico", () => {
    const timeline = buildTimeline([
      ev("recovery_send_succeeded", 0),
      ev("recovery_message_delivered", 1),
      ev("recovery_message_read", 2),
      ev("recovery_reply_detected", 3),
      ev("recovery_marked_recovered", 4),
      ev("recovery_marked_not_recovered", 5),
    ]);
    const text = timeline.map((t) => t.label).join(" | ");
    expect(text).toContain("Recuperação enviada");
    expect(text).toContain("Mensagem entregue ao cliente");
    expect(text).toContain("Mensagem visualizada pelo cliente");
    expect(text).toContain("Cliente respondeu");
    expect(text).toContain("Lead marcado como recuperado");
    expect(text).toContain("Lead marcado como não recuperado");
    expect(text.toLowerCase()).not.toMatch(/webhook|callback|idempot|cas\b/);
  });

  it("não duplica entradas quando o mesmo evento não é registrado duas vezes", () => {
    const timeline = buildTimeline([ev("recovery_message_delivered", 1)]);
    expect(timeline).toHaveLength(1);
  });
});
