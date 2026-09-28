import { describe, expect, it } from "vitest";
import {
  isLeadInSegment,
  parseSegmentDefinition,
} from "../relationship-campaigns.server";

const lead = {
  id: "lead-1",
  name: "Ana",
  phone: "5511999999999",
  channel: "whatsapp",
  status: "novo",
  tags: ["vip", "reactivation"],
  product: "service-a",
  assigned_to: "seller-1",
};

describe("relationship campaign segments", () => {
  it("validates a generic definition and evaluates all/any predicates", () => {
    const definition = parseSegmentDefinition({
      all: [{ field: "status", op: "eq", value: "novo" }],
      any: [
        { field: "tag", op: "eq", value: "vip" },
        { field: "product", op: "eq", value: "other" },
      ],
    });

    expect(isLeadInSegment(lead, definition)).toBe(true);
    expect(
      isLeadInSegment(lead, parseSegmentDefinition({
        all: [{ field: "status", op: "eq", value: "qualificado" }],
      })),
    ).toBe(false);
  });

  it("supports tag containment and rejects unknown fields", () => {
    expect(
      isLeadInSegment(
        lead,
        parseSegmentDefinition({ all: [{ field: "tag", op: "contains", value: "rea" }] }),
      ),
    ).toBe(true);

    expect(() => parseSegmentDefinition({
      all: [{ field: "company_name", op: "eq", value: "x" }],
    })).toThrow("field is not supported");
  });

  it("limits predicate complexity", () => {
    expect(() => parseSegmentDefinition({
      all: Array.from({ length: 21 }, () => ({ field: "status", op: "eq", value: "novo" })),
    })).toThrow("at most");
  });
});
