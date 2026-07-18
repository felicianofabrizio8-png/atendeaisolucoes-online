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
}

type SourceFilter = "all" | "marketing" | "products";

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
}: Props) {
  const [marketingItems, setMarketingItems] = useState<MarketingMediaRow[]>([]);
  const [productImages, setProductImages] = useState<ProductImageItem[]>([]);
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [filter, setFilter] = useState("");
  const [source, setSource] = useState<SourceFilter>("all");
  const [activeTag, setActiveTag] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const selectedKeys = useMemo(() => new Set(selected.map(selectionKey)), [selected]);

  async function refresh() {
    setLoading(true);
    try {
      const [mediaRows, productsRes] = await Promise.all([
        apiListMedia(),
        supabase
          .from("products")
          .select("id,name,category,images")
          .eq("company_id", companyId)
          .eq("active", true),
      ]);

      setMarketingItems(mediaRows);

      const prodItems: ProductImageItem[] = [];
      for (const row of productsRes.data ?? []) {
        const imgs = Array.isArray(row.images)
          ? (row.images.filter((x) => typeof x === "string") as string[])
          : [];
        for (const img of imgs) {
          prodItems.push({
            productId: row.id,
            productName: row.name ?? "Produto",
            category: (row.category as string | null) ?? null,
            imagePath: img,
          });
        }
      }
      setProductImages(prodItems);

      // Resolve URLs for both sources in parallel.
      const mediaEntries = await Promise.all(
        mediaRows.map(
          async (r) =>
            [`m:${r.id}`, (await urlForMarketingPath(r.storage_path)) ?? ""] as const,
        ),
      );
      const productEntries = await Promise.all(
        prodItems.map(
          async (p) =>
            [`p:${p.productId}:${p.imagePath}`, await getSignedImageUrl(p.imagePath)] as const,
        ),
      );
      setUrls(Object.fromEntries([...mediaEntries, ...productEntries]));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao carregar mídia.");
    } finally {
      setLoading(false);
    }
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
      selection: { origin: "marketing", id: m.id, storagePath: m.storage_path },
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
      if (source === "marketing" && u.origin !== "marketing") return false;
      if (source === "products" && u.origin !== "product") return false;
      if (activeTag && !u.tags.includes(activeTag)) return false;
      if (!q) return true;
      const hay = [u.title, u.subtitle, ...u.tags].join(" ").toLowerCase();
      return hay.includes(q);
    });
  }, [unified, filter, source, activeTag]);

  const counts = useMemo(
    () => ({
      total: unified.length,
      marketing: unified.filter((u) => u.origin === "marketing").length,
      products: unified.filter((u) => u.origin === "product").length,
    }),
    [unified],
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Input
          placeholder="Buscar por título, produto, categoria ou tag"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          className="max-w-xs"
        />
        <div className="inline-flex rounded-md border overflow-hidden">
          <button
            type="button"
            onClick={() => setSource("all")}
            className={`px-3 h-9 text-xs ${source === "all" ? "bg-primary text-primary-foreground" : "bg-background"}`}
          >
            Todos <span className="opacity-70">({counts.total})</span>
          </button>
          <button
            type="button"
            onClick={() => setSource("marketing")}
            className={`px-3 h-9 text-xs border-l inline-flex items-center gap-1 ${source === "marketing" ? "bg-primary text-primary-foreground" : "bg-background"}`}
          >
            <Sparkles className="h-3 w-3" /> Marketing{" "}
            <span className="opacity-70">({counts.marketing})</span>
          </button>
          <button
            type="button"
            onClick={() => setSource("products")}
            className={`px-3 h-9 text-xs border-l inline-flex items-center gap-1 ${source === "products" ? "bg-primary text-primary-foreground" : "bg-background"}`}
          >
            <Package className="h-3 w-3" /> Produtos{" "}
            <span className="opacity-70">({counts.products})</span>
          </button>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <input
            ref={inputRef}
            type="file"
            multiple
            accept="image/*,video/*"
            className="hidden"
            onChange={(e) => handleFiles(e.target.files)}
          />
          <Button onClick={() => inputRef.current?.click()} disabled={uploading}>
            {uploading ? (
              <Loader2 className="h-4 w-4 animate-spin mr-1" />
            ) : (
              <Upload className="h-4 w-4 mr-1" />
            )}
            Enviar fotos/vídeos
          </Button>
        </div>
      </div>

      {allTags.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {allTags.map((t) => {
            const active = activeTag === t;
            return (
              <button
                key={t}
                type="button"
                onClick={() => setActiveTag(active ? null : t)}
                className={`text-[11px] rounded-full border px-2 py-0.5 ${active ? "bg-primary text-primary-foreground border-primary" : "bg-background hover:bg-accent"}`}
              >
                {t}
              </button>
            );
          })}
          {activeTag && (
            <button
              type="button"
              onClick={() => setActiveTag(null)}
              className="text-[11px] rounded-full border px-2 py-0.5 inline-flex items-center gap-1 text-muted-foreground"
            >
              <X className="h-3 w-3" /> limpar
            </button>
          )}
        </div>
      )}

      <p className="text-[11px] text-muted-foreground">
        Centro de mídia unificado — imagens de produtos aparecem em somente leitura
        e podem ser combinadas com fotos e vídeos do marketing. Nenhuma cópia é
        duplicada.
      </p>

      {loading ? (
        <div className="flex items-center gap-2 text-muted-foreground text-sm">
          <Loader2 className="h-4 w-4 animate-spin" /> Carregando…
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
          Nada por aqui. Envie fotos e vídeos ou cadastre produtos com imagens.
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
          {filtered.map((u) => {
            const isSel = selectedKeys.has(u.key);
            const isMarketing = u.origin === "marketing";
            return (
              <div
                key={u.key}
                className={`group relative rounded-lg border overflow-hidden bg-muted/30 ${
                  selectable ? "cursor-pointer" : ""
                } ${isSel ? "ring-2 ring-primary" : ""}`}
                onClick={() => selectable && onToggleSelect?.(u.selection)}
              >
                <div className="aspect-square bg-black/40 flex items-center justify-center">
                  {u.isVideo ? (
                    u.url ? (
                      <video src={u.url} className="h-full w-full object-cover" muted />
                    ) : (
                      <Video className="h-8 w-8 text-muted-foreground" />
                    )
                  ) : u.url ? (
                    <img
                      src={u.url}
                      alt={u.title}
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <ImageIcon className="h-8 w-8 text-muted-foreground" />
                  )}
                </div>
                <div className="absolute top-1 left-1">
                  <span
                    className={`text-[9px] uppercase tracking-wide rounded px-1.5 py-0.5 font-semibold ${
                      isMarketing
                        ? "bg-primary/90 text-primary-foreground"
                        : "bg-secondary/90 text-secondary-foreground"
                    }`}
                  >
                    {isMarketing ? "MKT" : "Produto"}
                  </span>
                </div>
                <div className="p-2 text-xs">
                  <div className="truncate font-medium">{u.title}</div>
                  <div className="text-muted-foreground truncate">
                    {u.subtitle}
                    {u.sizeBytes
                      ? ` · ${(u.sizeBytes / (1024 * 1024)).toFixed(1)} MB`
                      : ""}
                  </div>
                </div>
                {!selectable && isMarketing && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      const raw = u.raw as MarketingMediaRow;
                      void handleDelete(raw.id);
                    }}
                    className="absolute top-1 right-1 p-1 rounded bg-black/50 text-white opacity-0 group-hover:opacity-100 transition-opacity"
                    aria-label="Remover"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
