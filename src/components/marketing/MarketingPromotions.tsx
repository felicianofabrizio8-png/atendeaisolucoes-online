import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Loader2, Plus, Trash2, Edit } from "lucide-react";
import { toast } from "sonner";
import {
  apiListPromotions,
  apiUpsertPromotion,
  apiDeletePromotion,
} from "@/data/marketingRepo";
import type { MarketingPromotionRow } from "@/lib/marketing/marketing.types";

interface Props {
  companyId: string;
}

const emptyForm = {
  id: undefined as string | undefined,
  title: "",
  description: "",
  price_original: "",
  price_promo: "",
  discount_percent: "",
  starts_at: "",
  ends_at: "",
  whatsapp_cta_text: "",
  whatsapp_destination: "",
  status: "draft" as "draft" | "active" | "paused" | "ended",
};

export function MarketingPromotions({ companyId }: Props) {
  const [items, setItems] = useState<MarketingPromotionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<typeof emptyForm | null>(null);
  const [saving, setSaving] = useState(false);

  async function refresh() {
    setLoading(true);
    try {
      const rows = await apiListPromotions();
      setItems(rows);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao carregar promoções.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyId]);

  function startEdit(p?: MarketingPromotionRow) {
    if (!p) {
      setEditing({ ...emptyForm });
      return;
    }
    setEditing({
      id: p.id,
      title: p.title ?? "",
      description: p.description ?? "",
      price_original: p.price_original?.toString() ?? "",
      price_promo: p.price_promo?.toString() ?? "",
      discount_percent: p.discount_percent?.toString() ?? "",
      starts_at: p.starts_at ? p.starts_at.slice(0, 16) : "",
      ends_at: p.ends_at ? p.ends_at.slice(0, 16) : "",
      whatsapp_cta_text: p.whatsapp_cta_text ?? "",
      whatsapp_destination: p.whatsapp_destination ?? "",
      status: p.status,
    });
  }

  async function save() {
    if (!editing) return;
    if (!editing.title.trim()) {
      toast.error("Informe um título para a promoção.");
      return;
    }
    setSaving(true);
    try {
      await apiUpsertPromotion({
        id: editing.id,
        title: editing.title.trim(),
        description: editing.description.trim() || null,
        price_original: editing.price_original ? Number(editing.price_original) : null,
        price_promo: editing.price_promo ? Number(editing.price_promo) : null,
        discount_percent: editing.discount_percent ? Number(editing.discount_percent) : null,
        starts_at: editing.starts_at ? new Date(editing.starts_at).toISOString() : null,
        ends_at: editing.ends_at ? new Date(editing.ends_at).toISOString() : null,
        whatsapp_cta_text: editing.whatsapp_cta_text.trim() || null,
        whatsapp_destination: editing.whatsapp_destination.trim() || null,
        status: editing.status,
      });
      toast.success("Promoção salva.");
      setEditing(null);
      await refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao salvar.");
    } finally {
      setSaving(false);
    }
  }

  async function remove(id: string) {
    if (!confirm("Excluir esta promoção?")) return;
    try {
      await apiDeletePromotion(id);
      toast.success("Promoção removida.");
      await refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao remover.");
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">Promoções</h3>
        <Button onClick={() => startEdit()}>
          <Plus className="h-4 w-4 mr-1" /> Nova promoção
        </Button>
      </div>

      {editing && (
        <div className="rounded-lg border bg-card p-4 space-y-3">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <Label>Título *</Label>
              <Input
                value={editing.title}
                onChange={(e) => setEditing({ ...editing, title: e.target.value })}
              />
            </div>
            <div>
              <Label>Status</Label>
              <select
                className="w-full h-9 rounded-md border bg-background px-2 text-sm"
                value={editing.status}
                onChange={(e) => setEditing({ ...editing, status: e.target.value as typeof editing.status })}
              >
                <option value="draft">Rascunho</option>
                <option value="active">Ativa</option>
                <option value="paused">Pausada</option>
                <option value="ended">Encerrada</option>
              </select>
            </div>
            <div className="md:col-span-2">
              <Label>Descrição</Label>
              <Textarea
                value={editing.description}
                onChange={(e) => setEditing({ ...editing, description: e.target.value })}
                rows={3}
              />
            </div>
            <div>
              <Label>Preço original</Label>
              <Input
                type="number"
                inputMode="decimal"
                step="0.01"
                value={editing.price_original}
                onChange={(e) => setEditing({ ...editing, price_original: e.target.value })}
              />
            </div>
            <div>
              <Label>Preço promocional</Label>
              <Input
                type="number"
                inputMode="decimal"
                step="0.01"
                value={editing.price_promo}
                onChange={(e) => setEditing({ ...editing, price_promo: e.target.value })}
              />
            </div>
            <div>
              <Label>Desconto (%)</Label>
              <Input
                type="number"
                inputMode="decimal"
                value={editing.discount_percent}
                onChange={(e) => setEditing({ ...editing, discount_percent: e.target.value })}
              />
            </div>
            <div />
            <div>
              <Label>Início</Label>
              <Input
                type="datetime-local"
                value={editing.starts_at}
                onChange={(e) => setEditing({ ...editing, starts_at: e.target.value })}
              />
            </div>
            <div>
              <Label>Fim</Label>
              <Input
                type="datetime-local"
                value={editing.ends_at}
                onChange={(e) => setEditing({ ...editing, ends_at: e.target.value })}
              />
            </div>
            <div>
              <Label>Texto do CTA (WhatsApp)</Label>
              <Input
                placeholder="Ex.: Fale conosco agora"
                value={editing.whatsapp_cta_text}
                onChange={(e) => setEditing({ ...editing, whatsapp_cta_text: e.target.value })}
              />
            </div>
            <div>
              <Label>Destino do WhatsApp</Label>
              <Input
                placeholder="Ex.: 5511999999999 ou link"
                value={editing.whatsapp_destination}
                onChange={(e) => setEditing({ ...editing, whatsapp_destination: e.target.value })}
              />
              <p className="mt-1 text-[11px] text-muted-foreground">
                Use o WhatsApp configurado da empresa. Não invente números.
              </p>
            </div>
          </div>
          <div className="flex gap-2 justify-end pt-2 border-t">
            <Button variant="ghost" onClick={() => setEditing(null)} disabled={saving}>
              Cancelar
            </Button>
            <Button onClick={save} disabled={saving}>
              {saving && <Loader2 className="h-4 w-4 animate-spin mr-1" />}
              Salvar
            </Button>
          </div>
        </div>
      )}

      {loading ? (
        <div className="text-sm text-muted-foreground flex items-center gap-2">
          <Loader2 className="h-4 w-4 animate-spin" /> Carregando…
        </div>
      ) : items.length === 0 ? (
        <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
          Nenhuma promoção cadastrada.
        </div>
      ) : (
        <div className="space-y-2">
          {items.map((p) => (
            <div key={p.id} className="rounded-lg border bg-card p-3 flex items-start gap-3">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <div className="font-medium truncate">{p.title}</div>
                  <span className="text-[10px] uppercase rounded bg-muted px-1.5 py-0.5">
                    {p.status}
                  </span>
                </div>
                {p.description && (
                  <div className="text-xs text-muted-foreground line-clamp-2 mt-0.5">
                    {p.description}
                  </div>
                )}
                <div className="text-[11px] text-muted-foreground mt-1">
                  {p.price_promo ? `R$ ${p.price_promo}` : ""}
                  {p.discount_percent ? ` · ${p.discount_percent}% off` : ""}
                  {p.whatsapp_cta_text ? ` · CTA: ${p.whatsapp_cta_text}` : ""}
                </div>
              </div>
              <button
                onClick={() => startEdit(p)}
                className="p-2 rounded hover:bg-accent"
                aria-label="Editar"
              >
                <Edit className="h-4 w-4" />
              </button>
              <button
                onClick={() => void remove(p.id)}
                className="p-2 rounded hover:bg-destructive/10 text-destructive"
                aria-label="Excluir"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
