import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Trash2, Pencil, RotateCcw, Loader2, Check, X } from "lucide-react";

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
        Nenhum criativo salvo ainda. Gere um anúncio com IA e clique em “Salvar criativo”.
      </p>
    );
  }

  return (
    <div className="grid sm:grid-cols-2 gap-3">
      {items.map((c) => (
        <div key={c.id} className="rounded-lg border bg-card p-3 space-y-2">
          <div className="flex items-start justify-between gap-2">
            {editing === c.id ? (
              <input
                value={editTitle}
                onChange={(e) => setEditTitle(e.target.value)}
                className="flex-1 h-8 rounded border px-2 text-sm"
                autoFocus
              />
            ) : (
              <h3 className="text-sm font-medium line-clamp-2 flex-1">{c.title}</h3>
            )}
            {editing === c.id ? (
              <div className="flex gap-1">
                <button onClick={() => saveEdit(c.id)} className="p-1 hover:text-primary" title="Salvar">
                  <Check className="h-4 w-4" />
                </button>
                <button onClick={() => setEditing(null)} className="p-1 hover:text-foreground" title="Cancelar">
                  <X className="h-4 w-4" />
                </button>
              </div>
            ) : null}
          </div>
          <div className="text-xs text-muted-foreground flex items-center justify-between">
            <span>{c.product_name ?? "Sem produto"}</span>
            <span>{new Date(c.created_at).toLocaleDateString("pt-BR")}</span>
          </div>
          {c.primary_text && (
            <p className="text-xs text-muted-foreground line-clamp-3">{c.primary_text}</p>
          )}
          {editing !== c.id && (
            <div className="flex gap-1 pt-1">
              <button
                onClick={() => onReuse(c)}
                className="inline-flex items-center gap-1 text-xs h-8 px-2 rounded border hover:bg-accent"
              >
                <RotateCcw className="h-3 w-3" /> Reutilizar
              </button>
              <button
                onClick={() => {
                  setEditing(c.id);
                  setEditTitle(c.title);
                }}
                className="inline-flex items-center gap-1 text-xs h-8 px-2 rounded border hover:bg-accent"
              >
                <Pencil className="h-3 w-3" /> Editar
              </button>
              <button
                onClick={() => remove(c.id)}
                className="inline-flex items-center gap-1 text-xs h-8 px-2 rounded border hover:bg-destructive/10 hover:text-destructive ml-auto"
              >
                <Trash2 className="h-3 w-3" />
              </button>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
