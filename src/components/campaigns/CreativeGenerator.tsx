// Gerador de Criativos com IA — wizard completo.
// Fluxo: Upload → Análise → Configuração → Gerar variantes (texto+imagem) → Salvar/Usar.
// Aditivo: não substitui o gerador existente em /campanhas/nova.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import {
  Upload, Sparkles, Loader2, Wand2, ImageIcon, Eye, Save, ArrowRight,
  Heart, Tag, Clock, Check, Award, RefreshCw, Download, Package, Search, X,
} from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

interface ProductRow {
  id: string;
  name: string;
  category: string | null;
  description: string | null;
  price: number | null;
  promo_price: number | null;
  images: string[];
}

type Step = "upload" | "configure" | "results";
type VariantKey = "emotion" | "offer" | "urgency";
type Format = "feed_1080" | "story_1920" | "facebook_feed" | "whatsapp_status";

interface Analysis {
  category?: string;
  main_object?: string;
  colors?: string[];
  context?: string;
  quality?: "alta" | "media" | "baixa";
  audience?: string[];
  business_type?: string;
  style_keywords?: string[];
}

interface VariantText {
  headline: string;
  primary_text: string;
  description: string;
  cta: string;
  image_prompt: string;
}

interface Variants {
  emotion: VariantText;
  offer: VariantText;
  urgency: VariantText;
  audience_suggestion: string;
}

interface VariantImage {
  format: Format;
  url: string; // data: URL ou storage url
  generating?: boolean;
}

interface ScoreResult {
  score: number;
  ctr_potential: "baixo" | "medio" | "alto";
  conversion_potential: "baixo" | "medio" | "alto";
  strengths: string[];
  improvements: string[];
}

const VARIANT_META: Record<VariantKey, { label: string; icon: typeof Heart; color: string; desc: string }> = {
  emotion: { label: "Emoção", icon: Heart, color: "rose", desc: "Aspiração e estilo de vida" },
  offer: { label: "Oferta", icon: Tag, color: "emerald", desc: "Benefício tangível" },
  urgency: { label: "Urgência", icon: Clock, color: "amber", desc: "Escassez e tempo limitado" },
};

const FORMAT_META: Record<Format, { label: string; ratio: string; w: number; h: number }> = {
  feed_1080: { label: "Feed 1:1", ratio: "1/1", w: 1080, h: 1080 },
  story_1920: { label: "Stories 9:16", ratio: "9/16", w: 1080, h: 1920 },
  facebook_feed: { label: "Facebook 16:9", ratio: "16/9", w: 1920, h: 1080 },
  whatsapp_status: { label: "WhatsApp 9:16", ratio: "9/16", w: 1080, h: 1920 },
};

const GOALS = [
  { v: "leads", l: "Leads" }, { v: "whatsapp", l: "WhatsApp" },
  { v: "sales", l: "Vendas" }, { v: "traffic", l: "Tráfego" }, { v: "awareness", l: "Reconhecimento" },
];
const STYLES = [
  { v: "premium", l: "Premium" }, { v: "offer", l: "Oferta" },
  { v: "luxury", l: "Luxo" }, { v: "family", l: "Família" },
  { v: "urgency", l: "Urgência" }, { v: "modern", l: "Moderno" },
  { v: "minimal", l: "Minimalista" },
];
const AUDIENCES = [
  { v: "homens", l: "Homens" }, { v: "mulheres", l: "Mulheres" },
  { v: "casais", l: "Casais" }, { v: "familias", l: "Famílias" },
  { v: "empresarios", l: "Empresários" }, { v: "custom", l: "Personalizado" },
];

interface Props {
  companyId: string;
  campaignId?: string;
  onUseInCampaign?: (creativeId: string, variant: VariantText, imageUrl: string) => void;
}

