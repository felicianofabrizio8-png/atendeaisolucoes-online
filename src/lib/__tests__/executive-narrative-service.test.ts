import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("@/lib/ai-platform/supabase-usage-sink.server", () => ({
  createSupabaseAiUsageSink: () => ({ record: vi.fn() }),
}));
import { ExecutiveNarrativeService } from "../executive-narrative/ExecutiveNarrativeService.server";

const bundle = {
  generatedAt: "2026-10-24T00:00:00.000Z",
  metrics: {
    attendance: { newLeads: 0, attendedLeads: 0, unansweredLeads: 0, avgResponseMinutes: 0, conversionRate: 0, humanAttendedLeads: null, aiAttendedLeads: null, mixedAttendedLeads: null },
    sales: { quotesIssued: 0, estimatedSales: 0, averageTicket: 0, closedCount: 0, lostCount: 0 },
    campaigns: { best: [], worst: [], avgCostPerLead: 0, avgCostPerConversation: 0 },
    topProducts: [], worstProducts: [], lossReasons: [],
    followups: { pending: 0, completed: 0, cancelled: 0 },
    coach: { openAlerts: 0, criticalAlerts: 0, bySeverity: {} },
    aiUsage: { autoReplies: 0, handoffs: 0, qualifications: 0, timeSavedMinutes: 0 },
    evolution: { daily: [], weekly: [], monthly: [] },
  },
  period: "30d",
  range: { from: "2026-09-24", to: "2026-10-24", days: 30, label: "30 dias" },
  insights: [],
  dataQuality: { tablesEmpty: [], unavailableMetrics: [], estimatedMetrics: [], warnings: [] },
} as never;

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("ExecutiveNarrativeService OpenAI rollout", () => {
  it("usa Responses API somente com a flag própria e preserva o tenant", async () => {
    vi.stubEnv("OPENAI_API_KEY", "test-key");
    vi.stubEnv("EXECUTIVE_NARRATIVE_OPENAI_RESPONSES", "enabled");
    vi.stubEnv("EXECUTIVE_NARRATIVE_OPENAI_MAX_OUTPUT_TOKENS", "9999");
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      id: "resp_exec", model: "gpt-6-luna", output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify({
        greeting: "Boa tarde, Ana", summary: "Resumo baseado nos dados disponíveis.", priorities: ["Prioridade"], opportunities: [], risks: [], nextAction: "Revisar o funil.",
      }) }] }], usage: { input_tokens: 10, output_tokens: 20 },
    }), { status: 200, headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await ExecutiveNarrativeService.generate({
      companyId: "company-a", bundle, executiveFirstName: "Ana", localHour: 14,
    });

    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(body.model).toBe("gpt-6-luna");
    expect(body.max_output_tokens).toBe(900);
    expect(body.reasoning).toEqual({ effort: "low", mode: "standard", context: "current_turn" });
    expect(body.store).toBe(false);
    expect(body.text.format).toMatchObject({ type: "json_schema", name: "executive_narrative", strict: true });
    expect(result.model).toBe("gpt-6-luna");
    expect(result.summary).toContain("Resumo");
  });

  it("volta ao provedor anterior quando OpenAI falha", async () => {
    vi.stubEnv("OPENAI_API_KEY", "test-key");
    vi.stubEnv("LOVABLE_API_KEY", "lovable-test-key");
    vi.stubEnv("EXECUTIVE_NARRATIVE_OPENAI_RESPONSES", "enabled");
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response("busy", { status: 503 }))
      .mockResolvedValueOnce(new Response("busy", { status: 503 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        model: "google/gemini-2.5-flash", choices: [{ message: { content: JSON.stringify({
          greeting: "Olá", summary: "Fallback válido.", priorities: [], opportunities: [], risks: [], nextAction: "Nenhuma ação.",
        }) } }],
      }), { status: 200, headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await ExecutiveNarrativeService.generate({
      companyId: "company-b", bundle, executiveFirstName: "Bia", localHour: 9,
    });
    expect(result.model).toBe("google/gemini-2.5-flash");
    expect(result.summary).toBe("Fallback válido.");
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});
