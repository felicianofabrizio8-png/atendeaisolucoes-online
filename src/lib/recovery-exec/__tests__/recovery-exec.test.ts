// Testes da execução assistida (Fase 6.3) — domínio puro, sem rede nem banco.

import { describe, it, expect } from "vitest";
import {
  RECOVERY_COOLDOWN_MS,
  buildAttemptMetrics,
  buildIdempotencyKey,
  buildTimeline,
  canStartNewAttempt,
  canTransition,
  maskRecipient,
  nextIdempotencyKey,
  previewTemplateBody,
  queueAttemptView,
  validateTemplateSelection,
  type RecoveryAttempt,
  type TemplateCandidate,
} from "@/lib/recovery-exec";

const base: RecoveryAttempt = {
  id: "a1",
  conversationId: "c1",
  leadId: "l1",
  status: "draft",
  score: 80,
  chance: 40,
  tier: "alta",
  strategyFingerprint: "fp",
  messageStyle: null,
  messageText: null,
  templateId: null,
  templateName: null,
  templateVariables: {},
  windowState: "open",
  initiatedBy: "u1",
  initiatedAt: "2026-01-01T10:00:00.000Z",
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
  sendAttempts: 0,
  source: "recovery_queue",
  idempotencyKey: "draft:c1:1",
  createdAt: "2026-01-01T10:00:00.000Z",
  updatedAt: "2026-01-01T10:00:00.000Z",
};

describe("máquina de estados", () => {
  it("não permite enviar sem confirmar", () => {
    expect(canTransition("draft", "sending")).toBe(false);
    expect(canTransition("awaiting_confirmation", "sending")).toBe(false);
    expect(canTransition("confirmed", "sending")).toBe(true);
  });

  it("bloqueia segundo envio a partir de sending", () => {
    expect(canTransition("sending", "sending")).toBe(false);
  });

  it("não regride de enviado para rascunho", () => {
    expect(canTransition("sent", "draft")).toBe(false);
  });

  it("só permite retry a partir de falha", () => {
    expect(canTransition("failed", "confirmed")).toBe(true);
    expect(canTransition("sent", "confirmed")).toBe(false);
  });
});

describe("idempotência", () => {
  it("mantém a mesma chave para o mesmo despacho", () => {
    expect(buildIdempotencyKey("a1", 1)).toBe(nextIdempotencyKey("a1", 0));
    expect(nextIdempotencyKey("a1", 0)).toBe(nextIdempotencyKey("a1", 0));
  });

  it("avança apenas em retry explícito", () => {
    expect(nextIdempotencyKey("a1", 1)).toBe("rec:a1:2");
  });
});

describe("templates", () => {
  const tpl: TemplateCandidate = {
    id: "t1",
    name: "retomada",
    status: "approved",
    language: "pt_BR",
    variables: ["nome", "produto"],
    body: "Oi {{1}}, sobre o {{2}}…",
  };

  it("bloqueia template não aprovado", () => {
    const r = validateTemplateSelection({ ...tpl, status: "pending" }, { nome: "A", produto: "B" });
    expect(r.ok).toBe(false);
  });

  it("bloqueia parâmetro faltando", () => {
    const r = validateTemplateSelection(tpl, { nome: "Ana" });
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.missing).toEqual(["produto"]);
  });

  it("gera preview com as variáveis preenchidas", () => {
    expect(previewTemplateBody(tpl, { nome: "Ana", produto: "spa" })).toBe(
      "Oi Ana, sobre o spa…",
    );
  });
});

describe("cooldown da fila", () => {
  const sentAt = "2026-01-01T12:00:00.000Z";
  const sent: RecoveryAttempt = { ...base, status: "sent", sentAt, responseStatus: "no_reply" };

  it("segura o lead por 24h após envio", () => {
    const view = queueAttemptView(sent, Date.parse(sentAt) + 1000);
    expect(view.state).toBe("waiting_reply");
    expect(canStartNewAttempt(view)).toBe(false);
  });

  it("libera nova tentativa após o cooldown", () => {
    const view = queueAttemptView(sent, Date.parse(sentAt) + RECOVERY_COOLDOWN_MS + 1);
    expect(canStartNewAttempt(view)).toBe(true);
  });

  it("bloqueia enquanto houver tentativa em andamento", () => {
    const view = queueAttemptView({ ...base, status: "confirmed" }, Date.now());
    expect(view.state).toBe("in_progress");
    expect(canStartNewAttempt(view)).toBe(false);
  });

  it("permite retry imediato após falha", () => {
    const view = queueAttemptView({ ...base, status: "failed" }, Date.now());
    expect(canStartNewAttempt(view)).toBe(true);
  });
});

describe("métricas", () => {
  it("conta apenas tentativas realmente enviadas", () => {
    const now = Date.parse("2026-01-01T13:00:00.000Z");
    const m = buildAttemptMetrics(
      [
        { ...base, status: "sent", sentAt: "2026-01-01T12:00:00.000Z" },
        {
          ...base,
          id: "a2",
          status: "replied",
          responseStatus: "replied",
          sentAt: "2026-01-01T11:00:00.000Z",
        },
        { ...base, id: "a3", status: "draft" },
        { ...base, id: "a4", status: "failed" },
      ],
      now,
    );
    expect(m.sent).toBe(2);
    expect(m.replied).toBe(1);
    expect(m.failed).toBe(1);
    expect(m.replyRate).toBe(50);
  });
});

describe("timeline e mascaramento", () => {
  it("traduz eventos para linguagem de vendedor", () => {
    const entries = buildTimeline([
      {
        id: "e1",
        attemptId: "a1",
        conversationId: "c1",
        eventType: "recovery_send_succeeded",
        metadata: {},
        createdAt: "2026-01-01T12:00:00.000Z",
      },
    ]);
    expect(entries[0].label).toContain("Recuperação enviada");
  });

  it("nunca expõe o telefone completo", () => {
    const masked = maskRecipient("5511987654321");
    expect(masked).not.toContain("5511987654321");
    expect(masked).toContain("4321");
  });
});
