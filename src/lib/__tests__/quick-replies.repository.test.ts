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

    await expect(listActiveQuickRepliesForGrounding("company-1", client)).resolves.toMatchObject(rows);
    expect(builder.select).toHaveBeenCalledWith("name, category, content, sort_order, company_id, conflict_key, valid_until");
  });

  it("não entrega à IA resposta com validade vencida", async () => {
    const now = new Date("2026-11-05T15:00:00Z");
    const rows = [
      { name: "Prazo de entrega", category: null, content: "Carga no fim de outubro.", sort_order: 1, valid_until: "2026-10-31" },
      { name: "Promoção", category: null, content: "Vale até sexta.", sort_order: 2, valid_until: "2026-11-05" },
      { name: "Garantia", category: null, content: "Dois anos.", sort_order: 3, valid_until: null },
    ];
    const client = { from: vi.fn().mockReturnValue(query(rows)) } as unknown as SupabaseClient<any>;

    const result = await listActiveQuickRepliesForGrounding("company-1", client, 20, now);

    expect(result.map((reply) => reply.name)).toEqual(["Promoção", "Garantia"]);
  });

  it("sem a coluna de validade no banco, lê as respostas como antes", async () => {
    const rows = [{ name: "Garantia", category: null, content: "Dois anos.", sort_order: 1 }];
    const failing = query(null);
    failing.then = ((resolve: (value: { data: null; error: { message: string } }) => unknown) =>
      Promise.resolve(resolve({ data: null, error: { message: "column does not exist" } }))) as never;
    const working = query(rows);
    const client = { from: vi.fn().mockReturnValueOnce(failing).mockReturnValueOnce(working) } as unknown as SupabaseClient<any>;

    await expect(listActiveQuickRepliesForGrounding("company-1", client)).resolves.toMatchObject(rows);
    expect(working.select).toHaveBeenCalledWith("name, category, content, sort_order, company_id, conflict_key");
  });
});
