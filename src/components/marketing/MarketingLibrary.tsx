import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Loader2, Upload, Trash2, Image as ImageIcon, Video } from "lucide-react";
import { toast } from "sonner";
import {
  apiListMedia,
  apiRegisterMedia,
  apiDeleteMedia,
  uploadMarketingFile,
  urlForMarketingPath,
} from "@/data/marketingRepo";
import type { MarketingMediaRow } from "@/lib/marketing/marketing.types";

interface Props {
  companyId: string;
  selectable?: boolean;
  selectedIds?: string[];
  onToggleSelect?: (id: string) => void;
}

export function MarketingLibrary({ companyId, selectable, selectedIds = [], onToggleSelect }: Props) {
  const [items, setItems] = useState<MarketingMediaRow[]>([]);
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [filter, setFilter] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  async function refresh() {
    setLoading(true);
    try {
      const rows = await apiListMedia();
      setItems(rows);
      const entries = await Promise.all(
        rows.map(async (r) => [r.id, (await urlForMarketingPath(r.storage_path)) ?? ""] as const),
      );
      setUrls(Object.fromEntries(entries));
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
        // Limite defensivo de 50MB para vídeos, 15MB para imagens.
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

  const filtered = items.filter((i) =>
    (i.title ?? "").toLowerCase().includes(filter.toLowerCase()) ||
    (i.tags ?? []).some((t) => t.toLowerCase().includes(filter.toLowerCase())),
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Input
          placeholder="Buscar por título ou tag"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          className="max-w-xs"
        />
        <input
          ref={inputRef}
          type="file"
          multiple
          accept="image/*,video/*"
          className="hidden"
          onChange={(e) => handleFiles(e.target.files)}
        />
        <Button onClick={() => inputRef.current?.click()} disabled={uploading}>
          {uploading ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Upload className="h-4 w-4 mr-1" />}
          Enviar fotos/vídeos
        </Button>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-muted-foreground text-sm">
          <Loader2 className="h-4 w-4 animate-spin" /> Carregando…
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
          Nenhuma mídia ainda. Envie fotos e vídeos da sua empresa para começar.
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
          {filtered.map((m) => {
            const selected = selectedIds.includes(m.id);
            return (
              <div
                key={m.id}
                className={`group relative rounded-lg border overflow-hidden bg-muted/30 ${
                  selectable ? "cursor-pointer" : ""
                } ${selected ? "ring-2 ring-primary" : ""}`}
                onClick={() => selectable && onToggleSelect?.(m.id)}
              >
                <div className="aspect-square bg-black/40 flex items-center justify-center">
                  {m.media_type === "video" ? (
                    urls[m.id] ? (
                      <video src={urls[m.id]} className="h-full w-full object-cover" muted />
                    ) : (
                      <Video className="h-8 w-8 text-muted-foreground" />
                    )
                  ) : urls[m.id] ? (
                    <img src={urls[m.id]} alt={m.title ?? ""} className="h-full w-full object-cover" />
                  ) : (
                    <ImageIcon className="h-8 w-8 text-muted-foreground" />
                  )}
                </div>
                <div className="p-2 text-xs">
                  <div className="truncate font-medium">{m.title ?? "sem título"}</div>
                  <div className="text-muted-foreground">
                    {m.media_type === "video" ? "Vídeo" : "Imagem"}
                    {m.size_bytes ? ` · ${(m.size_bytes / (1024 * 1024)).toFixed(1)} MB` : ""}
                  </div>
                </div>
                {!selectable && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      void handleDelete(m.id);
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
