import type { SalesAgentMode } from "./sales-agent-mode";

export type SalesAgentProductOperation = "price" | "included_items" | "photos" | "measures";

export type SalesAgentToolErrorCode =
  | "company_id_required"
  | "invalid_input"
  | "access_denied"
  | "product_not_found"
  | "product_inactive"
  | "ambiguous_product"
  | "price_unavailable"
  | "data_unavailable"
  | "invalid_value"
  | "query_error"
  | "action_not_allowed";

export type SalesAgentToolResult<T> =
  | { ok: true; kind: "success"; data: T }
  | { ok: false; kind: "error"; code: SalesAgentToolErrorCode };

export type SalesAgentProductQueryInput = {
  companyId: string;
  scope: { companyId: string; activeOnly: true };
  catalog: readonly unknown[];
  productIds: readonly string[];
  operation: SalesAgentProductOperation;
};

export type SalesAgentValidatedProduct = {
  id: string;
  name: string;
  price: number | null;
  promoPrice: number | null;
  includedItems: string[] | null;
  images: string[] | null;
  measures: {
    lengthM: number | null;
    widthM: number | null;
    depthM: number | null;
    capacityL: number | null;
  };
};

export type SalesAgentProductToolData = {
  operation: SalesAgentProductOperation;
  product: Pick<SalesAgentValidatedProduct, "id" | "name">;
  value:
    | { price: number | null; promoPrice: number | null }
    | { includedItems: string[] }
    | { images: string[] }
    | { measures: SalesAgentValidatedProduct["measures"] };
};

type ProductRecord = Record<string, unknown>;

function failure(code: SalesAgentToolErrorCode): SalesAgentToolResult<never> {
  return { ok: false, kind: "error", code };
}

function readValue(record: ProductRecord, camel: string, snake: string): unknown {
  return record[camel] ?? record[snake];
}

function readNumber(
  record: ProductRecord,
  camel: string,
  snake: string,
): SalesAgentToolResult<number | null> {
  const value = readValue(record, camel, snake);
  if (value === undefined || value === null) return { ok: true, kind: "success", data: null };
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0)
    return failure("invalid_value");
  return { ok: true, kind: "success", data: value };
}

function readStringArray(
  record: ProductRecord,
  camel: string,
  snake: string,
): SalesAgentToolResult<string[] | null> {
  const value = readValue(record, camel, snake);
  if (value === undefined || value === null) return { ok: true, kind: "success", data: null };
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string"))
    return failure("invalid_value");
  return { ok: true, kind: "success", data: [...value] };
}

function validateProduct(
  companyId: string,
  scope: { companyId: string; activeOnly: true },
  raw: unknown,
): SalesAgentToolResult<SalesAgentValidatedProduct> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return failure("query_error");
  const record = raw as ProductRecord;
  const rowCompanyId = record.company_id ?? record.companyId;
  if (rowCompanyId !== undefined && rowCompanyId !== companyId) return failure("access_denied");
  if (scope.companyId !== companyId || scope.activeOnly !== true) return failure("access_denied");
  if (record.active === false) return failure("product_inactive");
  const id = typeof record.id === "string" ? record.id.trim() : "";
  const name = typeof record.name === "string" ? record.name.trim() : "";
  if (!id || !name) return failure("invalid_value");

  const price = readNumber(record, "price", "price");
  const promoPrice = readNumber(record, "promoPrice", "promo_price");
  const lengthM = readNumber(record, "lengthM", "length_m");
  const widthM = readNumber(record, "widthM", "width_m");
  const depthM = readNumber(record, "depthM", "depth_m");
  const capacityL = readNumber(record, "capacityL", "capacity_l");
  const includedItems = readStringArray(record, "includedItems", "included_items");
  const images = readStringArray(record, "images", "images");
  const values = [price, promoPrice, lengthM, widthM, depthM, capacityL, includedItems, images];
  const invalid = values.find((value) => !value.ok);
  if (invalid && !invalid.ok) return invalid;

  return {
    ok: true,
    kind: "success",
    data: {
      id,
      name,
      price: price.ok ? price.data : null,
      promoPrice: promoPrice.ok ? promoPrice.data : null,
      includedItems: includedItems.ok ? includedItems.data : null,
      images: images.ok ? images.data : null,
      measures: {
        lengthM: lengthM.ok ? lengthM.data : null,
        widthM: widthM.ok ? widthM.data : null,
        depthM: depthM.ok ? depthM.data : null,
        capacityL: capacityL.ok ? capacityL.data : null,
      },
    },
  };
}

