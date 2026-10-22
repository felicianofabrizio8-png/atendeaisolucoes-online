import { createFileRoute, useNavigate } from "@tanstack/react-router";
import {
  listProducts,
  subscribeProducts,
  createProduct,
  deleteProduct,
  getProductsCompanyId,
  listProductCategories,
  type Product,
} from "@/data/products";
import { supabase } from "@/integrations/supabase/client";
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { productMatches } from "@/lib/product-search";
import { toast } from "sonner";
import { attributeRowsFromSpecifications, factKeyFromLabel } from "@/lib/catalog-facts";
import type { AttributeSuggestion } from "@/components/products/ProductAttributesField";
import { CatalogAuditPanel } from "@/components/products/CatalogAuditPanel";
import { ConfirmDeleteModal, ProductFormModal } from "@/components/products/ProductFormModal";
import { ProductDetailSheet } from "@/components/products/ProductDetailSheet";
import {
  ProductsDesktop,
  type CatalogViewProps,
  type ProductSort,
  type QuickFilter,
} from "@/components/products/ProductsCatalog";
import { ProductsMobile } from "@/components/products/ProductsMobile";
import type { ProductActions } from "@/components/products/ProductCard";
import { displayPrice, hasPromo } from "@/components/products/product-view";
import { useTeamAccess } from "@/hooks/useTeamAccess";
import { useIsMobile } from "@/hooks/use-mobile";

export const Route = createFileRoute("/produtos")({
  // Regressão pós-update: SSR desta rota estava causando HTTPError 500 no worker.
  // A biblioteca é 100% client-side (localStorage/Supabase realtime + framer-motion),
  // então desligamos o SSR aqui para eliminar a superfície de falha sem tocar em
  // cadastro, banco ou envio de mídia.
  ssr: false,
  component: ProductsPage,
});

function useProducts(): Product[] {
  return useSyncExternalStore(
    subscribeProducts,
    () => listProducts(),
    () => listProducts(),
  );
}

// Filtro compartilhado com a Biblioteca de Produtos do chat — ver
// `@/lib/product-search`. Alterações devem ser feitas lá para manter as
// duas superfícies em sincronia.

