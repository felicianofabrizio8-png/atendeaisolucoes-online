// Coach Interpreter — Service.
// Puro em relação ao TanStack Start: recebe supabase autenticado do handler,
// não conhece HTTP nem sessão.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { LLMGateway } from "@/lib/llm-gateway/LLMGateway.server";
import type { LLMProvider } from "@/lib/llm-gateway/LLMProvider";
import { LovableChatProvider } from "@/lib/llm-gateway/providers/LovableChatProvider";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  CoachInterpreterOutputSchema,
  type CoachInterpreterOutput,
  safeSummarizeZodError,
} from "./schema";
import {
  buildCoachInterpreterRepairPrompt,
  buildCoachInterpreterSystemPrompt,
  buildCoachInterpreterTurns,
  COACH_INTERPRETER_PROMPT_VERSION,
  type CoachPromptTurn,
} from "./prompt/interpreter-prompt.v1";
import {
  findPotentialDuplicateRules,
  insertAssistantCoachMessage,
  insertCoachProposals,
  listCoachMessages,
} from "./coach-interpreter.repository";
import {
  COACH_INTERPRETER_CONFIDENCE_MIN_PROPOSAL,
  COACH_INTERPRETER_MAX_CLARIFICATIONS,
  COACH_INTERPRETER_MAX_HISTORY_MESSAGES,
  COACH_INTERPRETER_MAX_TOKENS,
  COACH_INTERPRETER_MODEL,
  COACH_INTERPRETER_PROVIDER,
  COACH_INTERPRETER_TEMPERATURE,
  type CoachInterpreterOutcome,
  type CoachInterpreterRunMeta,
} from "./types";

type SB = SupabaseClient<Database>;

export interface InterpretCoachMessageInput {
  supabase: SB;
  companyId: string;
  conversationId: string;
  userMessageId: string;
  userMessageText: string;
  companyName?: string | null;
  companyTone?: string | null;
  providers?: LLMProvider[]; // testes injetam mocks
}

export interface InterpretCoachMessageResult {
  outcome: CoachInterpreterOutcome;
  run: CoachInterpreterRunMeta;
  assistantMessageId: string;
}

function parseJsonSafe(raw: string): unknown | null {
  const t = raw.trim();
  // Strip fences se o modelo teimar em enviá-las.
  const cleaned = t.replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    return null;
  }
}

async function buildHistoryTurns(sb: SB, conversationId: string): Promise<CoachPromptTurn[]> {
  const msgs = await listCoachMessages(sb, conversationId, 200);
  const relevant = msgs
    .filter((m) => m.kind === "user_message" || m.kind === "assistant_message")
    .slice(-1 - COACH_INTERPRETER_MAX_HISTORY_MESSAGES, -1); // exclui a mensagem atual
  return relevant.map<CoachPromptTurn>((m) => ({
    role: m.kind === "user_message" ? "user" : "assistant",
    content: (m.content ?? "").slice(0, 2000),
  }));
}

function countPriorClarifications(sb: SB, conversationId: string): Promise<number> {
  return listCoachMessages(sb, conversationId, 200).then((msgs) =>
    msgs.filter((m) => m.kind === "clarification_request").length,
  );
}

