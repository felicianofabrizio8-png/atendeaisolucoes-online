import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

describe("AI agent consultative shadow integration contract", () => {
  const source = [
    // A integração consultiva do turno fica em consultative-turn.server.ts.
    "../ai-agent.server.ts",
    "../consultative-turn.server.ts",
  ].map((path) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8")).join("\n");

  it("executa somente após o contexto/estado comercial e permanece isolado do atendimento", () => {
    expect(source).toContain("observeConsultativeShadow");
    expect(source).toContain("await observeConsultativeShadow({");
    expect(source).toContain("salesState: filteredSalesState");
    expect(source).toContain("leadId: params.leadId");
    expect(source).toContain("isConsultativeShadowEnabled(settings)");
    expect(source).toContain("consultative_shadow");
  });

  it("não conecta sugestão shadow a decisão, resposta ou envio atuais", () => {
    expect(source).not.toContain("suggestion.message");
    expect(source).not.toContain("suggestion.response");
    expect(source).not.toContain("sendWhatsappText({\n      companyId: tenant");
    expect(source).not.toContain("decision = shadow");
  });

  it("registra apenas métricas minimizadas no evento existente", () => {
    expect(source).toContain("question_generated");
    expect(source).toContain("next_action_present");
    expect(source).toContain("artifact_counts");
    expect(source).toContain("divergence_codes");
    expect(source).not.toContain("message: metrics");
    expect(source).not.toContain("text: metrics");
  });
});
