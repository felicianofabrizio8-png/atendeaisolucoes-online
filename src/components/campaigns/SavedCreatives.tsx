import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Trash2, Pencil, RotateCcw, Loader2, Check, X, Image as ImageIcon } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

export interface CreativeData {
  title: string;
  primary_text: string | null;
  cta: string | null;
  social_caption: string | null;
  audience_suggestion: string | null;
  image_url: string | null;
  product_id: string | null;
  campaign_id?: string | null;
}

export interface SavedCreative extends CreativeData {
  id: string;
  created_at: string;
  product_name?: string | null;
}

export function SavedCreatives({
  companyId,
  onReuse,
}: {
  companyId: string;
  onReuse: (c: SavedCreative) => void;
}) {
  const [items, setItems] = useState<SavedCreative[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const { data, error } = await supabase
        .from("campaign_creatives")
        .select("*, products(name)")
        .eq("company_id", companyId)
        .order("created_at", { ascending: false })
        .limit(50);
      if (cancelled) return;
      if (error) {
        console.error(error);
        toast.error("Não foi possível carregar criativos.");
        setItems([]);
      } else {
        setItems(
          (data ?? []).map((r: any) => ({
            ...r,
            product_name: r.products?.name ?? null,
          })),
        );
      }
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [companyId]);

  async function remove(id: string) {
    if (!confirm("Excluir este criativo?")) return;
    const { error } = await supabase.from("campaign_creatives").delete().eq("id", id);
    if (error) {
      toast.error("Erro ao excluir.");
      return;
    }
    setItems((arr) => (arr ?? []).filter((c) => c.id !== id));
    toast.success("Criativo excluído.");
  }

  async function saveEdit(id: string) {
    const { error } = await supabase
      .from("campaign_creatives")
      .update({ title: editTitle })
      .eq("id", id);
    if (error) {
      toast.error("Erro ao editar.");
      return;
    }
    setItems((arr) =>
      (arr ?? []).map((c) => (c.id === id ? { ...c, title: editTitle } : c)),
    );
    setEditing(null);
    toast.success("Criativo atualizado.");
  }

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground py-6">
        <Loader2 className="h-4 w-4 animate-spin" /> Carregando criativos…
      </div>
    );
  }

  if (!items?.length) {
    return (
      <p className="text-sm text-muted-foreground py-6">
        Nenhum criativo salvo ainda. Gere um anúncio com IA e clique em "Salvar criativo".
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {items.map((c) => (
        <div
          key={c.id}
          className="group flex items-center gap-3 rounded-lg border bg-card/50 hover:bg-accent/40 transition-colors p-2 pr-3"
        >
          {/* Thumbnail */}
          <div className="h-14 w-14 shrink-0 rounded-md overflow-hidden border bg-muted flex items-center justify-center">
            {c.image_url ? (
              <img src={c.image_url} alt="" className="h-full w-full object-cover" />
            ) : (
              <ImageIcon className="h-5 w-5 text-muted-foreground" />
            )}
          </div>

          {/* Content */}
          <div className="flex-1 min-w-0">
            {editing === c.id ? (
              <div className="flex items-center gap-1">
                <input
                  value={editTitle}
                  onChange={(e) => setEditTitle(e.target.value)}
                  className="flex-1 h-8 rounded border px-2 text-sm bg-background"
                  autoFocus
                />
                <button
                  onClick={() => saveEdit(c.id)}
                  className="p-1.5 rounded hover:bg-accent text-primary"
                  title="Salvar"
                >
                  <Check className="h-4 w-4" />
                </button>
                <button
                  onClick={() => setEditing(null)}
                  className="p-1.5 rounded hover:bg-accent"
                  title="Cancelar"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            ) : (
              <>
                <div className="text-sm font-medium truncate">{c.title}</div>
                <div className="text-xs text-muted-foreground flex items-center gap-2 truncate">
                  <span className="truncate">{c.product_name ?? "Sem produto"}</span>
                  <span className="opacity-60">·</span>
                  <span className="shrink-0">
                    {new Date(c.created_at).toLocaleDateString("pt-BR")}
                  </span>
                </div>
              </>
            )}
          </div>

          {/* Actions */}
          {editing !== c.id && (
            <div className="flex items-center gap-1 opacity-70 group-hover:opacity-100 transition-opacity">
              <button
                onClick={() => onReuse(c)}
                className="inline-flex items-center gap-1 text-xs h-8 px-2.5 rounded-md border hover:bg-background hover:border-primary/40 hover:text-primary transition-colors"
                title="Reutilizar"
              >
                <RotateCcw className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">Reutilizar</span>
              </button>
              <button
                onClick={() => {
                  setEditing(c.id);
                  setEditTitle(c.title);
                }}
                className="p-1.5 rounded-md hover:bg-background hover:text-foreground text-muted-foreground transition-colors"
                title="Editar"
              >
                <Pencil className="h-3.5 w-3.5" />
              </button>
              <button
                onClick={() => remove(c.id)}
                className="p-1.5 rounded-md hover:bg-destructive/10 hover:text-destructive text-muted-foreground transition-colors"
                title="Excluir"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
