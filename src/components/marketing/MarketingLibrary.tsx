import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Loader2,
  Upload,
  Trash2,
  Image as ImageIcon,
  Video,
  Package,
  Sparkles,
  X,
} from "lucide-react";
import { toast } from "sonner";
import {
  apiListMedia,
  apiRegisterMedia,
  apiDeleteMedia,
  uploadMarketingFile,
  urlForMarketingPath,
} from "@/data/marketingRepo";
import type { MarketingMediaRow } from "@/lib/marketing/marketing.types";
import { supabase } from "@/integrations/supabase/client";
import { getSignedImageUrl } from "@/lib/storage";
import type { MediaSelection } from "@/lib/marketing/media-selection";
import { selectionKey } from "@/lib/marketing/media-selection";

interface Props {
  companyId: string;
  selectable?: boolean;
  selected?: MediaSelection[];
  onToggleSelect?: (sel: MediaSelection) => void;
  /** Restringe a lista a um tipo de mídia (usado pelos seletores de criação). */
  mediaKind?: "image" | "video";
  /** Esconde imagens de produtos (quando só mídias do acervo servem). */
  marketingOnly?: boolean;
  /** Fora do modo de seleção: tocar em uma mídia começa uma publicação com ela. */
  onUse?: (sel: MediaSelection) => void;
}

type SourceFilter = "all" | "marketing" | "products";

