import { createLazyFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { useAuth } from "@/auth/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { createCampaign, type CampaignObjective } from "@/lib/campaigns";
import {
  ArrowLeft,
  Save,
  Rocket,
  Image as ImageIcon,
  Info,
  Sparkles,
  Package,
  BookmarkPlus,
  ChevronDown,
  ChevronUp,
  UploadCloud,
  MessageCircle,
  Instagram,
  Send,
  X,
  Loader2,
} from "lucide-react";
import { toast } from "sonner";
import { compressImage } from "@/lib/image-compress";
import type { SavedCreative } from "@/components/campaigns/SavedCreatives";

const SavedCreatives = lazy(() =>
  import("@/components/campaigns/SavedCreatives").then((m) => ({ default: m.SavedCreatives })),
);
const CreativePreview = lazy(() =>
  import("@/components/campaigns/CreativePreview").then((m) => ({ default: m.CreativePreview })),
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

type CampaignStatus = "draft" | "publishing" | "published" | "error";

function NewCampaignPage() {
  const { profile } = useAuth();
  const navigate = useNavigate();
  const [saving, setSaving] = useState(false);
  const [aiLoading, setAiLoading] = useState(false);
  const [audience, setAudience] = useState<string>("");
  const [savingCreative, setSavingCreative] = useState(false);
  const [showCreatives, setShowCreatives] = useState(false);
  const [status, setStatus] = useState<CampaignStatus>("draft");
  const [uploadingMedia, setUploadingMedia] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

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

  async function handleFiles(files: FileList | File[] | null) {
    if (!files || !profile?.company_id) return;
    const file = Array.from(files)[0];
    if (!file) return;
    const isImage = file.type.startsWith("image/");
    const isVideo = file.type.startsWith("video/");
    if (!isImage && !isVideo) {
      toast.error("Envie uma imagem ou vídeo.");
      return;
    }
    setUploadingMedia(true);
    try {
      const toUpload = isImage ? await compressImage(file) : file;
      const ext = isVideo
        ? (file.name.split(".").pop() || "mp4").toLowerCase()
        : "jpg";
      const path = `${profile.company_id}/campaigns/${Date.now()}-${Math.random()
        .toString(36)
        .slice(2, 8)}.${ext}`;
      const { error } = await supabase.storage
        .from("product-images")
        .upload(path, toUpload, {
          cacheControl: "31536000",
          upsert: false,
          contentType: toUpload.type || (isVideo ? "video/mp4" : "image/jpeg"),
        });
      if (error) throw error;
      const { data } = supabase.storage.from("product-images").getPublicUrl(path);
      setForm((f) => ({
        ...f,
        media_url: data.publicUrl,
        media_type: isVideo ? "video" : "image",
      }));
      toast.success("Mídia enviada!");
    } catch (e) {
      console.error(e);
      toast.error("Erro no upload da mídia.");
    } finally {
      setUploadingMedia(false);
      if (fileRef.current) fileRef.current.value = "";
    }
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
    if (publish && META_ADS_READY) setStatus("publishing");
    try {
      const { product_id: _ignored, ...rest } = form;
      const c = await createCampaign(profile.company_id, {
        ...rest,
        status: publish && META_ADS_READY ? "scheduled" : "draft",
      });
      setStatus(publish && META_ADS_READY ? "published" : "draft");
      toast.success(
        publish && META_ADS_READY
          ? "Campanha publicada!"
          : "Campanha salva como rascunho.",
      );
      navigate({ to: "/campanhas/$id", params: { id: c.id } });
    } catch (e) {
      setStatus("error");
      toast.error("Erro ao salvar campanha.");
      console.error(e);
    } finally {
      setSaving(false);
    }
  }

  async function saveCreative() {
    if (!profile?.company_id) return;
    if (!form.headline.trim() && !form.primary_text.trim()) {
      toast.error("Gere ou preencha o anúncio antes de salvar.");
      return;
    }
    setSavingCreative(true);
    try {
      const [audienceLine, ...captionParts] = audience.split(/\n\nLegenda sugerida:\n/);
      const { error } = await supabase.from("campaign_creatives").insert({
        company_id: profile.company_id,
        product_id: form.product_id || null,
        title: form.headline || form.name || "Criativo sem título",
        primary_text: form.primary_text || null,
        cta: form.cta || null,
        social_caption: captionParts.join("\n\nLegenda sugerida:\n") || null,
        audience_suggestion: audienceLine || null,
        image_url: form.media_type === "image" ? form.media_url || null : null,
      });
      if (error) throw error;
      toast.success("Criativo salvo!");
    } catch (e) {
      console.error(e);
      toast.error("Erro ao salvar criativo.");
    } finally {
      setSavingCreative(false);
    }
  }

  function reuseCreative(c: SavedCreative) {
    setForm((f) => ({
      ...f,
      headline: c.title || f.headline,
      primary_text: c.primary_text || f.primary_text,
      cta: c.cta || f.cta,
      media_url: c.image_url || f.media_url,
      media_type: c.image_url ? "image" : f.media_type,
      product_id: c.product_id || f.product_id,
    }));
    setAudience(
      [
        c.audience_suggestion,
        c.social_caption ? `\n\nLegenda sugerida:\n${c.social_caption}` : "",
      ]
        .filter(Boolean)
        .join(""),
    );
    toast.success("Criativo carregado no formulário.");
    setShowCreatives(false);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  return (
    <div className="p-3 md:p-5 max-w-7xl mx-auto w-full animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between gap-3 mb-3.5">
        <div className="space-y-0.5">
          <Link
            to="/campanhas"
            className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            <ArrowLeft className="h-3.5 w-3.5" /> Voltar
          </Link>
          <div className="flex items-center gap-3">
            <h1 className="text-xl md:text-2xl font-semibold tracking-tight">Nova campanha</h1>
            <StatusBadge status={status} />
          </div>
          <p className="text-xs md:text-sm text-muted-foreground">
            Crie um anúncio com IA. O preview atualiza em tempo real.
          </p>
        </div>
      </div>

      {!META_ADS_READY && (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-1.5 text-xs text-amber-700 dark:text-amber-400 flex items-start gap-2 mb-3.5">
          <Info className="h-3.5 w-3.5 mt-0.5 shrink-0" />
          <div>
            Publicação automática no Meta Ads em validação. A campanha é salva como rascunho.
          </div>
        </div>
      )}

      {/* Two-column layout: form + sticky preview */}
      <div className="grid lg:grid-cols-[1fr_380px] gap-4 items-start">
        {/* LEFT: form */}
        <div className="space-y-3.5 min-w-0">
          {/* Produto + IA */}
          <Card>
            <CardHead title="Produto e geração com IA" />
            <div className="space-y-3">
              <Field label="Produto cadastrado">
                <div className="flex flex-col sm:flex-row gap-2">
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
                  <AIButton onClick={generateWithAI} loading={aiLoading} />
                </div>
                {form.product_id && (
                  <p className="mt-1.5 text-xs text-muted-foreground inline-flex items-center gap-1">
                    <Package className="h-3 w-3" /> Dados do produto preenchidos
                    automaticamente.
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
                  <ObjectiveButton
                    active={form.objective === "whatsapp"}
                    onClick={() => update("objective", "whatsapp")}
                    icon={<MessageCircle className="h-4 w-4" />}
                    label="WhatsApp"
                    accent="emerald"
                  />
                  <ObjectiveButton
                    active={form.objective === "instagram"}
                    onClick={() => update("objective", "instagram")}
                    icon={<Instagram className="h-4 w-4" />}
                    label="Instagram"
                    accent="pink"
                  />
                  <ObjectiveButton
                    active={form.objective === "messenger"}
                    onClick={() => update("objective", "messenger")}
                    icon={<Send className="h-4 w-4" />}
                    label="Messenger"
                    accent="blue"
                  />
                </div>
              </Field>
            </div>
          </Card>

          {/* Segmentação */}
          <Card>
            <CardHead title="Segmentação e orçamento" />
            <div className="space-y-3">
              <div className="grid sm:grid-cols-2 gap-3">
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

              <div className="grid sm:grid-cols-3 gap-3">
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
            </div>
          </Card>

          {/* Mídia */}
          <Card>
            <CardHead title="Mídia do anúncio" />
            <MediaUploader
              mediaUrl={form.media_url}
              mediaType={form.media_type}
              uploading={uploadingMedia}
              dragOver={dragOver}
              setDragOver={setDragOver}
              onPickFile={() => fileRef.current?.click()}
              onFiles={handleFiles}
              onClear={() => update("media_url", "")}
              onUrlChange={(v) => update("media_url", v)}
              onTypeChange={(v) => update("media_type", v)}
              fileRef={fileRef}
            />
          </Card>

          {/* Copy */}
          <Card>
            <CardHead title="Texto do anúncio" />
            <div className="space-y-3">
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
          </Card>

          {/* Action bar */}
          <div className="flex flex-col-reverse sm:flex-row gap-2 justify-end">
            <button
              onClick={saveCreative}
              disabled={savingCreative}
              className="inline-flex items-center justify-center gap-2 h-10 px-4 rounded-lg border bg-background text-sm font-medium hover:bg-accent hover:border-foreground/20 transition-colors disabled:opacity-50"
            >
              <BookmarkPlus className="h-4 w-4" />{" "}
              {savingCreative ? "Salvando…" : "Salvar criativo"}
            </button>
            <button
              onClick={() => save(false)}
              disabled={saving}
              className="inline-flex items-center justify-center gap-2 h-10 px-4 rounded-lg border bg-background text-sm font-medium hover:bg-accent hover:border-foreground/20 transition-colors disabled:opacity-50"
            >
              <Save className="h-4 w-4" /> Salvar campanha
            </button>
            <button
              onClick={() => save(true)}
              disabled={saving || !META_ADS_READY}
              title={!META_ADS_READY ? "Meta Ads ainda não validado" : undefined}
              className="publish-cta group relative inline-flex items-center justify-center gap-2 h-10 px-5 rounded-lg bg-gradient-to-r from-primary via-primary to-primary/85 text-primary-foreground text-sm font-semibold shadow-[0_4px_14px_-2px_color-mix(in_oklab,var(--primary)_45%,transparent)] hover:shadow-[0_8px_22px_-2px_color-mix(in_oklab,var(--primary)_55%,transparent)] hover:-translate-y-px active:translate-y-0 transition-all disabled:opacity-50 disabled:hover:translate-y-0 overflow-hidden"
            >
              <span className="absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/20 to-transparent group-hover:translate-x-full transition-transform duration-700" />
              <Rocket className="h-4 w-4 group-hover:rotate-[-8deg] group-hover:scale-110 transition-transform relative" />
              <span className="relative">Publicar campanha</span>
            </button>
          </div>

          {/* Criativos salvos */}
          <Card padded={false}>
            <button
              type="button"
              onClick={() => setShowCreatives((s) => !s)}
              className="w-full flex items-center justify-between p-4 text-sm font-medium hover:bg-accent/40 rounded-xl transition-colors"
            >
              <span className="flex items-center gap-2">
                <BookmarkPlus className="h-4 w-4 text-muted-foreground" />
                Criativos salvos
              </span>
              {showCreatives ? (
                <ChevronUp className="h-4 w-4" />
              ) : (
                <ChevronDown className="h-4 w-4" />
              )}
            </button>
            {showCreatives && profile?.company_id && (
              <div className="px-4 pb-4 animate-fade-in">
                <Suspense
                  fallback={
                    <div className="text-sm text-muted-foreground py-6 flex items-center gap-2">
                      <Loader2 className="h-4 w-4 animate-spin" /> Carregando…
                    </div>
                  }
                >
                  <SavedCreatives
                    companyId={profile.company_id}
                    onReuse={reuseCreative}
                  />
                </Suspense>
              </div>
            )}
          </Card>
        </div>

        {/* RIGHT: sticky preview */}
        <aside className="lg:sticky lg:top-4 space-y-3">
          <Card>
            <div className="flex items-center justify-between mb-3">
              <div className="text-sm font-semibold flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-primary" />
                Preview do anúncio
              </div>
              <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
                Tempo real
              </span>
            </div>
            <div key={`${form.headline}-${form.cta}-${form.media_url}`} className="animate-fade-in">
              <Suspense
                fallback={
                  <div className="text-sm text-muted-foreground py-10 text-center">
                    Carregando preview…
                  </div>
                }
              >
                <CreativePreview
                  data={{
                    headline: form.headline,
                    primary_text: form.primary_text,
                    cta: form.cta,
                    media_url: form.media_url,
                    media_type: form.media_type,
                    product: form.product,
                  }}
                />
              </Suspense>
            </div>
          </Card>
        </aside>
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
          transition: border-color .15s ease, box-shadow .15s ease;
        }
        textarea.input { height: auto; padding: 0.5rem 0.75rem; }
        .input:hover { border-color: color-mix(in oklab, var(--foreground) 25%, transparent); }
        .input:focus { border-color: var(--ring); box-shadow: 0 0 0 3px color-mix(in oklab, var(--ring) 25%, transparent); }

        @keyframes ai-glow {
          0%, 100% { box-shadow: 0 0 0 0 color-mix(in oklab, var(--primary) 35%, transparent), 0 1px 2px rgba(0,0,0,.05); }
          50% { box-shadow: 0 0 18px 2px color-mix(in oklab, var(--primary) 35%, transparent), 0 1px 2px rgba(0,0,0,.05); }
        }
        .ai-glow { animation: ai-glow 2.6s ease-in-out infinite; }
      `}</style>
    </div>
  );
}

/* ---------------- Subcomponents ---------------- */

function Card({
  children,
  padded = true,
}: {
  children: React.ReactNode;
  padded?: boolean;
}) {
  return (
    <div
      className={`rounded-xl border bg-card shadow-[0_1px_0_rgba(0,0,0,0.02)] ${
        padded ? "p-4 md:p-5" : ""
      }`}
    >
      {children}
    </div>
  );
}

function CardHead({ title }: { title: string }) {
  return (
    <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">
      {title}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1.5">
      <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
      {children}
    </label>
  );
}

function StatusBadge({ status }: { status: CampaignStatus }) {
  const map: Record<
    CampaignStatus,
    { label: string; className: string; dot: string }
  > = {
    draft: {
      label: "Rascunho",
      className: "bg-muted text-muted-foreground border-border",
      dot: "bg-muted-foreground",
    },
    publishing: {
      label: "Publicando",
      className: "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/30",
      dot: "bg-amber-500 animate-pulse",
    },
    published: {
      label: "Publicado",
      className: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/30",
      dot: "bg-emerald-500",
    },
    error: {
      label: "Erro",
      className: "bg-destructive/10 text-destructive border-destructive/30",
      dot: "bg-destructive",
    },
  };
  const s = map[status];
  return (
    <span
      className={`inline-flex items-center gap-1.5 h-6 px-2 rounded-full border text-[11px] font-medium ${s.className}`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${s.dot}`} />
      {s.label}
    </span>
  );
}

function AIButton({ onClick, loading }: { onClick: () => void; loading: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={loading}
      title="Preenche título, texto, CTA, legenda e público-alvo"
      className={`relative group inline-flex items-center gap-2 h-10 px-3.5 rounded-lg text-sm font-medium text-primary-foreground bg-gradient-to-r from-primary to-primary/85 hover:from-primary hover:to-primary transition-all disabled:opacity-60 ${
        loading ? "" : "ai-glow hover:-translate-y-px"
      }`}
    >
      <Sparkles className={`h-4 w-4 ${loading ? "animate-spin" : "group-hover:scale-110 transition-transform"}`} />
      <span>{loading ? "Gerando…" : "Gerar anúncio com IA"}</span>
      <span className="ml-1 inline-flex items-center justify-center h-5 px-1.5 rounded-md bg-white/20 text-[10px] font-bold tracking-wider">
        IA
      </span>
    </button>
  );
}

function ObjectiveButton({
  active,
  onClick,
  icon,
  label,
  accent,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
  accent: "emerald" | "pink" | "blue";
}) {
  const accents: Record<typeof accent, string> = {
    emerald: "border-emerald-500/60 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 shadow-[0_0_0_1px_color-mix(in_oklab,oklch(0.65_0.18_160)_40%,transparent)]",
    pink: "border-pink-500/60 bg-pink-500/10 text-pink-600 dark:text-pink-400 shadow-[0_0_0_1px_color-mix(in_oklab,oklch(0.65_0.22_0)_40%,transparent)]",
    blue: "border-blue-500/60 bg-blue-500/10 text-blue-600 dark:text-blue-400 shadow-[0_0_0_1px_color-mix(in_oklab,oklch(0.65_0.18_240)_40%,transparent)]",
  };
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center justify-center gap-2 h-10 rounded-lg border text-sm font-medium transition-all ${
        active
          ? accents[accent]
          : "border-input bg-background hover:bg-accent hover:border-foreground/20 text-foreground"
      }`}
    >
      {icon}
      <span>{label}</span>
    </button>
  );
}

function MediaUploader({
  mediaUrl,
  mediaType,
  uploading,
  dragOver,
  setDragOver,
  onPickFile,
  onFiles,
  onClear,
  onUrlChange,
  onTypeChange,
  fileRef,
}: {
  mediaUrl: string;
  mediaType: string;
  uploading: boolean;
  dragOver: boolean;
  setDragOver: (v: boolean) => void;
  onPickFile: () => void;
  onFiles: (f: FileList | File[] | null) => void;
  onClear: () => void;
  onUrlChange: (v: string) => void;
  onTypeChange: (v: string) => void;
  fileRef: React.RefObject<HTMLInputElement | null>;
}) {
  return (
    <div className="space-y-3">
      {/* Dropzone */}
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          onFiles(e.dataTransfer.files);
        }}
        onClick={onPickFile}
        className={`relative cursor-pointer rounded-xl border-2 border-dashed p-6 text-center transition-all ${
          dragOver
            ? "border-primary bg-primary/5 scale-[1.01]"
            : "border-border hover:border-foreground/30 hover:bg-accent/30"
        }`}
      >
        <input
          ref={fileRef}
          type="file"
          accept="image/*,video/*"
          className="hidden"
          onChange={(e) => onFiles(e.target.files)}
        />
        {mediaUrl ? (
          <div className="flex flex-col items-center gap-3">
            {mediaType === "image" ? (
              <img
                src={mediaUrl}
                alt=""
                className="max-h-48 rounded-lg border object-contain bg-background"
              />
            ) : (
              <video
                src={mediaUrl}
                controls
                className="max-h-48 rounded-lg border bg-background"
                onClick={(e) => e.stopPropagation()}
              />
            )}
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <span>Clique ou arraste para substituir</span>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onClear();
                }}
                className="inline-flex items-center gap-1 h-7 px-2 rounded-md border hover:bg-destructive/10 hover:text-destructive hover:border-destructive/30 transition-colors"
              >
                <X className="h-3 w-3" /> Remover
              </button>
            </div>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-2 py-4">
            <div className="h-14 w-14 rounded-full bg-primary/10 text-primary flex items-center justify-center">
              {uploading ? (
                <Loader2 className="h-7 w-7 animate-spin" />
              ) : (
                <UploadCloud className="h-7 w-7" />
              )}
            </div>
            <div className="text-sm font-medium">
              {uploading ? "Enviando…" : "Arraste uma imagem ou vídeo aqui"}
            </div>
            <div className="text-xs text-muted-foreground">
              ou clique para selecionar do dispositivo
            </div>
          </div>
        )}
      </div>

      {/* URL alternativa */}
      <details className="group">
        <summary className="text-xs text-muted-foreground hover:text-foreground cursor-pointer inline-flex items-center gap-1 select-none">
          <ImageIcon className="h-3 w-3" /> Usar URL externa
        </summary>
        <div className="mt-2 flex gap-2">
          <input
            value={mediaUrl}
            onChange={(e) => onUrlChange(e.target.value)}
            placeholder="https://…"
            className="input flex-1"
          />
          <select
            value={mediaType}
            onChange={(e) => onTypeChange(e.target.value)}
            className="input w-32"
          >
            <option value="image">Imagem</option>
            <option value="video">Vídeo</option>
          </select>
        </div>
      </details>
    </div>
  );
}