export function CreativeGenerator({ companyId, campaignId, onUseInCampaign }: Props) {
  const [step, setStep] = useState<Step>("upload");
  const [sourceImage, setSourceImage] = useState<string | null>(null);
  const [sourcePath, setSourcePath] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [analysis, setAnalysis] = useState<Analysis | null>(null);

  const [config, setConfig] = useState({
    goal: "leads", style: "premium", audience: "familias",
    audience_custom: "", product_name: "", product_description: "",
    preserve_product: false,
  });

  const [generatingTexts, setGeneratingTexts] = useState(false);
  const [variants, setVariants] = useState<Variants | null>(null);
  const [activeVariant, setActiveVariant] = useState<VariantKey>("emotion");
  const [activeFormat, setActiveFormat] = useState<Format>("feed_1080");

  // Imagens geradas: chave `${variant}-${format}` => data URL
  const [images, setImages] = useState<Record<string, VariantImage>>({});
  const [scoring, setScoring] = useState(false);
  const [scores, setScores] = useState<Record<VariantKey, ScoreResult | null>>({ emotion: null, offer: null, urgency: null });

  const fileRef = useRef<HTMLInputElement>(null);

  // ============ PRODUCT LIBRARY ============
  const [sourceMode, setSourceMode] = useState<"upload" | "library">("upload");
  const [products, setProducts] = useState<ProductRow[] | null>(null);
  const [loadingProducts, setLoadingProducts] = useState(false);
  const [productSearch, setProductSearch] = useState("");

  useEffect(() => {
    if (sourceMode !== "library" || products !== null || !companyId) return;
    setLoadingProducts(true);
    (async () => {
      const { data, error } = await supabase
        .from("products")
        .select("id,name,category,description,price,promo_price,images")
        .eq("company_id", companyId)
        .eq("active", true)
        .order("created_at", { ascending: false });
      if (error) {
        console.error(error);
        toast.error("Não foi possível carregar produtos.");
        setProducts([]);
      } else {
        setProducts(
          (data ?? []).map((r: any) => ({
            id: r.id,
            name: r.name,
            category: r.category,
            description: r.description,
            price: r.price != null ? Number(r.price) : null,
            promo_price: r.promo_price != null ? Number(r.promo_price) : null,
            images: Array.isArray(r.images) ? (r.images.filter((x: any) => typeof x === "string") as string[]) : [],
          })),
        );
      }
      setLoadingProducts(false);
    })();
  }, [sourceMode, products, companyId]);

  const filteredProducts = useMemo(() => {
    if (!products) return [];
    const q = productSearch.trim().toLowerCase();
    if (!q) return products;
    return products.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        (p.category ?? "").toLowerCase().includes(q) ||
        (p.description ?? "").toLowerCase().includes(q),
    );
  }, [products, productSearch]);

  const pickProductFromLibrary = async (p: ProductRow) => {
    const url = p.images[0];
    if (!url) {
      toast.error("Esse produto não tem imagem cadastrada.");
      return;
    }
    setSourceImage(url);
    setSourcePath(url);
    setConfig((c) => ({
      ...c,
      product_name: p.name,
      product_description: [
        p.category ? `Categoria: ${p.category}` : null,
        p.price != null ? `Preço: R$ ${p.price.toFixed(2)}` : null,
        p.promo_price != null ? `Promo: R$ ${p.promo_price.toFixed(2)}` : null,
        p.description ?? null,
      ]
        .filter(Boolean)
        .join(" • "),
    }));
    toast.success(`Produto "${p.name}" carregado.`);
    void runAnalyze(url);
  };


  // ============ UPLOAD ============
  const handleFile = async (file: File) => {
    if (!file.type.startsWith("image/")) { toast.error("Selecione uma imagem."); return; }
    if (file.size > 8 * 1024 * 1024) { toast.error("Imagem máxima 8MB."); return; }
    setUploading(true);
    try {
      const ext = file.name.split(".").pop() ?? "jpg";
      const path = `${companyId}/creative-source/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
      const { error } = await supabase.storage.from("product-images").upload(path, file, { upsert: false });
      if (error) throw error;
      const { data } = await supabase.storage.from("product-images").createSignedUrl(path, 60 * 60);
      setSourcePath(path);
      setSourceImage(data?.signedUrl ?? null);
      toast.success("Imagem carregada.");
      // Auto-analisar
      void runAnalyze(data?.signedUrl ?? null);
    } catch (e: any) {
      console.error(e);
      toast.error("Falha no upload.");
    } finally { setUploading(false); }
  };

  const authHeader = useCallback(async () => {
    const { data } = await supabase.auth.getSession();
    return { Authorization: `Bearer ${data.session?.access_token ?? ""}`, "Content-Type": "application/json" };
  }, []);

  // ============ ANALYZE ============
  const runAnalyze = async (img: string | null) => {
    if (!img) return;
    setAnalyzing(true);
    try {
      const res = await fetch("/api/ai/creative-generator", {
        method: "POST", headers: await authHeader(),
        body: JSON.stringify({ mode: "analyze", image_url: img }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? "Falha na análise");
      setAnalysis(data);
      setStep("configure");
    } catch (e: any) { toast.error(e.message ?? "Erro na análise"); }
    finally { setAnalyzing(false); }
  };

  // ============ GENERATE TEXTS ============
  const generateTexts = async () => {
    if (!sourceImage) { toast.error("Envie uma imagem primeiro."); return; }
    setGeneratingTexts(true);
    try {
      const res = await fetch("/api/ai/creative-generator", {
        method: "POST", headers: await authHeader(),
        body: JSON.stringify({ mode: "generate-texts", image_url: sourceImage, analysis, config }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? "Falha");
      setVariants(data);
      setStep("results");
      // Gera automaticamente a imagem do formato Feed para cada variante
      for (const v of ["emotion", "offer", "urgency"] as VariantKey[]) {
        void generateImage(v, "feed_1080", data[v].image_prompt);
      }
    } catch (e: any) { toast.error(e.message ?? "Erro"); }
    finally { setGeneratingTexts(false); }
  };

  // ============ GENERATE IMAGE ============
  const generateImage = async (variant: VariantKey, format: Format, promptOverride?: string) => {
    const v = variants?.[variant];
    const prompt = promptOverride ?? v?.image_prompt;
    if (!prompt) return;
    const key = `${variant}-${format}`;
    setImages((p) => ({ ...p, [key]: { format, url: "", generating: true } }));
    try {
      const res = await fetch("/api/ai/creative-generator", {
        method: "POST", headers: await authHeader(),
        body: JSON.stringify({ mode: "generate-image", image_url: sourceImage, prompt, format, preserve_product: config.preserve_product }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? "Falha");
      const url = `data:image/png;base64,${data.b64_json}`;
      setImages((p) => ({ ...p, [key]: { format, url, generating: false } }));
    } catch (e: any) {
      toast.error(`Imagem ${FORMAT_META[format].label}: ${e.message}`);
      setImages((p) => { const n = { ...p }; delete n[key]; return n; });
    }
  };

  // ============ SAVE ============
  const saveVariant = async (variant: VariantKey) => {
    if (!variants) return;
    const v = variants[variant];
    const key = `${variant}-${activeFormat}`;
    const img = images[key];
    if (!img?.url) { toast.error("Gere a imagem antes de salvar."); return; }

    // upload base64 -> storage
    try {
      const blob = await (await fetch(img.url)).blob();
      const path = `${companyId}/creatives/${Date.now()}-${variant}-${activeFormat}.png`;
      const { error: upErr } = await supabase.storage.from("product-images").upload(path, blob, { contentType: "image/png", upsert: false });
      if (upErr) throw upErr;

      const { data: insert, error: insErr } = await supabase.from("campaign_creatives").insert({
        company_id: companyId,
        campaign_id: campaignId ?? null,
        title: v.headline.slice(0, 80) || `Criativo ${VARIANT_META[variant].label}`,
        headline: v.headline,
        primary_text: v.primary_text,
        description: v.description,
        cta: v.cta,
        social_caption: v.primary_text,
        audience_suggestion: variants.audience_suggestion,
        image_url: path,
        source_image_url: sourcePath,
        format: activeFormat,
        variant_label: variant,
        analysis: analysis ?? {},
        prompt: v.image_prompt,
        config: config as any,
        preserve_product: config.preserve_product,
      } as any).select().single();
      if (insErr) throw insErr;
      toast.success("Criativo salvo na biblioteca.");
      return insert?.id as string | undefined;
    } catch (e: any) {
      console.error(e);
      toast.error("Falha ao salvar.");
    }
  };

  // ============ SCORE ============
  const scoreVariant = async (variant: VariantKey) => {
    if (!variants) return;
    const v = variants[variant];
    const key = `${variant}-${activeFormat}`;
    const img = images[key];
    if (!img?.url) { toast.error("Gere a imagem antes."); return; }
    setScoring(true);
    try {
      const res = await fetch("/api/ai/creative-generator", {
        method: "POST", headers: await authHeader(),
        body: JSON.stringify({ mode: "score", image_url: img.url, texts: v }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? "Falha");
      setScores((p) => ({ ...p, [variant]: data }));
    } catch (e: any) { toast.error(e.message ?? "Erro"); }
    finally { setScoring(false); }
  };

  const useNow = async (variant: VariantKey) => {
    const v = variants?.[variant];
    if (!v) return;
    const key = `${variant}-${activeFormat}`;
    const img = images[key];
    if (!img?.url) { toast.error("Gere a imagem antes."); return; }
    const id = await saveVariant(variant);
    if (id && onUseInCampaign) onUseInCampaign(id, v, img.url);
  };

  // ============ RENDER ============
  return (
    <div className="space-y-4">
      <header className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold flex items-center gap-2"><Wand2 className="h-5 w-5 text-primary" /> Gerador de Criativos IA</h2>
          <p className="text-xs text-muted-foreground">Transforme uma foto em criativo profissional pronto para Meta Ads e WhatsApp.</p>
        </div>
        <div className="flex items-center gap-1 text-xs">
          {(["upload", "configure", "results"] as Step[]).map((s, i) => (
            <div key={s} className={`px-2.5 py-1 rounded-full border ${step === s ? "bg-primary text-primary-foreground border-primary" : "bg-muted text-muted-foreground"}`}>
              {i + 1}. {s === "upload" ? "Foto" : s === "configure" ? "Config" : "Resultado"}
            </div>
          ))}
        </div>
      </header>

      {/* STEP UPLOAD */}
      {step === "upload" && (
        <div className="rounded-xl border-2 border-dashed p-8 text-center bg-card">
          <input ref={fileRef} type="file" accept="image/*" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); }} />
          {sourceImage ? (
            <div className="space-y-3">
              <img src={sourceImage} alt="" className="mx-auto max-h-64 rounded-lg shadow" />
              {analyzing ? (
                <p className="text-sm flex items-center justify-center gap-2 text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Analisando imagem…</p>
              ) : (
                <button onClick={() => fileRef.current?.click()} className="text-xs underline text-muted-foreground">Trocar imagem</button>
              )}
            </div>
          ) : (
            <>
              <Upload className="h-10 w-10 mx-auto text-muted-foreground mb-3" />
              <p className="text-sm font-medium">Envie uma foto do produto</p>
              <p className="text-xs text-muted-foreground mt-1 mb-4">JPG ou PNG até 8 MB</p>
              <button disabled={uploading} onClick={() => fileRef.current?.click()} className="inline-flex items-center gap-2 px-4 py-2 rounded-md bg-primary text-primary-foreground text-sm hover:bg-primary/90 disabled:opacity-60">
                {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                Escolher arquivo
              </button>
            </>
          )}
        </div>
      )}

      {/* STEP CONFIGURE */}
      {step === "configure" && (
        <div className="grid md:grid-cols-2 gap-4">
          <div className="space-y-3">
            {sourceImage && <img src={sourceImage} alt="" className="rounded-lg border max-h-56 w-full object-contain bg-muted/40" />}
            {analysis && (
              <div className="rounded-lg border p-3 text-xs space-y-1 bg-muted/30">
                <p className="font-semibold flex items-center gap-1"><Sparkles className="h-3.5 w-3.5" /> Análise IA</p>
                <p><b>Categoria:</b> {analysis.category}</p>
                <p><b>Objeto:</b> {analysis.main_object}</p>
                <p><b>Contexto:</b> {analysis.context}</p>
                <p><b>Qualidade:</b> {analysis.quality}</p>
                {analysis.audience?.length ? <p><b>Público provável:</b> {analysis.audience.join(", ")}</p> : null}
                {analysis.colors?.length ? (
                  <div className="flex items-center gap-1.5 mt-1"><b>Cores:</b>
                    {analysis.colors.slice(0, 6).map((c, i) => <span key={i} className="inline-block h-4 w-4 rounded border" style={{ background: c }} />)}
                  </div>
                ) : null}
              </div>
            )}
          </div>
          <div className="space-y-3">
            <Field label="Objetivo">
              <select className="w-full h-9 rounded-md border bg-background px-2 text-sm" value={config.goal} onChange={(e) => setConfig({ ...config, goal: e.target.value })}>
                {GOALS.map((g) => <option key={g.v} value={g.v}>{g.l}</option>)}
              </select>
            </Field>
            <Field label="Estilo">
              <div className="grid grid-cols-3 gap-1.5">
                {STYLES.map((s) => (
                  <button key={s.v} onClick={() => setConfig({ ...config, style: s.v })}
                    className={`text-xs h-8 rounded-md border ${config.style === s.v ? "bg-primary text-primary-foreground border-primary" : "hover:bg-accent"}`}>{s.l}</button>
                ))}
              </div>
            </Field>
            <Field label="Público">
              <div className="grid grid-cols-3 gap-1.5">
                {AUDIENCES.map((a) => (
                  <button key={a.v} onClick={() => setConfig({ ...config, audience: a.v })}
                    className={`text-xs h-8 rounded-md border ${config.audience === a.v ? "bg-primary text-primary-foreground border-primary" : "hover:bg-accent"}`}>{a.l}</button>
                ))}
              </div>
              {config.audience === "custom" && (
                <input className="mt-2 w-full h-9 rounded-md border bg-background px-2 text-sm" placeholder="Descreva o público..."
                  value={config.audience_custom} onChange={(e) => setConfig({ ...config, audience_custom: e.target.value })} />
              )}
            </Field>
            <Field label="Nome do produto (opcional)">
              <input className="w-full h-9 rounded-md border bg-background px-2 text-sm" value={config.product_name} onChange={(e) => setConfig({ ...config, product_name: e.target.value })} />
            </Field>
            <label className="flex items-start gap-2 p-3 rounded-md border bg-muted/30 cursor-pointer">
              <input type="checkbox" className="mt-0.5" checked={config.preserve_product} onChange={(e) => setConfig({ ...config, preserve_product: e.target.checked })} />
              <div className="text-xs">
                <p className="font-medium">Preservar produto original</p>
                <p className="text-muted-foreground">Mantém forma, proporções e identidade. Ideal para piscinas, móveis, veículos e produtos técnicos.</p>
              </div>
            </label>
            <div className="flex gap-2 pt-2">
              <button onClick={() => setStep("upload")} className="px-3 h-9 rounded-md border text-sm hover:bg-accent">Voltar</button>
              <button disabled={generatingTexts} onClick={generateTexts}
                className="flex-1 inline-flex items-center justify-center gap-2 h-9 rounded-md bg-primary text-primary-foreground text-sm hover:bg-primary/90 disabled:opacity-60">
                {generatingTexts ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                Gerar 3 variantes
              </button>
            </div>
          </div>
        </div>
      )}

      {/* STEP RESULTS */}
      {step === "results" && variants && (
        <div className="space-y-4">
          <Tabs value={activeVariant} onValueChange={(v) => setActiveVariant(v as VariantKey)}>
            <TabsList className="grid grid-cols-3 w-full">
              {(["emotion", "offer", "urgency"] as VariantKey[]).map((k) => {
                const M = VARIANT_META[k]; const Icon = M.icon;
                return <TabsTrigger key={k} value={k} className="gap-1.5"><Icon className="h-3.5 w-3.5" /> {M.label}</TabsTrigger>;
              })}
            </TabsList>
            {(["emotion", "offer", "urgency"] as VariantKey[]).map((k) => {
              const v = variants[k];
              const score = scores[k];
              return (
                <TabsContent key={k} value={k} className="space-y-3 mt-3">
                  <div className="grid md:grid-cols-2 gap-3">
                    {/* Preview multi-formato */}
                    <div className="space-y-2">
                      <div className="flex items-center gap-1 flex-wrap">
                        {(Object.keys(FORMAT_META) as Format[]).map((f) => {
                          const has = images[`${k}-${f}`];
                          return (
                            <button key={f} onClick={() => setActiveFormat(f)}
                              className={`text-xs h-7 px-2 rounded border inline-flex items-center gap-1 ${activeFormat === f ? "bg-primary text-primary-foreground border-primary" : "hover:bg-accent"}`}>
                              {FORMAT_META[f].label}
                              {has?.url && <Check className="h-3 w-3" />}
                            </button>
                          );
                        })}
                      </div>
                      <div className="rounded-xl border bg-muted/20 p-3 flex items-center justify-center min-h-[280px]" style={{ aspectRatio: FORMAT_META[activeFormat].ratio }}>
                        {(() => {
                          const key = `${k}-${activeFormat}`;
                          const img = images[key];
                          if (img?.generating) return <div className="flex flex-col items-center gap-2 text-xs text-muted-foreground"><Loader2 className="h-6 w-6 animate-spin" /> Gerando imagem…</div>;
                          if (img?.url) return <img src={img.url} alt="" className="max-h-[360px] rounded-md object-contain" />;
                          return (
                            <button onClick={() => generateImage(k, activeFormat)}
                              className="inline-flex items-center gap-2 px-3 h-9 rounded-md border text-sm hover:bg-accent">
                              <ImageIcon className="h-4 w-4" /> Gerar {FORMAT_META[activeFormat].label}
                            </button>
                          );
                        })()}
                      </div>
                      <div className="flex gap-2">
                        {images[`${k}-${activeFormat}`]?.url && (
                          <>
                            <button onClick={() => generateImage(k, activeFormat)} className="text-xs h-8 px-2 rounded border inline-flex items-center gap-1 hover:bg-accent">
                              <RefreshCw className="h-3.5 w-3.5" /> Regerar
                            </button>
                            <a href={images[`${k}-${activeFormat}`].url} download={`criativo-${k}-${activeFormat}.png`}
                              className="text-xs h-8 px-2 rounded border inline-flex items-center gap-1 hover:bg-accent">
                              <Download className="h-3.5 w-3.5" /> Baixar
                            </a>
                          </>
                        )}
                      </div>
                    </div>

                    {/* Textos */}
                    <div className="space-y-2">
                      <Editable label="Headline" value={v.headline} onChange={(val) => setVariants({ ...variants, [k]: { ...v, headline: val } })} />
                      <Editable label="Texto principal" value={v.primary_text} multiline onChange={(val) => setVariants({ ...variants, [k]: { ...v, primary_text: val } })} />
                      <Editable label="Descrição" value={v.description} onChange={(val) => setVariants({ ...variants, [k]: { ...v, description: val } })} />
                      <Editable label="CTA" value={v.cta} onChange={(val) => setVariants({ ...variants, [k]: { ...v, cta: val } })} />
                      <div className="text-xs text-muted-foreground p-2 rounded bg-muted/40">
                        <b>Público sugerido:</b> {variants.audience_suggestion}
                      </div>

                      {score && (
                        <div className="rounded-md border p-3 space-y-1.5 bg-card">
                          <div className="flex items-center gap-2">
                            <Award className="h-4 w-4 text-primary" />
                            <span className="font-semibold text-sm">Nota IA: {score.score}/100</span>
                            <span className="text-xs text-muted-foreground">· CTR {score.ctr_potential} · Conv. {score.conversion_potential}</span>
                          </div>
                          {!!score.strengths?.length && <div className="text-xs"><b>Pontos fortes:</b> {score.strengths.join(", ")}</div>}
                          {!!score.improvements?.length && <div className="text-xs"><b>Melhorias:</b> {score.improvements.join(", ")}</div>}
                        </div>
                      )}

                      <div className="flex flex-wrap gap-2 pt-1">
                        <button disabled={scoring} onClick={() => scoreVariant(k)} className="text-xs h-8 px-2.5 rounded border inline-flex items-center gap-1 hover:bg-accent disabled:opacity-60">
                          {scoring ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Eye className="h-3.5 w-3.5" />} Analisar Criativo
                        </button>
                        <button onClick={() => saveVariant(k)} className="text-xs h-8 px-2.5 rounded border inline-flex items-center gap-1 hover:bg-accent">
                          <Save className="h-3.5 w-3.5" /> Salvar
                        </button>
                        {onUseInCampaign && (
                          <button onClick={() => useNow(k)} className="text-xs h-8 px-2.5 rounded bg-primary text-primary-foreground inline-flex items-center gap-1 hover:bg-primary/90">
                            <ArrowRight className="h-3.5 w-3.5" /> Usar neste anúncio
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                </TabsContent>
              );
            })}
          </Tabs>
          <div className="flex justify-between pt-2 border-t">
            <button onClick={() => setStep("configure")} className="text-xs underline text-muted-foreground">Ajustar configuração</button>
            <button onClick={() => { setStep("upload"); setSourceImage(null); setSourcePath(null); setAnalysis(null); setVariants(null); setImages({}); setScores({ emotion: null, offer: null, urgency: null }); }}
              className="text-xs underline text-muted-foreground">Começar de novo</button>
          </div>
        </div>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div><label className="text-xs font-medium text-muted-foreground block mb-1">{label}</label>{children}</div>;
}

function Editable({ label, value, onChange, multiline }: { label: string; value: string; onChange: (v: string) => void; multiline?: boolean }) {
  return (
    <div>
      <label className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</label>
      {multiline ? (
        <textarea className="w-full min-h-[72px] rounded-md border bg-background px-2 py-1.5 text-sm" value={value} onChange={(e) => onChange(e.target.value)} />
      ) : (
        <input className="w-full h-9 rounded-md border bg-background px-2 text-sm" value={value} onChange={(e) => onChange(e.target.value)} />
      )}
    </div>
  );
}
