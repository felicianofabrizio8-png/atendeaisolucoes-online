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

describe("precedência única: chave-mestra > takeover > empresa > conversa", () => {
  it.each([
    ["chave-mestra desligada vence modo automático", { masterEnabled: false, mode: "automatic" }, "master_disabled"],
    ["chave-mestra desligada vence escopo geral", { masterEnabled: false, scope: "geral" }, "master_disabled"],
    ["takeover vence modo automático", { mode: "automatic", humanTakeoverAt: "2026-10-23T10:00:00Z" }, "human_active"],
    ["aguardando humano vence escopo geral", { scope: "geral", aiStatus: "aguardando_humano" }, "human_active"],
    ["silent nunca responde, mesmo com opt-in", { mode: "silent", salesAgentAutoReply: true }, "disabled"],
    ["assisted exige opt-in da conversa", { mode: "assisted", salesAgentAutoReply: false }, "conversation_not_authorized"],
    ["escopo teste exige opt-in da conversa", { scope: "teste", salesAgentAutoReply: false }, "conversation_not_authorized"],
    ["escopo desligado não responde", { scope: "desligado", salesAgentAutoReply: true }, "disabled"],
  ] as const)("%s", (_label, input, reason) => {
    expect(isAutomaticReplyAllowed(input)).toEqual({ ok: false, reason });
  });

  it.each([
    ["automático da empresa", { mode: "automatic" }],
    ["assisted com opt-in", { mode: "assisted", salesAgentAutoReply: true }],
    ["teste com opt-in", { scope: "teste", salesAgentAutoReply: true }],
    ["geral sem opt-in", { scope: "geral" }],
    ["chave-mestra ausente (padrão ligado)", { masterEnabled: null, mode: "automatic" }],
  ] as const)("permite: %s", (_label, input) => {
    expect(isAutomaticReplyAllowed(input)).toEqual({ ok: true });
  });
});
