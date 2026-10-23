import { describe, expect, it } from "vitest";
import {
  hasExecutionCapability,
  TRAINING_SESSION_CAPABILITIES,
  WHATSAPP_CONVERSATION_CAPABILITIES,
  type ExecutionScope,
} from "../execution-scope";

describe("ExecutionScope", () => {
  const training: ExecutionScope = {
    kind: "training_session",
    companyId: "company-a",
    scopeId: "session-a",
    capabilities: TRAINING_SESSION_CAPABILITIES,
  };

  const whatsapp: ExecutionScope = {
    kind: "whatsapp_conversation",
    companyId: "company-a",
    scopeId: "conversation-a",
    capabilities: WHATSAPP_CONVERSATION_CAPABILITIES,
  };

  it("permite gerar e persistir somente no escopo do treinamento", () => {
    expect(hasExecutionCapability(training, "generate_response")).toBe(true);
    expect(hasExecutionCapability(training, "read_scoped_memory")).toBe(true);
    expect(hasExecutionCapability(training, "write_scoped_memory")).toBe(true);
    expect(hasExecutionCapability(training, "send_whatsapp")).toBe(false);
    expect(hasExecutionCapability(training, "mutate_leads")).toBe(false);
    expect(hasExecutionCapability(training, "mutate_conversations")).toBe(false);
    expect(hasExecutionCapability(training, "schedule_followup")).toBe(false);
  });

  it("mantém capacidades de atendimento real separadas", () => {
    expect(whatsapp.kind).toBe("whatsapp_conversation");
    expect(whatsapp.companyId).toBe("company-a");
    expect(whatsapp.scopeId).toBe("conversation-a");
    expect(hasExecutionCapability(whatsapp, "send_whatsapp")).toBe(true);
    expect(hasExecutionCapability(whatsapp, "mutate_leads")).toBe(true);
  });
});
