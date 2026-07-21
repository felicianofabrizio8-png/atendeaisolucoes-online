// Coach Interpreter — Zod estrito para saída do LLM.
// Contrato:
//   - additionalProperties=false via z.strictObject;
//   - máximo de 3 proposals;
//   - scope agent bloqueado (Fase 2 exclui);
//   - cross-validation determinística (has_rule, scope_ref x scope_kind, etc.).
import { z } from "zod";
import {
  COACH_INTERPRETER_MAX_PROPOSALS,
  COACH_INTERPRETER_NORMALIZED_OUTPUT_MAX_BYTES,
} from "./types";

export const COACH_INTENTS = [
  "rule",
  "knowledge",
  "faq",
  "preference",
  "quick_reply",
  "marketing",
  "noise",
  "mixed",
] as const;
export type CoachIntent = (typeof COACH_INTENTS)[number];

export const COACH_INTERPRETER_CATEGORIES = [
  "identity",
  "tone",
  "qualification",
  "sales",
  "pricing",
  "negotiation",
  "discounts",
  "payments",
  "followup",
  "human_handoff",
  "prohibitions",
  "safety",
  "after_sales",
  "other",
] as const;

export const COACH_INTERPRETER_RULE_TYPES = [
  "instruction",
  "prohibition",
  "mandatory_action",
  "mandatory_question",
  "handoff",
  "standard_reply",
  "preference",
] as const;

// Escopos aceitos NESTA fase (o enum de banco também tem 'agent', mas o
// Interpreter deve rejeitar 'agent' — apenas company/channel).
export const COACH_INTERPRETER_SCOPES = ["company", "channel"] as const;
export const COACH_INTERPRETER_CHANNELS = [
  "whatsapp",
  "instagram",
  "facebook",
  "web",
  "other",
] as const;

export const COACH_RISK_LEVELS = ["low", "medium", "high", "critical"] as const;

const CONTROL_CHARS_RE = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;

function trimAndClean(input: string): string {
  return input.replace(CONTROL_CHARS_RE, "").trim();
}

const nonEmptyString = (min: number, max: number) =>
  z.string().transform(trimAndClean).pipe(z.string().min(min).max(max));

const scopeRefSchema = z
  .strictObject({
    channel: z.enum(COACH_INTERPRETER_CHANNELS).optional(),
  })
  .default({});

export const CoachProposalSchema = z
  .strictObject({
    title: nonEmptyString(3, 120),
    category: z.enum(COACH_INTERPRETER_CATEGORIES),
    rule_type: z.enum(COACH_INTERPRETER_RULE_TYPES),
    scope_kind: z.enum(COACH_INTERPRETER_SCOPES),
    scope_ref: scopeRefSchema,
    priority: z.number().int().min(0).max(100),
    condition: z.string().transform(trimAndClean).pipe(z.string().max(500)).optional().default(""),
    instruction: nonEmptyString(3, 2000),
    rationale: z.string().transform(trimAndClean).pipe(z.string().max(1000)).optional().default(""),
    examples: z
      .array(z.string().transform(trimAndClean).pipe(z.string().max(300)))
      .max(5)
      .optional()
      .default([]),
    confidence: z.number().min(0).max(1),
    risk_level: z.enum(COACH_RISK_LEVELS),
    ambiguities: z.array(z.string().max(300)).max(5).optional().default([]),
    missing_information: z.array(z.string().max(300)).max(5).optional().default([]),
  })
  .superRefine((p, ctx) => {
    if (p.scope_kind === "company") {
      if (Object.keys(p.scope_ref).length > 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["scope_ref"],
          message: "scope_ref must be empty when scope_kind='company'",
        });
      }
    } else if (p.scope_kind === "channel") {
      if (!p.scope_ref.channel) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["scope_ref", "channel"],
          message: "channel required when scope_kind='channel'",
        });
      }
    }
  });

export type CoachProposal = z.infer<typeof CoachProposalSchema>;

export const CoachInterpreterOutputSchema = z
  .strictObject({
    intent: z.enum(COACH_INTENTS),
    has_rule: z.boolean(),
    proposals: z.array(CoachProposalSchema).max(COACH_INTERPRETER_MAX_PROPOSALS),
    clarification_questions: z
      .array(z.string().transform(trimAndClean).pipe(z.string().min(3).max(300)))
      .max(3),
    confidence: z.number().min(0).max(1),
    reasoning_summary: z.string().transform(trimAndClean).pipe(z.string().max(600)),
    warnings: z.array(z.string().max(300)).max(5),
  })
  .superRefine((out, ctx) => {
    if (!out.has_rule && out.proposals.length > 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["proposals"],
        message: "proposals must be empty when has_rule=false",
      });
    }
    // Intents cujo persistir proposal é vetado (exceto 'mixed' com has_rule=true).
    const NON_PROPOSAL_INTENTS = new Set(["knowledge", "faq", "quick_reply", "marketing", "noise"]);
    if (NON_PROPOSAL_INTENTS.has(out.intent) && out.proposals.length > 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["proposals"],
        message: `intent=${out.intent} must not carry proposals`,
      });
    }
    // Tamanho normalizado.
    const size = Buffer.byteLength(JSON.stringify(out), "utf8");
    if (size > COACH_INTERPRETER_NORMALIZED_OUTPUT_MAX_BYTES) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [],
        message: `normalized_output exceeds ${COACH_INTERPRETER_NORMALIZED_OUTPUT_MAX_BYTES} bytes`,
      });
    }
  });

export type CoachInterpreterOutput = z.infer<typeof CoachInterpreterOutputSchema>;

export function safeSummarizeZodError(err: z.ZodError): string {
  // Retorna string curta e sanitizada, adequada para incluir num prompt de repair.
  return err.issues
    .slice(0, 10)
    .map((i) => `${i.path.join(".") || "<root>"}: ${i.message}`)
    .join(" | ");
}
