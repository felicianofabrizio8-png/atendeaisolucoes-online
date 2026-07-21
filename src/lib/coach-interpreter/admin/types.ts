// Tipos locais espelhando o retorno das server functions do Coach
// Interpreter. Não são o contrato canônico do backend; são adaptadores de
// leitura para a UI admin.

export type ConversationRow = {
  id: string;
  company_id: string;
  owner_user_id: string | null;
  title: string | null;
  status: string;
  last_message_at: string | null;
  created_at: string;
  /** Opcional — quando ausente, ordenação cai em created_at. */
  updated_at?: string | null;
};

export type MessageRow = {
  id: string;
  conversation_id: string;
  kind: string;
  author_user_id: string | null;
  content: string;
  payload: unknown;
  run: unknown;
  client_request_id: string | null;
  created_at: string;
};

export type ProposalRow = {
  id: string;
  conversation_id: string;
  source_message_id: string;
  status: string;
  title: string;
  category: string;
  rule_type: string;
  scope_kind: string;
  scope_ref: unknown;
  priority: number;
  instruction: string;
  confidence: number;
  risk_level: string;
  warnings: unknown;
  normalized_output: unknown;
  created_at: string;
};

export type ProposalFilters = {
  category: string;
  ruleType: string;
  status: string;
  minConfidence: number;
  ownerUser: string;
  dateFrom: string;
  dateTo: string;
};
