import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import {
  listProducts,
  subscribeProducts,
  createProduct,
  updateProduct,
  deleteProduct,
  getProductsCompanyId,
  PRODUCT_CATEGORIES,
  type Product,
  type ProductCategory,
} from "@/data/products";
import { formatBRL } from "@/data/mock";
import { supabase } from "@/integrations/supabase/client";
import {
  FileText,
  Package,
  Tag,
  Plus,
  Pencil,
  Trash2,
  X,
  Upload,
  ImageIcon,
  ArrowLeft,
  ArrowRight,
  Loader2,
} from "lucide-react";
import { useMemo, useRef, useState, useSyncExternalStore } from "react";
import { toast } from "sonner";


export const Route = createFileRoute("/produtos")({
  component: ProductsPage,
});

function useProducts(): Product[] {
  return useSyncExternalStore(
    subscribeProducts,
    () => listProducts(),
    () => listProducts(),
  );
}

function ProductsPage() {
  const navigate = useNavigate();
  const products = useProducts();
  const [editing, setEditing] = useState<Product | null>(null);
  const [creating, setCreating] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<Product | null>(null);

  const grouped = useMemo(() => {
    const map = new Map<ProductCategory, Product[]>();
    for (const p of products) {
      const arr = map.get(p.category) ?? [];
      arr.push(p);
      map.set(p.category, arr);
    }
    return [...map.entries()];
  }, [products]);

  return (
    <div className="flex-1 overflow-y-auto">
      <header className="h-14 px-4 md:px-6 border-b border-border flex items-center gap-3">
        <Package className="h-4 w-4 text-primary" />
        <div className="flex-1 min-w-0">
          <h1 className="text-sm font-semibold">Catálogo de produtos</h1>
          <p className="text-[11px] text-muted-foreground">
            {products.length} produtos • Tabela ativa: Maio 2026
          </p>
        </div>
        <button
          onClick={() => setCreating(true)}
          className="inline-flex items-center gap-1.5 text-xs font-semibold rounded-md bg-primary text-primary-foreground px-3 py-1.5 hover:opacity-90"
        >
          <Plus className="h-3.5 w-3.5" /> Novo produto
        </button>
      </header>

      <div className="p-4 md:p-6 space-y-8 max-w-5xl">
        {products.length === 0 && (
          <div className="rounded-lg border border-dashed border-border p-8 text-center">
            <Package className="h-6 w-6 text-muted-foreground mx-auto mb-2" />
            <p className="text-sm font-semibold">Nenhum produto cadastrado</p>
            <p className="text-xs text-muted-foreground mt-1">
              Clique em "Novo produto" para começar.
            </p>
          </div>
        )}

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
                    <div className="pt-1.5 mt-auto flex items-center gap-1.5 flex-wrap">
                      <button
                        onClick={() =>
                          navigate({
                            to: "/orcamentos",
                            search: {
                              new: "1",
                              suggestedProductId: p.id,
                            },
                          })
                        }
                        className="inline-flex items-center gap-1.5 text-[11px] font-semibold rounded-md bg-primary text-primary-foreground px-2.5 py-1.5 hover:opacity-90"
                      >
                        <FileText className="h-3 w-3" /> Criar orçamento
                      </button>
                      <button
                        onClick={() => setEditing(p)}
                        className="inline-flex items-center gap-1.5 text-[11px] font-semibold rounded-md border border-border bg-background px-2.5 py-1.5 hover:bg-accent"
                      >
                        <Pencil className="h-3 w-3" /> Editar
                      </button>
                      <button
                        onClick={() => setConfirmDelete(p)}
                        className="inline-flex items-center gap-1.5 text-[11px] font-semibold rounded-md border border-border bg-background px-2.5 py-1.5 hover:bg-destructive hover:text-destructive-foreground hover:border-destructive"
                      >
                        <Trash2 className="h-3 w-3" /> Excluir
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        ))}

        {products.length > 0 && (
          <div className="pt-2">
            <Link to="/orcamentos" search={{}} className="text-xs text-primary hover:underline">
              → Criar orçamento com estes produtos
            </Link>
          </div>
        )}
      </div>

      {(creating || editing) && (
        <ProductFormModal
          product={editing}
          onClose={() => {
            setCreating(false);
            setEditing(null);
          }}
        />
      )}

      {confirmDelete && (
        <ConfirmDeleteModal
          product={confirmDelete}
          onClose={() => setConfirmDelete(null)}
          onConfirm={() => {
            deleteProduct(confirmDelete.id);
            setConfirmDelete(null);
          }}
        />
      )}
    </div>
  );
}

