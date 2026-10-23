import { describe, expect, it, vi } from "vitest";
import {
  isAutomaticReplyAllowed,
  isHumanTakeoverActive,
  normalizeAiReplyScope,
  parseAiConversationAction,
} from "../ai-reply-control";
import {
  ASSISTED_SUGGESTION_CAPABILITIES,
  TRAINING_SESSION_CAPABILITIES,
  WHATSAPP_CONVERSATION_CAPABILITIES,
  hasExecutionCapability,
} from "../execution-scope";
import {
  authorizeWhatsappSend,
  authorizeWhatsappSendFromExecutionScope,
  isWhatsappSendAuthorization,
} from "../whatsapp-send-authorization.server";

const rows: Record<string, Record<string, unknown> | null> = {
  companies: { id: "company-1" },
  conversations: {
    id: "conversation-1",
    company_id: "company-1",
    lead_id: "lead-1",
    channel: "whatsapp",
    sales_agent_auto_reply: true,
    ai_status: null,
    human_takeover_at: null,
  },
  leads: {
    id: "lead-1",
    company_id: "company-1",
    channel: "whatsapp",
    integration_id: "integration-1",
  },
  integrations: { id: "integration-1", company_id: "company-1", channel: "whatsapp", active: true },
  company_settings: {
    company_id: "company-1",
    sales_agent_v2_enabled: true,
    sales_agent_v2_mode: "automatic",
    sales_agent_master_enabled: true,
  },
};

vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: {
    from: (table: string) => {
      let requestedId: string | null = null;
      const chain: Record<string, unknown> = {};
      chain.select = () => chain;
      chain.eq = (column: string, value: unknown) => {
        if (column === "id") requestedId = String(value);
        if (table === "company_settings" && column === "company_id" && value !== rows.company_settings?.company_id) {
          requestedId = "__cross_tenant__";
        }
        return chain;
      };
      chain.maybeSingle = async () => ({
        data:
          ((table === "integrations" || table === "company_settings") &&
            requestedId &&
            requestedId !== (table === "integrations" ? rows.integrations?.id : rows.company_settings?.company_id))
            ? null
            : (rows[table] ?? null),
        error: null,
      });
      return chain;
    },
  },
}));

describe("AI reply control", () => {
  it("normalizes legacy values and validates actions", () => {
    expect(normalizeAiReplyScope(undefined)).toBe("desligado");
    expect(normalizeAiReplyScope(undefined, true)).toBe("geral");
    expect(parseAiConversationAction("takeover")).toBe("takeover");
    expect(parseAiConversationAction("unknown")).toBeNull();
  });

  it("enforces the complete mode matrix", () => {
    expect(isAutomaticReplyAllowed({ mode: "automatic", salesAgentAutoReply: false })).toEqual({
      ok: true,
    });
    expect(isAutomaticReplyAllowed({ mode: "automatic", salesAgentAutoReply: true })).toEqual({
      ok: true,
    });
    expect(isAutomaticReplyAllowed({ mode: "assisted", salesAgentAutoReply: true })).toEqual({
      ok: true,
    });
    expect(isAutomaticReplyAllowed({ mode: "assisted", salesAgentAutoReply: false })).toEqual({
      ok: false,
      reason: "conversation_not_authorized",
    });
    expect(isAutomaticReplyAllowed({ mode: "silent", salesAgentAutoReply: true })).toEqual({
      ok: false,
      reason: "disabled",
    });
  });

  it("blocks legacy disabled, unauthorized test conversations, and human takeover", () => {
    expect(isAutomaticReplyAllowed({ scope: "desligado" })).toEqual({
      ok: false,
      reason: "disabled",
    });
    expect(isAutomaticReplyAllowed({ scope: "teste", conversationEnabled: false })).toEqual({
      ok: false,
      reason: "conversation_not_authorized",
    });
    expect(isAutomaticReplyAllowed({ scope: "geral", aiStatus: "assumido_humano" })).toEqual({
      ok: false,
      reason: "human_active",
    });
    expect(isHumanTakeoverActive({ humanTakeoverAt: "2026-01-01T00:00:00Z" })).toBe(true);
  });
});

describe("execution scope", () => {
  it("keeps training and assisted scopes unable to send", () => {
    expect(
      hasExecutionCapability(
        {
          kind: "training_session",
          companyId: "company-1",
          scopeId: "session-1",
          capabilities: TRAINING_SESSION_CAPABILITIES,
        },
        "send_whatsapp",
      ),
    ).toBe(false);
    expect(
      hasExecutionCapability(
        {
          kind: "whatsapp_conversation",
          companyId: "company-1",
          scopeId: "conversation-1",
          capabilities: ASSISTED_SUGGESTION_CAPABILITIES,
        },
        "send_whatsapp",
      ),
    ).toBe(false);
    expect(WHATSAPP_CONVERSATION_CAPABILITIES.send_whatsapp).toBe(true);
  });
});

