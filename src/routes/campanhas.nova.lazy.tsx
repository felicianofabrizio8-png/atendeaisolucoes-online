import { createLazyFileRoute, useNavigate, Link, useRouter } from "@tanstack/react-router";
import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { useAuth } from "@/auth/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { createCampaign, type CampaignObjective, type CampaignGoal } from "@/lib/campaigns";
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
  Megaphone,
  MousePointerClick,
  MessageSquareHeart,
  Users,
  ShoppingBag,
  RotateCcw,
} from "lucide-react";

// CampaignGoal type now lives in @/lib/campaigns

const GOALS: {
  id: CampaignGoal;
  label: string;
  desc: string;
  icon: React.ComponentType<{ className?: string }>;
}[] = [
  { id: "awareness", label: "Reconhecimento", desc: "Mostrar sua empresa para mais pessoas", icon: Megaphone },
  { id: "traffic", label: "Tráfego", desc: "Levar pessoas para WhatsApp, Instagram ou site", icon: MousePointerClick },
  { id: "engagement", label: "Engajamento", desc: "Gerar mensagens e interações", icon: MessageSquareHeart },
  { id: "leads", label: "Leads", desc: "Captar contatos e orçamentos", icon: Users },
  { id: "sales", label: "Vendas", desc: "Vender produtos ou promoções", icon: ShoppingBag },
  { id: "reactivation", label: "Reativação", desc: "Trazer antigos clientes de volta", icon: RotateCcw },
];
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
  errorComponent: CampaignsRouteError,
  notFoundComponent: CampaignsRouteNotFound,
});

function CampaignsRouteError({ error, reset }: { error: Error; reset: () => void }) {
  const router = useRouter();
  return (
    <div className="p-6 max-w-md mx-auto space-y-3 text-center">
      <h2 className="text-lg font-semibold">Não foi possível carregar Nova campanha</h2>
      <p className="text-sm text-muted-foreground">{error.message}</p>
      <div className="flex gap-2 justify-center">
        <button
          onClick={() => { router.invalidate(); reset(); }}
          className="h-9 px-4 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90"
        >
          Tentar novamente
        </button>
        <Link to="/campanhas" className="h-9 px-4 inline-flex items-center rounded-md border text-sm">
          Voltar
        </Link>
      </div>
    </div>
  );
}

