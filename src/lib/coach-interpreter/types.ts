// Coach Interpreter — tipos partilhados (client-safe).
// Nenhum consumidor UI existe nesta fase; expor tipos permite futuras
// integrações sem quebrar o isolamento server-side.

export const COACH_INTERPRETER_MODEL = "google/gemini-2.5-flash" as const;
export const COACH_INTERPRETER_PROVIDER = "lovable" as const;
export const COACH_INTERPRETER_TEMPERATURE = 0.2 as const;
export const COACH_INTERPRETER_MAX_TOKENS = 1000 as const;
export const COACH_INTERPRETER_MAX_PROPOSALS = 3 as const;
export const COACH_INTERPRETER_MAX_CLARIFICATIONS = 3 as const;
export const COACH_INTERPRETER_MAX_HISTORY_MESSAGES = 10 as const;
export const COACH_INTERPRETER_MAX_INPUT_CHARS = 4000 as const;
export const COACH_INTERPRETER_NORMALIZED_OUTPUT_MAX_BYTES = 16_384 as const;

export const COACH_INTERPRETER_CONFIDENCE_MIN_PROPOSAL = 0.7 as const;
export const COACH_INTERPRETER_CONFIDENCE_STRONG = 0.85 as const;

export type CoachInterpreterErrorClass =
  | "schema_invalid"
  | "provider_failure"
  | "timeout"
  | "input_invalid"
  | "flag_disabled"
  | "killswitch"
  | "duplicate_request"
  | "unauthorized"
  | "not_found"
  | "internal";

export interface CoachInterpreterRunMeta {
  attempts: number;
  repaired: boolean;
  provider: string;
  model: string;
  tokens_in: number;
  tokens_out: number;
  latency_ms: number;
  prompt_version: string;
  error_class?: CoachInterpreterErrorClass;
  duplicate_warning?: boolean;
}

export type CoachInterpreterOutcome =
  | { kind: "proposals"; proposal_ids: string[]; warnings: string[] }
  | { kind: "clarification"; questions: string[]; warnings: string[] }
  | { kind: "classified"; intent: string; warnings: string[] }
  | { kind: "error"; error_class: CoachInterpreterErrorClass; message: string };
