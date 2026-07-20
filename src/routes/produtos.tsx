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
  Camera,
  Search,
  Copy,
  Eye,
} from "lucide-react";
import { compressImage, isMobileDevice } from "@/lib/image-compress";
import { useMemo, useRef, useState, useSyncExternalStore } from "react";
import { parseMeasureQuery, productMatchesMeasure } from "@/lib/product-measure-filter";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { SmartImage } from "@/components/SmartImage";
import { motion } from "framer-motion";


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

function normalizeSearch(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function productMatches(product: Product, rawQuery: string): boolean {
  if (!rawQuery.trim()) return true;

  // 1) PRIORIDADE MÁXIMA: filtro exclusivo por medida principal.
  //    Se o termo for apenas um número (opcionalmente com "m"/"metros"),
  //    restringe SOMENTE aos produtos cujo comprimento principal (extraído
  //    de padrões NxM ou "N m/metros" em nome/descrição) case exatamente.
  //    Preço, litragem, códigos de modelo ("Sol 500") NÃO contam.
  const measure = parseMeasureQuery(rawQuery);
  if (measure !== null) {
    return productMatchesMeasure(
      { name: product.name, description: product.description },
      measure,
    );
  }

  const q = normalizeSearch(rawQuery);
  // 2) Filtro determinístico por categoria: se o termo digitado equivale ao
  //    nome de uma categoria, restringe apenas àquela categoria.
  const productCat = normalizeSearch(product.category ?? "");
  const isCategoryQuery = PRODUCT_CATEGORIES.some((cat) => {
    const nc = normalizeSearch(cat);
    return nc === q || nc.startsWith(q) || nc.endsWith(q);
  });
  if (isCategoryQuery) {
    return productCat === q || productCat.startsWith(q) || productCat.endsWith(q);
  }

  // 3) Busca textual comum — sem `price` no haystack.
  const haystack = normalizeSearch(
    [product.name, product.category, product.description, product.notes].join(" "),
  );
  return haystack.includes(q);
}

function ProductsPage() {
  const navigate = useNavigate();
  const products = useProducts();
  const [editing, setEditing] = useState<Product | null>(null);
  const [creating, setCreating] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<Product | null>(null);
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    return products.filter((p) => productMatches(p, query));
  }, [products, query]);

  const grouped = useMemo(() => {
    const map = new Map<ProductCategory, Product[]>();
    for (const p of filtered) {
      const arr = map.get(p.category) ?? [];
      arr.push(p);
      map.set(p.category, arr);
    }
    return [...map.entries()];
  }, [filtered]);

  return (
    <div className="flex-1 overflow-y-auto safe-bottom">
      <header className="sticky top-0 z-20 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80 h-14 px-3 md:px-6 border-b border-border flex items-center gap-2 md:gap-3">
        <Package className="h-4 w-4 text-primary shrink-0" />
        <div className="flex-1 min-w-0">
          <h1 className="text-sm font-semibold truncate">Catálogo de produtos</h1>
          <p className="text-[11px] text-muted-foreground truncate">
            {query.trim()
              ? `${filtered.length} resultado${filtered.length === 1 ? "" : "s"}`
              : `${products.length} produtos`}
          </p>
        </div>
        <button
          onClick={() => setCreating(true)}
          aria-label="Novo produto"
          className="hidden md:inline-flex items-center gap-1.5 text-xs font-semibold rounded-md bg-primary text-primary-foreground px-3 py-1.5 hover:opacity-90"
        >
          <Plus className="h-3.5 w-3.5" /> Novo produto
        </button>
        <button
          onClick={() => setCreating(true)}
          aria-label="Novo produto"
          className="md:hidden h-11 w-11 inline-flex items-center justify-center rounded-md bg-primary text-primary-foreground hover:opacity-90"
        >
          <Plus className="h-5 w-5" />
        </button>
      </header>

      <div className="p-3 md:p-6 space-y-4 md:space-y-6">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar por nome, categoria…"
            className="w-full h-11 md:h-10 pl-9 pr-10 text-base md:text-sm rounded-md border border-border bg-background focus:outline-none focus:ring-1 focus:ring-ring"
          />
          {query && (
            <button
              onClick={() => setQuery("")}
              className="absolute right-1 top-1/2 -translate-y-1/2 h-9 w-9 inline-flex items-center justify-center text-muted-foreground hover:text-foreground"
              aria-label="Limpar busca"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>

        {products.length === 0 && (
          <div className="rounded-lg border border-dashed border-border p-8 text-center">
            <Package className="h-6 w-6 text-muted-foreground mx-auto mb-2" />
            <p className="text-sm font-semibold">Nenhum produto cadastrado</p>
            <p className="text-xs text-muted-foreground mt-1">
              Toque em "+" para começar.
            </p>
          </div>
        )}

        {query.trim() && filtered.length === 0 && (
          <div className="rounded-lg border border-dashed border-border p-8 text-center">
            <Search className="h-6 w-6 text-muted-foreground mx-auto mb-2" />
            <p className="text-sm font-semibold">Não encontramos produtos para sua pesquisa.</p>
            <p className="text-xs text-muted-foreground mt-1">
              Tente outro termo como "SPA", "6x3" ou "aquecedor".
            </p>
          </div>
        )}

        {grouped.map(([category, items]) => (
          <section key={category}>
            <h2 className="text-xs uppercase tracking-wide text-muted-foreground mb-3 px-1">
              {category}
            </h2>
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3 md:gap-4">
              {items.map((p, idx) => (
                <ProductCard
                  key={p.id}
                  product={p}
                  query={query}
                  index={idx}
                  onEdit={() => setEditing(p)}
                  onDelete={() => setConfirmDelete(p)}
                  onDuplicate={() => {
                    void createProduct({
                      name: `${p.name} (cópia)`,
                      category: p.category,
                      description: p.description,
                      price: p.price,
                      promoPrice: p.promoPrice,
                      notes: p.notes,
                      images: p.images ?? [],
                    }).then(() => toast.success("Produto duplicado"));
                  }}
                  onQuote={() =>
                    navigate({
                      to: "/orcamentos",
                      search: { new: "1", suggestedProductId: p.id },
                    })
                  }
                />
              ))}
            </div>
          </section>
        ))}


        {!query.trim() && products.length > 0 && (
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

function highlightMatch(text: string, query: string): React.ReactNode {
  const q = query.trim();
  if (!q) return text;
  const nText = normalizeSearch(text);
  const nQuery = normalizeSearch(q);
  const idx = nText.indexOf(nQuery);
  if (idx === -1) return text;
  return (
    <>
      {text.slice(0, idx)}
      <mark className="bg-yellow-200 dark:bg-yellow-500/40 text-inherit rounded-sm px-0.5">
        {text.slice(idx, idx + q.length)}
      </mark>
      {text.slice(idx + q.length)}
    </>
  );
}

interface ProductCardProps {
  product: Product;
  query: string;
  index: number;
  onEdit: () => void;
  onDelete: () => void;
  onDuplicate: () => void;
  onQuote: () => void;
}

function ProductCard({ product, query, index, onEdit, onDelete, onDuplicate, onQuote }: ProductCardProps) {
  const hasPromo = product.promoPrice && product.promoPrice < product.price;
  const cover = product.images?.[0];
  const displayPrice = hasPromo ? product.promoPrice! : product.price;

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25, delay: Math.min(index * 0.02, 0.2), ease: "easeOut" }}
      whileHover={{ y: -4 }}
      className="group relative flex flex-col rounded-xl border border-border bg-card overflow-hidden shadow-sm hover:shadow-lg hover:border-primary/40 transition-all duration-200"
    >
      <div className="relative w-full bg-muted/40" style={{ aspectRatio: "1 / 1" }}>
        {cover ? (
          <SmartImage
            src={cover}
            alt={product.name}
            wrapperClassName="w-full h-full"
            aspectRatio="1/1"
            thumbWidth={480}
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-muted-foreground">
            <ImageIcon className="h-8 w-8 opacity-40" />
          </div>
        )}

        <div className="absolute top-2 left-2">
          <span className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide rounded-full bg-background/85 backdrop-blur px-2 py-0.5 text-foreground border border-border/60">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
            Ativo
          </span>
        </div>

        {hasPromo && (
          <div className="absolute top-2 right-2">
            <span className="text-[10px] font-bold uppercase tracking-wide rounded-full bg-[var(--status-won)] text-[var(--status-won-foreground)] px-2 py-0.5 shadow-sm">
              Promo
            </span>
          </div>
        )}

        <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-black/10 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-200 flex items-end justify-center gap-1.5 p-2.5">
          <CardIconButton label="Visualizar" onClick={onQuote}>
            <Eye className="h-3.5 w-3.5" />
          </CardIconButton>
          <CardIconButton label="Editar" onClick={onEdit}>
            <Pencil className="h-3.5 w-3.5" />
          </CardIconButton>
          <CardIconButton label="Duplicar" onClick={onDuplicate}>
            <Copy className="h-3.5 w-3.5" />
          </CardIconButton>
          <CardIconButton label="Excluir" onClick={onDelete} destructive>
            <Trash2 className="h-3.5 w-3.5" />
          </CardIconButton>
        </div>
      </div>

      <div className="flex flex-col gap-1.5 p-3">
        <h3
          className="text-sm font-semibold leading-snug line-clamp-2 min-h-[2.5rem]"
          title={product.name}
        >
          {highlightMatch(product.name, query)}
        </h3>
        <div className="flex items-center gap-1.5">
          <span className="inline-flex items-center gap-1 text-[10px] font-medium rounded-md bg-secondary text-secondary-foreground px-1.5 py-0.5 truncate max-w-full">
            <Tag className="h-2.5 w-2.5 shrink-0" />
            <span className="truncate">{product.category}</span>
          </span>
        </div>
        <div className="flex items-baseline gap-2 pt-0.5">
          <span className="text-base font-bold text-foreground">{formatBRL(displayPrice)}</span>
          {hasPromo && (
            <span className="text-[11px] text-muted-foreground line-through">
              {formatBRL(product.price)}
            </span>
          )}
        </div>
      </div>
    </motion.div>
  );
}

function CardIconButton({
  children,
  onClick,
  label,
  destructive,
}: {
  children: React.ReactNode;
  onClick: () => void;
  label: string;
  destructive?: boolean;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      className={cn(
        "h-8 w-8 inline-flex items-center justify-center rounded-full bg-background/95 backdrop-blur border border-border/60 shadow-sm text-foreground hover:scale-110 transition-transform",
        destructive && "hover:bg-destructive hover:text-destructive-foreground hover:border-destructive",
        !destructive && "hover:bg-primary hover:text-primary-foreground hover:border-primary",
      )}
    >
      {children}
    </button>
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
    <div className="fixed inset-0 z-50 bg-black/60 flex items-stretch md:items-center justify-center md:p-4">
      <form
        onSubmit={handleSubmit}
        className="bg-card border-0 md:border border-border md:rounded-lg shadow-lg w-full md:max-w-md max-h-[100dvh] md:max-h-[90vh] overflow-y-auto safe-top safe-bottom"
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
              className="mt-1 w-full h-11 md:h-9 px-3 text-base md:text-sm rounded-md border border-border bg-background focus:outline-none focus:ring-1 focus:ring-ring"
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
              className="mt-1 w-full h-11 md:h-9 px-3 text-base md:text-sm rounded-md border border-border bg-background focus:outline-none focus:ring-1 focus:ring-ring"
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
                className="mt-1 w-full h-11 md:h-9 px-3 text-base md:text-sm rounded-md border border-border bg-background focus:outline-none focus:ring-1 focus:ring-ring"
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
                className="mt-1 w-full h-11 md:h-9 px-3 text-base md:text-sm rounded-md border border-border bg-background focus:outline-none focus:ring-1 focus:ring-ring"
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
              className="mt-1 w-full px-3 py-2 text-base md:text-sm rounded-md border border-border bg-background focus:outline-none focus:ring-1 focus:ring-ring resize-none"
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
              className="mt-1 w-full h-11 md:h-9 px-3 text-base md:text-sm rounded-md border border-border bg-background focus:outline-none focus:ring-1 focus:ring-ring"
            />
          </div>

          <ProductImagesField images={images} onChange={setImages} />


          {error && (
            <div className="text-xs text-destructive bg-destructive/10 border border-destructive/30 rounded-md px-3 py-2">
              {error}
            </div>
          )}
        </div>

        <div className="sticky bottom-0 bg-card flex items-center justify-end gap-2 p-3 md:p-4 border-t border-border safe-bottom">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 md:flex-none text-sm md:text-xs font-semibold rounded-md border border-border bg-background h-11 md:h-auto md:px-3 md:py-1.5 hover:bg-accent"
          >
            Cancelar
          </button>
          <button
            type="submit"
            className="flex-1 md:flex-none text-sm md:text-xs font-semibold rounded-md bg-primary text-primary-foreground h-11 md:h-auto md:px-3 md:py-1.5 hover:opacity-90"
          >
            {isEdit ? "Salvar" : "Cadastrar"}
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
        <div className="flex items-center justify-end gap-2 p-3 md:p-4">
          <button
            onClick={onClose}
            className="flex-1 md:flex-none text-sm md:text-xs font-semibold rounded-md border border-border bg-background h-11 md:h-auto md:px-3 md:py-1.5 hover:bg-accent"
          >
            Cancelar
          </button>
          <button
            onClick={onConfirm}
            className="flex-1 md:flex-none text-sm md:text-xs font-semibold rounded-md bg-destructive text-destructive-foreground h-11 md:h-auto md:px-3 md:py-1.5 hover:opacity-90 inline-flex items-center justify-center gap-1.5"
          >
            <Trash2 className="h-3.5 w-3.5" /> Excluir
          </button>
        </div>
      </div>
    </div>
  );
}

function ProductImagesField({
  images,
  onChange,
}: {
  images: string[];
  onChange: (next: string[]) => void;
}) {
  const galleryRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  // Local blob previews appended optimistically while uploading
  const [pendingPreviews, setPendingPreviews] = useState<string[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const isMobile = useMemo(() => isMobileDevice(), []);

  const handleFiles = async (files: FileList | File[] | null) => {
    if (!files) return;
    const list = Array.from(files as ArrayLike<File>);
    if (list.length === 0) return;
    const companyId = getProductsCompanyId();
    if (!companyId) {
      toast.error("Carregue uma empresa antes de enviar fotos.");
      return;
    }

    // Optimistic local previews for instant feedback
    const previewUrls = list
      .filter((f) => f.type.startsWith("image/"))
      .map((f) => URL.createObjectURL(f));
    setPendingPreviews((p) => [...p, ...previewUrls]);

    setUploading(true);
    setProgress({ done: 0, total: list.length });
    const uploaded: string[] = [];
    try {
      let done = 0;
      for (const file of list) {
        if (!file.type.startsWith("image/")) {
          toast.error(`Arquivo ignorado (não é imagem): ${file.name}`);
          done++;
          setProgress({ done, total: list.length });
          continue;
        }
        try {
          const compressed = await compressImage(file);
          const path = `${companyId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.jpg`;
          const { error } = await supabase.storage
            .from("product-images")
            .upload(path, compressed, {
              cacheControl: "31536000",
              upsert: false,
              contentType: compressed.type || "image/jpeg",
            });
          if (error) {
            console.error("PRODUCT_IMAGE_UPLOAD_ERROR", error);
            const msg = /quota/i.test(error.message)
              ? "Limite de armazenamento da empresa atingido. Remova imagens antigas ou contate o admin."
              : `Falha ao enviar ${file.name}: ${error.message}`;
            toast.error(msg);
          } else {
            const { getPublicImageUrl } = await import("@/lib/storage");
            uploaded.push(getPublicImageUrl(path));
          }
        } catch (e) {
          console.error("PRODUCT_IMAGE_COMPRESS_ERROR", e);
          toast.error(`Falha ao processar ${file.name}`);
        }
        done++;
        setProgress({ done, total: list.length });
      }
      if (uploaded.length) {
        onChange([...images, ...uploaded]);
        toast.success(`${uploaded.length} foto(s) adicionada(s)`);
      }
    } finally {
      // Release object URLs
      previewUrls.forEach((u) => URL.revokeObjectURL(u));
      setPendingPreviews((p) => p.filter((u) => !previewUrls.includes(u)));
      setUploading(false);
      setProgress(null);
      if (galleryRef.current) galleryRef.current.value = "";
      if (cameraRef.current) cameraRef.current.value = "";
    }
  };

  const remove = (idx: number) => {
    onChange(images.filter((_, i) => i !== idx));
  };

  const move = (idx: number, dir: -1 | 1) => {
    const next = [...images];
    const j = idx + dir;
    if (j < 0 || j >= next.length) return;
    [next[idx], next[j]] = [next[j], next[idx]];
    onChange(next);
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    if (e.dataTransfer?.files?.length) {
      handleFiles(e.dataTransfer.files);
    }
  };

  return (
    <div>
      <label className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">
        Fotos do produto
      </label>
      <div className="mt-1 space-y-2">
        {(images.length > 0 || pendingPreviews.length > 0) && (
          <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
            {images.map((url, idx) => (
              <div
                key={url + idx}
                className="relative group aspect-square rounded-md overflow-hidden border border-border bg-muted touch-manipulation"
              >
                <SmartImage
                  src={url}
                  alt={`Foto ${idx + 1}`}
                  aspectRatio="1/1"
                  wrapperClassName="w-full h-full"
                />

                {/* Always-visible action bar on mobile, hover on desktop */}
                <div className="absolute inset-x-0 bottom-0 flex items-center justify-between gap-1 p-1 bg-gradient-to-t from-black/70 to-transparent opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity">
                  <button
                    type="button"
                    onClick={() => move(idx, -1)}
                    disabled={idx === 0}
                    className="p-1.5 rounded bg-background/90 hover:bg-background disabled:opacity-30"
                    title="Mover para esquerda"
                  >
                    <ArrowLeft className="h-3 w-3" />
                  </button>
                  <button
                    type="button"
                    onClick={() => move(idx, 1)}
                    disabled={idx === images.length - 1}
                    className="p-1.5 rounded bg-background/90 hover:bg-background disabled:opacity-30"
                    title="Mover para direita"
                  >
                    <ArrowRight className="h-3 w-3" />
                  </button>
                  <button
                    type="button"
                    onClick={() => remove(idx)}
                    className="p-1.5 rounded bg-destructive text-destructive-foreground hover:opacity-90"
                    title="Remover"
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                </div>
                {idx === 0 && (
                  <span className="absolute top-1 left-1 text-[9px] font-semibold bg-primary text-primary-foreground rounded px-1.5 py-0.5">
                    CAPA
                  </span>
                )}
              </div>
            ))}
            {pendingPreviews.map((url) => (
              <div
                key={url}
                className="relative aspect-square rounded-md overflow-hidden border border-border bg-muted"
              >
                <img src={url} alt="" className="w-full h-full object-cover opacity-60" />
                <div className="absolute inset-0 flex items-center justify-center bg-background/40">
                  <Loader2 className="h-4 w-4 animate-spin text-foreground" />
                </div>
              </div>
            ))}
          </div>
        )}

        <input
          ref={galleryRef}
          type="file"
          accept="image/*"
          multiple
          className="hidden"
          onChange={(e) => handleFiles(e.target.files)}
        />
        <input
          ref={cameraRef}
          type="file"
          accept="image/*"
          capture="environment"
          className="hidden"
          onChange={(e) => handleFiles(e.target.files)}
        />

        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={onDrop}
          className={cn(
            "rounded-md border border-dashed transition-colors",
            dragOver ? "border-primary bg-primary/5" : "border-border bg-background",
          )}
        >
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 p-2">
            {isMobile && (
              <button
                type="button"
                onClick={() => cameraRef.current?.click()}
                disabled={uploading}
                className="inline-flex items-center justify-center gap-1.5 text-xs font-semibold rounded-md bg-primary text-primary-foreground px-3 py-3 hover:opacity-90 disabled:opacity-60"
              >
                <Camera className="h-3.5 w-3.5" />
                Tirar foto
              </button>
            )}
            <button
              type="button"
              onClick={() => galleryRef.current?.click()}
              disabled={uploading}
              className={cn(
                "inline-flex items-center justify-center gap-1.5 text-xs font-semibold rounded-md border border-border bg-background px-3 py-3 hover:bg-accent disabled:opacity-60",
                !isMobile && "sm:col-span-2",
              )}
            >
              {uploading ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : images.length > 0 ? (
                <Upload className="h-3.5 w-3.5" />
              ) : (
                <ImageIcon className="h-3.5 w-3.5" />
              )}
              {uploading && progress
                ? `Enviando ${progress.done}/${progress.total}…`
                : isMobile
                  ? "Escolher da galeria"
                  : images.length > 0
                    ? "Adicionar mais fotos (ou arraste aqui)"
                    : "Enviar fotos do produto (ou arraste aqui)"}
            </button>
          </div>
        </div>
        <p className="text-[10px] text-muted-foreground">
          A primeira foto é a capa. Imagens são comprimidas automaticamente para envio rápido no WhatsApp.
        </p>
      </div>
    </div>
  );
}

