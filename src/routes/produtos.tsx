import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { products, type ProductCategory } from "@/data/products";
import { formatBRL } from "@/data/mock";
import { FileText, Package, Tag } from "lucide-react";
import { useMemo } from "react";

export const Route = createFileRoute("/produtos")({
  component: ProductsPage,
});

function ProductsPage() {
  const navigate = useNavigate();
  const grouped = useMemo(() => {
    const map = new Map<ProductCategory, typeof products>();
    for (const p of products) {
      const arr = map.get(p.category) ?? [];
      arr.push(p);
      map.set(p.category, arr);
    }
    return [...map.entries()];
  }, []);

  return (
    <div className="flex-1 overflow-y-auto">
      <header className="h-14 px-6 border-b border-border flex items-center gap-3">
        <Package className="h-4 w-4 text-primary" />
        <div>
          <h1 className="text-sm font-semibold">Catálogo de produtos</h1>
          <p className="text-[11px] text-muted-foreground">
            {products.length} produtos • Tabela ativa: Maio 2026
          </p>
        </div>
      </header>

      <div className="p-6 space-y-8 max-w-5xl">
        {grouped.map(([category, items]) => (
          <section key={category}>
            <h2 className="text-xs uppercase tracking-wide text-muted-foreground mb-2">
              {category}
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {items.map((p) => {
                const hasPromo = p.promoPrice && p.promoPrice < p.price;
                return (
                  <div
                    key={p.id}
                    className="rounded-lg border border-border bg-card p-4 flex flex-col gap-1.5"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="text-sm font-semibold">{p.name}</div>
                        {p.description && (
                          <p className="text-xs text-muted-foreground mt-0.5">{p.description}</p>
                        )}
                      </div>
                      <div className="text-right shrink-0">
                        {hasPromo ? (
                          <>
                            <div className="text-xs text-muted-foreground line-through">
                              {formatBRL(p.price)}
                            </div>
                            <div className="text-sm font-bold text-[var(--status-won)]">
                              {formatBRL(p.promoPrice!)}
                            </div>
                          </>
                        ) : (
                          <div className="text-sm font-bold">{formatBRL(p.price)}</div>
                        )}
                      </div>
                    </div>
                    {p.notes && (
                      <div className="flex items-center gap-1 text-[11px] text-muted-foreground">
                        <Tag className="h-3 w-3" /> {p.notes}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </section>
        ))}

        <div className="pt-2">
          <Link to="/orcamentos" search={{}} className="text-xs text-primary hover:underline">
            → Criar orçamento com estes produtos
          </Link>
        </div>
      </div>
    </div>
  );
}
