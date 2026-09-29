import { describe, expect, it } from "vitest";
import {
  isWithinRelationshipWindow,
  localTimeInZone,
  normalizeRelationshipPhone,
} from "../relationship-campaign-dispatcher.server";

describe("relationship campaign dispatch policy", () => {
  it("normalizes phones before suppression lookup", () => {
    expect(normalizeRelationshipPhone("+55 (11) 99999-0000")).toBe("5511999990000");
  });

  it("evaluates business hours in the configured timezone", () => {
    const atLunch = new Date("2026-09-28T16:00:00.000Z"); // 13:00 in Sao Paulo
    const beforeOpen = new Date("2026-09-28T11:30:00.000Z"); // 08:30 in Sao Paulo
    const settings = {
      timezone: "America/Sao_Paulo",
      business_hours_start: "09:00",
      business_hours_end: "18:00",
    };
    expect(localTimeInZone(atLunch, settings.timezone).minutes).toBe(13 * 60);
    expect(isWithinRelationshipWindow(atLunch, settings)).toBe(true);
    expect(isWithinRelationshipWindow(beforeOpen, settings)).toBe(false);
  });

  it("fails closed for an invalid timezone", () => {
    expect(isWithinRelationshipWindow(new Date(), {
      timezone: "not/a-timezone",
      business_hours_start: "09:00",
      business_hours_end: "18:00",
    })).toBe(false);
  });
});
