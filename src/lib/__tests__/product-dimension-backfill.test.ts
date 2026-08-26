import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  categoryRequiresDimensions,
  hasCompleteProductDimensions,
} from "../product-catalog-fields";

const migration = readFileSync(
  fileURLToPath(
    new URL(
      "../../../supabase/migrations/20260825020000_backfill_product_dimensions.sql",
      import.meta.url,
    ),
  ),
  "utf8",
);

describe("generic product dimension backfill", () => {
  it("extracts only one complete description triple and preserves existing values", () => {
    expect(migration).toContain("coalesce(p.description, '')");
    expect(migration).toContain("count(m.parts) = 1");
    expect(migration).toContain("length_m = coalesce(p.length_m, c.length_m)");
    expect(migration).toContain("width_m = coalesce(p.width_m, c.width_m)");
    expect(migration).toContain("depth_m = coalesce(p.depth_m, c.depth_m)");
    expect(migration).not.toMatch(/Solário|Solario|Sol 700|sku|p\.name/i);
  });

  it("handles a description without matches from the left join without aggregating null arrays", () => {
    expect(migration).toContain("LEFT JOIN LATERAL regexp_matches");
    expect(migration).toContain("count(m.parts)::integer");
    expect(migration).toContain("max(replace(m.parts[1], ',', '.')::numeric)");
    expect(migration).toContain("max(replace(m.parts[2], ',', '.')::numeric)");
    expect(migration).toContain("max(replace(m.parts[3], ',', '.')::numeric)");
    expect(migration).not.toContain("array_agg(m.parts)");
    expect(migration).toContain("WHEN c.match_count = 0 THEN 'description_without_unambiguous_triple'");
  });

  it("records migrated and pending products and is rerunnable", () => {
    expect(migration).toContain("product_dimension_backfill_report");
    expect(migration).toContain("description_with_multiple_triples");
    expect(migration).toContain("ON CONFLICT (product_id) DO UPDATE");
    expect(migration).toContain("CREATE OR REPLACE FUNCTION public.backfill_product_dimensions");
  });

  it("requires dimensions only for configured categories", () => {
    expect(categoryRequiresDimensions("Sob medida", ["Sob medida"])).toBe(true);
    expect(categoryRequiresDimensions("Acessórios", ["Sob medida"])).toBe(false);
    expect(hasCompleteProductDimensions({ lengthM: 7, widthM: 3.5, depthM: 1.4 })).toBe(true);
    expect(hasCompleteProductDimensions({ lengthM: 7, widthM: null, depthM: 1.4 })).toBe(false);
    expect(migration).toContain("product_dimension_required_categories");
    expect(migration).toContain("NEW.category = ANY");
  });
});
