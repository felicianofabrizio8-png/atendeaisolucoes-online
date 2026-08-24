import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  createProduct,
  setProductsMode,
  toDbProductFields,
  toProduct,
  updateProduct,
} from "../products";
import {
  parseIncludedItems,
  parseOptionalCatalogNumber,
  parseSpecifications,
  parseVariants,
} from "@/lib/product-catalog-fields";

const migration = readFileSync(
  fileURLToPath(
    new URL(
      "../../../supabase/migrations/20260824000000_add_structured_product_catalog_fields.sql",
      import.meta.url,
    ),
  ),
  "utf8",
);
const productsSource = readFileSync(
  fileURLToPath(new URL("../products.ts", import.meta.url)),
  "utf8",
);
const productsRouteSource = readFileSync(
  fileURLToPath(new URL("../../routes/produtos.tsx", import.meta.url)),
  "utf8",
);

describe("structured product catalog phase 2A", () => {
  it("defines a retrocompatible migration with constraints and useful indexes", () => {
    for (const column of [
      "model text",
      "sku text",
      "length_m numeric",
      "width_m numeric",
      "depth_m numeric",
      "capacity_l numeric",
      "shape text",
      "specifications jsonb NOT NULL DEFAULT '{}'::jsonb",
      "included_items text[] NOT NULL DEFAULT '{}'::text[]",
      "variants jsonb NOT NULL DEFAULT '[]'::jsonb",
    ]) {
      expect(migration).toContain(column);
    }
    expect(migration).toContain("CHECK (length_m IS NULL OR length_m >= 0)");
    expect(migration).toContain("CHECK (capacity_l IS NULL OR capacity_l >= 0)");
    expect(migration).toContain("CREATE UNIQUE INDEX IF NOT EXISTS uq_products_company_sku");
    expect(migration).toContain("company_id, lower(btrim(sku))");
    expect(migration).toContain("idx_products_company_active_length");
    expect(migration).toContain("idx_products_company_active_shape");
    expect(migration).not.toMatch(/\bUPDATE\s+public\.products\b/i);
  });

  it("maps legacy rows without inferring structured data", () => {
    const product = toProduct({
      id: "legacy-1",
      name: "Produto legado",
      category: "Acessórios",
      description: null,
      price: "100",
      promo_price: null,
      notes: null,
      images: [],
    });

    expect(product).toMatchObject({
      id: "legacy-1",
      model: undefined,
      sku: undefined,
      lengthM: undefined,
      shape: undefined,
      specifications: {},
      includedItems: [],
      variants: [],
    });
  });

  it("maps all structured fields to create/update database payloads", () => {
    const fields = toDbProductFields({
      name: "Piscina Caribe",
      model: "Caribe 6",
      sku: "CAR-6X3-AZ",
      category: "Piscinas de fibra",
      description: "Piscina de fibra",
      lengthM: 6,
      widthM: 3,
      depthM: 1.4,
      capacityL: 24_000,
      shape: "quadrada",
      specifications: { material: "fibra" },
      includedItems: ["Filtro", "Bomba"],
      variants: [{ name: "Azul", color: "azul" }],
      price: 20_000,
      promoPrice: 18_000,
      notes: "Instalação não inclusa",
      images: ["company/image.jpg"],
    });

    expect(fields).toMatchObject({
      model: "Caribe 6",
      sku: "CAR-6X3-AZ",
      length_m: 6,
      width_m: 3,
      depth_m: 1.4,
      capacity_l: 24_000,
      shape: "quadrada",
      specifications: { material: "fibra" },
      included_items: ["Filtro", "Bomba"],
      variants: [{ name: "Azul", color: "azul" }],
      promo_price: 18_000,
      images: ["company/image.jpg"],
    });
    expect(productsSource).toContain(".insert({");
    expect(productsSource).toContain(".update(dbPatch)");
    expect(productsSource).toContain("patch.shape ?? null");
  });

  it("supports structured fields in demo create and update without changing legacy products", async () => {
    setProductsMode("demo");
    const created = await createProduct({
      name: "Aquecedor estruturado",
      category: "Aquecedores",
      price: 5_000,
      model: "AQ-1",
      specifications: { power_btu: 75_000 },
    });
    const updated = await updateProduct(created.id, {
      capacityL: 12_000,
      shape: "cilíndrica",
      includedItems: ["Controle"],
    });

    expect(updated).toMatchObject({
      model: "AQ-1",
      capacityL: 12_000,
      shape: "cilíndrica",
      includedItems: ["Controle"],
    });
  });

  it("accepts decimal comma and rejects negative or malformed fields", () => {
    expect(parseOptionalCatalogNumber("1,40")).toBe(1.4);
    expect(parseOptionalCatalogNumber("  ")).toBeUndefined();
    expect(() => parseOptionalCatalogNumber("-1,2")).toThrow("catalog_number_invalid");
    expect(parseIncludedItems("Filtro\n\n Bomba ")).toEqual(["Filtro", "Bomba"]);
    expect(parseSpecifications('{"material":"fibra"}')).toEqual({ material: "fibra" });
    expect(parseVariants('[{"name":"Azul","color":"azul"}]')).toEqual([
      { name: "Azul", color: "azul" },
    ]);
    expect(() => parseSpecifications("[]")).toThrow("catalog_specifications_invalid");
    expect(() => parseSpecifications("{")).toThrow("catalog_specifications_invalid");
    expect(() => parseVariants("{}")).toThrow("catalog_variants_invalid");
  });

  it("keeps shape exact and exposes every optional field in the products form", () => {
    expect(productsRouteSource).toContain("shape: shape.trim() || emptyValue");
    expect(productsRouteSource).not.toContain('shape === "quadrada" ? "retangular"');
    for (const state of [
      "setModel",
      "setSku",
      "setLengthM",
      "setWidthM",
      "setDepthM",
      "setCapacityL",
      "setShape",
      "setSpecifications",
      "setIncludedItems",
      "setVariants",
    ]) {
      expect(productsRouteSource).toContain(state);
    }
    expect(productsRouteSource).toContain("<ProductImagesField images={images}");
  });
});
