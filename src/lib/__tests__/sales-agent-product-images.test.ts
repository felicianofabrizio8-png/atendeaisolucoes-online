import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  extractCompanyProductImagePath,
  detectFiberCatalogSize,
  normalizeRequestedProductIds,
  resolveFiberCatalogImages,
  resolveProductImages,
} from "../sales-agent-product-images";

const companyId = "company-1";
const ids = {
  p1: "10000000-0000-4000-8000-000000000001",
  p2: "10000000-0000-4000-8000-000000000002",
  p3: "10000000-0000-4000-8000-000000000003",
  p4: "10000000-0000-4000-8000-000000000004",
  p5: "10000000-0000-4000-8000-000000000005",
  p6: "10000000-0000-4000-8000-000000000006",
  missing: "10000000-0000-4000-8000-000000000007",
  otherCompany: "10000000-0000-4000-8000-000000000008",
};

describe("SalesAgent product images", () => {
  it("revalida empresa, produto ativo e IDs no servidor", () => {
    const serverSource = readFileSync(
      fileURLToPath(new URL("../sales-agent-product-images.server.ts", import.meta.url)),
      "utf8",
    );
    expect(serverSource).toContain('.eq("company_id", companyId)');
    expect(serverSource).toContain('.eq("active", true)');
    expect(serverSource).toContain('.in("id", ids)');
    expect(serverSource).toContain("const useFiberFallback = ids.length === 0");
    expect(serverSource).not.toMatch(/mediaUrl|send_product_images.*https?:/);
  });

  it("deduplica IDs, ignora valores inválidos e limita a cinco produtos", () => {
    expect(
      normalizeRequestedProductIds([
        ids.p1,
        ids.p1,
        null,
        "not-a-uuid",
        ids.p2,
        ids.p3,
        ids.p4,
        ids.p5,
        ids.p6,
      ]),
    ).toEqual([ids.p1, ids.p2, ids.p3, ids.p4, ids.p5]);
  });

  it("aceita somente paths do bucket de imagens escopados pela empresa", () => {
    expect(extractCompanyProductImagePath("company-1/a.jpg", companyId)).toBe("company-1/a.jpg");
    expect(
      extractCompanyProductImagePath(
        "https://project.supabase.co/storage/v1/object/public/product-images/company-1/b.jpg",
        companyId,
      ),
    ).toBe("company-1/b.jpg");
    expect(extractCompanyProductImagePath("company-2/a.jpg", companyId)).toBeNull();
    expect(
      extractCompanyProductImagePath("https://example.com/inventada.jpg", companyId),
    ).toBeNull();
  });

  it("seleciona uma foto cadastrada por produto e ignora IDs sem produto ou imagem válida", () => {
    expect(
      resolveProductImages(
        [ids.p2, ids.missing, ids.p1, ids.p2, ids.otherCompany],
        [
          { id: ids.p1, name: "Modelo 6x3", images: ["company-1/p1-a.jpg", "company-1/p1-b.jpg"] },
          {
            id: ids.p2,
            name: "Modelo 6x2",
            images: ["https://example.com/falsa.jpg", "company-1/p2.jpg"],
          },
          { id: ids.otherCompany, name: "Inválido", images: ["company-2/x.jpg"] },
        ],
        companyId,
      ),
    ).toEqual([
      {
        productId: ids.p2,
        productName: "Modelo 6x2",
        storedImage: "company-1/p2.jpg",
        path: "company-1/p2.jpg",
      },
      {
        productId: ids.p1,
        productName: "Modelo 6x3",
        storedImage: "company-1/p1-a.jpg",
        path: "company-1/p1-a.jpg",
      },
    ]);
  });

  it("classifica tamanho padrão como fibra por padrão e nunca classifica vinil", () => {
    expect(
      detectFiberCatalogSize({
        history: [{ role: "lead", text: "Quero uma piscina de fibra de 6 metros" }],
      }),
    ).toBe(6);
    expect(
      detectFiberCatalogSize({
        history: [{ role: "lead", text: "Quero uma piscina de vinil de 6 metros" }],
      }),
    ).toBeNull();
    expect(
      detectFiberCatalogSize({
        history: [{ role: "lead", text: "Quero uma piscina de 6 metros" }],
      }),
    ).toBe(6);
  });

  it("seleciona todos os modelos ativos de fibra do tamanho, sem limite de cinco", () => {
    const products = Array.from({ length: 7 }, (_, index) => ({
      id: `20000000-0000-4000-8000-00000000000${index}`,
      name: `Modelo Fibra 6m ${index}`,
      category: "Piscinas de fibra",
      description: "Piscina de 6 metros",
      images: [`company-1/modelo-${index}.jpg`, `company-1/modelo-${index}-extra.jpg`],
    }));
    products.push({
      id: "30000000-0000-4000-8000-000000000001",
      name: "Vinil 6m",
      category: "Piscinas de vinil",
      description: "Piscina de 6 metros",
      images: ["company-1/vinil.jpg"],
    });
    products.push({
      id: "30000000-0000-4000-8000-000000000002",
      name: "Fibra 8m",
      category: "Piscinas de fibra",
      description: "Piscina de 8 metros",
      images: ["company-1/fibra-8.jpg"],
    });

    const inferredSize = detectFiberCatalogSize({
      history: [{ role: "lead", text: "Quero uma piscina de 6 metros" }],
    });
    const selected = resolveFiberCatalogImages(inferredSize!, products, companyId);

    expect(selected).toHaveLength(7);
    expect(new Set(selected.map((image) => image.productId)).size).toBe(7);
    expect(selected.every((image) => image.path.endsWith(".jpg"))).toBe(true);
  });

  it("não expande catálogo de fibra quando o cliente informa vinil", () => {
    const inferredSize = detectFiberCatalogSize({
      history: [{ role: "lead", text: "Quero uma piscina de vinil de 6 metros" }],
    });

    expect(inferredSize).toBeNull();
  });
});
