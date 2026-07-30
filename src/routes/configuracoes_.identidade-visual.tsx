// Tela de Identidade Visual — Brand Center Fase 2.
// Admin-only. Edita rascunho e publica atomically via RPC.
// Rota não aninhada (configuracoes_.identidade-visual).

import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState, useCallback, useRef } from "react";
import {
  Palette,
  Loader2,
  ShieldAlert,
  Save,
  Upload,
  CheckCircle2,
  AlertCircle,
} from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/auth/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import {
  getBrandEditorState,
  saveBrandDraft,
  publishBrandVersion,
  signBrandAssetUpload,
  registerBrandAsset,
} from "@/lib/brand-center/brand-editor.functions";
import {
  ALLOWED_LOGO_MIMES,
  ALLOWED_FONTS,
  MAX_LOGO_BYTES,
  type EditorAssetType,
} from "@/lib/brand-center/brand-editor.types";
import { DEFAULT_COLORS, DEFAULT_TOKENS, DEFAULT_TYPOGRAPHY } from "@/lib/brand-center/brand-defaults";
import type { BrandColors, BrandTokens, BrandTypography } from "@/lib/brand-center/brand.types";

export const Route = createFileRoute("/configuracoes_/identidade-visual")({
  component: BrandCenterPage,
});

const COLOR_FIELDS: Array<{ key: keyof BrandColors; label: string }> = [
  { key: "primary", label: "Primária" },
  { key: "secondary", label: "Secundária" },
  { key: "accent", label: "Destaque (CTA)" },
  { key: "background", label: "Fundo" },
  { key: "surface", label: "Superfície" },
  { key: "text", label: "Texto" },
  { key: "textInverse", label: "Texto inverso" },
];

const LOGO_POSITIONS: BrandTokens["logoPosition"][] = [
  "top-left","top-center","top-right",
  "bottom-left","bottom-center","bottom-right","center",
];

async function computeSha256(file: File): Promise<string> {
  const buf = await file.arrayBuffer();
  const hash = await crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function readImageDimensions(file: File): Promise<{ width: number | null; height: number | null }> {
  return new Promise((resolve) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      resolve({ width: img.naturalWidth, height: img.naturalHeight });
      URL.revokeObjectURL(url);
    };
    img.onerror = () => {
      resolve({ width: null, height: null });
      URL.revokeObjectURL(url);
    };
    img.src = url;
  });
}

