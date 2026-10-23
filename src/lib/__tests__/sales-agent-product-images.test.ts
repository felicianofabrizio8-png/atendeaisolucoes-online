import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  extractCompanyProductImagePath,
  normalizeRequestedProductIds,
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
    expect(serverSource).toContain("if (ids.length === 0) return [];");
    // Nenhuma seleção de imagens por vocabulário de segmento.
    expect(serverSource).not.toMatch(/fiber|fibra|piscina|vinil/i);
    expect(serverSource).toContain("authorization: WhatsappSendAuthorization");
    expect(serverSource).toContain("isWhatsappSendAuthorization(params.authorization)");
    expect(serverSource).toContain('return { sent: 0, failed: 0 }');
    expect(serverSource).not.toMatch(/mediaUrl|send_product_images.*https?:/);
  });

  it("deduplica IDs, ignora valores inválidos e permite até dez produtos", () => {
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
    ).toEqual([ids.p1, ids.p2, ids.p3, ids.p4, ids.p5, ids.p6]);
  });

  it("mantém product_id e seleciona 9 fotos válidas sem duplicar imagem", () => {
    const productIds = Array.from(
      { length: 9 },
      (_, index) => `40000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
    );
    const products = productIds.map((id, index) => ({
      id,
      name: `Produto ${index + 1}`,
      images: [`company-1/produto-${index + 1}.jpg`],
    }));
    products[8].images = ["company-1/produto-1.jpg", "company-1/produto-9.jpg"];

    const selected = resolveProductImages(productIds, products, companyId);

    expect(selected).toHaveLength(9);
    expect(selected.map((image) => image.productId)).toEqual(productIds);
    expect(new Set(selected.map((image) => image.path)).size).toBe(9);
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
});
