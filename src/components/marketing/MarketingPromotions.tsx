import { LumePulse } from "./MarketingMotion";
import { useEffect, useState } from "react";
import { MarketingArtwork } from "./MarketingArtwork";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Plus, Trash2, Edit } from "lucide-react";
import { lumeToast as toast } from "./MarketingFeedback";
import { apiListPromotions, apiUpsertPromotion, apiDeletePromotion } from "@/data/marketingRepo";
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
      <div className="mkt-tool-toolbar flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold">Suas ofertas em destaque</h3>
          <p className="text-xs text-muted-foreground mt-1">
            Cadastre uma vez e reutilize nas suas campanhas.
          </p>
        </div>
        <Button onClick={() => startEdit()}>
          <Plus className="h-4 w-4 mr-1" /> Nova promoção
        </Button>
      </div>

      {editing && (
        <div className="mkt-promotion-editor rounded-lg border bg-card p-4 space-y-3">
          <fieldset>
            <legend>01 / O que você vai oferecer?</legend>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <Label htmlFor="mkt-offer-title">Título *</Label>
                <Input
                  id="mkt-offer-title"
                  value={editing.title}
                  onChange={(e) => setEditing({ ...editing, title: e.target.value })}
                />
              </div>
              <div>
                <Label htmlFor="mkt-offer-status">Status</Label>
                <select
                  id="mkt-offer-status"
                  className="w-full h-9 rounded-md border bg-background px-2 text-sm"
                  value={editing.status}
                  onChange={(e) =>
                    setEditing({ ...editing, status: e.target.value as typeof editing.status })
                  }
                >
                  <option value="draft">Rascunho</option>
                  <option value="active">Ativa</option>
                  <option value="paused">Pausada</option>
                  <option value="ended">Encerrada</option>
                </select>
              </div>
              <div className="md:col-span-2">
                <Label htmlFor="mkt-offer-description">Descrição</Label>
                <Textarea
                  id="mkt-offer-description"
                  value={editing.description}
                  onChange={(e) => setEditing({ ...editing, description: e.target.value })}
                  rows={3}
                />
              </div>
            </div>
          </fieldset>
          <fieldset>
            <legend>02 / Qual é o benefício?</legend>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <Label htmlFor="mkt-offer-price_original">Preço original</Label>
                <Input
                  id="mkt-offer-price_original"
                  type="number"
                  inputMode="decimal"
                  step="0.01"
                  value={editing.price_original}
                  onChange={(e) => setEditing({ ...editing, price_original: e.target.value })}
                />
              </div>
              <div>
                <Label htmlFor="mkt-offer-price_promo">Preço promocional</Label>
                <Input
                  id="mkt-offer-price_promo"
                  type="number"
                  inputMode="decimal"
                  step="0.01"
                  value={editing.price_promo}
                  onChange={(e) => setEditing({ ...editing, price_promo: e.target.value })}
                />
              </div>
              <div>
                <Label htmlFor="mkt-offer-discount_percent">Desconto (%)</Label>
                <Input
                  id="mkt-offer-discount_percent"
                  type="number"
                  inputMode="decimal"
                  value={editing.discount_percent}
                  onChange={(e) => setEditing({ ...editing, discount_percent: e.target.value })}
                />
              </div>
              <div />
            </div>
          </fieldset>
          <fieldset>
            <legend>03 / Quando essa oferta vale?</legend>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <Label htmlFor="mkt-offer-starts_at">Início</Label>
                <Input
                  id="mkt-offer-starts_at"
                  type="datetime-local"
                  value={editing.starts_at}
                  onChange={(e) => setEditing({ ...editing, starts_at: e.target.value })}
                />
              </div>
              <div>
                <Label htmlFor="mkt-offer-ends_at">Fim</Label>
                <Input
                  id="mkt-offer-ends_at"
                  type="datetime-local"
                  value={editing.ends_at}
                  onChange={(e) => setEditing({ ...editing, ends_at: e.target.value })}
                />
              </div>
            </div>
          </fieldset>
          <fieldset>
            <legend>04 / Como as pessoas entram em contato?</legend>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <Label htmlFor="mkt-offer-whatsapp_cta_text">Texto do botão do WhatsApp</Label>
                <Input
                  id="mkt-offer-whatsapp_cta_text"
                  placeholder="Ex.: Fale conosco agora"
                  value={editing.whatsapp_cta_text}
                  onChange={(e) => setEditing({ ...editing, whatsapp_cta_text: e.target.value })}
                />
              </div>
              <div>
                <Label htmlFor="mkt-offer-whatsapp_destination">Destino do WhatsApp</Label>
                <Input
                  id="mkt-offer-whatsapp_destination"
                  placeholder="Ex.: 5511999999999 ou link"
                  value={editing.whatsapp_destination}
                  onChange={(e) => setEditing({ ...editing, whatsapp_destination: e.target.value })}
                />
                <p className="mt-1 text-[11px] text-muted-foreground">
                  Informe o número com DDD e código do país, ou o link do WhatsApp da empresa.
                </p>
              </div>
            </div>
          </fieldset>
          <div className="flex gap-2 justify-end pt-2 border-t">
            <Button variant="ghost" onClick={() => setEditing(null)} disabled={saving}>
              Cancelar
            </Button>
            <Button onClick={save} disabled={saving}>
              {saving && <LumePulse className="h-4 w-4 animate-spin mr-1" />}
              Salvar
            </Button>
          </div>
        </div>
      )}

      {loading ? (
        <div className="text-sm text-muted-foreground flex items-center gap-2">
          <LumePulse className="h-4 w-4 animate-spin" /> Carregando…
        </div>
      ) : items.length === 0 ? (
        <div className="mkt-empty-state">
          <MarketingArtwork kind="orbit" />
          <h3>Um bom motivo para escolher você.</h3>
          <p>Reúna ofertas, condições e benefícios. Na hora de criar, basta escolher a promoção.</p>
          <Button variant="outline" onClick={() => startEdit()}>
            <Plus size={15} /> Criar primeira promoção
          </Button>
        </div>
      ) : (
        <div className="mkt-offer-grid">
          {items.map((p) => (
            <div
              key={p.id}
              className="mkt-offer-card rounded-lg border bg-card p-3 flex items-start gap-3"
            >
              <div className="mkt-offer-stamp" aria-hidden="true">
                <strong>{p.discount_percent ? `${p.discount_percent}%` : "↗"}</strong>
                <span>{p.discount_percent ? "DE DESCONTO" : "DESTAQUE"}</span>
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <div className="font-medium truncate">{p.title}</div>
                  <span className="text-[10px] uppercase rounded bg-muted px-1.5 py-0.5">
                    {
                      { draft: "Rascunho", active: "Ativa", paused: "Pausada", ended: "Encerrada" }[
                        p.status
                      ]
                    }
                  </span>
                </div>
                {p.description && (
                  <div className="text-xs text-muted-foreground line-clamp-2 mt-0.5">
                    {p.description}
                  </div>
                )}
                <div className="mkt-offer-price text-[11px] text-muted-foreground mt-1">
                  {p.price_promo != null
                    ? p.price_promo.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })
                    : ""}
                  {p.discount_percent ? ` · ${p.discount_percent}% off` : ""}
                  {p.whatsapp_cta_text ? ` ·  ${p.whatsapp_cta_text}` : ""}
                </div>
              </div>
              <div className="mkt-offer-tools">
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
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
