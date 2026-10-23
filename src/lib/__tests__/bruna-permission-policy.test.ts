import { describe, expect, it } from "vitest";
import { isAutomaticReplyAllowed } from "../ai-reply-control";
import { resolveSalesAgentMode } from "../sales-agent-mode";
import { resolveBrunaPermissionPolicy } from "../bruna-permission-policy";

const base = { sales_agent_v2_enabled: true } as const;

describe("bruna permission policy · matrix", () => {
  for (const mode of ["automatic", "assisted", "silent"] as const) {
    for (const conversation of [false, true]) {
      for (const takeover of [false, true]) {
        it(`${mode} / conversation=${conversation} / takeover=${takeover}`, () => {
          const result = resolveBrunaPermissionPolicy({
            ...base,
            sales_agent_v2_mode: mode,
            sales_agent_auto_reply: conversation,
            ...(takeover ? { ai_status: "assumido_humano" } : {}),
          });
          const expected = takeover
            ? { allowed: false, reason: "human_takeover" }
            : mode === "automatic"
              ? { allowed: true, reason: "automatic_mode" }
              : mode === "assisted" && conversation
                ? { allowed: true, reason: "assisted_conversation_enabled" }
                : {
                    allowed: false,
                    reason: mode === "silent" ? "silent_mode" : "assisted_approval_required",
                  };
          expect(result.reply).toMatchObject(expected);
          expect(result.mode).toBe(mode);
          expect(result.followup.allowed).toBe(!takeover);
        });
      }
    }
  }

  it("usa ai_auto_reply_enabled somente fora do V2", () => {
    expect(resolveBrunaPermissionPolicy({ ai_auto_reply_enabled: true }).reply).toMatchObject({
      allowed: true,
      reason: "legacy_enabled",
      mode: null,
    });
    expect(resolveBrunaPermissionPolicy({ ai_auto_reply_enabled: false }).reply.allowed).toBe(
      false,
    );
  });

  it("master off vence o legado e não reativa a Bruna", () => {
    expect(
      resolveBrunaPermissionPolicy({
        ai_auto_reply_enabled: true,
        sales_agent_master_enabled: false,
      }),
    ).toMatchObject({
      mode: null,
      reply: { allowed: false, reason: "master_disabled" },
    });
  });
});

describe("bruna permission policy · divergências e equivalência", () => {
  it("expõe combinações conflitantes sem lhes dar semântica nova", () => {
    expect(
      resolveBrunaPermissionPolicy({
        ...base,
        sales_agent_v2_mode: "silent",
        sales_agent_auto_reply: true,
        ai_auto_reply_enabled: true,
      }).divergences,
    ).toEqual(["silent_but_conversation_auto_reply_enabled", "v2_mode_ignores_legacy_flag"]);
  });

  it("registra mestre desligado + legado ligado e mantém bloqueio", () => {
    const result = resolveBrunaPermissionPolicy({
      ai_auto_reply_enabled: true,
      sales_agent_master_enabled: false,
    });
    expect(result.divergences).toEqual(["master_disabled_but_legacy_enabled"]);
    expect(result.reply.allowed).toBe(false);
  });

  it("mantém a divergência conhecida entre V2 e a função legada", () => {
    const input = { ...base, sales_agent_v2_mode: "automatic", ai_auto_reply_enabled: false };
    const policy = resolveBrunaPermissionPolicy(input);
    const legacyGate = isAutomaticReplyAllowed({
      mode: resolveSalesAgentMode(input),
      legacyEnabled: input.ai_auto_reply_enabled,
    });
    expect(policy.reply.allowed).toBe(true);
    expect(legacyGate).toEqual({ ok: true });
    expect(policy.divergences).toContain("v2_mode_ignores_legacy_flag");
  });

  it("handoff não envia quando já existe takeover e follow-up conserva sua trava", () => {
    const result = resolveBrunaPermissionPolicy({
      ...base,
      sales_agent_v2_mode: "automatic",
      handoff_requested: true,
      human_takeover_at: "2026-10-22T12:00:00Z",
    });
    expect(result.handoff).toMatchObject({ allowed: false, reason: "handoff_already_owned" });
    expect(result.followup).toMatchObject({ allowed: false, reason: "followup_human_takeover" });
  });
});
