// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";

const db = vi.hoisted(() => ({
  rows: [
    { id: "t1", name: "Comercial", hue: 280, owner_id: null },
    { id: "t2", name: "Foco", hue: 140, owner_id: "u1" },
  ],
  inserted: [] as unknown[],
  insertError: null as null | { code: string },
}));
vi.mock("@/auth/AuthContext", () => ({ useAuth: () => ({ user: { id: "u1" } }) }));
vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: () => {
      const builder: Record<string, unknown> = {};
      for (const method of ["select", "eq", "order", "update", "delete"])
        builder[method] = () => builder;
      builder.insert = (row: unknown) => {
        db.inserted.push(row);
        return {
          select: () => ({
            single: async () =>
              db.insertError
                ? { data: null, error: db.insertError }
                : { data: { id: "novo", ...(row as object) }, error: null },
          }),
        };
      };
      builder.then = (resolve: (v: unknown) => unknown) =>
        Promise.resolve({ data: db.rows, error: null }).then(resolve);
      return builder;
    },
  },
}));
import { useAgendaTags } from "../useAgendaTags";
import { toast } from "sonner";

describe("tags da agenda", () => {
  it("separa as da empresa das minhas e cria pessoal com dono e da empresa sem", async () => {
    const { result } = renderHook(() => useAgendaTags("c1", true));
    await waitFor(() => expect(result.current.tags).toHaveLength(2));
    expect(result.current.companyTags.map((t) => t.id)).toEqual(["t1"]);
    expect(result.current.myTags.map((t) => t.id)).toEqual(["t2"]);
    await act(async () => {
      await result.current.create({ name: " Retorno ", hue: 200, personal: true });
      await result.current.create({ name: "Vendas", hue: 300, personal: false });
    });
    expect(db.inserted).toEqual([
      { company_id: "c1", name: "Retorno", hue: 200, owner_id: "u1" },
      { company_id: "c1", name: "Vendas", hue: 300, owner_id: null },
    ]);
  });

  it("nome repetido avisa com mensagem clara", async () => {
    db.insertError = { code: "23505" };
    const { result } = renderHook(() => useAgendaTags("c1", true));
    await waitFor(() => expect(result.current.tags).toHaveLength(2));
    await act(async () => {
      expect(
        await result.current.create({ name: "Comercial", hue: 1, personal: false }),
      ).toBeNull();
    });
    expect(toast.error).toHaveBeenCalledWith("Já existe uma tag com esse nome.");
  });
});
