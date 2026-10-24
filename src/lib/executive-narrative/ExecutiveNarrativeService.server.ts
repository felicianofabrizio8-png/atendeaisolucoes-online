// ============================================================================
// ExecutiveNarrativeService — Gera a narrativa executiva via Lovable AI.
// READ-ONLY: recebe o snapshot já construído, sanitiza, chama LLM e devolve
// o objeto estruturado. Não toca banco, não escreve nada.
// ============================================================================

import type { ExecutiveDashboardBundle } from "@/lib/executive-ai/types";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { OpenAiResponsesGateway } from "@/lib/ai-platform/gateway.server";
import { createSupabaseAiUsageSink } from "@/lib/ai-platform/supabase-usage-sink.server";
import type { ExecutiveNarrative } from "./ExecutiveNarrativeTypes";
import {
  NARRATIVE_SYSTEM_PROMPT,
  EXECUTIVE_NARRATIVE_SCHEMA,
  buildUserPrompt,
  sanitizeSnapshotForLLM,
  type PreviousKnowledgeContext,
} from "./ExecutiveNarrativePrompt";

const GATEWAY_URL = "https://ai.gateway.lovable.dev/v1/chat/completions";
const LOVABLE_MODEL = "google/gemini-2.5-flash";
const OPENAI_MAX_OUTPUT_TOKENS = 900;

export interface NarrativeInput {
  companyId: string;
  bundle: ExecutiveDashboardBundle;
  executiveFirstName: string;
  localHour: number;
  previousKnowledge?: PreviousKnowledgeContext;
}

export function executiveNarrativeOpenAiEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.EXECUTIVE_NARRATIVE_OPENAI_RESPONSES === "enabled";
}

function openAiMaxOutputTokens(env: NodeJS.ProcessEnv = process.env): number {
  const parsed = Number(env.EXECUTIVE_NARRATIVE_OPENAI_MAX_OUTPUT_TOKENS);
  return Number.isInteger(parsed) && parsed > 0
    ? Math.min(parsed, OPENAI_MAX_OUTPUT_TOKENS)
    : OPENAI_MAX_OUTPUT_TOKENS;
}

interface GatewayResponse {
  choices?: Array<{ message?: { content?: string } }>;
}

function parseJsonSafe(text: string): Record<string, unknown> | null {
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    // Fallback: extrai o primeiro objeto {...} do texto.
    const m = text.match(/\{[\s\S]*\}/);
    if (!m) return null;
    try {
      return JSON.parse(m[0]) as Record<string, unknown>;
    } catch {
      return null;
    }
  }
}

function asStringList(v: unknown, max: number): string[] {
  if (!Array.isArray(v)) return [];
  return v
    .filter((x): x is string => typeof x === "string" && x.trim().length > 0)
    .slice(0, max)
    .map((s) => s.trim());
}

export class ExecutiveNarrativeService {
  static async generate(input: NarrativeInput): Promise<ExecutiveNarrative> {
    if (executiveNarrativeOpenAiEnabled()) {
      try {
        return await this.generateWithOpenAi(input);
      } catch (error) {
        console.warn(
          "[executive-narrative] OpenAI indisponível; usando fallback Lovable",
          error instanceof Error ? error.message : "provider_error",
        );
      }
    }
    return this.generateWithLovable(input);
  }

  private static async generateWithOpenAi(input: NarrativeInput): Promise<ExecutiveNarrative> {
    const sanitized = sanitizeSnapshotForLLM(input.bundle);
    const userPrompt = buildUserPrompt(
      sanitized,
      input.executiveFirstName,
      input.localHour,
      input.previousKnowledge,
    );
    const result = await new OpenAiResponsesGateway(undefined, {
      usageSink: createSupabaseAiUsageSink(supabaseAdmin),
    }).run({
      companyId: input.companyId,
      capability: "executive",
      instructions: NARRATIVE_SYSTEM_PROMPT,
      input: `${userPrompt}\n\nRetorne somente JSON válido conforme as instruções.`,
      store: false,
      maxOutputTokens: openAiMaxOutputTokens(),
      reasoning: { effort: "low", mode: "standard", context: "current_turn" },
      responseFormat: {
        type: "json_schema",
        name: "executive_narrative",
        schema: EXECUTIVE_NARRATIVE_SCHEMA,
        strict: true,
      },
      tags: { feature: "executive_narrative", prompt_version: "2026-10-24.a" },
    });
    return this.parseNarrative(result.outputText, input.bundle.generatedAt, result.model);
  }

  private static async generateWithLovable(input: NarrativeInput): Promise<ExecutiveNarrative> {
    const apiKey = process.env.LOVABLE_API_KEY;
    if (!apiKey) throw new Error("missing_api_key");

    const sanitized = sanitizeSnapshotForLLM(input.bundle);
    const userPrompt = buildUserPrompt(
      sanitized,
      input.executiveFirstName,
      input.localHour,
      input.previousKnowledge,
    );

    const res = await fetch(GATEWAY_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: LOVABLE_MODEL,
        messages: [
          { role: "system", content: NARRATIVE_SYSTEM_PROMPT },
          { role: "user", content: userPrompt },
        ],
        response_format: { type: "json_object" },
        temperature: 0.4,
      }),
    });

    if (res.status === 429) throw new Error("rate_limited");
    if (res.status === 402) throw new Error("credits_exhausted");
    if (!res.ok) throw new Error(`gateway_${res.status}`);

    const data = (await res.json()) as GatewayResponse;
    const content = data.choices?.[0]?.message?.content ?? "";
    return this.parseNarrative(content, input.bundle.generatedAt, LOVABLE_MODEL);
  }

  private static parseNarrative(content: string, snapshotGeneratedAt: string, model: string): ExecutiveNarrative {
    const parsed = parseJsonSafe(content);
    if (!parsed) throw new Error("invalid_llm_output");

    const greeting = typeof parsed.greeting === "string" ? parsed.greeting.trim() : "";
    const summary = typeof parsed.summary === "string" ? parsed.summary.trim() : "";
    const nextAction = typeof parsed.nextAction === "string" ? parsed.nextAction.trim() : "";
    if (!summary) throw new Error("invalid_llm_output");

    return {
      greeting,
      summary,
      priorities: asStringList(parsed.priorities, 5),
      opportunities: asStringList(parsed.opportunities, 5),
      risks: asStringList(parsed.risks, 5),
      nextAction,
      generatedAt: new Date().toISOString(),
      snapshotGeneratedAt,
      model,
    };
  }
}
