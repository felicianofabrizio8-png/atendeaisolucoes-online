import { describe, expect, it } from "vitest";
import type { Product } from "@/data/products";
import { buildLibraryPicks } from "@/lib/inbox/product-library";

const product = (id: string, name: string, images: string[]): Product => ({
  id,
  name,
  category: "Piscinas de fibra",
  description: `Descrição de ${name}`,
  price: 1,
  images,
});

describe("buildLibraryPicks", () => {
  it("legenda apenas a primeira imagem de cada produto e preserva a ordem", () => {
    const first = product("p401", "Sol 401", ["401-1", "401-2", "401-3"]);
    const second = product("p604", "Sol 604", ["604-1", "604-2"]);

    expect(buildLibraryPicks(["401-1", "401-2", "401-3", "604-1", "604-2"], [first, second])).toEqual([
      { path: "401-1", productId: "p401", caption: "*Sol 401*\nDescrição de Sol 401" },
      { path: "401-2", productId: "p401", caption: "" },
      { path: "401-3", productId: "p401", caption: "" },
      { path: "604-1", productId: "p604", caption: "*Sol 604*\nDescrição de Sol 604" },
      { path: "604-2", productId: "p604", caption: "" },
    ]);
  });
});
