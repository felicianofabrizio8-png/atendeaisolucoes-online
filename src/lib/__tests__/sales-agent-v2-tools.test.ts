import { describe, expect, it } from "vitest";
import {
  prepareSalesAgentAction,
  querySalesAgentProduct,
  validateSalesAgentCatalog,
} from "../sales-agent-v2-tools";

const scope = { companyId: "company-1", activeOnly: true as const };
const product = {
  id: "sol-801",
  name: "Sol 801",
  company_id: "company-1",
  active: true,
  price: 18_900,
  promo_price: 17_900,
  included_items: ["filtro", "motobomba"],
  images: ["sol-801.jpg"],
  length_m: 8,
  width_m: 3.5,
  depth_m: 1.4,
  capacity_l: 24_000,
};

function query(
  operation: "price" | "included_items" | "photos" | "measures",
  productIds = [product.id],
  catalog: unknown[] = [product],
) {
  return querySalesAgentProduct({
    companyId: "company-1",
    scope,
    catalog,
    productIds,
    operation,
  });
}

describe("Vendedora V2 — ferramentas formais de produto", () => {
  it.each([
    ["price", { price: 18_900, promoPrice: 17_900 }],
    ["included_items", { includedItems: ["filtro", "motobomba"] }],
    ["photos", { images: ["sol-801.jpg"] }],
    ["measures", { measures: { lengthM: 8, widthM: 3.5, depthM: 1.4, capacityL: 24_000 } }],
  ])("retorna dados validados para %s", (operation, value) => {
    const result = query(operation as "price" | "included_items" | "photos" | "measures");
    expect(result).toEqual({
      ok: true,
      kind: "success",
      data: {
        operation,
        product: { id: "sol-801", name: "Sol 801" },
        value,
      },
    });
  });

  it("distingue preço ausente e dados ausentes", () => {
    expect(query("price", [product.id], [{ ...product, price: null }])).toMatchObject({
      ok: false,
      kind: "error",
      code: "price_unavailable",
    });
    expect(
      query("included_items", [product.id], [{ ...product, included_items: undefined }]),
    ).toMatchObject({
      ok: false,
      kind: "error",
      code: "data_unavailable",
    });
    expect(
      query(
        "measures",
        [product.id],
        [{ ...product, length_m: null, width_m: null, depth_m: null, capacity_l: null }],
      ),
    ).toMatchObject({
      ok: false,
      kind: "error",
      code: "data_unavailable",
    });
  });

  it.each([
    ["produto inexistente", ["missing"], [product], "product_not_found"],
    [
      "produto ambíguo",
      ["sol-801", "sol-802"],
      [product, { ...product, id: "sol-802", name: "Sol 802" }],
      "ambiguous_product",
    ],
    ["produto inativo", [product.id], [{ ...product, active: false }], "product_inactive"],
    [
      "produto de outro tenant",
      [product.id],
      [{ ...product, company_id: "company-2" }],
      "access_denied",
    ],
    ["valor inválido", [product.id], [{ ...product, price: -1 }], "invalid_value"],
  ])("retorna erro discriminado para %s", (_label, productIds, catalog, code) => {
    expect(query("price", productIds, catalog)).toMatchObject({ ok: false, kind: "error", code });
  });

  it("rejeita escopo de company_id divergente e catálogo inválido", () => {
    expect(
      validateSalesAgentCatalog({
        companyId: "company-1",
        scope: { companyId: "company-2", activeOnly: true },
        catalog: [product],
      }),
    ).toMatchObject({
      ok: false,
      code: "access_denied",
    });
    expect(
      validateSalesAgentCatalog({ companyId: "company-1", scope, catalog: null as never }),
    ).toMatchObject({
      ok: false,
      code: "query_error",
    });
  });
});

describe("Vendedora V2 — contrato de ações", () => {
  it("prepara envio automático sem executar integração real", () => {
    const result = prepareSalesAgentAction({
      v2Enabled: true,
      mode: "automatic",
      companyId: "company-1",
      kind: "send_text",
      conversationId: "conversation-1",
      leadId: "lead-1",
      text: "A Sol 801 custa R$ 18.900,00.",
      productIds: ["sol-801"],
    });
    expect(result).toEqual({
      ok: true,
      kind: "success",
      data: { kind: "send_text", execute: false, companyId: "company-1" },
    });
  });

  it.each([
    [
      "flag desligada",
      {
        v2Enabled: false,
        mode: "automatic" as const,
        companyId: "company-1",
        kind: "send_text" as const,
        conversationId: "c",
        leadId: "l",
        text: "oi",
      },
      "action_not_allowed",
    ],
    [
      "modo assistido",
      {
        v2Enabled: true,
        mode: "assisted" as const,
        companyId: "company-1",
        kind: "send_product_images" as const,
        conversationId: "c",
        leadId: "l",
        productIds: ["p"],
      },
      "action_not_allowed",
    ],
    [
      "company ausente",
      {
        v2Enabled: true,
        mode: "automatic" as const,
        companyId: "",
        kind: "send_text" as const,
        conversationId: "c",
        leadId: "l",
        text: "oi",
      },
      "company_id_required",
    ],
    [
      "entrada vazia",
      {
        v2Enabled: true,
        mode: "automatic" as const,
        companyId: "company-1",
        kind: "send_product_images" as const,
        conversationId: "c",
        leadId: "l",
        productIds: [],
      },
      "invalid_input",
    ],
  ])("não executa ação quando há %s", (_label, input, code) => {
    expect(prepareSalesAgentAction(input)).toMatchObject({ ok: false, kind: "error", code });
  });

  it("permite contrato de handoff em modo V2 sem envio", () => {
    expect(
      prepareSalesAgentAction({
        v2Enabled: true,
        mode: "assisted",
        companyId: "company-1",
        kind: "request_human_handoff",
        reason: "preço ausente",
      }),
    ).toMatchObject({ ok: true, data: { kind: "request_human_handoff", execute: false } });
  });
});
