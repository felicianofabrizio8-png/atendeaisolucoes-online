import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import {
  Sparkles,
  MessageCircle,
  Check,
  ArrowRight,
  ArrowLeft,
  Phone,
  Send,
  ShieldCheck,
  Loader2,
  Instagram,
  Facebook,
  AlertTriangle,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/onboarding/whatsapp")({
  head: () => ({
    meta: [
      { title: "Conectar WhatsApp — Assistente guiado" },
      {
        name: "description",
        content:
          "Conecte o WhatsApp Business API oficial da Meta em poucos passos.",
      },
    ],
  }),
  component: OnboardingWhatsApp,
});

type StepId = "welcome" | "connect" | "choose" | "test";

const STEPS: { id: StepId; title: string; subtitle: string }[] = [
  { id: "welcome", title: "Bem-vindo", subtitle: "Vamos conectar seu WhatsApp" },
  { id: "connect", title: "Conectar com Meta", subtitle: "Autorize o acesso oficial" },
  { id: "choose", title: "Escolher número", subtitle: "Selecione a linha WhatsApp" },
  { id: "test", title: "Teste de envio", subtitle: "Confirme que está funcionando" },
];

// REUSO do mesmo redirect_uri já cadastrado no app Meta (não trocar).
const REDIRECT_URI =
  "https://atendei-ai-concierge.lovable.app/auth/meta/callback";

const REQUIRED_SCOPES = [
  "public_profile",
  "email",
  "pages_show_list",
  "pages_read_engagement",
  "pages_manage_metadata",
  "business_management",
  "instagram_basic",
  "whatsapp_business_management",
  "whatsapp_business_messaging",
].join(",");

const GRAPH = "https://graph.facebook.com/v25.0";

/* ---------------- Types ---------------- */

type FacebookPage = {
  id: string;
  name: string;
  ig_business_account_id: string | null;
  ig_username: string | null;
};

type WhatsAppPhone = {
  id: string;
  display_phone_number: string;
  verified_name: string | null;
  quality_rating: string | null;
  waba_id: string;
  waba_name: string;
};

type DiscoveredAssets = {
  meName: string | null;
  pages: FacebookPage[];
  phones: WhatsAppPhone[];
  wabaCount: number;
};

/* ---------------- Component ---------------- */

type SavedInfo = {
  display_name: string;
  phone_number: string | null;
  waba_id: string;
  page_name: string | null;
  page_id: string | null;
};