function CampaignsRouteNotFound() {
  return (
    <div className="p-6 max-w-md mx-auto space-y-3 text-center">
      <h2 className="text-lg font-semibold">Página não encontrada</h2>
      <Link to="/campanhas" className="text-sm text-primary hover:underline">Voltar para Campanhas</Link>
    </div>
  );
}

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
    goal: "leads" as CampaignGoal,
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
      const { getPublicImageUrl } = await import("@/lib/storage");
      setForm((f) => ({
        ...f,
        media_url: getPublicImageUrl(path),
        media_type: isVideo ? "video" : "image",
      }));
      toast.success("Mídia enviada!");
    } catch (e) {
      const msg = e instanceof Error ? e.message : "";
      console.error(e);
      if (/quota/i.test(msg)) {
        toast.error("Limite de armazenamento da empresa atingido.");
      } else {
        toast.error("Erro no upload da mídia.");
      }
    } finally {
      setUploadingMedia(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function generateWithAI() {
    const hasProduct = !!form.product_id || !!form.product.trim();
    const hasMedia = !!form.media_url;
    if (!hasProduct && !hasMedia) {
      toast.error("Selecione um produto cadastrado ou envie um criativo para gerar o anúncio com IA.");
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
            name: p?.name ?? form.product ?? null,
            description: p?.description ?? form.primary_text ?? null,
            category: p?.category ?? null,
            price: p?.price ?? null,
            promoPrice: p?.promo_price ?? null,
          },
          objective: form.objective,
          goal: form.goal,
          city: form.city || null,
          media_url: form.media_url || null,
          media_type: form.media_type || null,
          daily_budget: form.daily_budget ?? null,
          radius_km: form.radius_km ?? null,
          start_date: form.start_date || null,
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
          {/* Objetivo estratégico */}
          <Card>
            <CardHead title="Objetivo da campanha" />
            <p className="-mt-1 mb-3 text-xs text-muted-foreground">
              Define como a IA escreve o anúncio e sugere o público.
            </p>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
              {GOALS.map((g) => (
                <GoalCard
                  key={g.id}
                  active={form.goal === g.id}
                  icon={<g.icon className="h-4 w-4" />}
                  label={g.label}
                  desc={g.desc}
                  onClick={() => update("goal", g.id)}
                />
              ))}
            </div>
          </Card>

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

              <Field label="Canal de atendimento">
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
            <div className="flex items-center justify-between mb-2.5">
              <div className="text-sm font-semibold flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-primary" />
                Preview do anúncio
              </div>
              <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
                Tempo real
              </span>
            </div>
            <Suspense
              fallback={
                <div className="space-y-2">
                  <div className="h-7 w-40 rounded-md bg-muted animate-pulse" />
                  <div className="aspect-square w-full rounded-xl bg-muted animate-pulse" />
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
          </Card>

          <AIInsights
            headline={form.headline}
            primary_text={form.primary_text}
            cta={form.cta}
            objective={form.objective}
            media_url={form.media_url}
          />
        </aside>
      </div>

      {/* keyframes & .input moved to src/styles.css (@layer components) */}
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
        padded ? "p-3.5 md:p-4" : ""
      }`}
    >
      {children}
    </div>
  );
}

function CardHead({ title }: { title: string }) {
  return (
    <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-2.5">
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

function GoalCard({
  active,
  icon,
  label,
  desc,
  onClick,
}: {
  active: boolean;
  icon: React.ReactNode;
  label: string;
  desc: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`group text-left rounded-lg border p-2.5 transition-all hover:-translate-y-px ${
        active
          ? "border-primary/70 bg-primary/[0.06] shadow-[0_0_0_1px_color-mix(in_oklab,var(--primary)_40%,transparent),0_6px_18px_-10px_color-mix(in_oklab,var(--primary)_60%,transparent)]"
          : "border-input bg-background hover:border-foreground/25 hover:bg-accent/40"
      }`}
    >
      <div className="flex items-center gap-2">
        <span
          className={`h-7 w-7 rounded-md flex items-center justify-center transition-colors ${
            active
              ? "bg-primary text-primary-foreground"
              : "bg-muted text-muted-foreground group-hover:text-foreground"
          }`}
        >
          {icon}
        </span>
        <span className={`text-sm font-medium ${active ? "text-foreground" : "text-foreground"}`}>
          {label}
        </span>
      </div>
      <p className="mt-1.5 text-[11px] leading-snug text-muted-foreground line-clamp-2">
        {desc}
      </p>
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
        className={`group relative cursor-pointer rounded-xl border border-dashed p-5 text-center transition-all overflow-hidden ${
          dragOver
            ? "border-primary bg-primary/[0.06] scale-[1.005] shadow-[0_0_0_4px_color-mix(in_oklab,var(--primary)_18%,transparent)]"
            : "border-border/70 bg-gradient-to-b from-muted/20 to-transparent hover:border-primary/40 hover:shadow-[0_0_24px_-6px_color-mix(in_oklab,var(--primary)_45%,transparent)]"
        }`}
      >
        <span className="absolute top-2 right-2 inline-flex items-center gap-1 h-5 px-1.5 rounded-full bg-background/80 backdrop-blur border text-[10px] font-medium text-muted-foreground">
          <Sparkles className="h-2.5 w-2.5 text-primary" /> Formato recomendado
        </span>
        <input
          ref={fileRef}
          type="file"
          accept="image/*,video/*"
          className="hidden"
          onChange={(e) => onFiles(e.target.files)}
        />
        {mediaUrl ? (
          <div className="flex flex-col items-center gap-2.5">
            {mediaType === "image" ? (
              <img
                src={mediaUrl}
                alt=""
                className="max-h-44 rounded-lg border object-contain bg-background"
              />
            ) : (
              <video
                src={mediaUrl}
                controls
                className="max-h-44 rounded-lg border bg-background"
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
          <div className="flex flex-col items-center gap-2 py-2">
            <div className="h-16 w-16 rounded-2xl bg-gradient-to-br from-primary/15 to-primary/5 text-primary flex items-center justify-center ring-1 ring-primary/15 group-hover:scale-105 transition-transform">
              {uploading ? (
                <Loader2 className="h-8 w-8 animate-spin" />
              ) : (
                <UploadCloud className="h-8 w-8" />
              )}
            </div>
            <div className="text-sm font-medium">
              {uploading ? "Enviando…" : "Arraste imagem ou vídeo aqui"}
            </div>
            <div className="text-xs text-muted-foreground">
              ou clique para selecionar do dispositivo · JPG, PNG, MP4
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

/* ---------------- AI Insights (heurística local, sem chamada de IA) ---------------- */

function AIInsights({
  headline,
  primary_text,
  cta,
  objective,
  media_url,
}: {
  headline: string;
  primary_text: string;
  cta: string;
  objective: CampaignObjective;
  media_url: string;
}) {
  const h = headline.trim();
  const t = primary_text.trim();
  const hasMedia = !!media_url;

  // Pontuação simples — apenas leitura do estado, sem requests.
  let score = 0;
  if (h.length >= 8 && h.length <= 40) score += 25;
  else if (h.length > 0) score += 12;
  if (t.length >= 60 && t.length <= 500) score += 25;
  else if (t.length > 0) score += 12;
  if (cta && cta !== "Saiba mais") score += 20;
  else if (cta) score += 10;
  if (hasMedia) score += 30;

  const potential =
    score >= 75 ? { label: "Alto", tone: "emerald" as const } :
    score >= 45 ? { label: "Médio", tone: "amber" as const } :
                  { label: "Baixo", tone: "rose" as const };

  const ctaStrength =
    !cta ? "Defina um CTA claro." :
    cta === "Saiba mais" ? "CTA poderia ser mais direto." :
    "CTA forte e específico.";

  const clarity =
    !t ? "Adicione um texto descrevendo a oferta." :
    t.length < 60 ? "Texto curto — reforce o benefício." :
    t.length > 500 ? "Texto longo — pode perder atenção." :
    "Oferta clara e bem dimensionada.";

  const tip =
    !hasMedia ? "Adicione uma mídia — anúncios com imagem convertem muito mais." :
    objective === "whatsapp" && !/whats|mensagem|conversar/i.test(t + h) ?
      "Mencione 'fale no WhatsApp' para incentivar o clique." :
    objective === "instagram" && !/oferta|promoção|exclusiv/i.test(t + h) ?
      "Reforce escassez ou exclusividade no Instagram." :
    "Texto bem alinhado ao objetivo.";

  const toneCls: Record<"emerald" | "amber" | "rose", string> = {
    emerald: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/30",
    amber: "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/30",
    rose: "bg-rose-500/10 text-rose-600 dark:text-rose-400 border-rose-500/30",
  };

  return (
    <div className="rounded-xl border bg-card p-3.5 md:p-4 shadow-[0_1px_0_rgba(0,0,0,0.02)]">
      <div className="flex items-center justify-between mb-2.5">
        <div className="text-sm font-semibold flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-primary" />
          Qualidade do anúncio
        </div>
        <span className={`inline-flex items-center gap-1 h-5 px-2 rounded-full border text-[10px] font-medium ${toneCls[potential.tone]}`}>
          {potential.label}
        </span>
      </div>

      <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden mb-3">
        <div
          className="h-full rounded-full bg-gradient-to-r from-primary/70 to-primary transition-all duration-500"
          style={{ width: `${Math.min(100, score)}%` }}
        />
      </div>

      <ul className="space-y-1.5 text-xs">
        <li className="flex gap-2">
          <span className="text-muted-foreground shrink-0">Força do CTA:</span>
          <span className="text-foreground">{ctaStrength}</span>
        </li>
        <li className="flex gap-2">
          <span className="text-muted-foreground shrink-0">Clareza da oferta:</span>
          <span className="text-foreground">{clarity}</span>
        </li>
        <li className="flex gap-2">
          <span className="text-muted-foreground shrink-0">Sugestão:</span>
          <span className="text-foreground">{tip}</span>
        </li>
      </ul>
    </div>
  );
}

