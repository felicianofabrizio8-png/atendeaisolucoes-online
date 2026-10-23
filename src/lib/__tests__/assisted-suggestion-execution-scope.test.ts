import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  ASSISTED_SUGGESTION_CAPABILITIES,
  hasExecutionCapability,
  type ExecutionScope,
} from "../execution-scope";

describe("assisted suggestion execution scope", () => {
  it("allows generation, catalog/engine access and memory reads only", () => {
    const scope: ExecutionScope = {
      kind: "whatsapp_conversation",
      companyId: "company-a",
      scopeId: "conversation-a",
      capabilities: ASSISTED_SUGGESTION_CAPABILITIES,
    };

    expect(hasExecutionCapability(scope, "generate_response")).toBe(true);
    expect(hasExecutionCapability(scope, "use_external_engine")).toBe(true);
    expect(hasExecutionCapability(scope, "read_scoped_memory")).toBe(true);
    expect(hasExecutionCapability(scope, "write_scoped_memory")).toBe(false);
    expect(hasExecutionCapability(scope, "send_whatsapp")).toBe(false);
    expect(hasExecutionCapability(scope, "mutate_leads")).toBe(false);
    expect(hasExecutionCapability(scope, "mutate_conversations")).toBe(false);
    expect(hasExecutionCapability(scope, "schedule_followup")).toBe(false);
  });

  // A sugestão assistida sob demanda (rota api.ai.suggest-reply) roda com essas capacidades.
  // A qualificação automática no tick em modo assistido segue o comportamento da main
  // (decisão de produto pendente, registrada no diário da integração).
  it("a rota de sugestão assistida usa o escopo restrito", () => {
    const route = readFileSync(new URL("../../routes/api.ai.suggest-reply.tsx", import.meta.url), "utf8");
    expect(route).toContain("capabilities: ASSISTED_SUGGESTION_CAPABILITIES");
  });
});
