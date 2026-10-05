import { describe, expect, it } from "vitest";
import {
  canSalesAgentSend,
  isConversationAutoReply,
  resolveSalesAgentMode,
  withConversationAutoReply,
  salesAgentModeReason,
} from "../sales-agent-mode";

describe("sales-agent-mode", () => {
  it("mantém o fluxo legado fora do opt-in", () => {
    expect(resolveSalesAgentMode({ sales_agent_v2_enabled: false })).toBeNull();
    expect(resolveSalesAgentMode({})).toBeNull();
    expect(canSalesAgentSend(null)).toBe(true);
  });

  it("normaliza modo ausente ou inválido para assisted", () => {
    expect(resolveSalesAgentMode({ sales_agent_v2_enabled: true })).toBe("assisted");
    expect(
      resolveSalesAgentMode({ sales_agent_v2_enabled: true, sales_agent_v2_mode: "unsafe" }),
    ).toBe("assisted");
  });

  it("bloqueia envio em silent e assisted", () => {
    expect(canSalesAgentSend("silent")).toBe(false);
    expect(canSalesAgentSend("assisted")).toBe(false);
    expect(canSalesAgentSend("automatic")).toBe(true);
    expect(salesAgentModeReason("silent")).toBe("v2_silent");
    expect(salesAgentModeReason("assisted")).toBe("v2_assisted_approval_required");
  });

  it("integra o contrato de company_settings com o gate de execução", () => {
    const companySettingsRow = {
      sales_agent_v2_enabled: true,
      sales_agent_v2_mode: "silent",
    };
    const mode = resolveSalesAgentMode(companySettingsRow);
    expect(mode).toBe("silent");
    expect(canSalesAgentSend(mode)).toBe(false);
    expect(salesAgentModeReason(mode!)).toBe("v2_silent");
  });

  it("automático por conversa só vale em empresa no modo assistido", () => {
    const assisted = { sales_agent_v2_enabled: true, sales_agent_v2_mode: "assisted" };
    const on = withConversationAutoReply(assisted, true);
    expect(resolveSalesAgentMode(on)).toBe("automatic");
    expect(isConversationAutoReply(on)).toBe(true);
    expect(canSalesAgentSend(resolveSalesAgentMode(on))).toBe(true);
    // Desligado na conversa: continua sugerindo.
    expect(withConversationAutoReply(assisted, false)).toBe(assisted);
    // Silent e legado não passam a responder por causa da conversa.
    const silent = { sales_agent_v2_enabled: true, sales_agent_v2_mode: "silent" };
    expect(withConversationAutoReply(silent, true)).toBe(silent);
    const legacy = { sales_agent_v2_enabled: false, sales_agent_v2_mode: "assisted" };
    expect(withConversationAutoReply(legacy, true)).toBe(legacy);
    // Automático da empresa inteira não é confundido com o da conversa.
    expect(isConversationAutoReply({ sales_agent_v2_enabled: true, sales_agent_v2_mode: "automatic" })).toBe(false);
  });
});
