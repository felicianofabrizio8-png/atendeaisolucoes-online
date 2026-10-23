/** First-stage discriminated execution contract for the agent. */
export type ExecutionCapability =
  | "generate_response"
  | "use_external_engine"
  | "read_scoped_memory"
  | "write_scoped_memory"
  | "send_whatsapp"
  | "mutate_leads"
  | "mutate_conversations"
  | "schedule_followup";

export type ExecutionScopeCapabilities = Readonly<{
  generate_response: boolean;
  use_external_engine: boolean;
  read_scoped_memory: boolean;
  write_scoped_memory: boolean;
  send_whatsapp: boolean;
  mutate_leads: boolean;
  mutate_conversations: boolean;
  schedule_followup: boolean;
}>;

type ExecutionScopeBase = {
  companyId: string;
  scopeId: string;
  capabilities: ExecutionScopeCapabilities;
};

export type TrainingSessionExecutionScope = ExecutionScopeBase & {
  kind: "training_session";
  capabilities: ExecutionScopeCapabilities & {
    send_whatsapp: false;
    mutate_leads: false;
    mutate_conversations: false;
    schedule_followup: false;
  };
};

export type WhatsappConversationExecutionScope = ExecutionScopeBase & {
  kind: "whatsapp_conversation";
  capabilities: ExecutionScopeCapabilities & {
    send_whatsapp: true;
    mutate_leads: true;
    mutate_conversations: true;
    schedule_followup: true;
  };
};

/** Read-only contract for composing an assisted suggestion. */
export type AssistedSuggestionExecutionScope = ExecutionScopeBase & {
  // Keep the conversation scope key so existing sales memory remains compatible.
  kind: "whatsapp_conversation";
  capabilities: ExecutionScopeCapabilities & {
    write_scoped_memory: false;
    send_whatsapp: false;
    mutate_leads: false;
    mutate_conversations: false;
    schedule_followup: false;
  };
};

export type ExecutionScope =
  | TrainingSessionExecutionScope
  | WhatsappConversationExecutionScope
  | AssistedSuggestionExecutionScope;

export const TRAINING_SESSION_CAPABILITIES = {
  generate_response: true,
  use_external_engine: true,
  read_scoped_memory: true,
  write_scoped_memory: true,
  send_whatsapp: false,
  mutate_leads: false,
  mutate_conversations: false,
  schedule_followup: false,
} as const satisfies TrainingSessionExecutionScope["capabilities"];

export const WHATSAPP_CONVERSATION_CAPABILITIES = {
  generate_response: true,
  use_external_engine: true,
  read_scoped_memory: true,
  write_scoped_memory: true,
  send_whatsapp: true,
  mutate_leads: true,
  mutate_conversations: true,
  schedule_followup: true,
} as const satisfies WhatsappConversationExecutionScope["capabilities"];

export const ASSISTED_SUGGESTION_CAPABILITIES = {
  generate_response: true,
  use_external_engine: true,
  read_scoped_memory: true,
  write_scoped_memory: false,
  send_whatsapp: false,
  mutate_leads: false,
  mutate_conversations: false,
  schedule_followup: false,
} as const satisfies AssistedSuggestionExecutionScope["capabilities"];

export function hasExecutionCapability(
  scope: ExecutionScope,
  capability: ExecutionCapability,
): boolean {
  return scope.capabilities[capability];
}
