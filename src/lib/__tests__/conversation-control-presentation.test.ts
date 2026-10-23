import { describe, expect, it } from "vitest";
import { resolveConversationControl } from "@/lib/inbox/control-presentation";

describe("conversation control presentation", () => {
  it.each([
    [{ global_scope: "geral" }, "bruna_ativa"],
    // No escopo geral a política responde sem opt-in: a tela não pode dizer o contrário.
    [{ sales_agent_auto_reply: false, global_scope: "geral" }, "bruna_ativa"],
    [{ sales_agent_auto_reply: true, global_scope: "desligado" }, "ia_desativada"],
    [{ sales_agent_auto_reply: false, global_scope: "teste" }, "ia_desativada"],
    [{ sales_agent_auto_reply: true, global_scope: "teste" }, "bruna_ativa"],
    [{ mode: "assisted", sales_agent_auto_reply: false }, "ia_desativada"],
    [{ mode: "assisted", sales_agent_auto_reply: true }, "bruna_ativa"],
    [{ mode: "automatic" }, "bruna_ativa"],
    [{ mode: "silent", sales_agent_auto_reply: true }, "ia_desativada"],
    [{ master_enabled: false, mode: "automatic" }, "ia_desativada"],
    [{ ai_status: "aguardando_humano", global_scope: "desligado" }, "aguardando_humano"],
    [{ ai_status: "assumido_humano", global_scope: "desligado" }, "atendimento_assumido"],
    [{ human_takeover_at: "2026-10-22T12:00:00Z", global_scope: "geral" }, "atendimento_assumido"],
  ] as const)("classifies %j as %s", (input, expected) => {
    expect(resolveConversationControl(input)).toBe(expected);
  });

  it("does not claim Bruna controls while the global AI is disabled", () => {
    expect(resolveConversationControl({ sales_agent_auto_reply: true, global_enabled: false })).toBe("ia_desativada");
  });
});