function ProductsPage() {
  const access = useTeamAccess();
  const canEdit = access.can("products.manage");
  const canQuote = access.can("quotes.manage");
  const navigate = useNavigate();
  const isMobile = useIsMobile();
  const products = useProducts();
  const [editing, setEditing] = useState<Product | null>(null);
  const [creating, setCreating] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<Product | null>(null);
  // Painel aberto guarda só o id: edições feitas em outro lugar aparecem na hora.
  const [viewingId, setViewingId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<string | null>(null);
  const [quick, setQuick] = useState<QuickFilter>("todos");
  const [sort, setSort] = useState<ProductSort>("padrao");
  const [dimensionRequiredCategories, setDimensionRequiredCategories] = useState<string[]>([]);

  useEffect(() => {
    const companyId = getProductsCompanyId();
    if (!companyId) return;
    void supabase
      .from("company_settings")
      .select("product_dimension_required_categories")
      .eq("company_id", companyId)
      .maybeSingle()
      .then(({ data }) =>
        setDimensionRequiredCategories(data?.product_dimension_required_categories ?? []),
      );
  }, []);

  // Categorias e características já usadas pela empresa (sugestões na tela).
  const categories = useMemo(() => listProductCategories(products), [products]);
  const attributeSuggestions = useMemo(() => collectAttributeSuggestions(products), [products]);

  // Busca + filtro rápido valem para tudo; a categoria escolhida filtra por cima.
  const searched = useMemo(
    () =>
      products.filter(
        (p) =>
          productMatches(p, query, categories) &&
          (quick === "todos" ||
            (quick === "promo" && hasPromo(p)) ||
            (quick === "semFoto" && !p.images?.length)),
      ),
    [products, query, categories, quick],
  );

  const categoryCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const p of searched) counts.set(p.category, (counts.get(p.category) ?? 0) + 1);
    return [...counts.entries()].map(([name, count]) => ({ category: name, count }));
  }, [searched]);

  // Categoria escolhida que sumiu (renomeada, filtro rápido): volta para "Todas".
  useEffect(() => {
    if (category !== null && !products.some((p) => p.category === category)) setCategory(null);
  }, [category, products]);

  const visible = useMemo(
    () =>
      sortProducts(
        searched.filter((p) => category === null || p.category === category),
        sort,
      ),
    [searched, category, sort],
  );

  const groups = useMemo(() => {
    const map = new Map<string, Product[]>();
    for (const p of visible) {
      const arr = map.get(p.category) ?? [];
      arr.push(p);
      map.set(p.category, arr);
    }
    return [...map.entries()];
  }, [visible]);

  const viewing = viewingId ? (products.find((p) => p.id === viewingId) ?? null) : null;

  const quote = (p?: Product) =>
    navigate(
      p
        ? { to: "/orcamentos", search: { new: "1", suggestedProductId: p.id } }
        : { to: "/orcamentos", search: {} },
    );

  const duplicate = (p: Product) => {
    void createProduct({
      name: `${p.name} (cópia)`,
      model: p.model,
      sku: undefined,
      category: p.category,
      description: p.description,
      lengthM: p.lengthM,
      widthM: p.widthM,
      depthM: p.depthM,
      capacityL: p.capacityL,
      shape: p.shape,
      specifications: p.specifications,
      includedItems: p.includedItems,
      variants: p.variants,
      price: p.price,
      promoPrice: p.promoPrice,
      notes: p.notes,
      images: p.images ?? [],
    }).then(() => toast.success("Produto duplicado"));
  };

  const actionsFor = (p: Product): ProductActions => ({
    onOpen: () => setViewingId(p.id),
    onQuote: canQuote ? () => quote(p) : undefined,
    onEdit: canEdit ? () => setEditing(p) : undefined,
    onDuplicate: canEdit ? () => duplicate(p) : undefined,
    onDelete: canEdit ? () => setConfirmDelete(p) : undefined,
  });

  const view: CatalogViewProps = {
    products,
    visible,
    groups,
    categoryCounts,
    query,
    onQuery: setQuery,
    category,
    onCategory: setCategory,
    quick,
    onQuick: setQuick,
    sort,
    onSort: setSort,
    canEdit,
    canQuote,
    onCreate: () => setCreating(true),
    onQuoteAny: () => quote(),
    actionsFor,
    audit: canEdit && !query.trim() && (
      <CatalogAuditPanel products={products} onEdit={setEditing} />
    ),
  };

  return (
    <>
      {isMobile ? <ProductsMobile {...view} /> : <ProductsDesktop {...view} />}

      {/* O painel some enquanto o formulário ou a exclusão estão abertos (o
          diálogo modal bloquearia cliques neles) e volta atualizado depois. */}
      {viewing && !creating && !editing && !confirmDelete && (
        <ProductDetailSheet
          product={viewing}
          onClose={() => setViewingId(null)}
          onQuote={canQuote ? () => quote(viewing) : undefined}
          onEdit={canEdit ? () => setEditing(viewing) : undefined}
          onDuplicate={
            canEdit
              ? () => {
                  duplicate(viewing);
                  setViewingId(null);
                }
              : undefined
          }
          onDelete={canEdit ? () => setConfirmDelete(viewing) : undefined}
        />
      )}

      {canEdit && (creating || editing) && (
        <ProductFormModal
          product={editing}
          dimensionRequiredCategories={dimensionRequiredCategories}
          categories={categories}
          attributeSuggestions={attributeSuggestions}
          onClose={() => {
            setCreating(false);
            setEditing(null);
          }}
        />
      )}

      {canEdit && confirmDelete && (
        <ConfirmDeleteModal
          product={confirmDelete}
          onClose={() => setConfirmDelete(null)}
          onConfirm={() => {
            deleteProduct(confirmDelete.id);
            if (viewingId === confirmDelete.id) setViewingId(null);
            setConfirmDelete(null);
          }}
        />
      )}
    </>
  );
}

function sortProducts(items: Product[], sort: ProductSort): Product[] {
  if (sort === "padrao") return items;
  const sorted = [...items];
  if (sort === "nome") sorted.sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
  if (sort === "menor") sorted.sort((a, b) => displayPrice(a) - displayPrice(b));
  if (sort === "maior") sorted.sort((a, b) => displayPrice(b) - displayPrice(a));
  return sorted;
}

/** Rótulo → tipo/unidade mais frequentes nas características da empresa. */
function collectAttributeSuggestions(products: Product[]): AttributeSuggestion[] {
  const counts = new Map<string, { suggestion: AttributeSuggestion; count: number }>();
  for (const product of products) {
    for (const row of attributeRowsFromSpecifications(product.specifications)) {
      const id = `${factKeyFromLabel(row.label)}|${row.type}|${row.unit}`;
      const current = counts.get(id);
      counts.set(id, {
        suggestion: current?.suggestion ?? { label: row.label, type: row.type, unit: row.unit },
        count: (current?.count ?? 0) + 1,
      });
    }
  }
  const byLabel = new Map<string, { suggestion: AttributeSuggestion; count: number }>();
  for (const entry of counts.values()) {
    const key = factKeyFromLabel(entry.suggestion.label);
    if ((byLabel.get(key)?.count ?? 0) < entry.count) byLabel.set(key, entry);
  }
  return [...byLabel.values()]
    .map((entry) => entry.suggestion)
    .sort((left, right) => left.label.localeCompare(right.label, "pt-BR"));
}
