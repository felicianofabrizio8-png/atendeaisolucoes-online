import { describe, expect, it } from "vitest";
import { resolveConversationControl } from "@/lib/inbox/control-presentation";

describe("conversation control presentation", () => {
  it.each([
    [{ ai_reply_enabled: true, global_scope: "geral" }, "bruna_ativa"],
    [{ ai_reply_enabled: false, global_scope: "geral" }, "ia_desativada"],
    [{ ai_reply_enabled: true, global_scope: "desligado" }, "ia_desativada"],
    [{ ai_reply_enabled: true }, "bruna_ativa"],
    [{ ai_status: "aguardando_humano", ai_reply_enabled: false, global_scope: "desligado" }, "aguardando_humano"],
    [{ ai_status: "assumido_humano", ai_reply_enabled: false, global_scope: "desligado" }, "atendimento_assumido"],
    [{ human_takeover_at: "2026-10-22T12:00:00Z", ai_reply_enabled: false, global_scope: "geral" }, "atendimento_assumido"],
  ] as const)("classifies %j as %s", (input, expected) => {
    expect(resolveConversationControl(input)).toBe(expected);
  });

  it("does not claim Bruna controls while the global AI is disabled", () => {
    expect(resolveConversationControl({ ai_reply_enabled: true, global_enabled: false })).toBe("ia_desativada");
  });
});
