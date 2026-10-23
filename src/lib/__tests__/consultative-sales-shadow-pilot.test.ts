import { describe, expect, it } from "vitest";
import type { AgentSettings } from "../sales-agent-core";
import {
  runConsultativeShadowSafely,
  type ConsultativeShadowAuditMetrics,
  type ConsultativeShadowFeatureSettings,
} from "../consultative-sales-shadow-runtime";
import type { ConsultativeMemoryInput } from "../consultative-sales-memory";

const baseSettings: AgentSettings & ConsultativeShadowFeatureSettings = {
  company_id: "synthetic-company-a",
  ai_auto_reply_enabled: true,
  ai_after_hours_only: false,
  ai_initial_message: null,
  ai_max_auto_replies: 5,
  ai_handoff_timeout_minutes: 30,
  ai_agent_name: "Synthetic Agent",
  business_hours_start: "08:00",
  business_hours_end: "18:00",
};

function makeInput(companyId: string, conversationNumber: number) {
  const settings = { ...baseSettings, company_id: companyId, consultative_shadow_enabled: true };
  const tenant = {
    companyId,
    conversationId: `${companyId}-conversation-${conversationNumber}`,
    leadId: `${companyId}-lead-${conversationNumber}`,
    scopeType: "whatsapp_conversation" as const,
    settings,
    capabilityProfile: {
      version: 1,
      autonomyLevel: "assistido" as const,
      salesAgentMode: null,
      consultativeSales: {
        enabled: true,
        maxQualificationQuestionsPerTurn: 1,
        askReactionAfterPresentation: true,
        avoidRepeatedQuestions: true,
      },
      actions: {},
      authorizedObjectionTypes: [],
    },
    catalogScope: { companyId, activeOnly: true as const },
    groundingSources: [],
    timezone: "UTC",
  };
  const memory: ConsultativeMemoryInput = {
    tenant: {
      companyId,
      conversationId: tenant.conversationId,
      leadId: tenant.leadId,
      scopeType: tenant.scopeType,
    },
    channel: "whatsapp",
    history: [
      {
        role: "lead",
        text: "Quero conhecer opções para o meu cenário.",
        at: "2026-10-20T10:00:00.000Z",
      },
    ],
    salesState: null,
    asOf: "2026-10-20T10:00:00.000Z",
  };
  return { settings, tenant, memory };
}

function percentile(values: number[], p: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * p) - 1)] ?? 0;
}

describe("consultative shadow synthetic pilot", () => {
  it("mede p95/p99 sintéticos e mantém isolamento entre empresas", async () => {
    const metricsByCompany = new Map<string, ConsultativeShadowAuditMetrics[]>();
    const latencies: number[] = [];

    for (let index = 0; index < 100; index += 1) {
      const companyId = index % 2 === 0 ? "synthetic-company-a" : "synthetic-company-b";
      const input = makeInput(companyId, index);
      const startedAt = performance.now();
      const result = await runConsultativeShadowSafely({
        ...input,
        audit: (metrics) => {
          const list = metricsByCompany.get(metrics.companyId) ?? [];
          list.push(metrics);
          metricsByCompany.set(metrics.companyId, list);
        },
      });
      latencies.push(performance.now() - startedAt);
      expect(result).toMatchObject({ enabled: true, executed: true });
    }

    expect(metricsByCompany.get("synthetic-company-a")?.length).toBe(50);
    expect(metricsByCompany.get("synthetic-company-b")?.length).toBe(50);
    for (const [companyId, metrics] of metricsByCompany) {
      expect(metrics.every((item) => item.companyId === companyId)).toBe(true);
      expect(metrics.every((item) => item.conversationId?.startsWith(companyId))).toBe(true);
      expect(metrics.every((item) => item.result === "executed")).toBe(true);
    }

    // O benchmark é informativo; não impõe SLA ao ambiente de testes.
    console.info(
      `[consultative-shadow-pilot] samples=${latencies.length} p95_ms=${percentile(latencies, 0.95).toFixed(2)} p99_ms=${percentile(latencies, 0.99).toFixed(2)} sends=0`,
    );
  });

  it("desliga por rollback sem executar nem auditar", async () => {
    const input = makeInput("synthetic-company-a", 999);
    const auditCalls: ConsultativeShadowAuditMetrics[] = [];
    const result = await runConsultativeShadowSafely({
      ...input,
      settings: { ...input.settings, consultative_shadow_enabled: false },
      audit: (metrics) => {
        auditCalls.push(metrics);
      },
    });

    expect(result).toEqual({ enabled: false, executed: false });
    expect(auditCalls).toHaveLength(0);
  });
});
