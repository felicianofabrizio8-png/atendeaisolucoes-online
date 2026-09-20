import { describe, expect, it } from "vitest";
import {
  canSalesAgentSend,
  resolveSalesAgentMode,
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
});