function OnboardingWhatsApp() {
  const [stepIndex, setStepIndex] = useState(0);
  const [selectedPhoneId, setSelectedPhoneId] = useState<string | null>(null);

  const [connecting, setConnecting] = useState(false);
  const [loadingAssets, setLoadingAssets] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [assets, setAssets] = useState<DiscoveredAssets | null>(null);
  // Token mantido apenas em memória — não persistir em localStorage/sessionStorage.
  const [userToken, setUserToken] = useState<string | null>(null);

  const [saving, setSaving] = useState(false);
  const [savedInfo, setSavedInfo] = useState<SavedInfo | null>(null);

  const step = STEPS[stepIndex];
  const isLast = stepIndex === STEPS.length - 1;
  const isFirst = stepIndex === 0;
  const connected = !!assets;

  const canAdvance =
    step.id === "welcome" ||
    (step.id === "connect" && connected) ||
    (step.id === "choose" && !!selectedPhoneId && !saving) ||
    step.id === "test";

  /* ---------- Graph API discovery ---------- */

  const discoverAssets = useCallback(async (userTokenArg: string) => {
    setLoadingAssets(true);
    setErrorMsg(null);
    setUserToken(userTokenArg);
    const tok = encodeURIComponent(userTokenArg);

    try {
      // /me
      let meName: string | null = null;
      try {
        const meRes = await fetch(`${GRAPH}/me?fields=id,name&access_token=${tok}`);
        const meJson = (await meRes.json()) as { name?: string };
        meName = meJson?.name ?? null;
      } catch (e) {
        console.warn("META_ONBOARDING_ME_FAIL", e);
      }

      // /me/accounts → páginas FB + IG vinculado
      const pages: FacebookPage[] = [];
      try {
        const accountsRes = await fetch(
          `${GRAPH}/me/accounts?fields=id,name,instagram_business_account{id,username}&limit=100&access_token=${tok}`,
        );
        const accountsJson = (await accountsRes.json()) as {
          data?: Array<{
            id: string;
            name: string;
            instagram_business_account?: { id?: string; username?: string };
          }>;
          error?: { message?: string };
        };
        if (accountsJson.error) {
          throw new Error(accountsJson.error.message ?? "Erro Graph /me/accounts");
        }
        for (const p of accountsJson.data ?? []) {
          pages.push({
            id: p.id,
            name: p.name,
            ig_business_account_id: p.instagram_business_account?.id ?? null,
            ig_username: p.instagram_business_account?.username ?? null,
          });
        }
        console.log("META_PAGES_FOUND", {
          count: pages.length,
          pages: pages.map((p) => ({
            id: p.id,
            name: p.name,
            ig: p.ig_username,
          })),
        });
      } catch (e) {
        console.warn("META_ONBOARDING_PAGES_FAIL", e);
      }

      // /me/businesses → WABAs + phone numbers
      const phones: WhatsAppPhone[] = [];
      let wabaCount = 0;
      try {
        const bizRes = await fetch(
          `${GRAPH}/me/businesses?fields=id,name,owned_whatsapp_business_accounts{id,name,phone_numbers{id,display_phone_number,verified_name,quality_rating}}&limit=100&access_token=${tok}`,
        );
        const bizJson = (await bizRes.json()) as {
          data?: Array<{
            id: string;
            name: string;
            owned_whatsapp_business_accounts?: {
              data?: Array<{
                id: string;
                name: string;
                phone_numbers?: {
                  data?: Array<{
                    id: string;
                    display_phone_number: string;
                    verified_name?: string;
                    quality_rating?: string;
                  }>;
                };
              }>;
            };
          }>;
          error?: { message?: string };
        };
        if (bizJson.error) {
          throw new Error(bizJson.error.message ?? "Erro Graph /me/businesses");
        }
        const wabaList: { id: string; name: string }[] = [];
        for (const biz of bizJson.data ?? []) {
          for (const waba of biz.owned_whatsapp_business_accounts?.data ?? []) {
            wabaList.push({ id: waba.id, name: waba.name });
            for (const ph of waba.phone_numbers?.data ?? []) {
              phones.push({
                id: ph.id,
                display_phone_number: ph.display_phone_number,
                verified_name: ph.verified_name ?? null,
                quality_rating: ph.quality_rating ?? null,
                waba_id: waba.id,
                waba_name: waba.name,
              });
            }
          }
        }
        wabaCount = wabaList.length;
        console.log("META_WABA_FOUND", { count: wabaCount, wabas: wabaList });
        console.log("META_PHONE_NUMBERS_FOUND", {
          count: phones.length,
          phones: phones.map((p) => ({
            id: p.id,
            number: p.display_phone_number,
            verified_name: p.verified_name,
            waba: p.waba_name,
          })),
        });
      } catch (e) {
        console.warn("META_ONBOARDING_WABA_FAIL", e);
      }

      setAssets({ meName, pages, phones, wabaCount });

      if (phones.length === 0 && pages.length === 0) {
        setErrorMsg(
          "Login concluído, mas não encontramos páginas ou números WhatsApp Business na sua conta Meta. Verifique se você tem permissões de administrador.",
        );
      }
    } catch (e) {
      console.error("META_ONBOARDING_ERROR", e);
      setErrorMsg(
        e instanceof Error ? e.message : "Falha ao ler dados Meta",
      );
    } finally {
      setLoadingAssets(false);
    }
  }, []);

  /* ---------- OAuth flow (reuso de /auth/meta/callback + meta-connect) ---------- */

  const exchangeCodeForToken = useCallback(
    async (code: string) => {
      try {
        const { data, error } = await supabase.functions.invoke("meta-connect", {
          body: {
            mode: "exchange_code",
            code,
            redirectUri: REDIRECT_URI,
          },
        });
        if (error) throw error;
        const res = data as { ok?: boolean; access_token?: string; error?: string };
        if (!res?.access_token) {
          throw new Error(res?.error ?? "Resposta sem access_token");
        }
        await discoverAssets(res.access_token);
      } catch (e) {
        console.error("META_ONBOARDING_ERROR", e);
        setErrorMsg(
          e instanceof Error ? e.message : "Falha ao trocar código Meta",
        );
      } finally {
        setConnecting(false);
      }
    },
    [discoverAssets],
  );

  // Listener postMessage da popup OAuth.
  useEffect(() => {
    if (typeof window === "undefined") return;

    const onMessage = (ev: MessageEvent) => {
      if (ev.origin !== window.location.origin) return;
      const data = ev.data as {
        type?: string;
        code?: string;
        access_token?: string;
        error?: string;
      } | null;
      if (!data || data.type !== "META_OAUTH_RESULT") return;
      if (data.error) {
        setConnecting(false);
        setErrorMsg(data.error);
        return;
      }
      if (data.code) {
        void exchangeCodeForToken(data.code);
      } else if (data.access_token) {
        void discoverAssets(data.access_token).finally(() => setConnecting(false));
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [exchangeCodeForToken, discoverAssets]);

  const handleConnect = async () => {
    setErrorMsg(null);
    setAssets(null);
    setConnecting(true);
    console.log("META_ONBOARDING_START", { scopes: REQUIRED_SCOPES });

    try {
      const res = await fetch("/api/meta/config");
      const cfg = (await res.json()) as { appId?: string; hasAppId?: boolean };
      if (!cfg.hasAppId || !cfg.appId) {
        throw new Error(
          "META_APP_ID não configurado. Avise o administrador.",
        );
      }

      const state = crypto.randomUUID();
      window.sessionStorage.setItem("META_OAUTH_STATE", state);

      const oauthUrl =
        `https://www.facebook.com/v21.0/dialog/oauth` +
        `?app_id=${encodeURIComponent(cfg.appId)}` +
        `&redirect_uri=${encodeURIComponent(REDIRECT_URI)}` +
        `&response_type=code` +
        `&state=${encodeURIComponent(state)}` +
        `&scope=${encodeURIComponent(REQUIRED_SCOPES)}`;

      const width = 600;
      const height = 720;
      const left = window.screenX + Math.max(0, (window.outerWidth - width) / 2);
      const top = window.screenY + Math.max(0, (window.outerHeight - height) / 2);
      const popup = window.open(
        oauthUrl,
        "meta-oauth",
        `width=${width},height=${height},left=${left},top=${top},resizable=yes,scrollbars=yes`,
      );
      if (!popup) {
        window.open(oauthUrl, "_blank", "noopener,noreferrer");
      }
    } catch (e) {
      console.error("META_ONBOARDING_ERROR", e);
      setErrorMsg(e instanceof Error ? e.message : "Falha ao iniciar login Meta");
      setConnecting(false);
    }
  };

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b border-border/60 bg-card/40 backdrop-blur-sm">
        <div className="mx-auto max-w-3xl px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="h-7 w-7 rounded-md bg-primary/10 text-primary inline-flex items-center justify-center">
              <Sparkles className="h-4 w-4" />
            </div>
            <span className="text-sm font-semibold">Assistente guiado</span>
          </div>
          <Link
            to="/configuracoes"
            className="text-xs text-muted-foreground hover:text-foreground transition"
          >
            Sair do assistente
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-6 py-10">
        {/* Stepper */}
        <ol className="flex items-center gap-2 mb-8">
          {STEPS.map((s, i) => {
            const done = i < stepIndex;
            const current = i === stepIndex;
            return (
              <li key={s.id} className="flex items-center gap-2 flex-1">
                <div
                  className={cn(
                    "h-7 w-7 rounded-full inline-flex items-center justify-center text-[11px] font-semibold border transition-colors",
                    done && "bg-primary text-primary-foreground border-primary",
                    current && "bg-primary/10 text-primary border-primary",
                    !done && !current &&
                      "bg-muted text-muted-foreground border-border",
                  )}
                >
                  {done ? <Check className="h-3.5 w-3.5" /> : i + 1}
                </div>
                <div className="hidden sm:block min-w-0">
                  <div
                    className={cn(
                      "text-[11px] font-medium truncate",
                      current ? "text-foreground" : "text-muted-foreground",
                    )}
                  >
                    {s.title}
                  </div>
                </div>
                {i < STEPS.length - 1 && (
                  <div
                    className={cn(
                      "h-px flex-1 mx-1",
                      done ? "bg-primary" : "bg-border",
                    )}
                  />
                )}
              </li>
            );
          })}
        </ol>

        <section className="rounded-2xl border border-border bg-card shadow-sm">
          <div className="px-6 pt-6 pb-2">
            <h1 className="text-lg font-semibold">{step.title}</h1>
            <p className="text-sm text-muted-foreground">{step.subtitle}</p>
          </div>

          <div className="px-6 py-6">
            {errorMsg && (
              <div className="mb-4 flex items-start gap-2 rounded-md border border-[var(--status-urgent)]/30 bg-[var(--status-urgent)]/10 text-[var(--status-urgent)] text-xs px-3 py-2">
                <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                <span>{errorMsg}</span>
              </div>
            )}

            {step.id === "welcome" && <StepWelcome />}
            {step.id === "connect" && (
              <StepConnect
                connecting={connecting}
                loadingAssets={loadingAssets}
                assets={assets}
                onConnect={handleConnect}
              />
            )}
            {step.id === "choose" && (
              <StepChoose
                assets={assets}
                selected={selectedPhoneId}
                onSelect={(id) => {
                  console.log("[onboarding] selected phone (mock save)", id);
                  setSelectedPhoneId(id);
                }}
              />
            )}
            {step.id === "test" && (
              <StepTest
                phone={testPhone}
                onChange={setTestPhone}
                onSend={() =>
                  console.log("[onboarding] enviar teste (mock)", {
                    testPhone,
                    phoneNumberId: selectedPhoneId,
                  })
                }
              />
            )}
          </div>

          {/* Footer nav */}
          <div className="px-6 py-4 border-t border-border flex items-center justify-between">
            <button
              type="button"
              onClick={() => setStepIndex((i) => Math.max(0, i - 1))}
              disabled={isFirst}
              className={cn(
                "inline-flex items-center gap-1.5 text-xs font-medium rounded-md px-3 py-2 transition",
                isFirst
                  ? "text-muted-foreground/50 cursor-not-allowed"
                  : "text-muted-foreground hover:text-foreground hover:bg-muted",
              )}
            >
              <ArrowLeft className="h-3.5 w-3.5" /> Voltar
            </button>

            {isLast ? (
              <button
                type="button"
                onClick={() => console.log("[onboarding] concluir (mock)")}
                className="inline-flex items-center gap-1.5 text-xs font-semibold rounded-md bg-primary text-primary-foreground px-4 py-2 hover:opacity-90 transition"
              >
                Concluir <Check className="h-3.5 w-3.5" />
              </button>
            ) : (
              <button
                type="button"
                disabled={!canAdvance}
                onClick={() => setStepIndex((i) => Math.min(STEPS.length - 1, i + 1))}
                className={cn(
                  "inline-flex items-center gap-1.5 text-xs font-semibold rounded-md px-4 py-2 transition",
                  canAdvance
                    ? "bg-primary text-primary-foreground hover:opacity-90"
                    : "bg-muted text-muted-foreground cursor-not-allowed",
                )}
              >
                Continuar <ArrowRight className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        </section>

        <p className="mt-6 text-center text-[11px] text-muted-foreground">
          Nada é salvo nesta etapa — estamos apenas detectando seus ativos Meta.
        </p>
      </main>
    </div>
  );
}

/* ---------------- Steps ---------------- */

function StepWelcome() {
  return (
    <div className="space-y-5">
      <div className="rounded-xl bg-gradient-to-br from-primary/10 to-transparent border border-primary/20 p-5">
        <div className="flex items-start gap-3">
          <div className="h-10 w-10 rounded-lg bg-primary/15 text-primary inline-flex items-center justify-center shrink-0">
            <MessageCircle className="h-5 w-5" />
          </div>
          <div>
            <h2 className="text-sm font-semibold mb-1">
              Conecte o WhatsApp oficial da Meta
            </h2>
            <p className="text-xs text-muted-foreground leading-relaxed">
              Em poucos passos vamos detectar suas páginas Facebook, contas
              Instagram Business e números WhatsApp Business disponíveis.
            </p>
          </div>
        </div>
      </div>
      <ul className="grid sm:grid-cols-3 gap-3">
        <Feature icon={<ShieldCheck className="h-4 w-4" />} title="Oficial e seguro" desc="Login direto na Meta." />
        <Feature icon={<MessageCircle className="h-4 w-4" />} title="Detecção automática" desc="Lemos seus ativos." />
        <Feature icon={<Sparkles className="h-4 w-4" />} title="Sem salvar nada" desc="Apenas pré-visualização." />
      </ul>
    </div>
  );
}

function Feature({ icon, title, desc }: { icon: React.ReactNode; title: string; desc: string }) {
  return (
    <li className="rounded-lg border border-border bg-background p-3">
      <div className="h-7 w-7 rounded-md bg-muted text-foreground inline-flex items-center justify-center mb-2">
        {icon}
      </div>
      <div className="text-xs font-semibold">{title}</div>
      <div className="text-[11px] text-muted-foreground">{desc}</div>
    </li>
  );
}

function StepConnect({
  connecting,
  loadingAssets,
  assets,
  onConnect,
}: {
  connecting: boolean;
  loadingAssets: boolean;
  assets: DiscoveredAssets | null;
  onConnect: () => void;
}) {
  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-border bg-background p-5 text-center">
        <div className="mx-auto h-12 w-12 rounded-full bg-[#1877F2]/10 text-[#1877F2] inline-flex items-center justify-center mb-3">
          <MessageCircle className="h-6 w-6" />
        </div>
        <h3 className="text-sm font-semibold mb-1">Login com a Meta</h3>
        <p className="text-xs text-muted-foreground mb-4 max-w-sm mx-auto">
          Você será direcionado para autorizar nossa aplicação no Facebook
          Business. Tenha em mãos o acesso de administrador.
        </p>

        {assets ? (
          <div className="inline-flex items-center gap-1.5 text-xs font-semibold rounded-md bg-[var(--status-ok)]/10 text-[var(--status-ok)] px-3 py-2">
            <Check className="h-3.5 w-3.5" />
            {assets.meName ? `Conectado como ${assets.meName}` : "Conta Meta conectada"}
          </div>
        ) : (
          <button
            type="button"
            onClick={onConnect}
            disabled={connecting || loadingAssets}
            className="inline-flex items-center gap-2 text-xs font-semibold rounded-md bg-[#1877F2] text-white px-4 py-2.5 hover:opacity-90 transition disabled:opacity-60"
          >
            {connecting || loadingAssets ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                {loadingAssets ? "Lendo ativos Meta…" : "Aguardando login…"}
              </>
            ) : (
              <>Continuar com Meta</>
            )}
          </button>
        )}
      </div>

      {assets && (
        <div className="grid sm:grid-cols-3 gap-3">
          <SummaryCard
            icon={<Facebook className="h-3.5 w-3.5" />}
            label="Páginas Facebook"
            value={assets.pages.length}
          />
          <SummaryCard
            icon={<Instagram className="h-3.5 w-3.5" />}
            label="Instagram Business"
            value={assets.pages.filter((p) => p.ig_business_account_id).length}
          />
          <SummaryCard
            icon={<Phone className="h-3.5 w-3.5" />}
            label="Números WhatsApp"
            value={assets.phones.length}
            hint={assets.wabaCount ? `${assets.wabaCount} WABA(s)` : undefined}
          />
        </div>
      )}

      <p className="text-[11px] text-muted-foreground text-center">
        Não compartilhamos sua senha. A autorização acontece direto com a Meta.
      </p>
    </div>
  );
}

function SummaryCard({
  icon,
  label,
  value,
  hint,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
  hint?: string;
}) {
  return (
    <div className="rounded-lg border border-border bg-background p-3">
      <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground mb-1">
        {icon} {label}
      </div>
      <div className="text-xl font-semibold">{value}</div>
      {hint && <div className="text-[10px] text-muted-foreground">{hint}</div>}
    </div>
  );
}

function StepChoose({
  assets,
  selected,
  onSelect,
}: {
  assets: DiscoveredAssets | null;
  selected: string | null;
  onSelect: (id: string) => void;
}) {
  if (!assets) {
    return (
      <p className="text-xs text-muted-foreground">
        Volte ao passo anterior e conecte sua conta Meta primeiro.
      </p>
    );
  }

  if (assets.phones.length === 0) {
    return (
      <div className="space-y-3">
        <p className="text-xs text-muted-foreground">
          Nenhum número WhatsApp Business foi encontrado na sua conta Meta.
          Confira se você tem uma WABA (WhatsApp Business Account) com número
          associado e se concedeu as permissões{" "}
          <code>whatsapp_business_management</code> e{" "}
          <code>whatsapp_business_messaging</code>.
        </p>
        {assets.pages.length > 0 && (
          <div className="rounded-lg border border-border bg-background p-3">
            <div className="text-[11px] font-semibold mb-2 text-muted-foreground">
              Páginas Facebook detectadas
            </div>
            <ul className="space-y-1">
              {assets.pages.map((p) => (
                <li key={p.id} className="text-xs flex items-center gap-2">
                  <Facebook className="h-3 w-3 text-[#1877F2]" />
                  {p.name}
                  {p.ig_username && (
                    <span className="text-[10px] text-muted-foreground">
                      · IG @{p.ig_username}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        Encontramos os números abaixo na sua conta Meta. Selecione qual será
        usado neste app.
      </p>
      <ul className="space-y-2">
        {assets.phones.map((n) => {
          const isSelected = selected === n.id;
          return (
            <li key={n.id}>
              <button
                type="button"
                onClick={() => onSelect(n.id)}
                className={cn(
                  "w-full text-left rounded-lg border p-3 flex items-center gap-3 transition",
                  isSelected
                    ? "border-primary bg-primary/5"
                    : "border-border bg-background hover:border-foreground/20",
                )}
              >
                <div
                  className={cn(
                    "h-9 w-9 rounded-md inline-flex items-center justify-center",
                    isSelected
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted text-foreground",
                  )}
                >
                  <Phone className="h-4 w-4" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium truncate">
                    {n.verified_name ?? n.display_phone_number}
                  </div>
                  <div className="text-[11px] text-muted-foreground truncate">
                    {n.display_phone_number} · WABA {n.waba_name}
                  </div>
                </div>
                {n.quality_rating && (
                  <span className="text-[10px] font-semibold uppercase tracking-wide rounded bg-[var(--status-ok)]/10 text-[var(--status-ok)] px-1.5 py-0.5">
                    {n.quality_rating}
                  </span>
                )}
                <div
                  className={cn(
                    "h-4 w-4 rounded-full border inline-flex items-center justify-center",
                    isSelected
                      ? "bg-primary border-primary text-primary-foreground"
                      : "border-border",
                  )}
                >
                  {isSelected && <Check className="h-3 w-3" />}
                </div>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function StepTest({
  phone,
  onChange,
  onSend,
}: {
  phone: string;
  onChange: (v: string) => void;
  onSend: () => void;
}) {
  return (
    <div className="space-y-4">
      <p className="text-xs text-muted-foreground">
        Esta etapa ainda é uma pré-visualização — nenhuma mensagem real será
        enviada nesta fase do onboarding.
      </p>

      <div className="rounded-xl border border-border bg-background p-4 space-y-3">
        <label className="block">
          <span className="text-[11px] font-medium text-muted-foreground">
            Número de destino
          </span>
          <input
            type="tel"
            placeholder="+55 11 90000-0000"
            value={phone}
            onChange={(e) => onChange(e.target.value)}
            className="mt-1 w-full rounded-md border border-border bg-card px-3 py-2 text-sm outline-none focus:border-primary"
          />
        </label>

        <div className="rounded-md bg-muted/50 border border-dashed border-border p-3">
          <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">
            Pré-visualização
          </div>
          <div className="text-xs leading-relaxed">
            Olá! 👋 Esta é uma mensagem de teste enviada pelo seu novo WhatsApp
            conectado. Se você recebeu, está tudo certo!
          </div>
        </div>

        <button
          type="button"
          onClick={onSend}
          disabled={!phone.trim()}
          className="inline-flex items-center gap-1.5 text-xs font-semibold rounded-md bg-primary text-primary-foreground px-3 py-2 hover:opacity-90 transition disabled:opacity-50"
        >
          <Send className="h-3.5 w-3.5" /> Enviar teste
        </button>
      </div>
    </div>
  );
}
