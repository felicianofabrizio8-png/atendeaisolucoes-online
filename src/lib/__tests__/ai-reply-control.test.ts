import { describe, expect, it } from "vitest";
import { isAutomaticReplyAllowed, normalizeAiReplyScope, parseAiConversationAction } from "../ai-reply-control";

describe("Atendimento 2.0: escopo e autorização", () => {
  it("mantém compatibilidade legada sem escopo", () => {
    expect(normalizeAiReplyScope(undefined, true)).toBe("geral");
    expect(normalizeAiReplyScope(undefined, false)).toBe("desligado");
  });

  it("TESTE exige autorização da conversa", () => {
    expect(isAutomaticReplyAllowed({ scope: "teste", conversationEnabled: false })).toEqual({
      ok: false,
      reason: "conversation_not_authorized",
    });
    expect(isAutomaticReplyAllowed({ scope: "teste", conversationEnabled: true })).toEqual({ ok: true });
  });

  it("bloqueia desligado e qualquer handoff até retomada explícita", () => {
    expect(isAutomaticReplyAllowed({ scope: "desligado", conversationEnabled: true })).toEqual({ ok: false, reason: "disabled" });
    expect(isAutomaticReplyAllowed({ scope: "geral", aiStatus: "aguardando_humano" })).toEqual({ ok: false, reason: "human_active" });
    expect(isAutomaticReplyAllowed({ scope: "geral", humanTakeoverAt: "2026-10-22T10:00:00Z" })).toEqual({ ok: false, reason: "human_active" });
  });

  it("aceita apenas ações HTTP conhecidas", () => {
    expect(parseAiConversationAction(undefined)).toBeNull();
    expect(parseAiConversationAction("resume")).toBe("resume");
    expect(parseAiConversationAction("enable_all")).toBeNull();
    expect(parseAiConversationAction({})).toBeNull();
  });
});
