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
  RefreshCw,
  Bot,
  BadgeCheck,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { OnboardingChecklist } from "@/components/OnboardingChecklist";


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
  "https://app.atendeaisolucoes.online/auth/meta/callback";

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
  integration_id: string;
  display_name: string;
  phone_number: string | null;
  waba_id: string;
  page_name: string | null;
  page_id: string | null;
};

function OnboardingWhatsApp() {
  const [stepIndex, setStepIndex] = useState(0);
  const [selectedPhoneId, setSelectedPhoneId] = useState<string | null>(null);
  const [selectedPageId, setSelectedPageId] = useState<string | null>(null);

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

  // Página é obrigatória apenas se a conta Meta tiver páginas disponíveis.
  const pageSelectionOk =
    !assets || assets.pages.length === 0 || !!selectedPageId;

  const canAdvance =
    step.id === "welcome" ||
    (step.id === "connect" && connected) ||
    (step.id === "choose" && !!selectedPhoneId && pageSelectionOk && !saving) ||
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
        // Inclui owned_* (Direct) e client_* (Embedded Signup / Tech Provider).
        const bizRes = await fetch(
          `${GRAPH}/me/businesses?fields=id,name,` +
            `owned_whatsapp_business_accounts{id,name,phone_numbers{id,display_phone_number,verified_name,quality_rating}},` +
            `client_whatsapp_business_accounts{id,name,phone_numbers{id,display_phone_number,verified_name,quality_rating}}` +
            `&limit=100&access_token=${tok}`,
        );
        type WabaNode = {
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
        };
        const bizJson = (await bizRes.json()) as {
          data?: Array<{
            id: string;
            name: string;
            owned_whatsapp_business_accounts?: { data?: WabaNode[] };
            client_whatsapp_business_accounts?: { data?: WabaNode[] };
          }>;
          error?: { message?: string };
        };
        if (bizJson.error) {
          throw new Error(bizJson.error.message ?? "Erro Graph /me/businesses");
        }
        const wabaList: { id: string; name: string; source: "owned" | "client" }[] = [];
        const seenWaba = new Set<string>();
        const seenPhone = new Set<string>();
        for (const biz of bizJson.data ?? []) {
          const buckets: Array<{ src: "owned" | "client"; data?: WabaNode[] }> = [
            { src: "owned", data: biz.owned_whatsapp_business_accounts?.data },
            { src: "client", data: biz.client_whatsapp_business_accounts?.data },
          ];
          for (const bucket of buckets) {
            for (const waba of bucket.data ?? []) {
              if (seenWaba.has(waba.id)) continue;
              seenWaba.add(waba.id);
              wabaList.push({ id: waba.id, name: waba.name, source: bucket.src });
              for (const ph of waba.phone_numbers?.data ?? []) {
                if (seenPhone.has(ph.id)) continue;
                seenPhone.add(ph.id);
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
        }
        console.log("META_DISCOVERY_CLIENT_WABAS", {
          total: wabaList.length,
          owned: wabaList.filter((w) => w.source === "owned").length,
          client: wabaList.filter((w) => w.source === "client").length,
        });
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

      // Log explícito das páginas/IG/WhatsApp disponíveis para o usuário escolher.
      console.log("META_AVAILABLE_PAGES", {
        count: pages.length,
        pages: pages.map((p) => ({
          id: p.id,
          name: p.name,
          ig_id: p.ig_business_account_id,
          ig_username: p.ig_username,
        })),
        wabas: wabaCount,
        phones: phones.map((p) => ({
          id: p.id,
          number: p.display_phone_number,
          waba_id: p.waba_id,
        })),
      });

      // Reset seleções para evitar reutilização entre conexões diferentes.
      setSelectedPageId(pages.length === 1 ? pages[0].id : null);
      setSelectedPhoneId(phones.length === 1 ? phones[0].id : null);

      // Compara scopes do token com REQUIRED_SCOPES para detectar permissões faltando.
      let missingScopes: string[] = [];
      try {
        const dbgRes = await fetch(
          `${GRAPH}/debug_token?input_token=${tok}&access_token=${tok}`,
        );
        const dbgJson = (await dbgRes.json()) as {
          data?: { scopes?: string[] };
        };
        const granted = new Set(dbgJson.data?.scopes ?? []);
        const required = REQUIRED_SCOPES.split(",");
        missingScopes = required.filter((s) => !granted.has(s));
        if (missingScopes.length > 0) {
          console.warn("META_MISSING_SCOPES", { missing: missingScopes });
        }
      } catch (e) {
        console.warn("META_DEBUG_TOKEN_FAIL", e);
      }

      const noAssets = phones.length === 0 && pages.length === 0;
      if (noAssets) {
        console.warn("META_ASSETS_DISCOVERY_EMPTY", {
          pages: pages.length,
          phones: phones.length,
          wabaCount,
          missingScopes,
        });
        const base =
          "Não encontramos ativos Meta para conectar. Para concluir, você precisa ser administrador da Página do Facebook, do Instagram profissional e do WhatsApp Business no Gerenciador de Negócios. Também confirme se aceitou todas as permissões solicitadas no login.";
        setErrorMsg(
          missingScopes.length > 0
            ? `${base} Permissões faltando: ${missingScopes.join(", ")}.`
            : base,
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
        error_reason?: string;
        error_description?: string;
        error_code?: string;
        raw?: Record<string, string>;
      } | null;
      if (!data || data.type !== "META_OAUTH_RESULT") return;
      console.log("META_OAUTH_CALLBACK_RESPONSE", { payload: data });
      if (data.error) {
        console.error("META_OAUTH_POPUP_ERROR", {
          error: data.error,
          error_reason: data.error_reason,
          error_description: data.error_description,
          error_code: data.error_code,
          raw: data.raw,
        });
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
      const cfg = (await res.json()) as {
        appId?: string;
        hasAppId?: boolean;
        businessConfigId?: string;
        hasBusinessConfigId?: boolean;
      };
      if (!cfg.hasAppId || !cfg.appId) {
        throw new Error(
          "META_APP_ID não configurado. Avise o administrador.",
        );
      }

      const state = crypto.randomUUID();
      window.sessionStorage.setItem("META_OAUTH_STATE", state);

      const useBusinessConfig = !!cfg.hasBusinessConfigId && !!cfg.businessConfigId;
      console.log("META_OAUTH_LOGIN_MODE", {
        mode: useBusinessConfig ? "business_config" : "classic_scope",
      });
      console.log("META_BUSINESS_CONFIG_ID_PRESENT", { present: useBusinessConfig });
      console.log("META_CONFIG_ID_USED", {
        config_id: useBusinessConfig ? cfg.businessConfigId : null,
      });
      console.log("META_OAUTH_REDIRECT_URI_USED", { redirect_uri: REDIRECT_URI });

      // Facebook Login for Business: escopos vêm da Login Configuration no painel Meta.
      // Fallback (sem config_id): mantém OAuth clássico com scope= por compatibilidade.
      const base =
        `https://www.facebook.com/v21.0/dialog/oauth` +
        `?client_id=${encodeURIComponent(cfg.appId)}` +
        `&redirect_uri=${encodeURIComponent(REDIRECT_URI)}` +
        `&response_type=code` +
        `&state=${encodeURIComponent(state)}`;
      const oauthUrl = useBusinessConfig
        ? `${base}&config_id=${encodeURIComponent(cfg.businessConfigId!)}`
        : `${base}&scope=${encodeURIComponent(REQUIRED_SCOPES)}`;

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


  /* ---------- Save connection (Phase 3) ---------- */
  const saveConnection = useCallback(async (): Promise<boolean> => {
    if (!userToken || !selectedPhoneId || !assets) {
      setErrorMsg("Selecione um número antes de salvar.");
      return false;
    }
    const phone = assets.phones.find((p) => p.id === selectedPhoneId);
    if (!phone) {
      setErrorMsg("Número selecionado inválido.");
      return false;
    }
    // Página agora vem da escolha explícita do usuário — não usamos mais
    // pages[0] como fallback automático para evitar reaproveitar a página
    // de outra conta/onboarding.
    const page = selectedPageId
      ? assets.pages.find((p) => p.id === selectedPageId) ?? null
      : null;

    if (assets.pages.length > 0 && !page) {
      setErrorMsg("Selecione uma página Facebook antes de salvar.");
      return false;
    }

    console.log("META_SELECTED_PAGE", {
      id: page?.id ?? null,
      name: page?.name ?? null,
    });
    console.log("META_SELECTED_INSTAGRAM", {
      id: page?.ig_business_account_id ?? null,
      username: page?.ig_username ?? null,
    });
    console.log("META_SELECTED_WHATSAPP", {
      phone_number_id: phone.id,
      waba_id: phone.waba_id,
      display: phone.display_phone_number,
    });

    setSaving(true);
    setErrorMsg(null);
    try {
      const { data: sess } = await supabase.auth.getSession();
      const bearer = sess.session?.access_token;
      if (!bearer) {
        setErrorMsg("Sessão expirada. Faça login novamente.");
        setSaving(false);
        return false;
      }
      const res = await fetch("/api/onboarding/meta-save", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${bearer}`,
        },
        body: JSON.stringify({
          access_token: userToken,
          selected_phone_number_id: phone.id,
          selected_waba_id: phone.waba_id,
          selected_phone_number: phone.display_phone_number,
          selected_phone_verified_name: phone.verified_name,
          selected_page_id: page?.id ?? null,
          selected_page_name: page?.name ?? null,
          selected_instagram_id: page?.ig_business_account_id ?? null,
          selected_instagram_username: page?.ig_username ?? null,
        }),
      });
      const json = (await res.json()) as {
        ok?: boolean;
        error?: string;
        integration_id?: string;
        display_name?: string;
        phone_number?: string | null;
        waba_id?: string;
        page_id?: string | null;
        page_name?: string | null;
      };
      if (!res.ok || !json.ok || !json.integration_id) {
        throw new Error(json.error ?? `HTTP ${res.status}`);
      }
      setSavedInfo({
        integration_id: json.integration_id,
        display_name: json.display_name ?? phone.display_phone_number,
        phone_number: json.phone_number ?? phone.display_phone_number,
        waba_id: json.waba_id ?? phone.waba_id,
        page_id: json.page_id ?? null,
        page_name: json.page_name ?? null,
      });
      return true;
    } catch (e) {
      console.error("META_ONBOARDING_SAVE_ERROR_CLIENT", e);
      setErrorMsg(e instanceof Error ? e.message : "Falha ao salvar conexão");
      return false;
    } finally {
      setSaving(false);
    }
  }, [userToken, selectedPhoneId, selectedPageId, assets]);

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
              <div className="mb-4 rounded-md border border-[var(--status-urgent)]/30 bg-[var(--status-urgent)]/10 text-[var(--status-urgent)] text-xs px-3 py-2.5 space-y-2">
                <div className="flex items-start gap-2">
                  <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                  <span>{errorMsg}</span>
                </div>
                <ManualFallbackHint />
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
                  console.log("META_SELECTED_WHATSAPP_PICK", { phone_id: id });
                  setSelectedPhoneId(id);
                }}
                selectedPageId={selectedPageId}
                onSelectPage={(id) => {
                  console.log("META_SELECTED_PAGE_PICK", { page_id: id });
                  setSelectedPageId(id);
                }}
              />
            )}
            {step.id === "test" && (
              <StepSuccess saved={savedInfo} saving={saving} />
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
                disabled={!canAdvance || saving}
                onClick={async () => {
                  if (step.id === "choose") {
                    const ok = await saveConnection();
                    if (!ok) return;
                  }
                  setStepIndex((i) => Math.min(STEPS.length - 1, i + 1));
                }}
                className={cn(
                  "inline-flex items-center gap-1.5 text-xs font-semibold rounded-md px-4 py-2 transition",
                  canAdvance && !saving
                    ? "bg-primary text-primary-foreground hover:opacity-90"
                    : "bg-muted text-muted-foreground cursor-not-allowed",
                )}
              >
                {saving ? (
                  <>
                    <Loader2 className="h-3.5 w-3.5 animate-spin" /> Salvando…
                  </>
                ) : (
                  <>
                    {step.id === "choose" ? "Salvar e continuar" : "Continuar"}{" "}
                    <ArrowRight className="h-3.5 w-3.5" />
                  </>
                )}
              </button>
            )}
          </div>
        </section>

        <p className="mt-6 text-center text-[11px] text-muted-foreground">
          Seus tokens são armazenados de forma segura no servidor. Nada sensível
          fica no navegador.
        </p>
      </main>
    </div>
  );
}

/* ---------------- Fallback Hint ---------------- */

function ManualFallbackHint() {
  return (
    <div className="flex items-center justify-between gap-2 pt-2 border-t border-[var(--status-urgent)]/20">
      <span className="text-[11px] text-foreground/80">
        Você também pode conectar manualmente nas Configurações.
      </span>
      <Link
        to="/configuracoes"
        className="inline-flex items-center gap-1 rounded-md border border-border bg-background hover:bg-muted text-foreground text-[11px] font-semibold px-2.5 py-1.5"
      >
        Usar modo manual
        <ArrowRight className="h-3 w-3" />
      </Link>
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
  selectedPageId,
  onSelectPage,
}: {
  assets: DiscoveredAssets | null;
  selected: string | null;
  onSelect: (id: string) => void;
  selectedPageId: string | null;
  onSelectPage: (id: string) => void;
}) {
  if (!assets) {
    return (
      <p className="text-xs text-muted-foreground">
        Volte ao passo anterior e conecte sua conta Meta primeiro.
      </p>
    );
  }

  const pagesPicker = assets.pages.length > 0 && (
    <div className="space-y-2">
      <p className="text-xs text-muted-foreground">
        Selecione a página Facebook / Instagram que será conectada. Cada conexão
        usa uma única página — escolha exatamente a desta empresa.
      </p>
      <ul className="space-y-2">
        {assets.pages.map((p) => {
          const isSelected = selectedPageId === p.id;
          return (
            <li key={p.id}>
              <button
                type="button"
                onClick={() => onSelectPage(p.id)}
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
                  <Facebook className="h-4 w-4" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium truncate">{p.name}</div>
                  <div className="text-[11px] text-muted-foreground truncate">
                    ID {p.id}
                    {p.ig_username ? ` · IG @${p.ig_username}` : " · sem Instagram"}
                  </div>
                </div>
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

  if (assets.phones.length === 0) {
    return (
      <div className="space-y-4">
        <p className="text-xs text-muted-foreground">
          Nenhum número WhatsApp Business foi encontrado na sua conta Meta.
          Confira se você tem uma WABA (WhatsApp Business Account) com número
          associado e se concedeu as permissões{" "}
          <code>whatsapp_business_management</code> e{" "}
          <code>whatsapp_business_messaging</code>.
        </p>
        {pagesPicker}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {pagesPicker}
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

type CheckStatus = "ok" | "warn" | "error" | "idle" | "loading";

interface FriendlyCheck {
  key: string;
  label: string;
  status: CheckStatus;
  hint?: string;
}

function StepSuccess({
  saved,
  saving,
}: {
  saved: SavedInfo | null;
  saving: boolean;
}) {
  const [testSendOk, setTestSendOk] = useState(false);
  const [openTest, setOpenTest] = useState(false);
  const [advanced, setAdvanced] = useState(false);

  const [checks, setChecks] = useState<FriendlyCheck[]>([
    { key: "conn", label: "Conexão ativa", status: "idle" },
    { key: "recv", label: "Recebendo mensagens", status: "idle" },
    { key: "send", label: "Envio funcionando", status: "idle" },
    { key: "win24", label: "Janela 24h ativa", status: "idle" },
  ]);
  const [verifying, setVerifying] = useState(false);
  const [verifyError, setVerifyError] = useState<string | null>(null);
  const [tokenExpired, setTokenExpired] = useState(false);

  const [aiStatus, setAiStatus] = useState<string | null>(null);

  const runVerify = useCallback(async () => {
    setVerifying(true);
    setVerifyError(null);
    setChecks((prev) => prev.map((c) => ({ ...c, status: "loading" as CheckStatus })));
    try {
      const { data: sess } = await supabase.auth.getSession();
      const token = sess.session?.access_token;
      if (!token) throw new Error("Sessão expirada. Faça login novamente.");
      const res = await fetch("/api/whatsapp/debug", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ useSaved: true }),
      });
      const json = (await res.json()) as {
        ok?: boolean;
        debug_token?: { body?: { data?: { is_valid?: boolean; expires_at?: number } } };
        phone_number?: { ok?: boolean };
        webhook_subscribed?: boolean;
        error?: string;
      };
      if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);

      const tokenOk = json.debug_token?.body?.data?.is_valid === true;
      const expSec = json.debug_token?.body?.data?.expires_at ?? 0;
      const expSoon = expSec > 0 && expSec * 1000 - Date.now() < 7 * 24 * 60 * 60 * 1000;
      const phoneOk = json.phone_number?.ok === true;
      const webhookOk = !!json.webhook_subscribed;

      setTokenExpired(!tokenOk);

      setChecks([
        {
          key: "conn",
          label: "Conexão ativa",
          status: tokenOk ? (expSoon ? "warn" : "ok") : "error",
          hint: tokenOk
            ? expSoon
              ? "Renovação recomendada em breve"
              : "Tudo certo"
            : "Sua conexão expirou",
        },
        {
          key: "recv",
          label: "Recebendo mensagens",
          status: webhookOk ? "ok" : "error",
          hint: webhookOk ? "Pronto para receber" : "Não está recebendo mensagens",
        },
        {
          key: "send",
          label: "Envio funcionando",
          status: phoneOk ? "ok" : "error",
          hint: phoneOk ? "Número ativo" : "Número não acessível",
        },
        {
          key: "win24",
          label: "Janela 24h ativa",
          status: phoneOk && tokenOk ? "ok" : "warn",
          hint: "Respostas livres em até 24h após o cliente escrever",
        },
      ]);
    } catch (e) {
      setVerifyError(e instanceof Error ? e.message : "Falha ao verificar conexão");
      setChecks((prev) => prev.map((c) => ({ ...c, status: "error" as CheckStatus })));
    } finally {
      setVerifying(false);
    }
  }, []);

  // Carrega status da IA + roda verify uma vez
  useEffect(() => {
    void runVerify();
    void (async () => {
      try {
        const { data: sess } = await supabase.auth.getSession();
        const token = sess.session?.access_token;
        if (!token) return;
        const res = await fetch("/api/ai/readiness", {
          headers: { Authorization: `Bearer ${token}` },
        });
        const json = (await res.json()) as {
          ok?: boolean;
          readiness?: { status?: string };
        };
        if (json.ok && json.readiness?.status) setAiStatus(json.readiness.status);
      } catch {
        /* silencia: status IA é apenas informativo */
      }
    })();
  }, [runVerify]);

  if (saving) {
    return (
      <div className="py-10 text-center text-xs text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin mx-auto mb-2" />
        Salvando conexão…
      </div>
    );
  }
  if (!saved) {
    return (
      <p className="text-xs text-muted-foreground">
        Volte e selecione um número para salvar a conexão.
      </p>
    );
  }

  return (
    <div className="space-y-5">
      {/* Hero premium */}
      <div className="relative overflow-hidden rounded-2xl border border-[var(--status-ok)]/30 bg-gradient-to-br from-[var(--status-ok)]/10 via-primary/5 to-transparent p-6">
        <div className="absolute -right-8 -top-8 h-32 w-32 rounded-full bg-[var(--status-ok)]/10 blur-3xl" />
        <div className="relative flex items-start gap-4">
          <div className="h-14 w-14 rounded-2xl bg-[var(--status-ok)]/15 text-[var(--status-ok)] inline-flex items-center justify-center shrink-0 shadow-sm">
            <MessageCircle className="h-7 w-7" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1.5">
              <h3 className="text-base font-semibold">WhatsApp pronto para uso</h3>
              <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 text-primary text-[10px] font-semibold px-2 py-0.5">
                <BadgeCheck className="h-3 w-3" /> Oficial Meta
              </span>
            </div>
            <p className="text-xs text-muted-foreground">
              Seu número <span className="font-medium text-foreground">{saved.phone_number ?? saved.display_name}</span> foi conectado com sucesso e já pode receber mensagens dos seus clientes.
            </p>
          </div>
        </div>
      </div>

      {/* Status IA */}
      {aiStatus && <AIStatusCard status={aiStatus} />}

      {/* Token expirado — erro amigável */}
      {tokenExpired && (
        <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-4 flex items-start gap-3">
          <div className="h-9 w-9 rounded-lg bg-destructive/15 text-destructive inline-flex items-center justify-center shrink-0">
            <AlertTriangle className="h-5 w-5" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-sm font-semibold text-destructive mb-0.5">
              Sua conexão expirou
            </div>
            <p className="text-xs text-muted-foreground mb-2">
              Para continuar recebendo e enviando mensagens, clique abaixo para reconectar com a Meta.
            </p>
            <Link
              to="/onboarding/whatsapp"
              className="inline-flex items-center gap-1.5 text-xs font-semibold rounded-md bg-destructive text-destructive-foreground hover:opacity-90 px-3 py-2"
            >
              <RefreshCw className="h-3.5 w-3.5" /> Reconectar agora
            </Link>
          </div>
        </div>
      )}

      {/* Cards de status premium */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {checks.map((c) => {
          const finalStatus: CheckStatus =
            c.key === "send" && testSendOk && c.status !== "loading" ? "ok" : c.status;
          return <StatusCard key={c.key} status={finalStatus} label={c.label} hint={c.hint} />;
        })}
      </div>

      {/* Verificar conexão */}
      <div className="rounded-xl border border-border bg-card p-4 flex items-center gap-3">
        <div className="h-9 w-9 rounded-lg bg-primary/10 text-primary inline-flex items-center justify-center shrink-0">
          <ShieldCheck className="h-5 w-5" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-semibold">Diagnóstico automático</div>
          <p className="text-[11px] text-muted-foreground">
            Testamos tudo de uma vez — conexão, recebimento e envio.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void runVerify()}
          disabled={verifying}
          className="inline-flex items-center gap-1.5 text-xs font-semibold rounded-md bg-primary text-primary-foreground hover:opacity-90 px-3 py-2 disabled:opacity-60"
        >
          {verifying ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <RefreshCw className="h-3.5 w-3.5" />
          )}
          {verifying ? "Verificando…" : "Verificar conexão"}
        </button>
      </div>

      {verifyError && (
        <div className="rounded-md border border-destructive/30 bg-destructive/5 text-destructive text-xs px-3 py-2 flex items-start gap-2">
          <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
          <span>{verifyError}</span>
        </div>
      )}

      {/* CTA teste de envio */}
      <TestSendButton
        externalOpen={openTest}
        onOpenChange={setOpenTest}
        onSuccess={() => setTestSendOk(true)}
      />

      {/* Modo simples × avançado */}
      <div className="flex items-center justify-between pt-2 text-[11px]">
        <span className="text-muted-foreground">
          {advanced ? "Modo avançado" : "Modo simples"}
        </span>
        <button
          type="button"
          onClick={() => setAdvanced((v) => !v)}
          className="rounded-md border border-border bg-background hover:bg-muted px-2.5 py-1.5 font-semibold"
        >
          {advanced ? "Ocultar detalhes técnicos" : "Mostrar detalhes técnicos"}
        </button>
      </div>

      {advanced && (
        <>
          <OnboardingChecklist
            testSendOk={testSendOk}
            onTestSend={() => setOpenTest(true)}
          />
          <div className="rounded-lg border border-border bg-background p-4 space-y-2">
            <Row label="Número" value={saved.phone_number ?? "—"} />
            <Row label="Nome verificado" value={saved.display_name} />
            {saved.page_name && <Row label="Página Facebook" value={saved.page_name} />}
            <Row label="WABA ID" value={saved.waba_id} mono />
          </div>
          <DiagnosticsPanel integrationId={saved.integration_id} />
        </>
      )}
    </div>
  );
}

const STATUS_VISUAL: Record<
  CheckStatus,
  { emoji: string; cls: string; iconCls: string }
> = {
  ok: {
    emoji: "✅",
    cls: "border-[var(--status-ok)]/30 bg-[var(--status-ok)]/5",
    iconCls: "text-[var(--status-ok)]",
  },
  warn: {
    emoji: "⚠️",
    cls: "border-yellow-500/30 bg-yellow-500/5",
    iconCls: "text-yellow-600",
  },
  error: {
    emoji: "❌",
    cls: "border-destructive/30 bg-destructive/5",
    iconCls: "text-destructive",
  },
  loading: {
    emoji: "🔄",
    cls: "border-border bg-muted/40",
    iconCls: "text-muted-foreground",
  },
  idle: {
    emoji: "•",
    cls: "border-border bg-background",
    iconCls: "text-muted-foreground",
  },
};

function StatusCard({
  status,
  label,
  hint,
}: {
  status: CheckStatus;
  label: string;
  hint?: string;
}) {
  const v = STATUS_VISUAL[status];
  return (
    <div
      className={cn(
        "rounded-xl border p-3 transition-all duration-300",
        v.cls,
      )}
    >
      <div className={cn("text-lg leading-none mb-1.5", v.iconCls)}>
        {status === "loading" ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <span aria-hidden>{v.emoji}</span>
        )}
      </div>
      <div className="text-[12px] font-semibold leading-tight">{label}</div>
      {hint && (
        <div className="text-[10px] text-muted-foreground mt-0.5 leading-snug">
          {hint}
        </div>
      )}
    </div>
  );
}

function AIStatusCard({ status }: { status: string }) {
  const map: Record<string, { label: string; desc: string; cls: string; emoji: string }> = {
    ativa: {
      label: "IA ativa",
      desc: "Atende automaticamente seus clientes.",
      cls: "border-[var(--status-ok)]/30 bg-[var(--status-ok)]/5 text-[var(--status-ok)]",
      emoji: "✅",
    },
    piloto: {
      label: "IA em modo piloto",
      desc: "Respondendo de forma controlada apenas para você acompanhar.",
      cls: "border-primary/30 bg-primary/5 text-primary",
      emoji: "🚀",
    },
    pronta: {
      label: "IA pronta para ativar",
      desc: "Tudo configurado — basta ligar a resposta automática.",
      cls: "border-primary/20 bg-primary/5 text-primary",
      emoji: "✨",
    },
    parcialmente_configurada: {
      label: "IA aguardando configuração",
      desc: "Faltam alguns ajustes antes de ativar.",
      cls: "border-yellow-500/30 bg-yellow-500/5 text-yellow-700",
      emoji: "⚠️",
    },
    desativada: {
      label: "IA desativada",
      desc: "A IA não está respondendo no momento.",
      cls: "border-border bg-muted/40 text-muted-foreground",
      emoji: "💤",
    },
  };
  const v = map[status] ?? map.desativada;
  return (
    <div className={cn("rounded-xl border p-3 flex items-center gap-3", v.cls)}>
      <div className="h-9 w-9 rounded-lg bg-background/60 inline-flex items-center justify-center shrink-0">
        <Bot className="h-5 w-5" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-sm font-semibold flex items-center gap-1.5">
          <span aria-hidden>{v.emoji}</span> {v.label}
        </div>
        <div className="text-[11px] opacity-80">{v.desc}</div>
      </div>
      <Link
        to="/ia"
        className="text-[11px] font-semibold rounded-md bg-background/80 hover:bg-background px-2.5 py-1.5 text-foreground"
      >
        Ajustar
      </Link>
    </div>
  );
}




function TestSendButton({
  externalOpen,
  onOpenChange,
  onSuccess,
}: {
  externalOpen?: boolean;
  onOpenChange?: (v: boolean) => void;
  onSuccess?: () => void;
} = {}) {
  const [internalOpen, setInternalOpen] = useState(false);
  const open = externalOpen ?? internalOpen;
  const setOpen = (v: boolean) => {
    setInternalOpen(v);
    onOpenChange?.(v);
  };
  const [phone, setPhone] = useState("");
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<
    | { kind: "ok"; to: string }
    | { kind: "err"; msg: string }
    | null
  >(null);


  const DEFAULT_MSG = "Teste de conexão do Atende Ai realizado com sucesso.";

  const send = async () => {
    setSending(true);
    setResult(null);
    try {
      const { data: sess } = await supabase.auth.getSession();
      const token = sess.session?.access_token;
      if (!token) {
        setResult({ kind: "err", msg: "Sessão expirada. Faça login novamente." });
        return;
      }
      const res = await fetch("/api/onboarding/test-send", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ phone, text: DEFAULT_MSG }),
      });
      const json = (await res.json()) as { ok?: boolean; error?: string; to?: string };
      if (!res.ok || !json.ok) {
        setResult({ kind: "err", msg: json.error ?? `Erro HTTP ${res.status}` });
      } else {
        setResult({ kind: "ok", to: json.to ?? phone });
        onSuccess?.();

      }
    } catch (e) {
      setResult({
        kind: "err",
        msg: e instanceof Error ? e.message : "Falha inesperada",
      });
    } finally {
      setSending(false);
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setResult(null);
          setOpen(true);
        }}
        className="w-full inline-flex items-center justify-center gap-1.5 text-xs font-semibold rounded-md bg-primary text-primary-foreground hover:bg-primary/90 px-3 py-2.5"
      >
        <Send className="h-3.5 w-3.5" /> Enviar mensagem de teste
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onClick={() => !sending && setOpen(false)}
        >
          <div
            className="w-full max-w-sm rounded-xl border border-border bg-background p-5 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-sm font-semibold mb-1">Enviar mensagem de teste</h3>
            <p className="text-xs text-muted-foreground mb-4">
              Informe um telefone com DDD para receber a mensagem oficial.
            </p>

            <label className="block text-xs font-medium mb-1">Telefone (com DDD)</label>
            <input
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="Ex.: 11999998888"
              disabled={sending}
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm mb-3"
            />

            <div className="rounded-md bg-muted/40 p-3 text-xs text-muted-foreground mb-4">
              Mensagem que será enviada:
              <div className="mt-1 text-foreground">{DEFAULT_MSG}</div>
            </div>

            {result?.kind === "ok" && (
              <div className="rounded-md border border-[var(--status-ok)]/40 bg-[var(--status-ok)]/10 text-[var(--status-ok)] text-xs p-3 mb-3">
                Mensagem enviada com sucesso para +{result.to}.
              </div>
            )}
            {result?.kind === "err" && (
              <div className="rounded-md border border-destructive/40 bg-destructive/10 text-destructive text-xs p-3 mb-3 space-y-2">
                <div className="flex gap-2">
                  <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
                  <span>{result.msg}</span>
                </div>
                <div className="flex items-center justify-between gap-2 pt-2 border-t border-destructive/20">
                  <span className="text-[11px] text-foreground/80">
                    Você também pode conectar manualmente nas Configurações.
                  </span>
                  <Link
                    to="/configuracoes"
                    className="inline-flex items-center gap-1 rounded-md border border-border bg-background hover:bg-muted text-foreground text-[11px] font-semibold px-2.5 py-1.5"
                  >
                    Usar modo manual
                    <ArrowRight className="h-3 w-3" />
                  </Link>
                </div>
              </div>
            )}

            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setOpen(false)}
                disabled={sending}
                className="text-xs px-3 py-2 rounded-md border border-border hover:bg-muted"
              >
                Fechar
              </button>
              <button
                type="button"
                onClick={send}
                disabled={sending || phone.replace(/\D/g, "").length < 10}
                className="text-xs px-3 py-2 rounded-md bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 inline-flex items-center gap-1.5"
              >
                {sending ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Send className="h-3.5 w-3.5" />
                )}
                {sending ? "Enviando…" : "Enviar"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3 text-xs">
      <span className="text-muted-foreground">{label}</span>
      <span className={cn("font-medium truncate", mono && "font-mono text-[11px]")}>
        {value}
      </span>
    </div>
  );
}

type DiagRow = {
  id: string;
  company_id: string;
  channel: string;
  external_account_id: string | null;
  account_metadata: Record<string, unknown> | null;
  active: boolean;
  has_access_token: boolean;
  has_webhook_secret: boolean;
  last_synced_at: string | null;
  updated_at: string | null;
};

function DiagnosticsPanel({ integrationId }: { integrationId: string }) {
  const [row, setRow] = useState<DiagRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    const { data, error } = await supabase
      .from("integrations_safe")
      .select(
        "id, company_id, channel, external_account_id, account_metadata, active, has_access_token, has_webhook_secret, last_synced_at, updated_at",
      )
      .eq("id", integrationId)
      .maybeSingle();
    if (error) setErr(error.message);
    setRow((data as DiagRow | null) ?? null);
    setLoading(false);
  }, [integrationId]);

  useEffect(() => {
    void load();
  }, [load]);

  const meta = (row?.account_metadata ?? {}) as Record<string, unknown>;
  const get = (k: string) =>
    typeof meta[k] === "string" || typeof meta[k] === "number"
      ? String(meta[k])
      : null;

  return (
    <details className="rounded-lg border border-border bg-muted/30 text-xs" open>
      <summary className="cursor-pointer px-3 py-2 font-semibold flex items-center justify-between">
        <span>Diagnóstico da conexão</span>
        <button
          type="button"
          onClick={(e) => {
            e.preventDefault();
            void load();
          }}
          className="text-[10px] uppercase tracking-wide text-muted-foreground hover:text-foreground"
        >
          Atualizar
        </button>
      </summary>
      <div className="px-3 pb-3 space-y-1.5">
        {loading && (
          <div className="text-muted-foreground py-2 inline-flex items-center gap-1.5">
            <Loader2 className="h-3 w-3 animate-spin" /> Lendo do banco…
          </div>
        )}
        {err && <div className="text-[var(--status-urgent)]">Erro: {err}</div>}
        {!loading && row && (
          <>
            <Row label="company_id" value={row.company_id} mono />
            <Row label="integration_id" value={row.id} mono />
            <Row label="channel" value={row.channel} />
            <Row label="page_id" value={get("page_id") ?? "—"} mono />
            <Row label="waba_id" value={get("waba_id") ?? "—"} mono />
            <Row
              label="phone_number_id"
              value={row.external_account_id ?? "—"}
              mono
            />
            <Row label="status" value={row.active ? "ativa" : "inativa"} />
            <Row
              label="has_access_token"
              value={row.has_access_token ? "true" : "false"}
            />
            <Row
              label="has_webhook_secret"
              value={row.has_webhook_secret ? "true" : "false"}
            />
            <Row label="last_synced_at" value={row.last_synced_at ?? "—"} />
            <Row label="updated_at" value={row.updated_at ?? "—"} />
          </>
        )}
        {!loading && !row && !err && (
          <div className="text-muted-foreground py-2">
            Integração não encontrada em <code>integrations_safe</code>.
          </div>
        )}
        <p className="pt-2 text-[10px] text-muted-foreground">
          Tokens nunca trafegam para o navegador — apenas o indicador{" "}
          <code>has_access_token</code>.
        </p>
      </div>
    </details>
  );
}
