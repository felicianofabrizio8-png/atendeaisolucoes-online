import { describe, expect, it } from "vitest";
import { buildSalesAgentAuditPayload, maskAuditIdentifier } from "../sales-agent-audit";

describe("auditoria da Vendedora V2", () => {
  it.each(["off", "silent", "assisted", "automatic"] as const)(
    "registra o modo %s com campos operacionais",
    (mode) => {
      const payload = buildSalesAgentAuditPayload({
        companyId: "company-1",
        conversationId: "conversation-1",
        mode,
        decision: mode === "automatic" ? "reply" : "skipped",
        productIds: ["sol-801"],
        tools: ["catalog_search", "action_contract"],
        result: mode === "automatic" ? "sent" : "mode_gate",
        blocked: mode === "automatic" ? null : "approval_required",
        latencyMs: 42.6,
        tokensAvailable: null,
      });
      expect(payload).toMatchObject({
        audit_kind: "sales_agent_v2",
        mode,
        product_ids: ["sol-801"],
        tools: ["catalog_search", "action_contract"],
        latency_ms: 43,
        tokens_available: null,
      });
    },
  );

  it("não aceita company_id vazio e não persiste conteúdo sensível", () => {
    expect(() =>
      buildSalesAgentAuditPayload({
        companyId: " ",
        conversationId: "conversation-1",
        mode: "silent",
        decision: "skipped",
        result: "message com telefone 5511999999999 e access_token=secret",
        latencyMs: 1,
      }),
    ).toThrow("company_id");

    const payload = buildSalesAgentAuditPayload({
      companyId: "company-1",
      conversationId: "conversation-1",
      mode: "silent",
      decision: "skipped",
      result: "safe_result",
      blocked: "approval required / conteúdo privado",
      productIds: ["sol-801", "telefone-5511999999999"],
      tools: ["safe_tool"],
      latencyMs: 1,
      tokensAvailable: -10,
    });
    expect(JSON.stringify(payload)).not.toContain("telefone");
    expect(JSON.stringify(payload)).not.toContain("access_token");
    expect(payload.tokens_available).toBe(0);
  });

  it("mascara identificador na saída", () => {
    expect(maskAuditIdentifier("conversation-1234")).toBe("conv…1234");
    expect(maskAuditIdentifier(null)).toBe("-");
  });
});
