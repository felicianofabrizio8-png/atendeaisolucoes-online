import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Ecossistema Lume: um núcleo de conversa e "domínios" de ferramentas (Agenda hoje;
 * Atendimento, Marketing, Orçamentos depois). Cada ferramenta declara o que faz, o
 * risco e como desfazer — o núcleo decide se executa na hora ou pede confirmação.
 */

export interface LumeContext {
  /** Cliente com a sessão do usuário: o banco aplica as permissões dele (RLS). */
  client: SupabaseClient;
  companyId: string;
  userId: string;
  userName: string | null;
  timeZone: string;
  now: Date;
  /** A estrutura nova da Agenda já está no banco. */
  extended: boolean;
  /** Migração de hierarquia (alcance, participantes, tags). Ausente = segue extended. */
  hierarchy?: boolean;
}

/**
 * - `read`: só consulta, executa sempre;
 * - `safe`: muda dados, executa na hora e oferece Desfazer (criar);
 * - `confirm`: muda ou apaga dados existentes ou avisa pessoas — espera confirmação.
 */
export type LumeRisk = "read" | "safe" | "confirm";

export interface JsonSchema {
  type: "object";
  properties: Record<string, unknown>;
  required?: string[];
  additionalProperties?: boolean;
}

export interface LumeToolResult {
  /** Volta para o modelo (resumida, sem dados sensíveis desnecessários). */
  output: unknown;
  /** Operação para desfazer, guardada em `lume_actions.undo`. */
  undo?: LumeUndo | null;
  /** Ids de compromissos afetados, para a tela destacar. */
  touched?: string[];
}

export type LumeUndo =
  | { op: "delete_events"; ids: string[] }
  | { op: "restore_events"; rows: Array<Record<string, unknown>> }
  | { op: "update_event"; id: string; changes: Record<string, unknown> }
  | { op: "delete_rows"; table: string; ids: string[] };

export interface LumeTool<Args = Record<string, unknown>> {
  name: string;
  domain: string;
  description: string;
  parameters: JsonSchema;
  risk: LumeRisk | ((args: Args) => LumeRisk);
  /** Frase curta para o cartão de ação: "Excluir 2 compromissos de sexta". */
  summarize: (args: Args, ctx: LumeContext) => string | Promise<string>;
  execute: (args: Args, ctx: LumeContext) => Promise<LumeToolResult>;
}

export interface LumeDomain {
  id: string;
  /** Instruções que o domínio acrescenta ao prompt (regras, vocabulário). */
  instructions: (ctx: LumeContext) => Promise<string> | string;
  tools: LumeTool<never>[];
  undo: (undo: LumeUndo, ctx: LumeContext) => Promise<void>;
}

export type LumeActionStatus =
  | "pendente"
  | "executada"
  | "confirmada"
  | "cancelada"
  | "desfeita"
  | "falhou";

/** O que a tela recebe de cada ação pedida à Lume. */
export interface LumeActionView {
  id: string;
  tool: string;
  summary: string;
  status: LumeActionStatus;
  undoable: boolean;
  touched: string[];
  error?: string | null;
}

export interface LumeTurn {
  role: "user" | "assistant";
  text: string;
}

export class LumeError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}
