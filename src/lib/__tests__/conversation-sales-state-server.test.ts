import { beforeEach, describe, expect, it, vi } from "vitest";

const { from } = vi.hoisted(() => ({ from: vi.fn() }));
vi.mock("@/integrations/supabase/client.server", () => ({ supabaseAdmin: { from } }));

import {
  loadConversationSalesState,
  revalidateConversationSalesState,
  saveConversationSalesState,
} from "../conversation-sales-state.server";

function configureQuery(result: { data: unknown; error: unknown }) {
  const query = {
    select: vi.fn(),
    eq: vi.fn(),
    in: vi.fn(),
    maybeSingle: vi.fn(async () => result),
    upsert: vi.fn(async () => result),
    then: (resolve: (value: typeof result) => unknown) => Promise.resolve(resolve(result)),
  };
  query.select.mockReturnValue(query);
  query.eq.mockReturnValue(query);
  query.in.mockReturnValue(query);
  from.mockReturnValue(query);
  return query;
}

describe("conversation sales state loading", () => {
  beforeEach(() => vi.clearAllMocks());

  it("distingue ausência de estado de erro de consulta", async () => {
    configureQuery({ data: null, error: null });
    await expect(loadConversationSalesState({
      companyId: "company-1",
      scopeType: "whatsapp_conversation",
      scopeId: "conversation-1",
    })).resolves.toEqual({ status: "missing", state: null });

    configureQuery({ data: null, error: new Error("database unavailable") });
    const result = await loadConversationSalesState({
      companyId: "company-1",
      scopeType: "whatsapp_conversation",
      scopeId: "conversation-1",
    });
    expect(result.status).toBe("error");
    expect(result).not.toEqual({ status: "missing", state: null });
  });

  it("remove fatos de produto e chaves desconhecidas do payload de memória", async () => {
    configureQuery({
      data: {
        product_ids: ["active-company-1"],
        attributes: { lengthM: 6, price: 9999, description: "fato proibido", specs: { capacity: 1000 }, availability: true },
        intent: "product_inquiry",
        last_valid_product_ids: ["active-company-1"],
        last_catalog_query: {
          status: "matches",
          criteria: { widthM: 3, price: 9999, description: "fato proibido" },
          referencedProductIds: ["active-company-1"],
          availability: "in_stock",
        },
      },
      error: null,
    });
    const result = await loadConversationSalesState({
      companyId: "company-1",
      scopeType: "whatsapp_conversation",
      scopeId: "conversation-1",
    });
    expect(result).toMatchObject({
      status: "found",
      state: {
        attributes: { lengthM: 6 },
        lastCatalogQuery: { criteria: { widthM: 3 }, referencedProductIds: ["active-company-1"] },
      },
    });
    if (result.status === "found") {
      expect(result.state.attributes).not.toHaveProperty("price");
      expect(result.state.lastCatalogQuery).not.toHaveProperty("availability");
      expect(result.state.lastCatalogQuery?.criteria).not.toHaveProperty("description");
    }
  });

  it("descarta IDs de outra empresa ou produto inativo", async () => {
    configureQuery({ data: [{ id: "active-company-1" }], error: null });
    const result = await revalidateConversationSalesState(
      { companyId: "company-1", scopeType: "whatsapp_conversation", scopeId: "conversation-1" },
      {
        productIds: ["active-company-1", "other-company", "inactive"],
        attributes: {},
        intent: "product_inquiry",
        lastValidProductIds: ["active-company-1", "inactive"],
        lastCatalogQuery: {
          status: "matches",
          criteria: {},
          referencedProductIds: ["other-company", "active-company-1"],
        },
      },
    );
    expect(result).toMatchObject({
      status: "validated",
      state: {
        productIds: ["active-company-1"],
        lastValidProductIds: ["active-company-1"],
        lastCatalogQuery: { referencedProductIds: ["active-company-1"] },
      },
    });
    expect(from).toHaveBeenCalledWith("products");
    const query = from.mock.results[0].value;
    expect(query.eq).toHaveBeenCalledWith("company_id", "company-1");
    expect(query.eq).toHaveBeenCalledWith("active", true);
  });

  it("persiste somente os IDs aprovados pela validação ativa e por empresa", async () => {
    const query = configureQuery({ data: [], error: null });
    await saveConversationSalesState(
      { companyId: "company-1", scopeType: "whatsapp_conversation", scopeId: "conversation-1" },
      {
        productIds: ["inactive"],
        attributes: {},
        intent: null,
        lastValidProductIds: ["inactive"],
        lastCatalogQuery: null,
      },
    );
    expect(query.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ product_ids: [], last_valid_product_ids: [] }),
      expect.anything(),
    );
  });
});
