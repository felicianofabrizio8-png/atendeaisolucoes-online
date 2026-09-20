import { describe, expect, it, vi } from "vitest";
import { transitionAssistedSuggestion } from "../sales-agent-assisted";
import { authorizeSalesAgentReply } from "../sales-agent-execution";

type Audit = {
  result: string;
  blocked: string | null;
  productIds: readonly string[];
  tools: readonly string[];
};

function harness() {
  const sendText = vi.fn(async () => ({ ok: true as const }));
  const sendImages = vi.fn(async () => undefined);
  const persistSuggestion = vi.fn(async () => ({ ok: true as const }));
  const audits: Audit[] = [];
  return {
    sendText,
    sendImages,
    persistSuggestion,
    audits,
    audit: vi.fn(async (details: Audit) => {
      audits.push(details);
    }),
  };
}

describe("execução comportamental da Fase 3", () => {
  it("desligado devolve legado e não chama dependências V2", async () => {
    const h = harness();
    const result = await authorizeSalesAgentReply({
      mode: null,
      companyId: "company-1",
      conversationId: "conversation-1",
      leadId: "lead-1",
      text: "resposta",
      persistSuggestion: h.persistSuggestion,
      audit: h.audit,
    });
    expect(result).toEqual({ kind: "legacy" });
    expect(h.persistSuggestion).not.toHaveBeenCalled();
    expect(h.audit).not.toHaveBeenCalled();
    expect(h.sendText).not.toHaveBeenCalled();
    expect(h.sendImages).not.toHaveBeenCalled();
  });

  it("silent audita o bloqueio e nunca envia", async () => {
    const h = harness();
    const result = await authorizeSalesAgentReply({
      mode: "silent",
      companyId: "company-1",
      conversationId: "conversation-1",
      leadId: "lead-1",
      text: "resposta",
      productIds: ["sol-801"],
      persistSuggestion: h.persistSuggestion,
      audit: h.audit,
    });
    expect(result).toEqual({ kind: "blocked", reason: "v2_silent" });
    expect(h.audits).toMatchObject([
      { result: "mode_gate", blocked: "v2_silent", productIds: ["sol-801"] },
    ]);
    expect(h.persistSuggestion).not.toHaveBeenCalled();
    expect(h.sendText).not.toHaveBeenCalled();
    expect(h.sendImages).not.toHaveBeenCalled();
  });

  it("assisted persiste pending por tenant/conversa e nunca envia antes da aprovação", async () => {
    const h = harness();
    const result = await authorizeSalesAgentReply({
      mode: "assisted",
      companyId: "company-1",
      conversationId: "conversation-1",
      leadId: "lead-1",
      text: "resposta validada",
      productIds: ["sol-801"],
      persistSuggestion: h.persistSuggestion,
      audit: h.audit,
    });
    expect(result).toEqual({ kind: "blocked", reason: "v2_assisted_approval_required" });
    expect(h.persistSuggestion).toHaveBeenCalledWith(
      expect.objectContaining({
        company_id: "company-1",
        conversation_id: "conversation-1",
        classification: "v2_status:pending",
        was_sent: false,
      }),
    );
    expect(h.audits).toMatchObject([
      { result: "suggestion_pending", blocked: "approval_required" },
    ]);
    expect(h.sendText).not.toHaveBeenCalled();
    expect(h.sendImages).not.toHaveBeenCalled();
  });

  it("aprovação e rejeição exigem o tenant correto e bloqueiam transição inválida", () => {
    const pending = {
      id: "suggestion-1",
      company_id: "company-1",
      conversation_id: "conversation-1",
      classification: "v2_status:pending",
      was_sent: false,
    };
    expect(transitionAssistedSuggestion(pending, "company-1", "approve")).toMatchObject({
      ok: true,
      status: "approved",
      sendAllowed: false,
    });
    expect(transitionAssistedSuggestion(pending, "company-1", "reject")).toMatchObject({
      ok: true,
      status: "rejected",
      sendAllowed: false,
    });
    expect(transitionAssistedSuggestion(pending, "company-2", "approve")).toMatchObject({
      ok: false,
      code: "cross_tenant",
    });
    expect(
      transitionAssistedSuggestion(
        { ...pending, classification: "v2_status:approved" },
        "company-1",
        "reject",
      ),
    ).toMatchObject({ ok: false, code: "invalid_status" });
  });

  it("automatic audita validação e somente então permite o sender", async () => {
    const h = harness();
    const result = await authorizeSalesAgentReply({
      mode: "automatic",
      companyId: "company-1",
      conversationId: "conversation-1",
      leadId: "lead-1",
      text: "resposta validada",
      productIds: ["sol-801"],
      persistSuggestion: h.persistSuggestion,
      audit: h.audit,
    });
    expect(result).toEqual({ kind: "authorized" });
    expect(h.audits).toMatchObject([
      { result: "validated", blocked: null, tools: ["action_contract"] },
    ]);
    if (result.kind === "authorized") await h.sendText();
    expect(h.sendText).toHaveBeenCalledTimes(1);
    expect(h.persistSuggestion).not.toHaveBeenCalled();
    expect(h.sendImages).not.toHaveBeenCalled();
  });

  it("falha de ferramenta não autoriza envio e fica auditada", async () => {
    const h = harness();
    const result = await authorizeSalesAgentReply({
      mode: "automatic",
      companyId: "company-1",
      conversationId: "conversation-1",
      leadId: "lead-1",
      text: "",
      persistSuggestion: h.persistSuggestion,
      audit: h.audit,
    });
    expect(result).toMatchObject({ kind: "error", reason: "invalid_input" });
    expect(h.audits).toMatchObject([{ result: "tool_error" }]);
    expect(h.sendText).not.toHaveBeenCalled();
    expect(h.sendImages).not.toHaveBeenCalled();
  });
});
