// ============================================================================
// Parser + validador do plano devolvido pela IA.
//
// O modelo é tratado como fonte NÃO confiável: tudo é normalizado, limitado e
// reconciliado com o contexto real. Em particular:
//  · template inventado é descartado — só nomes reais aprovados passam;
//  · janela fechada sem template aprovado vira aviso explícito;
//  · certeza é rebaixada a hipótese;
//  · no máximo 2 alternativas.
// ============================================================================

import { sanitizeForPrompt } from "./redact";
import {
  MAX_ALTERNATIVES,
  type InsistenceLevel,
  type RecoveryContext,
  type RecoveryPlan,
} from "./types";

const MAX_FIELD = 400;
const MAX_MESSAGE = 700;

const INSISTENCE: InsistenceLevel[] = ["baixa", "media", "alta"];

function str(value: unknown, max: number): string {
  if (typeof value !== "string") return "";
  return sanitizeForPrompt(value, max);
}

/** Garante linguagem de hipótese no motivo provável. */
export function asHypothesis(text: string): string {
  if (!text) return "Hipótese: não há sinais suficientes para explicar o afastamento.";
  const hedged = /(provavel|possivel|possível|indica|talvez|aparent|hipótese|hipotese|pode ter)/i.test(
    text,
  );
  return hedged ? text : `Provavelmente ${text.charAt(0).toLowerCase()}${text.slice(1)}`;
}

export interface ParseResult {
  ok: boolean;
  plan: RecoveryPlan | null;
  reason?: string;
}

export function parseRecoveryPlan(raw: unknown, ctx: RecoveryContext): ParseResult {
  if (!raw || typeof raw !== "object") return { ok: false, plan: null, reason: "payload vazio" };
  const o = raw as Record<string, unknown>;

  const primaryMessage = str(o.primary_message, MAX_MESSAGE);
  const strategy = str(o.strategy, MAX_FIELD);
  if (!primaryMessage || !strategy) {
    return { ok: false, plan: null, reason: "campos obrigatórios ausentes" };
  }

  const insistenceRaw = String(o.insistence ?? "").toLowerCase();
  const insistence: InsistenceLevel = INSISTENCE.includes(insistenceRaw as InsistenceLevel)
    ? (insistenceRaw as InsistenceLevel)
    : ctx.chancePercent >= 55
      ? "media"
      : "baixa";

  const alternatives = Array.isArray(o.alternatives)
    ? o.alternatives
        .map((a) => str(a, MAX_MESSAGE))
        .filter((a) => a && a !== primaryMessage)
        .slice(0, MAX_ALTERNATIVES)
    : [];

  // ---- reconciliação de template: nunca aceitar nome inventado ----
  const requiresTemplate = ctx.window.requiresTemplate;
  let templateName: string | null = null;
  if (requiresTemplate) {
    const proposed = str(o.template_name, 120);
    const match = ctx.availableTemplates.find(
      (t) => t.toLowerCase() === proposed.toLowerCase(),
    );
    templateName = match ?? ctx.requiredTemplate ?? null;
  }

  const explanationBase =
    str(o.explanation, MAX_FIELD) ||
    `Prioridade ${ctx.tier.toLowerCase()} (score ${ctx.score}) e chance de ${ctx.chancePercent}% após ${ctx.stalledLabel} parado.`;

  const templateNote = requiresTemplate
    ? templateName
      ? ` A janela de 24h está fechada: envie pelo template aprovado "${templateName}".`
      : " A janela de 24h está fechada e não há template aprovado cadastrado — cadastre um antes de contatar."
    : "";

  const plan: RecoveryPlan = {
    probableReason: asHypothesis(str(o.probable_reason, MAX_FIELD)),
    strategy,
    tone: str(o.tone, 120) || "consultivo e leve",
    insistence,
    bestMoment: str(o.best_moment, 160) || "em horário comercial, começo da tarde",
    cta: str(o.cta, 160) || "confirmar se ainda faz sentido retomar",
    primaryMessage,
    alternatives,
    explanation: `${explanationBase}${templateNote}`,
    templateName,
    requiresTemplate,
  };

  return { ok: true, plan };
}
