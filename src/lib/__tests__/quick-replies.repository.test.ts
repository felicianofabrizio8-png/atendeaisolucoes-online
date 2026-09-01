import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

import { listActiveQuickRepliesForGrounding } from "../quick-replies/quick-replies.repository";

function query(data: unknown) {
  const builder = {
    select: vi.fn(),
    eq: vi.fn(),
    order: vi.fn(),
    limit: vi.fn(),
    then: (resolve: (value: { data: unknown; error: null }) => unknown) =>
      Promise.resolve(resolve({ data, error: null })),
  };
  builder.select.mockReturnValue(builder);
  builder.eq.mockReturnValue(builder);
  builder.order.mockReturnValue(builder);
  builder.limit.mockReturnValue(builder);
  return builder;
}

describe("listActiveQuickRepliesForGrounding", () => {
  it("isola por company_id e somente busca respostas ativas", async () => {
    const builder = query([]);
    const client = { from: vi.fn().mockReturnValue(builder) } as unknown as SupabaseClient<any>;

    await listActiveQuickRepliesForGrounding("company-1", client);

    expect(client.from).toHaveBeenCalledWith("quick_replies");
    expect(builder.eq).toHaveBeenCalledWith("company_id", "company-1");
    expect(builder.eq).toHaveBeenCalledWith("active", true);
  });

  it("aplica o limite seguro", async () => {
    const builder = query([]);
    const client = { from: vi.fn().mockReturnValue(builder) } as unknown as SupabaseClient<any>;

    await listActiveQuickRepliesForGrounding("company-1", client, 200);

    expect(builder.limit).toHaveBeenCalledWith(50);
  });

  it("retorna somente os campos projetados", async () => {
    const rows = [
      {
        name: "Por Conta do Cliente",
        category: "Orçamento",
        content: "Água e energia.",
        sort_order: 12,
      },
    ];
    const builder = query(rows);
    const client = { from: vi.fn().mockReturnValue(builder) } as unknown as SupabaseClient<any>;

    await expect(listActiveQuickRepliesForGrounding("company-1", client)).resolves.toEqual(rows);
    expect(builder.select).toHaveBeenCalledWith("name, category, content, sort_order");
  });
});