function BrandCenterPage() {
  const { user, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const logoInputRef = useRef<HTMLInputElement>(null);

  const [name, setName] = useState("Identidade principal");
  const [description, setDescription] = useState("");
  const [visualStyle, setVisualStyle] = useState("");
  const [colors, setColors] = useState<BrandColors>(DEFAULT_COLORS);
  const [typography, setTypography] = useState<BrandTypography>(DEFAULT_TYPOGRAPHY);
  const [tokens, setTokens] = useState<BrandTokens>(DEFAULT_TOKENS);
  const [draftVersionId, setDraftVersionId] = useState<string | null>(null);
  const [publishedVersionNumber, setPublishedVersionNumber] = useState<number | null>(null);
  const [logoAsset, setLogoAsset] = useState<{
    storageBucket: string;
    storagePath: string;
    signedUrl: string | null;
  } | null>(null);

  useEffect(() => {
    if (authLoading) return;
    if (!user) { navigate({ to: "/login" }); return; }
  }, [user, authLoading, navigate]);

  const reload = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const state = await getBrandEditorState();
      setIsAdmin(state.isAdmin);
      if (!state.isAdmin) return;
      if (state.profile) {
        setName(state.profile.name);
        setDescription(state.profile.description ?? "");
        setVisualStyle(state.profile.visualStyle ?? "");
      }
      const source = state.draft ?? state.published;
      if (source) {
        setColors({ ...DEFAULT_COLORS, ...source.colors });
        setTypography({ ...DEFAULT_TYPOGRAPHY, ...source.typography });
        setTokens({ ...DEFAULT_TOKENS, ...source.tokens });
      }
      setDraftVersionId(state.draft?.id ?? null);
      setPublishedVersionNumber(state.published?.versionNumber ?? null);
      // Logo ativo
      const logo = state.assets.find((a) => a.type === "logo_primary");
      if (logo) {
        const { data } = await supabase.storage
          .from(logo.storageBucket)
          .createSignedUrl(logo.storagePath, 300);
        setLogoAsset({
          storageBucket: logo.storageBucket,
          storagePath: logo.storagePath,
          signedUrl: data?.signedUrl ?? null,
        });
      } else {
        setLogoAsset(null);
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Falha ao carregar identidade visual");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void reload(); }, [reload]);

  if (authLoading || isAdmin === null) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!isAdmin) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-3 p-6 text-center">
        <ShieldAlert className="h-10 w-10 text-muted-foreground" />
        <h1 className="text-base font-semibold">Acesso restrito</h1>
        <p className="text-sm text-muted-foreground max-w-sm">
          Apenas administradores podem editar a identidade visual.
        </p>
        <Link to="/configuracoes" className="text-sm text-primary hover:underline mt-2">
          ← Voltar para Configurações
        </Link>
      </div>
    );
  }

  const persistDraft = async (): Promise<string> => {
    const res = await saveBrandDraft({
      data: {
        name: name.trim(),
        description: description.trim() || null,
        visualStyle: visualStyle.trim() || null,
        colors, typography, tokens,
      },
    });
    setDraftVersionId(res.versionId);
    return res.versionId;
  };

  const handleSaveDraft = async () => {
    setBusy("save"); setErr(null); setOk(null);
    try {
      await persistDraft();
      setOk("Rascunho salvo.");
      toast.success("Rascunho salvo.");
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Falha ao salvar rascunho";
      console.error("[brand-center] saveBrandDraft error", e);
      setErr(msg);
      toast.error(msg);
    } finally { setBusy(null); }
  };

  const handlePublish = async () => {
    setBusy("publish"); setErr(null); setOk(null);
    try {
      // Auto-salva o rascunho com o estado atual do formulário antes de publicar.
      // Isso evita que o botão fique bloqueado por !draftVersionId e garante que
      // a versão publicada reflita exatamente o que está na tela.
      const versionId = await persistDraft();
      console.info("[brand-center] publishing versionId", versionId);
      const result = await publishBrandVersion({ data: { versionId } });
      console.info("[brand-center] publish result", result);
      setOk("Versão publicada com sucesso.");
      toast.success("Identidade visual publicada.");
      await reload();
    } catch (e) {
      const raw = e instanceof Error ? e.message : String(e);
      console.error("[brand-center] publishBrandVersion error", e);
      // Traduz erros conhecidos da RPC para mensagens claras.
      const friendly =
        raw.includes("brand_publish_forbidden") ? "Sem permissão para publicar (é necessário perfil de admin)."
        : raw.includes("brand_version_not_draft") ? "Esta versão já foi publicada. Edite e salve um novo rascunho."
        : raw.includes("brand_version_not_found") ? "Rascunho não encontrado. Recarregue a página."
        : raw.includes("brand_publish_no_company") ? "Sua sessão não está vinculada a uma empresa."
        : raw.includes("brand_version_cross_tenant") ? "Rascunho pertence a outra empresa."
        : raw.includes("Unauthorized") ? "Sessão expirada. Faça login novamente."
        : `Falha ao publicar: ${raw}`;
      setErr(friendly);
      toast.error(friendly);
    } finally { setBusy(null); }
  };

  const handleLogoFile = async (file: File) => {
    setErr(null); setOk(null);
    if (!ALLOWED_LOGO_MIMES.includes(file.type as (typeof ALLOWED_LOGO_MIMES)[number])) {
      setErr("Formato não suportado. Use PNG, JPG ou WebP.");
      return;
    }
    if (file.size > MAX_LOGO_BYTES) {
      setErr(`Arquivo excede ${(MAX_LOGO_BYTES / 1024 / 1024).toFixed(0)}MB.`);
      return;
    }
    setBusy("upload");
    try {
      const assetType: EditorAssetType = "logo_primary";
      const sign = await signBrandAssetUpload({
        data: {
          assetType,
          mimeType: file.type as (typeof ALLOWED_LOGO_MIMES)[number],
          sizeBytes: file.size,
          originalFilename: file.name,
        },
      });
      const upload = await supabase.storage
        .from(sign.bucket)
        .uploadToSignedUrl(sign.storagePath, sign.token, file, {
          contentType: file.type,
          upsert: false,
        });
      if (upload.error) throw new Error(`Falha no upload: ${upload.error.message}`);
      const [sha256, dims] = await Promise.all([
        computeSha256(file), readImageDimensions(file),
      ]);
      await registerBrandAsset({
        data: {
          assetType,
          storagePath: sign.storagePath,
          mimeType: file.type as (typeof ALLOWED_LOGO_MIMES)[number],
          sizeBytes: file.size,
          width: dims.width,
          height: dims.height,
          sha256,
          originalFilename: file.name,
        },
      });
      setOk("Logo atualizado.");
      await reload();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Falha ao enviar logo");
    } finally { setBusy(null); }
  };

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-10 border-b border-border bg-background/95 backdrop-blur px-4 md:px-6 py-3 flex items-center gap-3">
        <Link to="/configuracoes" className="text-muted-foreground hover:text-foreground">←</Link>
        <Palette className="h-4 w-4 text-primary" />
        <div>
          <h1 className="text-sm font-semibold">Identidade Visual</h1>
          <p className="text-[11px] text-muted-foreground">
            {publishedVersionNumber ? `Publicada: v${publishedVersionNumber}` : "Nenhuma versão publicada ainda"}
            {draftVersionId ? " · Rascunho ativo" : ""}
          </p>
        </div>
      </header>

      <div className="p-4 md:p-6 max-w-5xl grid gap-6 lg:grid-cols-[1fr_320px]">
        <div className="space-y-6">
          {err && (
            <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-xs text-destructive">
              <AlertCircle className="h-4 w-4 mt-0.5" /> <span>{err}</span>
            </div>
          )}
          {ok && (
            <div className="flex items-start gap-2 rounded-md border border-emerald-500/30 bg-emerald-500/5 p-3 text-xs text-emerald-700 dark:text-emerald-400">
              <CheckCircle2 className="h-4 w-4 mt-0.5" /> <span>{ok}</span>
            </div>
          )}

          <Section title="Identidade">
            <Field label="Nome">
              <input value={name} onChange={(e) => setName(e.target.value)} maxLength={120}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm" />
            </Field>
            <Field label="Estilo visual (opcional)">
              <input value={visualStyle} onChange={(e) => setVisualStyle(e.target.value)} maxLength={60}
                placeholder="ex.: moderno, elegante, minimalista"
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm" />
            </Field>
            <Field label="Descrição (opcional)">
              <textarea value={description} onChange={(e) => setDescription(e.target.value)} maxLength={500} rows={2}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm" />
            </Field>
          </Section>

          <Section title="Logo">
            <div className="flex items-center gap-4">
              <div className="h-20 w-20 rounded-md border border-border bg-muted grid place-items-center overflow-hidden">
                {logoAsset?.signedUrl ? (
                  <img src={logoAsset.signedUrl} alt="Logo" className="h-full w-full object-contain" />
                ) : (
                  <span className="text-[10px] text-muted-foreground">sem logo</span>
                )}
              </div>
              <div className="flex-1">
                <input
                  ref={logoInputRef}
                  type="file"
                  accept={ALLOWED_LOGO_MIMES.join(",")}
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) void handleLogoFile(f);
                    e.target.value = "";
                  }}
                />
                <button type="button" disabled={busy === "upload"}
                  onClick={() => logoInputRef.current?.click()}
                  className={cn("inline-flex items-center gap-2 rounded-md border border-border bg-card px-3 py-2 text-xs hover:bg-accent", busy === "upload" && "opacity-50")}>
                  {busy === "upload" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
                  {logoAsset ? "Substituir logo" : "Enviar logo"}
                </button>
                <p className="mt-2 text-[11px] text-muted-foreground">
                  PNG, JPG ou WebP · até {(MAX_LOGO_BYTES / 1024 / 1024).toFixed(0)}MB. SVG não permitido nesta fase.
                </p>
              </div>
            </div>
          </Section>

          <Section title="Cores">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {COLOR_FIELDS.map(({ key, label }) => (
                <div key={key} className="flex items-center gap-3">
                  <input type="color" value={colors[key]}
                    onChange={(e) => setColors({ ...colors, [key]: e.target.value.toUpperCase() })}
                    className="h-9 w-12 rounded border border-input bg-background" />
                  <div className="flex-1">
                    <div className="text-xs font-medium">{label}</div>
                    <input value={colors[key]}
                      onChange={(e) => setColors({ ...colors, [key]: e.target.value })}
                      className="w-full rounded-md border border-input bg-background px-2 py-1 text-xs font-mono" />
                  </div>
                </div>
              ))}
            </div>
          </Section>

          <Section title="Tipografia">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              {(["heading", "body", "display"] as const).map((role) => (
                <Field key={role} label={role === "heading" ? "Títulos" : role === "body" ? "Corpo" : "Display"}>
                  <select value={typography[role]}
                    onChange={(e) => setTypography({ ...typography, [role]: e.target.value as (typeof ALLOWED_FONTS)[number] })}
                    className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm">
                    {ALLOWED_FONTS.map((f) => <option key={f} value={f}>{f}</option>)}
                  </select>
                </Field>
              ))}
            </div>
          </Section>

          <Section title="Tokens">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <SliderField label="Raio (px)" min={0} max={32} step={1}
                value={tokens.radius} onChange={(v) => setTokens({ ...tokens, radius: v })} />
              <SliderField label="Intensidade de sombra" min={0} max={1} step={0.05}
                value={tokens.shadowIntensity} onChange={(v) => setTokens({ ...tokens, shadowIntensity: v })} />
              <SliderField label="Espaçamento base" min={4} max={16} step={1}
                value={tokens.spacingBase} onChange={(v) => setTokens({ ...tokens, spacingBase: v })} />
              <SliderField label="Opacidade de overlay" min={0} max={1} step={0.05}
                value={tokens.overlayOpacity} onChange={(v) => setTokens({ ...tokens, overlayOpacity: v })} />
              <SliderField label="Margem segura do logo" min={0} max={128} step={4}
                value={tokens.logoSafeMargin} onChange={(v) => setTokens({ ...tokens, logoSafeMargin: v })} />
              <Field label="Posição do logo">
                <select value={tokens.logoPosition}
                  onChange={(e) => setTokens({ ...tokens, logoPosition: e.target.value as BrandTokens["logoPosition"] })}
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm">
                  {LOGO_POSITIONS.map((p) => <option key={p} value={p}>{p}</option>)}
                </select>
              </Field>
              <Field label="Estilo de imagem">
                <select value={tokens.imageStyle}
                  onChange={(e) => setTokens({ ...tokens, imageStyle: e.target.value as BrandTokens["imageStyle"] })}
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm">
                  {(["photographic","illustrated","minimal","mixed"] as const).map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              </Field>
              <Field label="Estilo de gradiente">
                <select value={tokens.gradientStyle}
                  onChange={(e) => setTokens({ ...tokens, gradientStyle: e.target.value as BrandTokens["gradientStyle"] })}
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm">
                  {(["none","subtle","vibrant"] as const).map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              </Field>
            </div>
          </Section>

          <div className="flex items-center gap-3 pt-2">
            <button type="button" onClick={handleSaveDraft} disabled={busy !== null || loading}
              className={cn("inline-flex items-center gap-2 rounded-md bg-secondary text-secondary-foreground px-4 py-2 text-sm hover:opacity-90", (busy !== null || loading) && "opacity-50")}>
              {busy === "save" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              Salvar rascunho
            </button>
            <button type="button" onClick={handlePublish} disabled={busy !== null || loading}
              className={cn("inline-flex items-center gap-2 rounded-md bg-primary text-primary-foreground px-4 py-2 text-sm hover:opacity-90", (busy !== null || loading) && "opacity-50")}>
              {busy === "publish" ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
              Publicar versão
            </button>
          </div>
        </div>

        <aside className="space-y-3">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Preview</h2>
          <div className="rounded-lg border border-border overflow-hidden"
               style={{ background: colors.background, color: colors.text, borderRadius: tokens.radius }}>
            <div className="p-4 space-y-3" style={{ fontFamily: typography.body }}>
              {logoAsset?.signedUrl && (
                <img src={logoAsset.signedUrl} alt="Logo" className="h-10 object-contain" />
              )}
              <div style={{ fontFamily: typography.heading, color: colors.text, fontWeight: 700, fontSize: 20 }}>
                Título da marca
              </div>
              <div style={{ fontSize: 13, opacity: 0.85 }}>
                Exemplo de conteúdo com a tipografia e cores atuais.
              </div>
              <button className="text-xs font-semibold px-3 py-2"
                style={{ background: colors.accent, color: colors.textInverse, borderRadius: tokens.radius }}>
                Chamada para ação
              </button>
              <div className="mt-2 grid grid-cols-7 gap-1">
                {COLOR_FIELDS.map(({ key }) => (
                  <div key={key} className="h-6 rounded" style={{ background: colors[key] }} title={key} />
                ))}
              </div>
            </div>
          </div>
          <p className="text-[11px] text-muted-foreground">
            Preview administrativo. A publicação ativa a nova versão e arquiva a anterior.
          </p>
        </aside>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-lg border border-border bg-card p-4 space-y-4">
      <h2 className="text-sm font-semibold">{title}</h2>
      {children}
    </section>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}

function SliderField({
  label, min, max, step, value, onChange,
}: { label: string; min: number; max: number; step: number; value: number; onChange: (v: number) => void }) {
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-xs">
        <span className="font-medium text-muted-foreground">{label}</span>
        <span className="font-mono text-foreground">{value}</span>
      </div>
      <input type="range" min={min} max={max} step={step} value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full accent-primary" />
    </div>
  );
}