export async function interpretCoachMessage(
  input: InterpretCoachMessageInput,
): Promise<InterpretCoachMessageResult> {
  const {
    supabase,
    companyId,
    conversationId,
    userMessageId,
    userMessageText,
    companyName,
    companyTone,
  } = input;

  const providers: LLMProvider[] =
    input.providers && input.providers.length > 0
      ? input.providers
      : [new LovableChatProvider({ defaultModel: COACH_INTERPRETER_MODEL })];

  const gateway = new LLMGateway(supabaseAdmin, {
    providers,
    cacheEnabled: false, // determinismo por conversa; cache aqui pode confundir
    retryAttempts: 2,
  });

  const systemPrompt = buildCoachInterpreterSystemPrompt({
    companyName: companyName ?? null,
    tone: companyTone ?? null,
  });
  const history = await buildHistoryTurns(supabase, conversationId);
  const turns = buildCoachInterpreterTurns(history, userMessageText);

  const baseMessages = [
    { role: "system" as const, content: systemPrompt },
    ...turns.map((t) => ({ role: t.role, content: t.content })),
  ];

  let attempts = 0;
  let repaired = false;
  let provider: string = COACH_INTERPRETER_PROVIDER;
  let model: string = COACH_INTERPRETER_MODEL;
  let tokensIn = 0;
  let tokensOut = 0;
  let latencyMs = 0;

  const tryOnce = async (messages: typeof baseMessages) => {
    attempts += 1;
    const resp = await gateway.run({
      companyId,
      model: COACH_INTERPRETER_MODEL,
      temperature: COACH_INTERPRETER_TEMPERATURE,
      maxTokens: COACH_INTERPRETER_MAX_TOKENS,
      responseFormat: "json",
      messages,
      tags: {
        feature: "coach_interpreter",
        conversation_id: conversationId,
        message_id: userMessageId,
        prompt_version: COACH_INTERPRETER_PROMPT_VERSION,
      },
    });
    provider = resp.provider;
    model = resp.model;
    tokensIn += resp.tokensIn;
    tokensOut += resp.tokensOut;
    latencyMs += resp.latencyMs;
    return resp.text;
  };

  const buildRun = (
    errorClass?: CoachInterpreterRunMeta["error_class"],
  ): CoachInterpreterRunMeta => ({
    attempts,
    repaired,
    provider,
    model,
    tokens_in: tokensIn,
    tokens_out: tokensOut,
    latency_ms: latencyMs,
    prompt_version: COACH_INTERPRETER_PROMPT_VERSION,
    ...(errorClass ? { error_class: errorClass } : {}),
  });

  let raw: string;
  try {
    raw = await tryOnce(baseMessages);
  } catch (err) {
    const isTimeout = /timeout/i.test(err instanceof Error ? err.message : "");
    const cls: CoachInterpreterRunMeta["error_class"] = isTimeout
      ? "timeout"
      : "provider_failure";
    const run = buildRun(cls);
    const msg = await insertAssistantCoachMessage(
      supabase,
      companyId,
      conversationId,
      "Falha ao consultar o modelo. Tente novamente.",
      { error: err instanceof Error ? err.message.slice(0, 200) : "unknown" },
      run,
      "error",
    );
    return {
      outcome: { kind: "error", error_class: cls, message: "provider_call_failed" },
      run,
      assistantMessageId: msg.id,
    };
  }

  let parsed = parseJsonSafe(raw);
  let validation = parsed ? CoachInterpreterOutputSchema.safeParse(parsed) : null;

  if (!validation || !validation.success) {
    // Repair pass — 1 tentativa apenas.
    const summary = validation && !validation.success
      ? safeSummarizeZodError(validation.error)
      : "resposta anterior não era JSON válido";
    const repairMessages = [
      ...baseMessages,
      { role: "assistant" as const, content: raw.slice(0, 2000) },
      { role: "user" as const, content: buildCoachInterpreterRepairPrompt(summary) },
    ];
    try {
      raw = await tryOnce(repairMessages);
      repaired = true;
      parsed = parseJsonSafe(raw);
      validation = parsed ? CoachInterpreterOutputSchema.safeParse(parsed) : null;
    } catch (err) {
      const run = buildRun("provider_failure");
      const msg = await insertAssistantCoachMessage(
        supabase,
        companyId,
        conversationId,
        "Falha ao consultar o modelo no reparo.",
        { error: err instanceof Error ? err.message.slice(0, 200) : "unknown" },
        run,
        "error",
      );
      return {
        outcome: { kind: "error", error_class: "provider_failure", message: "provider_repair_failed" },
        run,
        assistantMessageId: msg.id,
      };
    }
  }

  if (!validation || !validation.success) {
    const run = buildRun("schema_invalid");
    const msg = await insertAssistantCoachMessage(
      supabase,
      companyId,
      conversationId,
      "Não consegui interpretar a mensagem em um formato válido. Pode reformular?",
      {
        validation_error: validation
          ? safeSummarizeZodError(validation.error).slice(0, 500)
          : "no_json",
      },
      run,
      "error",
    );
    return {
      outcome: { kind: "error", error_class: "schema_invalid", message: "schema_invalid" },
      run,
      assistantMessageId: msg.id,
    };
  }

  const out: CoachInterpreterOutput = validation.data;

  // Clarificação determinística no servidor (evita esconder baixa confiança).
  const priorClarifications = await countPriorClarifications(supabase, conversationId);
  const materialAmbiguity =
    out.proposals.some((p) => p.ambiguities.length > 0 && p.confidence < COACH_INTERPRETER_CONFIDENCE_MIN_PROPOSAL);
  const needsClarify =
    out.clarification_questions.length > 0 &&
    (out.confidence < COACH_INTERPRETER_CONFIDENCE_MIN_PROPOSAL ||
      materialAmbiguity ||
      out.proposals.length === 0);

  if (needsClarify) {
    if (priorClarifications >= COACH_INTERPRETER_MAX_CLARIFICATIONS) {
      const run = buildRun();
      const msg = await insertAssistantCoachMessage(
        supabase,
        companyId,
        conversationId,
        "Ainda há ambiguidade, mas atingimos o limite de perguntas. Revise manualmente.",
        {
          intent: out.intent,
          warnings: [...out.warnings, "max_clarifications_reached"],
          normalized_output: out,
        },
        run,
        "assistant_message",
      );
      return {
        outcome: {
          kind: "classified",
          intent: out.intent,
          warnings: [...out.warnings, "max_clarifications_reached"],
        },
        run,
        assistantMessageId: msg.id,
      };
    }
    const run = buildRun();
    const msg = await insertAssistantCoachMessage(
      supabase,
      companyId,
      conversationId,
      out.clarification_questions.join("\n"),
      {
        intent: out.intent,
        clarification_questions: out.clarification_questions,
        normalized_output: out,
      },
      run,
      "clarification_request",
    );
    return {
      outcome: {
        kind: "clarification",
        questions: out.clarification_questions,
        warnings: out.warnings,
      },
      run,
      assistantMessageId: msg.id,
    };
  }

  // Sem proposals: classifica e não persiste em knowledge/faq/quick_reply/marketing.
  if (out.proposals.length === 0) {
    const run = buildRun();
    const msg = await insertAssistantCoachMessage(
      supabase,
      companyId,
      conversationId,
      out.reasoning_summary || "Mensagem classificada sem proposta de regra.",
      { intent: out.intent, warnings: out.warnings, normalized_output: out },
      run,
      "assistant_message",
    );
    return {
      outcome: { kind: "classified", intent: out.intent, warnings: out.warnings },
      run,
      assistantMessageId: msg.id,
    };
  }

  // Duplicidade determinística (warning, nunca bloqueia).
  const warnings = [...out.warnings];
  for (const p of out.proposals) {
    try {
      const dup = await findPotentialDuplicateRules(supabase, p);
      if (dup.ruleIds.length + dup.proposalIds.length > 0) {
        warnings.push(`possible_duplicate:${p.category}:${p.title}`);
      }
    } catch {
      // não bloqueia
    }
  }

  const rows = await insertCoachProposals(
    supabase,
    companyId,
    conversationId,
    userMessageId,
    out.proposals,
    out as unknown as Record<string, unknown>,
    provider,
    model,
    COACH_INTERPRETER_PROMPT_VERSION,
  );
  const run: CoachInterpreterRunMeta = {
    ...buildRun(),
    duplicate_warning: warnings.some((w) => w.startsWith("possible_duplicate:")),
  };
  const msg = await insertAssistantCoachMessage(
    supabase,
    companyId,
    conversationId,
    out.reasoning_summary || "Proposta(s) de regra geradas para sua revisão.",
    {
      intent: out.intent,
      proposal_ids: rows.map((r) => r.id),
      warnings,
      normalized_output: out,
    },
    run,
    "assistant_message",
  );
  return {
    outcome: {
      kind: "proposals",
      proposal_ids: rows.map((r) => r.id),
      warnings,
    },
    run,
    assistantMessageId: msg.id,
  };
}
