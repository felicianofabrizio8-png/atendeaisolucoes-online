// Coach Interpreter — Service.
// Puro em relação ao TanStack Start: recebe supabase autenticado do handler,
// não conhece HTTP nem sessão.
//
// Fase 2.b.1 (correção A2): `supabaseAdmin` é carregado via `await import()`
// dentro do handler para não vazar o módulo server-only na cadeia de bundle
// dos `*.functions.ts` que importam este arquivo.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { LLMGateway } from "@/lib/llm-gateway/LLMGateway.server";
import type { LLMProvider } from "@/lib/llm-gateway/LLMProvider";
import { LovableChatProvider } from "@/lib/llm-gateway/providers/LovableChatProvider";
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
import { buildCompanyGrounding } from "./grounding.server";
import { validateAgainstDomain, type DomainValidationResult } from "./domain-validator.server";
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
  const cleaned = t
    .replace(/^```(?:json)?/i, "")
    .replace(/```$/i, "")
    .trim();
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
  return listCoachMessages(sb, conversationId, 200).then(
    (msgs) => msgs.filter((m) => m.kind === "clarification_request").length,
  );
}

/**
 * Coach Interpreter · Fase 2.b.1 (M4) — decisão determinística.
 *
 * Regra: qualquer `ambiguities` ou `missing_information` não vazio força
 * clarificação, mesmo com `confidence` alto. Confidence baixo, presença
 * de perguntas do modelo ou ausência de proposals também forçam.
 * Persiste proposals APENAS quando não há sinal de ambiguidade.
 */
