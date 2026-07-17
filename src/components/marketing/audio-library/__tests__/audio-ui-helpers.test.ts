import { describe, expect, it } from "vitest";
import {
  applySeasonToggle,
  filtersToQuery,
  formatPreferredRange,
  formatSeconds,
  splitWithMore,
  toggleInArray,
  validateClientPreferredRange,
} from "../audio-ui-helpers";
import { emptyAudioFilters } from "../AudioFilters";

describe("toggleInArray", () => {
  it("adds when missing", () => {
    expect(toggleInArray(["a"], "b")).toEqual(["a", "b"]);
  });
  it("removes when present", () => {
    expect(toggleInArray(["a", "b"], "a")).toEqual(["b"]);
  });
});

describe("applySeasonToggle", () => {
  it("selecting 'todas' clears others", () => {
    expect(applySeasonToggle(["verao", "inverno"], "todas")).toEqual(["todas"]);
  });
  it("selecting other while 'todas' active replaces with only that one", () => {
    expect(applySeasonToggle(["todas"], "verao")).toEqual(["verao"]);
  });
  it("toggles off 'todas' when re-selected", () => {
    expect(applySeasonToggle(["todas"], "todas")).toEqual([]);
  });
  it("normal toggle when 'todas' not active", () => {
    expect(applySeasonToggle(["verao"], "inverno")).toEqual(["verao", "inverno"]);
    expect(applySeasonToggle(["verao"], "verao")).toEqual([]);
  });
});

describe("formatSeconds", () => {
  it("formats mm:ss with padding", () => {
    expect(formatSeconds(8)).toBe("00:08");
    expect(formatSeconds(75)).toBe("01:15");
    expect(formatSeconds(125)).toBe("02:05");
  });
  it("handles invalid input", () => {
    expect(formatSeconds(null)).toBe("--:--");
    expect(formatSeconds(undefined)).toBe("--:--");
    expect(formatSeconds(-1)).toBe("--:--");
    expect(formatSeconds(Number.NaN)).toBe("--:--");
  });
});

describe("formatPreferredRange", () => {
  it("returns null when either end is missing", () => {
    expect(formatPreferredRange(null, 20)).toBeNull();
    expect(formatPreferredRange(10, null)).toBeNull();
  });
  it("formats with en-dash-like separator", () => {
    expect(formatPreferredRange(22, 37)).toBe("00:22–00:37");
  });
});

describe("splitWithMore", () => {
  it("returns all when under max", () => {
    expect(splitWithMore(["a", "b"], 2)).toEqual({ visible: ["a", "b"], extra: 0 });
  });
  it("caps and reports extra", () => {
    expect(splitWithMore(["a", "b", "c", "d"], 2)).toEqual({
      visible: ["a", "b"],
      extra: 2,
    });
  });
  it("max=0 hides everything", () => {
    expect(splitWithMore(["a", "b"], 0)).toEqual({ visible: [], extra: 2 });
  });
});

describe("validateClientPreferredRange", () => {
  it("accepts empty range", () => {
    const r = validateClientPreferredRange({ start: null, end: null });
    expect(r.ok).toBe(true);
  });
  it("rejects only-start", () => {
    const r = validateClientPreferredRange({ start: 10, end: null });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toMatch(/final/i);
  });
  it("rejects only-end", () => {
    const r = validateClientPreferredRange({ start: null, end: 10 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toMatch(/inicial/i);
  });
  it("rejects end <= start", () => {
    const r = validateClientPreferredRange({ start: 20, end: 20 });
    expect(r.ok).toBe(false);
  });
  it("rejects range beyond duration", () => {
    const r = validateClientPreferredRange({
      start: 10,
      end: 200,
      durationSeconds: 60,
    });
    expect(r.ok).toBe(false);
  });
  it("accepts valid range inside duration", () => {
    const r = validateClientPreferredRange({
      start: 10,
      end: 30,
      durationSeconds: 60,
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.result.start).toBe(10);
      expect(r.result.end).toBe(30);
    }
  });
});

describe("filtersToQuery", () => {
  it("returns empty object when all defaults", () => {
    expect(filtersToQuery(emptyAudioFilters)).toEqual({});
  });
  it("maps every new metadata filter", () => {
    const q = filtersToQuery({
      ...emptyAudioFilters,
      category: "tropical",
      marketingObjective: "venda",
      brandStyle: "premium",
      season: "verao",
      targetAudience: "familia",
      bestVideoDuration: 30,
    });
    expect(q).toEqual({
      category: "tropical",
      marketingObjective: "venda",
      brandStyle: "premium",
      season: "verao",
      targetAudience: "familia",
      bestVideoDuration: 30,
    });
  });
  it("ignores 'all' sentinel values", () => {
    const q = filtersToQuery({
      ...emptyAudioFilters,
      category: "all",
      marketingObjective: "all",
    });
    expect(q).toEqual({});
  });
});
