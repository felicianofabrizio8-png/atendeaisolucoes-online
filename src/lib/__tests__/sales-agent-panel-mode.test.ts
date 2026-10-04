import { describe, expect, it } from "vitest";
import { isSalesAgentServingAttendants } from "../sales-agent-mode";

describe("qual painel de IA a empresa vê", () => {
  it.each([
    [{ sales_agent_v2_enabled: true, sales_agent_v2_mode: "assisted" }, true],
    [{ sales_agent_v2_enabled: true, sales_agent_v2_mode: "automatic" }, true],
    [{ sales_agent_v2_enabled: true, sales_agent_v2_mode: "silent" }, false],
    [{ sales_agent_v2_enabled: false, sales_agent_v2_mode: "assisted" }, false],
    [{ sales_agent_v2_enabled: null, sales_agent_v2_mode: null }, false],
    [{}, false],
    [null, false],
    [undefined, false],
  ])("%j → Vendedora 2.0 atendendo: %s", (settings, expected) => {
    expect(isSalesAgentServingAttendants(settings)).toBe(expected);
  });
});
