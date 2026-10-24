import { OpenAiResponsesGateway } from "../src/lib/ai-platform/gateway.server";
import { isLocalOpenAiPilotCompanyEnabled } from "../src/lib/ai-platform/local-pilot.server";
import { EXECUTIVE_NARRATIVE_SCHEMA, NARRATIVE_SYSTEM_PROMPT } from "../src/lib/executive-narrative/ExecutiveNarrativePrompt";

const companyId = process.env.OPENAI_LOCAL_PILOT_COMPANY_ID ?? "";
if (!isLocalOpenAiPilotCompanyEnabled(companyId)) throw new Error("local_pilot_guard_blocked");

const gateway = new OpenAiResponsesGateway();
const results: Array<Record<string, unknown>> = [];
const required = ["greeting", "summary", "priorities", "opportunities", "risks", "nextAction"];

for (let index = 1; index <= 20; index += 1) {
  const startedAt = Date.now();
  try {
    const result = await gateway.run({
      companyId,
      capability: "executive",
      instructions: NARRATIVE_SYSTEM_PROMPT,
      input: `Executivo: Piloto\nMomento do dia: manhã\nSnapshot executivo (JSON — única fonte de verdade): {"period":"piloto-${index}","attendance":{"conversations":10},"sales":{"count":3},"followups":{"stalled":2},"dataQuality":{"tablesEmpty":[],"unavailableMetrics":[],"estimatedMetrics":[],"warnings":[]}}`,
      store: false,
      maxOutputTokens: 1200,
      responseFormat: { type: "json_schema", name: "executive_narrative", schema: EXECUTIVE_NARRATIVE_SCHEMA, strict: true },
      tags: { feature: "executive_narrative_real_pilot", pilot_company: companyId },
    });
    const parsed = JSON.parse(result.outputText);
    const missing = required.filter((field) => !(field in parsed));
    results.push({ index, status: missing.length === 0 ? "passed" : "contract_mismatch", latencyMs: Date.now() - startedAt, inputTokens: result.usage.inputTokens, outputTokens: result.usage.outputTokens, estimatedCostUsd: result.estimatedCostUsd, missing });
  } catch (error) {
    results.push({ index, status: "error", latencyMs: Date.now() - startedAt, errorCode: error instanceof Error ? error.name : "unknown" });
  }
}

console.log(JSON.stringify({
  companyId,
  calls: results.length,
  passed: results.filter((item) => item.status === "passed").length,
  failed: results.filter((item) => item.status !== "passed").length,
  rollbackGuardForOtherCompany: !isLocalOpenAiPilotCompanyEnabled("other-company"),
  noMetaSend: true,
  results,
}, null, 2));
