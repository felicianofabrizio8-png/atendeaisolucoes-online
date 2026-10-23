import { describe, expect, it } from "vitest";
import { isAutomaticReplyAllowed, isHumanTakeoverActive } from "../ai-reply-control";

describe("Atendimento 2.0 takeover fence", () => {
  it("allows a turn before takeover and blocks the same turn after takeover", () => {
    expect(isHumanTakeoverActive({ aiStatus: null, humanTakeoverAt: null })).toBe(false);
    expect(isAutomaticReplyAllowed({ scope: "geral", aiStatus: null, humanTakeoverAt: null })).toEqual({ ok: true });

    const duringProcessing = { aiStatus: "assumido_humano", humanTakeoverAt: "2026-10-22T10:01:00Z" };
    expect(isHumanTakeoverActive(duringProcessing)).toBe(true);
    expect(isAutomaticReplyAllowed({ scope: "geral", ...duringProcessing })).toEqual({ ok: false, reason: "human_active" });
  });

  it("does not turn a pending human action into an automatic send", () => {
    expect(isAutomaticReplyAllowed({ scope: "geral", aiStatus: "aguardando_humano", humanTakeoverAt: null })).toEqual({ ok: false, reason: "human_active" });
  });
});
