import { describe, expect, it } from "vitest";
import { isQuickReplyExpired, quickReplyValidity, quickReplyValidityLabel } from "../quick-replies/validity";

const now = new Date("2026-10-28T15:00:00Z"); // 28/10 em São Paulo

describe("validade da resposta rápida", () => {
  it("sem data não vence", () => {
    expect(quickReplyValidity(null, now)).toEqual({ state: "none", daysLeft: null });
    expect(isQuickReplyExpired(undefined, now)).toBe(false);
  });

  it("vale até o fim do último dia", () => {
    expect(quickReplyValidity("2026-10-28", now)).toEqual({ state: "expiring", daysLeft: 0 });
    expect(isQuickReplyExpired("2026-10-28", now)).toBe(false);
    expect(isQuickReplyExpired("2026-10-27", now)).toBe(true);
  });

  it("avisa a equipe a poucos dias do vencimento", () => {
    expect(quickReplyValidityLabel(quickReplyValidity("2026-10-31", now))).toBe("Vence em 3 dias");
    expect(quickReplyValidityLabel(quickReplyValidity("2026-10-29", now))).toBe("Vence amanhã");
    expect(quickReplyValidityLabel(quickReplyValidity("2026-10-28", now))).toBe("Vence hoje");
    expect(quickReplyValidityLabel(quickReplyValidity("2026-11-20", now))).toBeNull();
    expect(quickReplyValidityLabel(quickReplyValidity("2026-10-01", now))).toBe("Vencida");
  });

  it("usa o dia do fuso da empresa, não o UTC", () => {
    // 01:00 UTC do dia 29 ainda é dia 28 em São Paulo.
    expect(isQuickReplyExpired("2026-10-28", new Date("2026-10-29T01:00:00Z"))).toBe(false);
  });

  it("data ilegível é tratada como vencida", () => {
    expect(isQuickReplyExpired("31/10/2026", now)).toBe(true);
  });
});
