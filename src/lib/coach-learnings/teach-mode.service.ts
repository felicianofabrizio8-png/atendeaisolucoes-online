// Coach Teach Mode — extração estruturada.
// Server-side apenas. Consome Lovable AI Gateway via LLMGateway existente.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { LLMGateway } from "@/lib/llm-gateway/LLMGateway.server";
import { LovableChatProvider } from "@/lib/llm-gateway/providers/LovableChatProvider";
import {
  CoachLearningDraftSchema,
  TEACH_MODE_PROMPT_VERSION,
  type CoachLearningDraft,
} from "./schema";

type SB = SupabaseClient<Database>;

const TEACH_MODE_MODEL = "google/gemini-2.5-flash";
const TEACH_MODE_TEMPERATURE = 0.2;
const TEACH_MODE_MAX_TOKENS = 900;

const SYSTEM_PROMPT = `Você é o assistente de "Ensinar IA" do Atende Aí.
Um vendedor ou dono da empresa está ensinando uma regra, técnica ou aprendizado que a IA de vendas deve seguir.
Sua tarefa: transformar a explicação em um APRENDIZADO ESTRUTURADO que o Coach usará daqui em diante.

RETORNE APENAS JSON válido (sem markdown, sem fences) com este shape exato:
{
  "category": "objection" | "product_positioning" | "pricing" | "qualification" | "closing" | "followup" | "tone" | "process" | "other",
  "product_ref": string | null,       // nome/categoria de produto quando aplicável, senão null
  "title": string,                    // 3-120 chars, curto e claro
  "description": string,              // 3-2000 chars, contexto humano
  "rule_structured": string,          // regra normalizada em 1-3 frases imperativas
  "positive_example": string | null,  // como fazer certo
  "negative_example": string | null,  // como NÃO fazer
  "priority": number,                 // 0-100. Padrão 50. Objeção crítica ou proibição → 80-95.
  "confidence": number                // 0-1. Quão claro está o ensinamento.
}

Regras:
- Se faltar informação essencial (ex.: qual produto? qual objeção?), retorne o melhor rascunho possível E adicione no description a lista de dúvidas.
- NUNCA invente produtos ou preços que o usuário não mencionou.
- Prefira frases imperativas em rule_structured ("Sempre pergunte…", "Nunca ofereça…").
- product_ref é literal do que o usuário disse; sem inferir catálogo.`;

export interface TeachModeExtractResult {
  draft: CoachLearningDraft;
  raw: unknown;
  provider: string;
  model: string;
  tokensIn: number;
  tokensOut: number;
  latencyMs: number;
  promptVersion: string;
}

function parseJsonSafe(raw: string): unknown | null {
  const cleaned = raw
    .trim()
    .replace(/^```(?:json)?/i, "")
    .replace(/```$/i, "")
    .trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    return null;
  }
}

export async function extractTeachModeDraft(args: {
  supabase: SB;
  companyId: string;
  companyName?: string | null;
  userExplanation: string;
  priorTurns?: Array<{ role: "user" | "assistant"; content: string }>;
}): Promise<TeachModeExtractResult> {
  const { supabase, companyId, companyName, userExplanation, priorTurns = [] } = args;

  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  void supabase; // repositório dedicado à leitura RLS caso venhamos a estender

  const gateway = new LLMGateway(supabaseAdmin, {
    providers: [new LovableChatProvider({ defaultModel: TEACH_MODE_MODEL })],
    cacheEnabled: false,
    retryAttempts: 1,
  });

  const messages = [
    { role: "system" as const, content: SYSTEM_PROMPT },
    ...(companyName
      ? [{ role: "system" as const, content: `Empresa: ${companyName}.` }]
      : []),
    ...priorTurns
      .slice(-8)
      .map((t) => ({ role: t.role, content: (t.content ?? "").slice(0, 1800) })),
    { role: "user" as const, content: userExplanation.slice(0, 4000) },
  ];

  const resp = await gateway.run({
    companyId,
    model: TEACH_MODE_MODEL,
    temperature: TEACH_MODE_TEMPERATURE,
    maxTokens: TEACH_MODE_MAX_TOKENS,
    responseFormat: "json",
    messages,
    tags: {
      feature: "coach_teach_mode",
      prompt_version: TEACH_MODE_PROMPT_VERSION,
    },
  });

  const parsed = parseJsonSafe(resp.text);
  const validation = CoachLearningDraftSchema.safeParse(parsed);
  if (!validation.success) {
    throw new Error("teach_mode_schema_invalid");
  }

  return {
    draft: validation.data,
    raw: parsed,
    provider: resp.provider,
    model: resp.model,
    tokensIn: resp.tokensIn,
    tokensOut: resp.tokensOut,
    latencyMs: resp.latencyMs,
    promptVersion: TEACH_MODE_PROMPT_VERSION,
  };
}