function formatSize(bytes: number): string {
  const mb = bytes / (1024 * 1024);
  return mb >= 1 ? `${mb.toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

interface ProductImageItem {
  productId: string;
  productName: string;
  category: string | null;
  imagePath: string;
}

interface UnifiedItem {
  key: string;
  origin: "marketing" | "product";
  title: string;
  subtitle: string;
  isVideo: boolean;
  url: string;
  tags: string[];
  sizeBytes?: number | null;
  selection: MediaSelection;
  raw: MarketingMediaRow | ProductImageItem;
}

export function MarketingLibrary({
  companyId,
  selectable,
  selected = [],
  onToggleSelect,
  mediaKind,
  marketingOnly = false,
  onUse,
}: Props) {
  const [marketingItems, setMarketingItems] = useState<MarketingMediaRow[]>([]);
  const [productImages, setProductImages] = useState<ProductImageItem[]>([]);
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [filter, setFilter] = useState("");
  const [source, setSource] = useState<SourceFilter>("all");
  const [activeTag, setActiveTag] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const selectedKeys = useMemo(() => new Set(selected.map(selectionKey)), [selected]);
  const PAGE_SIZE = 30;
  const MAX_AUTO_PAGES = 20;

  async function loadPage(nextPage: number, append: boolean) {
    if (append) setLoadingMore(true); else setLoading(true);
    try {
      const offset = nextPage * PAGE_SIZE;
      const [mediaRows, productsRes] = await Promise.all([
        apiListMedia({ limit: PAGE_SIZE, offset }),
        supabase
          .from("products")
          .select("id,name,category,images")
          .eq("company_id", companyId)
          .eq("active", true)
          .order("name", { ascending: true })
          .order("id", { ascending: true })
          .range(offset, offset + PAGE_SIZE - 1),
      ]);
      const prodItems: ProductImageItem[] = [];
      for (const row of productsRes.data ?? []) {
        const imgs = Array.isArray(row.images) ? (row.images.filter((x) => typeof x === "string") as string[]) : [];
        for (const img of imgs) {
          prodItems.push({ productId: row.id, productName: row.name ?? "Produto", category: (row.category as string | null) ?? null, imagePath: img });
        }
      }
      setMarketingItems((current) => {
        if (!append) return mediaRows;
        const known = new Set(current.map((m) => m.id));
        return [...current, ...mediaRows.filter((m) => !known.has(m.id))];
      });
      setProductImages((current) => {
        if (!append) return prodItems;
        const known = new Set(current.map((p) => `${p.productId}:${p.imagePath}`));
        return [...current, ...prodItems.filter((p) => !known.has(`${p.productId}:${p.imagePath}`))];
      });
      setPage(nextPage);
      setHasMore(mediaRows.length === PAGE_SIZE || (productsRes.data?.length ?? 0) === PAGE_SIZE);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao carregar mídia.");
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }

  const narrowing = filter.trim().length > 0 || activeTag !== null || source !== "all" || !!mediaKind || marketingOnly;
  useEffect(() => {
    if (!narrowing || !hasMore || loading || loadingMore || page >= MAX_AUTO_PAGES - 1) return;
    void loadPage(page + 1, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [narrowing, hasMore, loading, loadingMore, page]);

  async function refresh() {
    setPage(0);
    await loadPage(0, false);
  }

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyId]);

  async function handleFiles(files: FileList | null) {
    if (!files?.length) return;
    setUploading(true);
    try {
      for (const file of Array.from(files)) {
        const isVideo = file.type.startsWith("video/");
        const isImage = file.type.startsWith("image/");
        if (!isImage && !isVideo) {
          toast.error(`Formato não suportado: ${file.name}`);
          continue;
        }
        const max = isVideo ? 50 * 1024 * 1024 : 15 * 1024 * 1024;
        if (file.size > max) {
          toast.error(`${file.name} excede o limite (${isVideo ? "50MB" : "15MB"}).`);
          continue;
        }
        const path = await uploadMarketingFile(companyId, file);
        await apiRegisterMedia({
          storage_path: path,
          media_type: isVideo ? "video" : "image",
          mime_type: file.type,
          size_bytes: file.size,
          title: file.name,
        });
      }
      toast.success("Mídia enviada.");
      await refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao enviar.");
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  async function handleDelete(id: string) {
    if (!confirm("Remover esta mídia da biblioteca?")) return;
    try {
      await apiDeleteMedia(id);
      toast.success("Mídia removida.");
      await refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao remover.");
    }
  }

  const unified: UnifiedItem[] = useMemo(() => {
    const marketing: UnifiedItem[] = marketingItems.map((m) => ({
      key: `m:${m.id}`,
      origin: "marketing",
      title: m.title ?? "sem título",
      subtitle: m.media_type === "video" ? "Vídeo" : "Imagem",
      isVideo: m.media_type === "video",
      url: urls[`m:${m.id}`] ?? "",
      tags: m.tags ?? [],
      sizeBytes: m.size_bytes,
      selection: { origin: "marketing", id: m.id, storagePath: m.storage_path, mediaType: m.media_type === "video" ? "video" : "image" },
      raw: m,
    }));
    const products: UnifiedItem[] = productImages.map((p) => {
      const key = `p:${p.productId}:${p.imagePath}`;
      const tags = [
        "produto",
        ...(p.category ? [p.category] : []),
      ];
      return {
        key,
        origin: "product",
        title: p.productName,
        subtitle: p.category ?? "Produto",
        isVideo: false,
        url: urls[key] ?? "",
        tags,
        selection: {
          origin: "product",
          productId: p.productId,
          productName: p.productName,
          imagePath: p.imagePath,
        },
        raw: p,
      };
    });
    return [...marketing, ...products];
  }, [marketingItems, productImages, urls]);

  const allTags = useMemo(() => {
    const s = new Set<string>();
    for (const u of unified) for (const t of u.tags) if (t) s.add(t);
    return Array.from(s).sort((a, b) => a.localeCompare(b));
  }, [unified]);

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return unified.filter((u) => {
      if (mediaKind === "image" && u.isVideo) return false;
      if (mediaKind === "video" && !u.isVideo) return false;
      if (marketingOnly && u.origin !== "marketing") return false;
      if (source === "marketing" && u.origin !== "marketing") return false;
      if (source === "products" && u.origin !== "product") return false;
      if (activeTag && !u.tags.includes(activeTag)) return false;
      if (!q) return true;
      const hay = [u.title, u.subtitle, ...u.tags].join(" ").toLowerCase();
      return hay.includes(q);
    });
  }, [unified, filter, source, activeTag, mediaKind, marketingOnly]);

  const visible = filtered;

  useEffect(() => {
    let cancelled = false;
    const missing = visible.filter((u) => !Object.prototype.hasOwnProperty.call(urls, u.key));
    if (missing.length === 0) return () => { cancelled = true; };
    void Promise.all(missing.map(async (u) => {
      const url = u.origin === "marketing"
        ? await urlForMarketingPath((u.raw as MarketingMediaRow).storage_path)
        : await getSignedImageUrl((u.raw as ProductImageItem).imagePath);
      return [u.key, url ?? ""] as const;
    })).then((entries) => {
      if (cancelled) return;
      setUrls((current) => ({ ...current, ...Object.fromEntries(entries) }));
    });
    return () => { cancelled = true; };
  }, [visible, urls]);

  const counts = useMemo(
    () => ({
      total: unified.length,
      marketing: unified.filter((u) => u.origin === "marketing").length,
      products: unified.filter((u) => u.origin === "product").length,
    }),
    [unified],
  );

  const selectedOrder = new Map(selected.map((sel, i) => [selectionKey(sel), i + 1]));
  const showSources = !marketingOnly && mediaKind !== "video";

  return (
    <div className="space-y-4">
      <input
        ref={inputRef}
        type="file"
        multiple
        accept={mediaKind === "video" ? "video/*" : mediaKind === "image" ? "image/*" : "image/*,video/*"}
        className="hidden"
        onChange={(e) => handleFiles(e.target.files)}
      />
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={uploading}
        className="flex w-full items-center justify-center gap-2 rounded-2xl border-2 border-dashed p-4 text-sm text-muted-foreground transition-colors hover:bg-muted disabled:opacity-60"
      >
        {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
        {uploading ? "Enviando…" : mediaKind === "video" ? "Enviar vídeos" : mediaKind === "image" ? "Enviar fotos" : "Enviar fotos ou vídeos"}
      </button>

      <div className="flex flex-wrap items-center gap-2">
        <Input
          placeholder="Buscar por nome ou tag"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          className="h-9 min-w-0 flex-1 basis-40 rounded-full sm:max-w-xs"
        />
        {showSources && (
          <div className="flex gap-1.5 overflow-x-auto">
            {([
              ["all", "Tudo", counts.total],
              ["marketing", "Enviadas", counts.marketing],
              ["products", "Produtos", counts.products],
            ] as Array<[SourceFilter, string, number]>).map(([id, label, n]) => (
              <button
                key={id}
                type="button"
                onClick={() => setSource(id)}
                aria-pressed={source === id}
                className={`shrink-0 rounded-full border px-3 py-1.5 text-xs ${source === id ? "border-foreground bg-foreground text-background" : "bg-card"}`}
              >
                {label} <span className="opacity-70">{n}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {allTags.length > 0 && (
        <div className="flex gap-1.5 overflow-x-auto pb-1">
          {allTags.map((t) => {
            const active = activeTag === t;
            return (
              <button
                key={t}
                type="button"
                onClick={() => setActiveTag(active ? null : t)}
                className={`shrink-0 rounded-full border px-2.5 py-0.5 text-[11px] ${active ? "border-foreground bg-foreground text-background" : "bg-card text-muted-foreground"}`}
              >
                {t}
              </button>
            );
          })}
          {activeTag && (
            <button type="button" onClick={() => setActiveTag(null)} className="inline-flex shrink-0 items-center gap-1 rounded-full border px-2.5 py-0.5 text-[11px] text-muted-foreground">
              <X className="h-3 w-3" /> limpar
            </button>
          )}
        </div>
      )}

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Carregando…
        </div>
      ) : visible.length === 0 ? (
        <div className="rounded-2xl border border-dashed p-8 text-center text-sm text-muted-foreground">
          {mediaKind === "video" ? "Nenhum vídeo por aqui. Envie um vídeo para começar." : "Nada por aqui. Envie fotos ou cadastre produtos com imagens."}
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
            {visible.map((u) => {
              const order = selectedOrder.get(u.key);
              const isMarketing = u.origin === "marketing";
              const activate = () => (selectable ? onToggleSelect?.(u.selection) : onUse?.(u.selection));
              const clickable = selectable || !!onUse;
              return (
                <div
                  key={u.key}
                  role={clickable ? "button" : undefined}
                  tabIndex={clickable ? 0 : undefined}
                  aria-pressed={selectable ? !!order : undefined}
                  aria-label={selectable ? u.title : onUse ? `Criar publicação com ${u.title}` : undefined}
                  onClick={clickable ? activate : undefined}
                  onKeyDown={clickable ? (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); activate(); } } : undefined}
                  className={`group relative overflow-hidden rounded-2xl bg-muted ${u.isVideo ? "aspect-[3/4]" : "aspect-square"} ${clickable ? "cursor-pointer" : ""} ${order ? "ring-4 ring-primary" : "ring-1 ring-border"}`}
                >
                  {u.isVideo ? (
                    u.url ? (
                      <video src={`${u.url}#t=0.1`} className="absolute inset-0 h-full w-full object-cover" muted playsInline preload="metadata" />
                    ) : (
                      <div className="absolute inset-0 grid place-items-center"><Video className="h-8 w-8 text-muted-foreground" /></div>
                    )
                  ) : u.url ? (
                    <img src={u.url} alt={u.title} loading="lazy" decoding="async" className="absolute inset-0 h-full w-full object-cover" />
                  ) : (
                    <div className="absolute inset-0 grid place-items-center"><ImageIcon className="h-8 w-8 text-muted-foreground" /></div>
                  )}
                  {u.isVideo && (
                    <span className="absolute left-2 top-2 grid h-6 w-6 place-items-center rounded-full bg-black/60 text-white"><Video className="h-3 w-3" /></span>
                  )}
                  {!isMarketing && (
                    <span className="absolute left-2 top-2 rounded-full bg-black/60 px-2 py-0.5 text-[10px] font-semibold text-white">Produto</span>
                  )}
                  {order && (
                    <span className="absolute right-2 top-2 grid h-6 w-6 place-items-center rounded-full bg-primary text-xs font-semibold text-primary-foreground">{order}</span>
                  )}
                  <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 to-transparent px-2 pb-1.5 pt-6 text-white">
                    <div className="truncate text-xs font-semibold">{u.title}</div>
                    <div className="truncate text-[10px] opacity-80">
                      {u.subtitle}
                      {u.sizeBytes ? ` · ${formatSize(u.sizeBytes)}` : ""}
                    </div>
                  </div>
                  {!selectable && isMarketing && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        void handleDelete((u.raw as MarketingMediaRow).id);
                      }}
                      className="absolute right-2 top-2 rounded-full bg-black/60 p-1.5 text-white transition-opacity sm:opacity-0 sm:group-hover:opacity-100 sm:focus-visible:opacity-100"
                      aria-label={`Remover ${u.title}`}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
              );
            })}
          </div>
          {hasMore && (
            <div className="flex justify-center">
              <Button type="button" variant="outline" className="rounded-full" disabled={loadingMore} onClick={() => void loadPage(page + 1, true)}>
                {loadingMore ? "Carregando..." : "Carregar mais"}
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
