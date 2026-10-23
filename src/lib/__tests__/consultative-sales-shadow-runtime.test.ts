import { describe, expect, it, vi } from "vitest";
import type { AgentSettings } from "../sales-agent-core";
import {
  isConsultativeShadowEnabled,
  runConsultativeShadowSafely,
} from "../consultative-sales-shadow-runtime";
import type { ConsultativeShadowFeatureSettings } from "../consultative-sales-shadow-runtime";
import type { ConsultativeMemoryInput } from "../consultative-sales-memory";

const settings: AgentSettings & ConsultativeShadowFeatureSettings = {
  company_id: "tenant-shadow",
  ai_auto_reply_enabled: true,
  ai_after_hours_only: false,
  ai_initial_message: null,
  ai_max_auto_replies: 5,
  ai_handoff_timeout_minutes: 30,
  ai_agent_name: "Atende Aí",
  business_hours_start: "08:00",
  business_hours_end: "18:00",
};

const memory: ConsultativeMemoryInput = {
  tenant: {
    companyId: "tenant-shadow",
    conversationId: "conversation-shadow",
    leadId: "lead-shadow",
    scopeType: "whatsapp_conversation",
  },
  channel: "whatsapp",
  history: [{ role: "lead", text: "Quero conhecer opções.", at: "2026-10-20T10:00:00.000Z" }],
  salesState: null,
  asOf: "2026-10-20T10:00:00.000Z",
};

function tenant() {
  return {
    companyId: "tenant-shadow",
    conversationId: "conversation-shadow",
    leadId: "lead-shadow",
    scopeType: "whatsapp_conversation" as const,
    settings,
    capabilityProfile: {
      version: 1,
      autonomyLevel: "assistido" as const,
      salesAgentMode: null,
      consultativeSales: { enabled: true, maxQualificationQuestionsPerTurn: 1, askReactionAfterPresentation: true, avoidRepeatedQuestions: true },
      actions: {},
      authorizedObjectionTypes: [],
    },
    catalogScope: { companyId: "tenant-shadow", activeOnly: true as const },
    groundingSources: [],
    timezone: "America/Sao_Paulo",
  };
}

describe("consultative shadow runtime guard", () => {
  it("permanece desligado por padrão e não chama auditoria", async () => {
    const audit = vi.fn();
    expect(isConsultativeShadowEnabled(settings)).toBe(false);
    const result = await runConsultativeShadowSafely({ settings, tenant: tenant(), memory, audit });
    expect(result).toEqual({ enabled: false, executed: false });
    expect(audit).not.toHaveBeenCalled();
  });

  it("executa quando a empresa habilita e registra somente métricas minimizadas", async () => {
    const audit = vi.fn();
    const result = await runConsultativeShadowSafely({
      settings: { ...settings, consultative_shadow_enabled: true },
      tenant: tenant(),
      memory,
      audit,
    });
    expect(result).toMatchObject({ enabled: true, executed: true });
    expect(audit).toHaveBeenCalledWith(expect.objectContaining({
      result: "executed",
      companyId: "tenant-shadow",
      questionGenerated: false,
    }));
    const metrics = audit.mock.calls[0][0] as Record<string, unknown>;
    expect(metrics).not.toHaveProperty("text");
    expect(metrics).not.toHaveProperty("message");
    expect(metrics).not.toHaveProperty("price");
  });

  it("isola falha do shadow e também protege falha do auditor", async () => {
    const audit = vi.fn().mockRejectedValue(new Error("audit_sink_down"));
    const result = await runConsultativeShadowSafely({
      settings: { ...settings, consultative_shadow_enabled: true },
      tenant: tenant(),
      memory: { ...memory, tenant: { ...memory.tenant, companyId: "tenant-other" } },
      audit,
    });
    expect(result.enabled).toBe(true);
    expect(result.executed).toBe(false);
    expect(result.errorCode).toBe("consultative_shadow_tenant_mismatch");
    expect(audit).toHaveBeenCalledTimes(1);
  });
});