function ProductFormModal({ product, onClose }: { product: Product | null; onClose: () => void }) {
  const isEdit = !!product;
  const [name, setName] = useState(product?.name ?? "");
  const [category, setCategory] = useState<ProductCategory>(
    product?.category ?? PRODUCT_CATEGORIES[0],
  );
  const [price, setPrice] = useState<string>(product ? String(product.price) : "");
  const [promoPrice, setPromoPrice] = useState<string>(
    product?.promoPrice ? String(product.promoPrice) : "",
  );
  const [description, setDescription] = useState(product?.description ?? "");
  const [notes, setNotes] = useState(product?.notes ?? "");
  const [images, setImages] = useState<string[]>(product?.images ?? []);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const priceNum = Number(price.replace(",", "."));
    if (!name.trim()) {
      setError("Informe o nome do produto.");
      return;
    }
    if (!Number.isFinite(priceNum) || priceNum <= 0) {
      setError("Informe um preço válido.");
      return;
    }
    const promoNum = promoPrice ? Number(promoPrice.replace(",", ".")) : undefined;
    if (promoNum !== undefined && (!Number.isFinite(promoNum) || promoNum <= 0)) {
      setError("Preço promocional inválido.");
      return;
    }
    const payload = {
      name: name.trim(),
      category,
      price: priceNum,
      promoPrice: promoNum,
      description: description.trim() || undefined,
      notes: notes.trim() || undefined,
      images,
    };
    if (isEdit && product) {
      updateProduct(product.id, payload);
    } else {
      createProduct(payload);
    }
    onClose();
  };


  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
      <form
        onSubmit={handleSubmit}
        className="bg-card border border-border rounded-lg shadow-lg w-full max-w-md max-h-[90vh] overflow-y-auto"
      >
        <div className="flex items-center justify-between p-4 border-b border-border">
          <h2 className="text-sm font-semibold">{isEdit ? "Editar produto" : "Novo produto"}</h2>
          <button
            type="button"
            onClick={onClose}
            className="text-muted-foreground hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="p-4 space-y-3">
          <div>
            <label className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">
              Nome
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Ex.: Piscina de fibra 6x3"
              className="mt-1 w-full h-9 px-3 text-sm rounded-md border border-border bg-background focus:outline-none focus:ring-1 focus:ring-ring"
              autoFocus
            />
          </div>

          <div>
            <label className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">
              Categoria
            </label>
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value as ProductCategory)}
              className="mt-1 w-full h-9 px-3 text-sm rounded-md border border-border bg-background focus:outline-none focus:ring-1 focus:ring-ring"
            >
              {PRODUCT_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">
                Preço (R$)
              </label>
              <input
                type="number"
                step="0.01"
                min="0"
                value={price}
                onChange={(e) => setPrice(e.target.value)}
                placeholder="0,00"
                className="mt-1 w-full h-9 px-3 text-sm rounded-md border border-border bg-background focus:outline-none focus:ring-1 focus:ring-ring"
              />
            </div>
            <div>
              <label className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">
                Promo (opcional)
              </label>
              <input
                type="number"
                step="0.01"
                min="0"
                value={promoPrice}
                onChange={(e) => setPromoPrice(e.target.value)}
                placeholder="0,00"
                className="mt-1 w-full h-9 px-3 text-sm rounded-md border border-border bg-background focus:outline-none focus:ring-1 focus:ring-ring"
              />
            </div>
          </div>

          <div>
            <label className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">
              Descrição
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              placeholder="Detalhes do produto…"
              className="mt-1 w-full px-3 py-2 text-sm rounded-md border border-border bg-background focus:outline-none focus:ring-1 focus:ring-ring resize-none"
            />
          </div>

          <div>
            <label className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">
              Observações (opcional)
            </label>
            <input
              type="text"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Ex.: Inclui escada inox"
              className="mt-1 w-full h-9 px-3 text-sm rounded-md border border-border bg-background focus:outline-none focus:ring-1 focus:ring-ring"
            />
          </div>

          {error && (
            <div className="text-xs text-destructive bg-destructive/10 border border-destructive/30 rounded-md px-3 py-2">
              {error}
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 p-4 border-t border-border">
          <button
            type="button"
            onClick={onClose}
            className="text-xs font-semibold rounded-md border border-border bg-background px-3 py-1.5 hover:bg-accent"
          >
            Cancelar
          </button>
          <button
            type="submit"
            className="text-xs font-semibold rounded-md bg-primary text-primary-foreground px-3 py-1.5 hover:opacity-90"
          >
            {isEdit ? "Salvar alterações" : "Cadastrar produto"}
          </button>
        </div>
      </form>
    </div>
  );
}

function ConfirmDeleteModal({
  product,
  onClose,
  onConfirm,
}: {
  product: Product;
  onClose: () => void;
  onConfirm: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
      <div className="bg-card border border-border rounded-lg shadow-lg w-full max-w-sm">
        <div className="p-4 border-b border-border">
          <h2 className="text-sm font-semibold">Excluir produto?</h2>
          <p className="text-xs text-muted-foreground mt-1">
            "{product.name}" será removido do catálogo. Essa ação não pode ser desfeita.
          </p>
        </div>
        <div className="flex items-center justify-end gap-2 p-4">
          <button
            onClick={onClose}
            className="text-xs font-semibold rounded-md border border-border bg-background px-3 py-1.5 hover:bg-accent"
          >
            Cancelar
          </button>
          <button
            onClick={onConfirm}
            className="text-xs font-semibold rounded-md bg-destructive text-destructive-foreground px-3 py-1.5 hover:opacity-90 inline-flex items-center gap-1.5"
          >
            <Trash2 className="h-3 w-3" /> Excluir
          </button>
        </div>
      </div>
    </div>
  );
}
