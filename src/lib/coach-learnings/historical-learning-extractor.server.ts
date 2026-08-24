import { resolveSalesAgentLlmConfig } from "@/lib/sales-agent-config.server";
import { normalizeAiDraft } from "./interpretation";
import type { CoachLearningDraft } from "./schema";

export type HistoricalLearningAiFailureKind =
  | "config"
  | "auth"
  | "credit"
  | "rate_limit"
  | "timeout"
  | "http"
  | "format";

export class HistoricalLearningAiError extends Error {
  constructor(
    readonly kind: HistoricalLearningAiFailureKind,
    readonly status: number | null = null,
  ) {
    super(`historical_learning_ai_${kind}`);
    this.name = "HistoricalLearningAiError";
  }
}

const SYSTEM_PROMPT = `Voce analisa uma conversa comercial real e extrai SOMENTE comportamento comercial geral e reutilizavel.
Retorne somente JSON valido com este formato:
{
  "category": "objection" | "product_positioning" | "pricing" | "qualification" | "closing" | "followup" | "tone" | "process" | "other",
  "product_ref": string | null,
  "title": string,
  "description": string,
  "rule_structured": string,
  "positive_example": string | null,
  "negative_example": string | null,
  "priority": number,
  "confidence": number
}
Use sempre product_ref null. Nao extraia nem mencione preco, medida, modelo, produto, prazo,
disponibilidade, estoque ou qualquer fato especifico do cliente, mesmo que conste no contexto.
Se a conversa depender desses fatos, generalize apenas a tecnica de comunicacao, qualificacao,
tratamento de objecao, fechamento, follow-up, tom ou processo. Nao copie dados pessoais.`;

function parseStructuredContent(content: unknown): unknown {
  if (typeof content !== "string" || !content.trim()) {
    throw new HistoricalLearningAiError("format");
  }
  const cleaned = content
    .trim()
    .replace(/^```(?:json)?/i, "")
    .replace(/```$/i, "")
    .trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    throw new HistoricalLearningAiError("format");
  }
}

export function classifyHistoricalLlmStatus(status: number): HistoricalLearningAiFailureKind {
  if (status === 401 || status === 403) return "auth";
  if (status === 402) return "credit";
  if (status === 429) return "rate_limit";
  return "http";
}

export async function extractHistoricalLearningDraft(args: {
  companyId: string;
  userExplanation: string;
  env?: Record<string, string | undefined>;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}): Promise<{ draft: CoachLearningDraft; model: string }> {
  const resolved = resolveSalesAgentLlmConfig(args.env ?? process.env);
  if (!resolved.ok) throw new HistoricalLearningAiError("config");
  const { endpoint, model, apiKey } = resolved.config;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), args.timeoutMs ?? 30_000);
  let response: Response;
  try {
    response = await (args.fetchImpl ?? fetch)(endpoint, {
      method: "POST",
      headers: {
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model,
        ...(model.split("/").at(-1) === "gpt-5.6-luna" ? { reasoning_effort: "none" } : {}),
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: args.userExplanation.slice(0, 7000) },
        ],
        response_format: { type: "json_object" },
      }),
      signal: ctrl.signal,
    });
  } catch (error) {
    if (error instanceof HistoricalLearningAiError) throw error;
    if (ctrl.signal.aborted) throw new HistoricalLearningAiError("timeout");
    throw new HistoricalLearningAiError("http");
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    throw new HistoricalLearningAiError(
      classifyHistoricalLlmStatus(response.status),
      response.status,
    );
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new HistoricalLearningAiError("format");
  }
  const content = (payload as { choices?: Array<{ message?: { content?: unknown } }> })
    ?.choices?.[0]?.message?.content;
  const parsed = parseStructuredContent(content);
  const normalized = normalizeAiDraft(parsed, { userExplanation: args.userExplanation });
  if (normalized.usedFallback) throw new HistoricalLearningAiError("format");
  return { draft: normalized.draft, model };
}