describe("WhatsApp send authorization", () => {
  it("returns the lead-bound integration and preserves the tenant", async () => {
    const authorization = await authorizeWhatsappSend({
      companyId: "company-1",
      conversationId: "conversation-1",
      leadId: "lead-1",
      source: "human",
    });
    expect(authorization).toMatchObject({ companyId: "company-1", integrationId: "integration-1" });
    expect(isWhatsappSendAuthorization(authorization)).toBe(true);
  });

  it("rejects cross-tenant context, takeover, and non-sendable scopes", async () => {
    rows.conversations = { ...rows.conversations, company_id: "company-2" };
    await expect(
      authorizeWhatsappSend({
        companyId: "company-1",
        conversationId: "conversation-1",
        leadId: "lead-1",
        source: "human",
      }),
    ).rejects.toThrow("whatsapp_send_context_invalid");
    rows.conversations = {
      ...rows.conversations,
      company_id: "company-1",
      ai_status: "assumido_humano",
    };
    await expect(
      authorizeWhatsappSend({
        companyId: "company-1",
        conversationId: "conversation-1",
        leadId: "lead-1",
        source: "automatic",
      }),
    ).rejects.toThrow("whatsapp_send_not_permitted");
    await expect(
      authorizeWhatsappSendFromExecutionScope(
        {
          kind: "training_session",
          companyId: "company-1",
          scopeId: "session-1",
          capabilities: TRAINING_SESSION_CAPABILITIES,
        },
        { leadId: "lead-1", source: "automatic" },
      ),
    ).rejects.toThrow("whatsapp_send_scope_not_allowed");
    rows.conversations = { ...rows.conversations, ai_status: null };
  });

  it("keeps automatic and follow-up independent from the conversation flag", async () => {
    rows.conversations = { ...rows.conversations, sales_agent_auto_reply: false };

    await expect(
      authorizeWhatsappSend({
        companyId: "company-1",
        conversationId: "conversation-1",
        leadId: "lead-1",
        source: "automatic",
      }),
    ).resolves.toMatchObject({ source: "automatic" });
    await expect(
      authorizeWhatsappSend({
        companyId: "company-1",
        conversationId: "conversation-1",
        leadId: "lead-1",
        source: "followup",
      }),
    ).resolves.toMatchObject({ source: "followup" });

    rows.conversations = { ...rows.conversations, sales_agent_auto_reply: true };
  });

  it("enforces the company's effective mode for automatic sends", async () => {
    rows.conversations = { ...rows.conversations, sales_agent_auto_reply: false };

    await expect(
      authorizeWhatsappSend({
        companyId: "company-1",
        conversationId: "conversation-1",
        leadId: "lead-1",
        source: "automatic",
      }),
    ).resolves.toMatchObject({ source: "automatic" });

    rows.company_settings = { ...rows.company_settings, sales_agent_v2_mode: "assisted" };
    await expect(
      authorizeWhatsappSend({
        companyId: "company-1",
        conversationId: "conversation-1",
        leadId: "lead-1",
        source: "automatic",
      }),
    ).rejects.toThrow("whatsapp_send_not_permitted");

    rows.conversations = { ...rows.conversations, sales_agent_auto_reply: true };
    await expect(
      authorizeWhatsappSend({
        companyId: "company-1",
        conversationId: "conversation-1",
        leadId: "lead-1",
        source: "automatic",
      }),
    ).resolves.toMatchObject({ source: "automatic" });

    rows.company_settings = { ...rows.company_settings, sales_agent_v2_enabled: false };
    await expect(
      authorizeWhatsappSend({
        companyId: "company-1",
        conversationId: "conversation-1",
        leadId: "lead-1",
        source: "automatic",
      }),
    ).rejects.toThrow("whatsapp_send_not_permitted");
    rows.company_settings = { ...rows.company_settings, sales_agent_v2_enabled: true };

    for (const mode of ["silent", "unknown"]) {
      rows.company_settings = { ...rows.company_settings, sales_agent_v2_mode: mode };
      await expect(
        authorizeWhatsappSend({
          companyId: "company-1",
          conversationId: "conversation-1",
          leadId: "lead-1",
          source: "automatic",
        }),
      ).rejects.toThrow("whatsapp_send_not_permitted");
    }
    rows.company_settings = { ...rows.company_settings, sales_agent_v2_mode: "automatic" };
    rows.conversations = { ...rows.conversations, sales_agent_auto_reply: true };
  });

  it("does not authorize automatic sends with another company's settings", async () => {
    rows.company_settings = { ...rows.company_settings, company_id: "company-2" };
    await expect(
      authorizeWhatsappSend({
        companyId: "company-1",
        conversationId: "conversation-1",
        leadId: "lead-1",
        source: "automatic",
      }),
    ).rejects.toThrow("whatsapp_send_not_permitted");
    rows.company_settings = { ...rows.company_settings, company_id: "company-1" };
  });

  it("blocks automatic and follow-up independently when takeover is active", async () => {
    rows.conversations = { ...rows.conversations, human_takeover_at: "2026-01-01T00:00:00Z" };
    for (const source of ["automatic", "followup"] as const) {
      await expect(
        authorizeWhatsappSend({
          companyId: "company-1",
          conversationId: "conversation-1",
          leadId: "lead-1",
          source,
        }),
      ).rejects.toThrow("whatsapp_send_not_permitted");
    }
    rows.conversations = { ...rows.conversations, human_takeover_at: null };
  });

  it("does not accept forged authorization objects", () => {
    expect(isWhatsappSendAuthorization({ companyId: "company-1", source: "human" })).toBe(false);
  });
});
