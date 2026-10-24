import { describe, expect, it } from "vitest";
import { recoveryAssistOpenAiEnabled } from "@/routes/api.recovery.assist";
import { buildSystemPrompt, buildUserPrompt } from "@/lib/recovery-ai/prompt";
import { parseRecoveryPlan } from "@/lib/recovery-ai/parser";
import type { RecoveryContext } from "@/lib/recovery-ai/types";

const context: RecoveryContext = {
  conversationId: "conversation-a",
  leadId: "lead-a",
  leadName: "Cliente fictício",
  product: "Produto autorizado",
  source: "WhatsApp",
  leadStatus: "em negociação",
  state: "stalled",
  stateLabel: "aguardando retorno",
  channel: "whatsapp",
  score: 72,
  tier: "alta",
  chancePercent: 64,
  stalledHours: 48,
  stalledLabel: "2 dias",
  lastInteractionAt: "2026-10-24T10:00:00.000Z",
  lastSpeaker: "cliente",
  tags: ["orçamento"],
  estimatedValue: null,
  window: { state: "open", label: "janela aberta", requiresTemplate: false },
  requiredTemplate: null,
  availableTemplates: [],
  summary: "Cliente perguntou sobre prazo e informou que precisa decidir nesta semana.",
  factors: ["cliente demonstrou intenção"],
  engineAction: { kind: "follow_up", label: "retomar", reason: "há intenção registrada" },
};

describe("recovery assist OpenAI rollout", () => {
  it("fica desligado por padrão e exige opt-in explícito", () => {
    expect(recoveryAssistOpenAiEnabled({} as NodeJS.ProcessEnv)).toBe(false);
    expect(recoveryAssistOpenAiEnabled({ RECOVERY_ASSIST_OPENAI_RESPONSES: "enabled" } as NodeJS.ProcessEnv)).toBe(true);
  });

  it("mantém regras de revisão humana e não envio no prompt", () => {
    expect(buildSystemPrompt()).toContain("NUNCA envia mensagens");
    expect(buildUserPrompt(context)).toContain("Produto autorizado");
    expect(buildUserPrompt(context)).not.toContain("Produto inventado");
  });

  it("reconcilia opt-out e template apenas com dados autorizados", () => {
    const optOutContext = { ...context, stateLabel: "opt-out", engineAction: { kind: "stop", label: "não contatar", reason: "cliente pediu para não receber contato" } };
    const parsed = parseRecoveryPlan({ primary_message: "Não farei novo contato.", strategy: "encerrar", insistence: "alta" }, optOutContext);
    expect(parsed.ok).toBe(true);
    expect(parsed.plan?.primaryMessage).toBe("Não farei novo contato.");
    expect(parsed.plan?.requiresTemplate).toBe(false);
  });

  it.each([
    ["objeção", "Cliente levantou objeção de prazo; não há condição comercial autorizada."],
    ["resposta antecipada", "Cliente respondeu antes do horário sugerido e pediu retorno humano."],
    ["ausência de informação", "Não há produto, preço, estoque ou prazo autorizados no contexto."],
  ])("mantém o plano limitado ao histórico em %s", (_scenario, summary) => {
    const parsed = parseRecoveryPlan(
      {
        probable_reason: "há sinais, mas é apenas uma hipótese",
        strategy: "retomar com pergunta leve",
        tone: "consultivo",
        insistence: "baixa",
        best_moment: "após revisão humana",
        cta: "confirmar se ainda faz sentido",
        primary_message: "Posso confirmar se ainda faz sentido conversarmos?",
        alternatives: [],
        explanation: "Plano baseado somente nos sinais registrados.",
      },
      { ...context, summary },
    );
    expect(parsed.ok).toBe(true);
    expect(parsed.plan?.primaryMessage).toContain("confirmar");
    expect(parsed.plan?.templateName).toBeNull();
  });
});
