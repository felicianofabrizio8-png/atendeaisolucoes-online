import { describe, expect, it } from "vitest";
import { SALES_AGENT_MAX_OPTIONS, SALES_AGENT_PLAYBOOK } from "../sales-agent-playbook";

describe("Sales Agent playbook", () => {
  it("contém somente regras comportamentais e limites comerciais", () => {
    expect(SALES_AGENT_PLAYBOOK).toContain("uma pergunta de qualificação por vez");
    expect(SALES_AGENT_PLAYBOOK).toContain("não repita perguntas respondidas");
    expect(SALES_AGENT_PLAYBOOK).toContain("2 ou 3 opções");
    expect(SALES_AGENT_PLAYBOOK).toContain("request_human_handoff");
    expect(SALES_AGENT_PLAYBOOK).not.toContain("fonte oficial de produtos");
    expect(SALES_AGENT_PLAYBOOK).not.toContain("Nunca invente");
    expect(SALES_AGENT_PLAYBOOK).not.toMatch(/R\$\s?\d|Piscina\s+\d|SKU|produto-\w+/i);
  });

  it("define no máximo três opções", () => {
    expect(SALES_AGENT_MAX_OPTIONS).toBe(3);
  });
});
