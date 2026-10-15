import { LumePulse } from "./MarketingMotion";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  ArrowUpRight,
  BadgePercent,
  CalendarRange,
  Edit,
  FileText,
  MessageCircle,
  Plus,
  Trash2,
} from "lucide-react";
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
        <Button className="mkt-primary" onClick={() => startEdit()}>
          <Plus className="h-4 w-4 mr-1" /> Nova promoção
        </Button>
      </div>

      {editing && (
        <div className="mkt-promotion-editor rounded-lg border bg-card p-4 space-y-3">
          <fieldset>
            <legend className="mkt-legend" data-hue="violet">
              <span className="mkt-icon-chip" aria-hidden>
                <FileText size={16} />
              </span>
              <span>
                O que você vai oferecer?
                <small>Nome e descrição aparecem na lista e ajudam a Lume a escrever.</small>
              </span>
            </legend>
            <div className="mkt-form-grid">
              <div className="mkt-field">
                <Label htmlFor="mkt-offer-title">Título *</Label>
                <Input
                  id="mkt-offer-title"
                  value={editing.title}
                  placeholder="Ex.: Semana do cliente"
                  onChange={(e) => setEditing({ ...editing, title: e.target.value })}
                />
              </div>
              <div className="mkt-field">
                <span id="mkt-offer-status" className="mkt-label">
                  Status
                </span>
                <div className="mkt-segmented" role="radiogroup" aria-labelledby="mkt-offer-status">
                  {(
                    [
                      ["draft", "Rascunho"],
                      ["active", "Ativa"],
                      ["paused", "Pausada"],
                      ["ended", "Encerrada"],
                    ] as const
                  ).map(([value, label]) => (
                    <button
                      key={value}
                      type="button"
                      role="radio"
                      aria-checked={editing.status === value}
                      onClick={() => setEditing({ ...editing, status: value })}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                <p className="mkt-hint">Só ofertas ativas aparecem na criação de campanhas.</p>
              </div>
              <div className="mkt-field mkt-field-wide">
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
            <legend className="mkt-legend" data-hue="orchid">
              <span className="mkt-icon-chip" aria-hidden>
                <BadgePercent size={16} />
              </span>
              <span>
                Qual é o benefício?
                <small>Preencha o que fizer sentido. A prévia ao lado mostra como fica.</small>
              </span>
            </legend>
            <div className="mkt-offer-benefit">
              <div className="mkt-field">
                <Label htmlFor="mkt-offer-price_original">Preço original</Label>
                <div className="mkt-input-prefix">
                  <span aria-hidden>R$</span>
                  <Input
                    id="mkt-offer-price_original"
                    type="number"
                    inputMode="decimal"
                    step="0.01"
                    value={editing.price_original}
                    onChange={(e) => setEditing({ ...editing, price_original: e.target.value })}
                  />
                </div>
              </div>
              <div className="mkt-field">
                <Label htmlFor="mkt-offer-price_promo">Preço promocional</Label>
                <div className="mkt-input-prefix">
                  <span aria-hidden>R$</span>
                  <Input
                    id="mkt-offer-price_promo"
                    type="number"
                    inputMode="decimal"
                    step="0.01"
                    value={editing.price_promo}
                    onChange={(e) => setEditing({ ...editing, price_promo: e.target.value })}
                  />
                </div>
              </div>
              <div className="mkt-field">
                <Label htmlFor="mkt-offer-discount_percent">Desconto (%)</Label>
                <div className="mkt-input-suffix">
                  <Input
                    id="mkt-offer-discount_percent"
                    type="number"
                    inputMode="decimal"
                    value={editing.discount_percent}
                    onChange={(e) => setEditing({ ...editing, discount_percent: e.target.value })}
                  />
                  <span aria-hidden>%</span>
                </div>
              </div>
              <div className="mkt-offer-live" aria-live="polite">
                <div className="mkt-offer-stamp" aria-hidden="true">
                  <strong>
                    {editing.discount_percent ? (
                      `${editing.discount_percent}%`
                    ) : (
                      <ArrowUpRight size={24} />
                    )}
                  </strong>
                  <span>{editing.discount_percent ? "de desconto" : "destaque"}</span>
                </div>
                <div>
                  <b>{editing.title.trim() || "Sua oferta"}</b>
                  <span>
                    {editing.price_original && editing.price_promo ? (
                      <>
                        <s>R$ {editing.price_original}</s> R$ {editing.price_promo}
                      </>
                    ) : editing.price_promo ? (
                      `R$ ${editing.price_promo}`
                    ) : (
                      "Prévia da oferta"
                    )}
                  </span>
                </div>
              </div>
            </div>
          </fieldset>
          <fieldset>
            <legend className="mkt-legend" data-hue="blue">
              <span className="mkt-icon-chip" aria-hidden>
                <CalendarRange size={16} />
              </span>
              <span>
                Quando essa oferta vale?
                <small>Deixe em branco para uma oferta sem prazo.</small>
              </span>
            </legend>
            <div className="mkt-form-grid">
              <div className="mkt-field">
                <Label htmlFor="mkt-offer-starts_at">Início</Label>
                <Input
                  id="mkt-offer-starts_at"
                  type="datetime-local"
                  value={editing.starts_at}
                  onChange={(e) => setEditing({ ...editing, starts_at: e.target.value })}
                />
              </div>
              <div className="mkt-field">
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
            <legend className="mkt-legend" data-hue="lilac">
              <span className="mkt-icon-chip" aria-hidden>
                <MessageCircle size={16} />
              </span>
              <span>
                Como as pessoas entram em contato?
                <small>O botão leva direto para a conversa no WhatsApp.</small>
              </span>
            </legend>
            <div className="mkt-form-grid">
              <div className="mkt-field">
                <Label htmlFor="mkt-offer-whatsapp_cta_text">Texto do botão do WhatsApp</Label>
                <Input
                  id="mkt-offer-whatsapp_cta_text"
                  placeholder="Ex.: Fale conosco agora"
                  value={editing.whatsapp_cta_text}
                  onChange={(e) => setEditing({ ...editing, whatsapp_cta_text: e.target.value })}
                />
              </div>
              <div className="mkt-field">
                <Label htmlFor="mkt-offer-whatsapp_destination">Destino do WhatsApp</Label>
                <Input
                  id="mkt-offer-whatsapp_destination"
                  placeholder="Ex.: 5511999999999 ou link"
                  value={editing.whatsapp_destination}
                  onChange={(e) => setEditing({ ...editing, whatsapp_destination: e.target.value })}
                />
                <p className="mkt-hint">
                  Informe o número com DDD e código do país, ou o link do WhatsApp da empresa.
                </p>
              </div>
            </div>
          </fieldset>
          <div className="mkt-form-actions">
            <Button variant="ghost" onClick={() => setEditing(null)} disabled={saving}>
              Cancelar
            </Button>
            <Button className="mkt-primary" onClick={save} disabled={saving}>
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
                <strong>
                  {p.discount_percent ? `${p.discount_percent}%` : <ArrowUpRight size={26} />}
                </strong>
                <span>{p.discount_percent ? "de desconto" : "destaque"}</span>
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
