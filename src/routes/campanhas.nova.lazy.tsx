import { createLazyFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { lazy, Suspense, useEffect, useState } from "react";
import { useAuth } from "@/auth/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { createCampaign, type CampaignObjective } from "@/lib/campaigns";
import { ArrowLeft, Save, Rocket, Image as ImageIcon, Info, Sparkles, Package, BookmarkPlus, ChevronDown, ChevronUp } from "lucide-react";
import { toast } from "sonner";
import type { SavedCreative } from "@/components/campaigns/SavedCreatives";

const SavedCreatives = lazy(() =>
  import("@/components/campaigns/SavedCreatives").then((m) => ({ default: m.SavedCreatives })),
);

export const Route = createLazyFileRoute("/campanhas/nova")({
  component: NewCampaignPage,
});

const META_ADS_READY = false;

interface ProductRow {
  id: string;
  name: string;
  category: string | null;
  description: string | null;
  price: number | null;
  promo_price: number | null;
  images: string[];
}

function NewCampaignPage() {
  const { profile } = useAuth();
  const navigate = useNavigate();
  const [saving, setSaving] = useState(false);
  const [aiLoading, setAiLoading] = useState(false);
  const [audience, setAudience] = useState<string>("");

  const [form, setForm] = useState({
    name: "",
    objective: "whatsapp" as CampaignObjective,
    product: "",
    product_id: "",
    city: "",
    radius_km: 10,
    daily_budget: 30,
    start_date: new Date().toISOString().slice(0, 10),
    media_url: "",
    media_type: "image",
    primary_text: "",
    headline: "",
    cta: "Saiba mais",
  });

  // Carga de produtos sob demanda — somente nesta tela.
  const [products, setProducts] = useState<ProductRow[] | null>(null);
  const [loadingProducts, setLoadingProducts] = useState(false);

  useEffect(() => {
    if (!profile?.company_id) return;
    let cancelled = false;
    setLoadingProducts(true);
    (async () => {
      const { data, error } = await supabase
        .from("products")
        .select("id,name,category,description,price,promo_price,images")
        .eq("company_id", profile.company_id)
        .eq("active", true)
        .order("created_at", { ascending: false });
      if (cancelled) return;
      if (error) {
        console.error(error);
        toast.error("Não foi possível carregar produtos.");
        setProducts([]);
      } else {
        setProducts(
          (data ?? []).map((r) => ({
            id: r.id,
            name: r.name,
            category: r.category,
            description: r.description,
            price: r.price != null ? Number(r.price) : null,
            promo_price: r.promo_price != null ? Number(r.promo_price) : null,
            images: Array.isArray(r.images)
              ? (r.images.filter((x) => typeof x === "string") as string[])
              : [],
          })),
        );
      }
      setLoadingProducts(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [profile?.company_id]);

  function update<K extends keyof typeof form>(k: K, v: (typeof form)[K]) {
    setForm((f) => ({ ...f, [k]: v }));
  }

  function pickProduct(id: string) {
    if (!id) {
      update("product_id", "");
      return;
    }
    const p = products?.find((x) => x.id === id);
    if (!p) return;
    setForm((f) => ({
      ...f,
      product_id: p.id,
      product: p.name,
      name: f.name || `Campanha – ${p.name}`,
      headline: f.headline || p.name,
      primary_text: f.primary_text || p.description || "",
      media_url: f.media_url || p.images[0] || "",
      media_type: "image",
    }));
  }

  async function generateWithAI() {
    if (!form.product_id && !form.product.trim()) {
      toast.error("Selecione um produto ou informe o nome.");
      return;
    }
    setAiLoading(true);
    try {
      const { data: sess } = await supabase.auth.getSession();
      const token = sess.session?.access_token;
      if (!token) throw new Error("Sessão expirada. Faça login novamente.");
      const p = products?.find((x) => x.id === form.product_id);
      const res = await fetch("/api/ai/campaign-creative", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          product: {
            name: p?.name ?? form.product,
            description: p?.description ?? form.primary_text ?? null,
            category: p?.category ?? null,
            price: p?.price ?? null,
            promoPrice: p?.promo_price ?? null,
          },
          objective: form.objective,
          city: form.city || null,
        }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error ?? `Erro ${res.status}`);
      setForm((f) => ({
        ...f,
        headline: j.headline ?? f.headline,
        primary_text: j.primary_text ?? f.primary_text,
        cta: j.cta ?? f.cta,
      }));
      setAudience(
        [j.audience_suggestion, j.social_caption ? `\n\nLegenda sugerida:\n${j.social_caption}` : ""]
          .filter(Boolean)
          .join(""),
      );
      toast.success("Anúncio gerado com IA!");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao gerar anúncio.");
    } finally {
      setAiLoading(false);
    }
  }

  async function save(publish: boolean) {
    if (!profile?.company_id) return;
    if (!form.name.trim()) {
      toast.error("Dê um nome para a campanha.");
      return;
    }
    setSaving(true);
    try {
      const { product_id: _ignored, ...rest } = form;
      const c = await createCampaign(profile.company_id, {
        ...rest,
        status: publish && META_ADS_READY ? "scheduled" : "draft",
      });
      toast.success(
        publish && META_ADS_READY
          ? "Campanha publicada!"
          : "Campanha salva como rascunho.",
      );
      navigate({ to: "/campanhas/$id", params: { id: c.id } });
    } catch (e) {
      toast.error("Erro ao salvar campanha.");
      console.error(e);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="p-4 md:p-6 max-w-3xl mx-auto w-full space-y-5">
      <Link
        to="/campanhas"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" /> Voltar
      </Link>

      <header>
        <h1 className="text-2xl font-semibold">Nova campanha</h1>
        <p className="text-sm text-muted-foreground">
          Preencha as informações abaixo. Você pode salvar como rascunho e publicar depois.
        </p>
      </header>

      {!META_ADS_READY && (
        <div className="rounded-md border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-xs text-amber-700 dark:text-amber-400 flex items-start gap-2">
          <Info className="h-4 w-4 mt-0.5 shrink-0" />
          <div>
            Publicação automática no Meta Ads ainda em validação. Por enquanto a campanha
            é salva como rascunho.
          </div>
        </div>
      )}

      <div className="rounded-xl border bg-card p-4 md:p-5 space-y-4">
        <Field label="Produto cadastrado">
          <div className="flex gap-2">
            <select
              value={form.product_id}
              onChange={(e) => pickProduct(e.target.value)}
              className="input flex-1"
              disabled={loadingProducts}
            >
              <option value="">
                {loadingProducts
                  ? "Carregando produtos…"
                  : products && products.length === 0
                    ? "Nenhum produto cadastrado"
                    : "Selecione um produto…"}
              </option>
              {products?.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                  {p.category ? ` · ${p.category}` : ""}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={generateWithAI}
              disabled={aiLoading}
              className="inline-flex items-center gap-1 h-10 px-3 rounded-md border bg-background text-sm font-medium hover:bg-accent disabled:opacity-50"
              title="Preenche título, texto, CTA, legenda e público-alvo"
            >
              <Sparkles className={`h-4 w-4 ${aiLoading ? "animate-pulse" : ""}`} />
              {aiLoading ? "Gerando…" : "Gerar anúncio com IA"}
            </button>
          </div>
          {form.product_id && (
            <p className="mt-1 text-xs text-muted-foreground inline-flex items-center gap-1">
              <Package className="h-3 w-3" /> Dados do produto preenchidos automaticamente.
            </p>
          )}
        </Field>

        <Field label="Nome da campanha">
          <input
            value={form.name}
            onChange={(e) => update("name", e.target.value)}
            placeholder="Ex.: Promoção piscina – Outubro"
            className="input"
          />
        </Field>

        <Field label="Objetivo">
          <div className="grid grid-cols-3 gap-2">
            {(["whatsapp", "instagram", "messenger"] as const).map((o) => (
              <button
                key={o}
                type="button"
                onClick={() => update("objective", o)}
                className={`h-10 rounded-md border text-sm font-medium capitalize transition-colors ${
                  form.objective === o
                    ? "border-primary bg-primary/10 text-primary"
                    : "border-input hover:bg-accent"
                }`}
              >
                {o}
              </button>
            ))}
          </div>
        </Field>

        <div className="grid sm:grid-cols-2 gap-4">
          <Field label="Produto / Serviço">
            <input
              value={form.product}
              onChange={(e) => update("product", e.target.value)}
              placeholder="Ex.: Piscina de fibra 7m"
              className="input"
            />
          </Field>
          <Field label="Cidade">
            <input
              value={form.city}
              onChange={(e) => update("city", e.target.value)}
              placeholder="Ex.: São Paulo"
              className="input"
            />
          </Field>
        </div>

        <div className="grid sm:grid-cols-3 gap-4">
          <Field label="Raio (km)">
            <input
              type="number"
              min={1}
              value={form.radius_km}
              onChange={(e) => update("radius_km", Number(e.target.value))}
              className="input"
            />
          </Field>
          <Field label="Orçamento diário (R$)">
            <input
              type="number"
              min={0}
              value={form.daily_budget}
              onChange={(e) => update("daily_budget", Number(e.target.value))}
              className="input"
            />
          </Field>
          <Field label="Início">
            <input
              type="date"
              value={form.start_date}
              onChange={(e) => update("start_date", e.target.value)}
              className="input"
            />
          </Field>
        </div>

        <Field label="Imagem ou vídeo (URL)">
          <div className="flex gap-2">
            <input
              value={form.media_url}
              onChange={(e) => update("media_url", e.target.value)}
              placeholder="https://…"
              className="input flex-1"
            />
            <select
              value={form.media_type}
              onChange={(e) => update("media_type", e.target.value)}
              className="input w-32"
            >
              <option value="image">Imagem</option>
              <option value="video">Vídeo</option>
            </select>
          </div>
          {form.media_url ? (
            form.media_type === "image" ? (
              <img
                src={form.media_url}
                alt=""
                className="mt-2 max-h-40 rounded-md border object-contain bg-muted"
              />
            ) : (
              <video src={form.media_url} controls className="mt-2 max-h-40 rounded-md border" />
            )
          ) : (
            <div className="mt-2 h-24 rounded-md border border-dashed flex items-center justify-center text-xs text-muted-foreground">
              <ImageIcon className="h-4 w-4 mr-1" /> Pré-visualização da mídia
            </div>
          )}
        </Field>

        <Field label="Título">
          <input
            value={form.headline}
            onChange={(e) => update("headline", e.target.value)}
            placeholder="Chamada principal do anúncio"
            className="input"
          />
        </Field>

        <Field label="Texto principal">
          <textarea
            value={form.primary_text}
            onChange={(e) => update("primary_text", e.target.value)}
            rows={4}
            placeholder="Descreva sua oferta…"
            className="input resize-y"
          />
        </Field>

        <Field label="Chamada para ação">
          <select
            value={form.cta}
            onChange={(e) => update("cta", e.target.value)}
            className="input"
          >
            {["Saiba mais", "Enviar mensagem", "Solicitar orçamento", "Comprar agora", "Agendar"].map(
              (c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ),
            )}
          </select>
        </Field>

        {audience && (
          <Field label="Sugestão da IA (público / legenda)">
            <textarea
              value={audience}
              onChange={(e) => setAudience(e.target.value)}
              rows={5}
              className="input resize-y"
            />
            <p className="text-xs text-muted-foreground mt-1">
              Use estas sugestões ao configurar o público no Meta Ads ou ao postar
              organicamente.
            </p>
          </Field>
        )}
      </div>

      <div className="flex flex-col-reverse sm:flex-row gap-2 justify-end">
        <button
          onClick={() => save(false)}
          disabled={saving}
          className="inline-flex items-center justify-center gap-2 h-10 px-4 rounded-md border bg-background text-sm font-medium hover:bg-accent disabled:opacity-50"
        >
          <Save className="h-4 w-4" /> Salvar campanha
        </button>
        <button
          onClick={() => save(true)}
          disabled={saving || !META_ADS_READY}
          title={!META_ADS_READY ? "Meta Ads ainda não validado" : undefined}
          className="inline-flex items-center justify-center gap-2 h-10 px-4 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 disabled:opacity-50"
        >
          <Rocket className="h-4 w-4" /> Publicar campanha
        </button>
      </div>

      <style>{`
        .input {
          height: 2.5rem;
          border-radius: 0.5rem;
          border: 1px solid hsl(var(--input, var(--border)));
          background: transparent;
          padding: 0 0.75rem;
          font-size: 0.875rem;
          width: 100%;
          outline: none;
        }
        textarea.input { height: auto; padding: 0.5rem 0.75rem; }
        .input:focus { box-shadow: 0 0 0 2px hsl(var(--ring) / 0.4); }
      `}</style>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1.5">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}