export function validateSalesAgentCatalog(input: {
  companyId: string;
  scope: { companyId: string; activeOnly: true };
  catalog: readonly unknown[];
}): SalesAgentToolResult<{ count: number }> {
  if (!input.companyId.trim()) return failure("company_id_required");
  if (!Array.isArray(input.catalog)) return failure("query_error");
  for (const product of input.catalog) {
    const result = validateProduct(input.companyId, input.scope, product);
    if (!result.ok) return result;
  }
  return { ok: true, kind: "success", data: { count: input.catalog.length } };
}

export function querySalesAgentProduct(
  input: SalesAgentProductQueryInput,
): SalesAgentToolResult<SalesAgentProductToolData> {
  if (!input.companyId.trim()) return failure("company_id_required");
  if (!Array.isArray(input.productIds) || input.productIds.length === 0)
    return failure("invalid_input");
  if (input.productIds.length !== 1) return failure("ambiguous_product");
  if (!Array.isArray(input.catalog)) return failure("query_error");
  const productId = input.productIds[0];
  if (typeof productId !== "string" || !productId.trim()) return failure("invalid_input");
  const raw = input.catalog.find(
    (item) => item && typeof item === "object" && (item as ProductRecord).id === productId,
  );
  if (!raw) return failure("product_not_found");
  const validated = validateProduct(input.companyId, input.scope, raw);
  if (!validated.ok) return validated;
  const product = { id: validated.data.id, name: validated.data.name };
  switch (input.operation) {
    case "price":
      return validated.data.price === null
        ? failure("price_unavailable")
        : {
            ok: true,
            kind: "success",
            data: {
              operation: input.operation,
              product,
              value: { price: validated.data.price, promoPrice: validated.data.promoPrice },
            },
          };
    case "included_items":
      return validated.data.includedItems === null
        ? failure("data_unavailable")
        : {
            ok: true,
            kind: "success",
            data: {
              operation: input.operation,
              product,
              value: { includedItems: validated.data.includedItems },
            },
          };
    case "photos":
      return validated.data.images === null
        ? failure("data_unavailable")
        : {
            ok: true,
            kind: "success",
            data: { operation: input.operation, product, value: { images: validated.data.images } },
          };
    case "measures":
      return Object.values(validated.data.measures).every((value) => value === null)
        ? failure("data_unavailable")
        : {
            ok: true,
            kind: "success",
            data: {
              operation: input.operation,
              product,
              value: { measures: validated.data.measures },
            },
          };
  }
}

export type SalesAgentActionInput =
  | {
      v2Enabled: boolean;
      mode: SalesAgentMode | null;
      companyId: string;
      kind: "send_text";
      conversationId: string;
      leadId: string;
      text: string;
      productIds?: readonly string[];
    }
  | {
      v2Enabled: boolean;
      mode: SalesAgentMode | null;
      companyId: string;
      kind: "send_product_images";
      conversationId: string;
      leadId: string;
      productIds: readonly string[];
    }
  | {
      v2Enabled: boolean;
      mode: SalesAgentMode | null;
      companyId: string;
      kind: "request_human_handoff";
      reason: string;
    };

export type SalesAgentActionData = {
  kind: SalesAgentActionInput["kind"];
  execute: false;
  companyId: string;
};

export function prepareSalesAgentAction(
  input: SalesAgentActionInput,
): SalesAgentToolResult<SalesAgentActionData> {
  if (!input.v2Enabled) return failure("action_not_allowed");
  if (!input.companyId.trim()) return failure("company_id_required");
  if (input.kind !== "request_human_handoff" && input.mode !== "automatic")
    return failure("action_not_allowed");
  if (input.kind === "send_text" && (!input.conversationId || !input.leadId || !input.text.trim()))
    return failure("invalid_input");
  if (
    input.kind === "send_product_images" &&
    (!input.conversationId || !input.leadId || input.productIds.length === 0)
  )
    return failure("invalid_input");
  if (input.kind === "request_human_handoff" && !input.reason.trim())
    return failure("invalid_input");
  return {
    ok: true,
    kind: "success",
    data: { kind: input.kind, execute: false, companyId: input.companyId },
  };
}
