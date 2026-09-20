import { describe, expect, it, vi } from "vitest";
import {
  buildPendingAssistedSuggestion,
  getAssistedSuggestionStatus,
  transitionAssistedSuggestion,
} from "../sales-agent-assisted";

describe("execução assisted da Vendedora V2", () => {
  it("persiste sugestão pendente isolada por empresa e conversa", () => {
    const send = vi.fn();
    const insert = buildPendingAssistedSuggestion({
      companyId: "company-1",
      conversationId: "conversation-1",
      leadId: "lead-1",
      text: "A Sol 801 está disponível para consulta.",
      productIds: ["sol-801"],
    });
    expect(insert).toMatchObject({
      company_id: "company-1",
      conversation_id: "conversation-1",
      classification: "v2_status:pending",
      was_sent: false,
    });
    expect(getAssistedSuggestionStatus(insert.classification, insert.was_sent)).toBe("pending");
    expect(send).not.toHaveBeenCalled();
  });

  it.each(["approve", "reject"] as const)("tem transição segura de %s sem envio", (action) => {
    const send = vi.fn();
    const result = transitionAssistedSuggestion(
      {
        id: "suggestion-1",
        company_id: "company-1",
        conversation_id: "conversation-1",
        classification: "v2_status:pending",
        was_sent: false,
      },
      "company-1",
      action,
    );
    expect(result).toMatchObject({
      ok: true,
      sendAllowed: false,
      status: action === "approve" ? "approved" : "rejected",
    });
    expect(send).not.toHaveBeenCalled();
  });

  it("bloqueia cross-tenant, repetição e sugestão já enviada", () => {
    expect(
      transitionAssistedSuggestion(
        {
          id: "s",
          company_id: "company-a",
          conversation_id: "c",
          classification: "v2_status:pending",
          was_sent: false,
        },
        "company-b",
        "approve",
      ),
    ).toMatchObject({ ok: false, code: "cross_tenant" });
    expect(
      transitionAssistedSuggestion(
        {
          id: "s",
          company_id: "company-a",
          conversation_id: "c",
          classification: "v2_status:approved",
          was_sent: false,
        },
        "company-a",
        "reject",
      ),
    ).toMatchObject({ ok: false, code: "invalid_status" });
    expect(
      transitionAssistedSuggestion(
        {
          id: "s",
          company_id: "company-a",
          conversation_id: "c",
          classification: "v2_status:approved",
          was_sent: true,
        },
        "company-a",
        "reject",
      ),
    ).toMatchObject({ ok: false, code: "already_sent" });
  });
});