export interface CoachInterpreterDecision {
  kind: "clarification" | "classified" | "proposals";
  materialAmbiguity: boolean;
}
export function decideCoachInterpreterOutcome(
  out: CoachInterpreterOutput,
): CoachInterpreterDecision {
  const materialAmbiguity = out.proposals.some(
    (p) => p.ambiguities.length > 0 || p.missing_information.length > 0,
  );
  const forceClarify =
    out.confidence < COACH_INTERPRETER_CONFIDENCE_MIN_PROPOSAL ||
    out.clarification_questions.length > 0 ||
    materialAmbiguity;

  if (forceClarify) {
    if (out.clarification_questions.length > 0) {
      return { kind: "clarification", materialAmbiguity };
    }
    // Ambiguidade explícita sem perguntas do modelo: não persiste.
    return { kind: "classified", materialAmbiguity };
  }
  if (out.proposals.length === 0) return { kind: "classified", materialAmbiguity: false };
  return { kind: "proposals", materialAmbiguity: false };
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

  // Fase 2.b.1 · A2: dynamic import server-only, nunca em module-scope.
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const gateway = new LLMGateway(supabaseAdmin, {
    providers,
    cacheEnabled: false, // determinismo por conversa; cache aqui pode confundir
    retryAttempts: 2,
  });

  // Grounding obrigatório: contexto de conhecimento da empresa.
  const grounding = await buildCompanyGrounding(supabase, companyId).catch(() => null);

  const systemPrompt = buildCoachInterpreterSystemPrompt({
    companyName: companyName ?? null,
    tone: companyTone ?? null,
    groundingBlock: grounding?.block ?? null,
  });
  const history = await buildHistoryTurns(supabase, conversationId);
  const turns = buildCoachInterpreterTurns(history, userMessageText);

  // Metadados de grounding — anexados a todos os payloads e a warnings quando fraco.
  const learningIdsUsed = grounding?.learningIdsUsed ?? [];
  const groundingMeta = grounding
    ? {
        sources_used: grounding.sourcesUsed,
        grounding_score: Number(grounding.groundingScore.toFixed(2)),
        grounding_counts: grounding.counts,
        grounding_warnings: grounding.warnings,
        grounding_empty: grounding.isEmpty,
        learning_ids_used: learningIdsUsed,
      }
    : {
        sources_used: null,
        grounding_score: 0,
        grounding_counts: null,
        grounding_warnings: ["grounding_build_failed"],
        grounding_empty: true,
        learning_ids_used: [] as string[],
      };
  const groundingWarnings: string[] = [];
  if (!grounding || grounding.isEmpty) groundingWarnings.push("grounding_empty");
  else if (grounding.groundingScore < 0.34) groundingWarnings.push("grounding_low");
  for (const w of groundingMeta.grounding_warnings ?? []) groundingWarnings.push(w);

  // Fire-and-forget: registra que estes learnings foram usados.
  if (learningIdsUsed.length > 0) {
    void (async () => {
      try {
        const { incrementLearningUsage } = await import(
          "@/lib/coach-learnings/coach-learnings.repository"
        );
        await incrementLearningUsage(supabase, learningIdsUsed);
      } catch {
        // silencioso: não bloqueia o fluxo do Interpreter
      }
    })();
  }

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
    const cls: CoachInterpreterRunMeta["error_class"] = isTimeout ? "timeout" : "provider_failure";
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
    const summary =
      validation && !validation.success
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
        outcome: {
          kind: "error",
          error_class: "provider_failure",
          message: "provider_repair_failed",
        },
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

  const rawOut: CoachInterpreterOutput = validation.data;

  // Domain Validator — nunca escreve, apenas filtra o output do LLM.
  const domainRaw = grounding?.raw ?? {
    products: [],
    forbiddenWords: [],
    preferredWords: [],
    activeRuleTitles: [],
    detectedDomains: [],
  };
  const domainResult: DomainValidationResult = validateAgainstDomain(rawOut, domainRaw);
  const out: CoachInterpreterOutput = domainResult.filteredOutput;
  const domainMeta = { domain_validation: domainResult.metadata };
  const domainWarnings = domainResult.passed
    ? []
    : ["domain_validation_filtered"];

  const decision = decideCoachInterpreterOutcome(out);
  const priorClarifications = await countPriorClarifications(supabase, conversationId);

  if (decision.kind === "clarification") {
    if (priorClarifications >= COACH_INTERPRETER_MAX_CLARIFICATIONS) {
      const run = buildRun();
      const msg = await insertAssistantCoachMessage(
        supabase,
        companyId,
        conversationId,
        "Ainda há ambiguidade, mas atingimos o limite de perguntas. Revise manualmente.",
        {
          intent: out.intent,
          warnings: [...out.warnings, ...groundingWarnings, ...domainWarnings, "max_clarifications_reached"],
          normalized_output: out,
          ...groundingMeta,
          ...domainMeta,
        },
        run,
        "assistant_message",
      );
      return {
        outcome: {
          kind: "classified",
          intent: out.intent,
          warnings: [...out.warnings, ...groundingWarnings, ...domainWarnings, "max_clarifications_reached"],
        },
        run,
        assistantMessageId: msg.id,
      };
    }
    const run = buildRun();
    const warnings = [
      ...out.warnings,
      ...groundingWarnings,
      ...domainWarnings,
      ...(decision.materialAmbiguity ? ["material_ambiguity_forced_clarification"] : []),
    ];
    const msg = await insertAssistantCoachMessage(
      supabase,
      companyId,
      conversationId,
      out.clarification_questions.join("\n"),
      {
        intent: out.intent,
        clarification_questions: out.clarification_questions,
        normalized_output: out,
        material_ambiguity: decision.materialAmbiguity,
        ...groundingMeta,
          ...domainMeta,
      },
      run,
      "clarification_request",
    );
    return {
      outcome: {
        kind: "clarification",
        questions: out.clarification_questions,
        warnings,
      },
      run,
      assistantMessageId: msg.id,
    };
  }

  // Sem proposals ou ambiguidade material sem perguntas: classifica e não persiste.
  if (decision.kind === "classified") {
    const run = buildRun();
    const warnings = [
      ...out.warnings,
      ...groundingWarnings,
      ...domainWarnings,
      ...(decision.materialAmbiguity ? ["material_ambiguity_blocked_proposals"] : []),
    ];
    const msg = await insertAssistantCoachMessage(
      supabase,
      companyId,
      conversationId,
      out.reasoning_summary || "Mensagem classificada sem proposta de regra.",
      {
        intent: out.intent,
        warnings,
        normalized_output: out,
        material_ambiguity: decision.materialAmbiguity,
        ...groundingMeta,
          ...domainMeta,
      },
      run,
      "assistant_message",
    );
    return {
      outcome: { kind: "classified", intent: out.intent, warnings },
      run,
      assistantMessageId: msg.id,
    };
  }

  // Duplicidade determinística (warning, nunca bloqueia).
  const warnings = [...out.warnings, ...groundingWarnings, ...domainWarnings];
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
      ...groundingMeta,
          ...domainMeta,
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
