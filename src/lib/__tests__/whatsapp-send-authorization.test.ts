import { describe, expect, it, vi } from "vitest";
import { authorizeWhatsappSend, authorizeWhatsappSendFromExecutionScope, isWhatsappSendAuthorization } from "../whatsapp-send-authorization.server";
import { ASSISTED_SUGGESTION_CAPABILITIES, TRAINING_SESSION_CAPABILITIES } from "../execution-scope";

const rows: Record<string, Record<string, unknown> | null> = {
  companies: { id: "company-1" },
  conversations: { id: "conversation-1", company_id: "company-1", lead_id: "lead-1", channel: "whatsapp", ai_reply_enabled: true, ai_status: null, human_takeover_at: null },
  leads: { id: "lead-1", company_id: "company-1", channel: "whatsapp", integration_id: "integration-1" },
  integrations: { id: "integration-1" },
};

vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: { from: (table: string) => {
    let requestedId: string | null = null;
    const chain: Record<string, unknown> = {
      select: () => chain,
      eq: (column: string, value: unknown) => {
        if (column === "id") requestedId = String(value);
        return chain;
      },
      limit: () => chain,
      maybeSingle: async () => ({
        data: table === "integrations" && requestedId && requestedId !== rows.integrations?.id
          ? null
          : rows[table] ?? null,
        error: null,
      }),
    };
    return chain;
  } },
}));

describe("WhatsApp send authorization", () => {
  it("retorna o número efetivo vinculado ao lead, sem permitir fallback", async () => {
    const authorization = await authorizeWhatsappSend({ companyId: "company-1", conversationId: "conversation-1", leadId: "lead-1", source: "human" });
    expect(authorization.integrationId).toBe("integration-1");
  });
  it("recusa lead sem integration_id mesmo com integração ativa na empresa", async () => {
    rows.leads = { ...rows.leads, integration_id: null };
    await expect(authorizeWhatsappSend({ companyId: "company-1", conversationId: "conversation-1", leadId: "lead-1", source: "human" })).rejects.toThrow("whatsapp_send_context_invalid");
    rows.leads = { ...rows.leads, integration_id: "integration-1" };
  });
  it("bloqueia training_session na origem, antes do sink", async () => {
    await expect(authorizeWhatsappSendFromExecutionScope({ kind: "training_session", companyId: "company-1", scopeId: "session-1", capabilities: TRAINING_SESSION_CAPABILITIES }, { leadId: "lead-1", source: "automatic" })).rejects.toThrow("whatsapp_send_scope_not_allowed");
  });
  it("bloqueia sugestão assistida mesmo compartilhando a chave da conversa", async () => {
    await expect(authorizeWhatsappSendFromExecutionScope({ kind: "whatsapp_conversation", companyId: "company-1", scopeId: "conversation-1", capabilities: ASSISTED_SUGGESTION_CAPABILITIES }, { leadId: "lead-1", source: "automatic" })).rejects.toThrow("whatsapp_send_scope_not_allowed");
  });
  it("bloqueia um comprovante ausente ou adulterado", async () => {
    expect(isWhatsappSendAuthorization(null)).toBe(false);
    expect(isWhatsappSendAuthorization({ companyId: "company-1", source: "human" })).toBe(false);
    const authorization = await authorizeWhatsappSend({ companyId: "company-1", conversationId: "conversation-1", leadId: "lead-1", source: "human" });
    expect(isWhatsappSendAuthorization(authorization)).toBe(true);
  });
  it.each(["human", "automatic", "followup"] as const)("permite %s com contexto server-side", async (source) => {
    const authorization = await authorizeWhatsappSend({ companyId: "company-1", conversationId: "conversation-1", leadId: "lead-1", source });
    expect(isWhatsappSendAuthorization(authorization)).toBe(true);
    expect(authorization.companyId).toBe("company-1");
  });
  it("recusa IDs que não formam um contexto pertencente à empresa", async () => {
    rows.conversations = { ...rows.conversations, lead_id: "other-lead" };
    await expect(authorizeWhatsappSend({ companyId: "company-1", conversationId: "conversation-1", leadId: "lead-1", source: "human" })).rejects.toThrow("whatsapp_send_context_invalid");
    rows.conversations = { ...rows.conversations, lead_id: "lead-1" };
  });
  it("recusa automático sem permissão da conversa", async () => {
    rows.conversations = { ...rows.conversations, ai_reply_enabled: false };
    await expect(authorizeWhatsappSend({ companyId: "company-1", conversationId: "conversation-1", leadId: "lead-1", source: "automatic" })).rejects.toThrow("whatsapp_send_not_permitted");
    rows.conversations = { ...rows.conversations, ai_reply_enabled: true };
  });
  it("recusa followup durante takeover humano", async () => {
    rows.conversations = { ...rows.conversations, human_takeover_at: new Date().toISOString() };
    await expect(authorizeWhatsappSend({ companyId: "company-1", conversationId: "conversation-1", leadId: "lead-1", source: "followup" })).rejects.toThrow("whatsapp_send_not_permitted");
    rows.conversations = { ...rows.conversations, human_takeover_at: null };
  });
  it("não escolhe outro número quando o lead aponta para integração diferente", async () => {
    rows.leads = { ...rows.leads, integration_id: "integration-2" };
    await expect(authorizeWhatsappSend({ companyId: "company-1", conversationId: "conversation-1", leadId: "lead-1", source: "human" })).rejects.toThrow("whatsapp_send_context_invalid");
    rows.leads = { ...rows.leads, integration_id: "integration-1" };
  });
});
