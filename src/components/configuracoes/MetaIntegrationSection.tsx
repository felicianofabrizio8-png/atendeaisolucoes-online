// Extraído de src/routes/configuracoes.tsx (Sprint 7 — Fase 7.1).
// Conteúdo idêntico ao original: apenas movido para reduzir o tamanho da rota.

import { useState, useEffect, useCallback } from "react";
import { Plug, PowerOff, Loader2 } from "lucide-react";
import { sanitizeForLog, safeErrorMessage, summarizeHttp } from "@/lib/audit/sanitize";
import { useAuth } from "@/auth/AuthContext";
import { supabase } from "@/integrations/supabase/client";

// ===================================================================
// Meta integration (Instagram / Facebook / Messenger)
// ===================================================================

interface MetaPage {
  id: string;
  page_id: string;
  page_name: string;
  ig_business_account_id: string | null;
  ig_username: string | null;
  active: boolean;
  token_expires_at: string | null;
  last_error: string | null;
}

declare global {
  interface Window {
    FB?: {
      init: (opts: { appId: string; cookie: boolean; xfbml: boolean; version: string }) => void;
      login: (
        cb: (res: {
          authResponse?: { accessToken: string; userID: string; grantedScopes?: string };
          status: string;
        }) => void,
        opts?: {
          config_id?: string;
          scope?: string;
          auth_type?: string;
          return_scopes?: boolean;
          response_type?: "token";
          override_default_response_type?: boolean;
        },
      ) => void;
      logout: (cb: (res: unknown) => void) => void;
      getLoginStatus: (cb: (res: { status?: string }) => void) => void;
      api: (path: string, cb: (res: unknown) => void) => void;
    };
    fbAsyncInit?: () => void;
  }
}

interface MetaBusinessConfig {
  appId: string;
  businessConfigId: string;
  pageLoginConfigId: string;
  hasAppId: boolean;
  hasBusinessConfigId: boolean;
  hasPageLoginConfigId: boolean;
}

async function getMetaBusinessConfig(): Promise<MetaBusinessConfig> {
  const res = await fetch("/api/meta/config");
  if (!res.ok) throw new Error("Falha ao carregar configuração Meta Business Login");
  return (await res.json()) as MetaBusinessConfig;
}

function loadFbSdk(appId: string): Promise<void> {
  return new Promise((resolve, reject) => {
    if (typeof window === "undefined") return reject(new Error("no window"));
    if (window.FB) return resolve();
    window.fbAsyncInit = () => {
      window.FB!.init({ appId, cookie: true, xfbml: false, version: "v21.0" });
      resolve();
    };
    const existing = document.getElementById("facebook-jssdk");
    if (existing) return;
    const s = document.createElement("script");
    s.id = "facebook-jssdk";
    s.src = "https://connect.facebook.net/en_US/sdk.js";
    s.async = true;
    s.defer = true;
    s.crossOrigin = "anonymous";
    s.onerror = () => reject(new Error("failed to load Facebook SDK"));
    document.body.appendChild(s);
  });
}

interface AvailablePage {
  id: string;
  name: string;
  access_token: string;
  ig_business_account_id: string | null;
  ig_username: string | null;
}

export function MetaIntegrationSection() {
  const { profile } = useAuth();
  const companyId = profile?.company_id ?? null;
  const [pages, setPages] = useState<MetaPage[]>([]);
  const [available, setAvailable] = useState<AvailablePage[]>([]);
  const [shortToken, setShortToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [savingPageId, setSavingPageId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [metaConfig, setMetaConfig] = useState<MetaBusinessConfig | null>(null);
  const [debugResult, setDebugResult] = useState<unknown>(null);
  const [debugLoading, setDebugLoading] = useState(false);

  const onDebugToken = async () => {
    if (!shortToken) {
      setDebugResult({ error: "Sem token. Faça login Meta primeiro." });
      return;
    }
    setDebugLoading(true);
    try {
      const { supabase } = await import("@/integrations/supabase/client");
      const { data, error } = await supabase.functions.invoke("meta-connect", {
        body: { mode: "debug_token", shortLivedToken: shortToken },
      });
      if (error) throw error;
      console.log("META_DEBUG_TOKEN_RESULT", sanitizeForLog(data));
      setDebugResult(data);
    } catch (e) {
      setDebugResult({ error: e instanceof Error ? e.message : String(e) });
    } finally {
      setDebugLoading(false);
    }
  };

  const reload = useCallback(async () => {
    if (!companyId) return;
    setLoading(true);
    try {
      const { supabase } = await import("@/integrations/supabase/client");
      const { data, error } = await supabase.functions.invoke("meta-connect", {
        method: "GET",
      });
      if (error) throw error;
      setPages(((data as { pages?: MetaPage[] })?.pages ?? []) as MetaPage[]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Falha ao carregar páginas");
    } finally {
      setLoading(false);
    }
  }, [companyId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  useEffect(() => {
    void getMetaBusinessConfig()
      .then(setMetaConfig)
      .catch(() => setMetaConfig(null));
  }, []);

  // App Atende Ai! (tipo Empresa) — solicita todas as permissões necessárias
  // para Pages, Business, Instagram e WhatsApp Business no primeiro dialog.
  const REQUIRED_SCOPES = [
    "public_profile",
    "email",
    "pages_show_list",
    "pages_read_engagement",
    "pages_manage_metadata",
    "pages_manage_engagement",
    "pages_manage_ads",
    "pages_manage_posts",
    "pages_messaging",
    "business_management",
    "ads_management",
    "ads_read",
    "instagram_basic",
    "whatsapp_business_management",
    "whatsapp_business_messaging",
  ].join(",");

  const REDIRECT_URI = "https://app.atendeaisolucoes.online/auth/meta/callback";

  // Carrega páginas a partir de um user access_token (chamado após callback OAuth).
  const loadPagesFromToken = useCallback(async (accessToken: string) => {
    setShortToken(accessToken);
    // Nunca registrar o token (nem parcialmente): apenas presença e tamanho.
    console.log("META_ACCESS_TOKEN", { present: !!accessToken, length: accessToken.length });

    const tok = encodeURIComponent(accessToken);
    const GRAPH = "https://graph.facebook.com/v25.0";

    const intent =
      typeof window !== "undefined"
        ? (window.sessionStorage.getItem("META_OAUTH_INTENT") ?? "default")
        : "default";

    // /debug_token — escopos concedidos
    let grantedScopes: string[] = [];
    try {
      const debugRes = await fetch(`${GRAPH}/debug_token?input_token=${tok}&access_token=${tok}`);
      const debugJson = await debugRes.json();
      const debugData =
        (debugJson as { data?: { scopes?: string[]; granular_scopes?: unknown; app_id?: string } })
          ?.data ?? {};
      grantedScopes = Array.isArray(debugData.scopes) ? debugData.scopes : [];
      console.log("META_TOKEN_SCOPES", {
        app_id: debugData.app_id ?? null,
        scopes: grantedScopes,
        granular_scopes: debugData.granular_scopes ?? null,
        raw: debugJson,
      });
    } catch (e) {
      console.warn("META_TOKEN_DEBUG_FAIL", safeErrorMessage(e));
    }

    // Readiness OAuth: exigir escopos mínimos para intent=facebook_page ANTES
    // de listar páginas — evita mensagem genérica "nenhuma página encontrada"
    // quando na verdade faltou pages_show_list na Configuration do Meta.
    const { evaluateFacebookPageReadiness, formatMissingScopesMessage } =
      await import("@/lib/meta-oauth/facebookPageReadiness");
    const readiness = evaluateFacebookPageReadiness(grantedScopes, intent);
    if (!readiness.ok) {
      console.error("META_FB_PAGE_SCOPES_MISSING", {
        intent,
        missing: readiness.missing,
        granted: grantedScopes,
      });
      setAvailable([]);
      setInfo(null);
      setError(formatMissingScopesMessage(readiness.missing));
      return;
    }

    // /me
    try {
      const meRes = await fetch(`${GRAPH}/me?fields=id,name,email&access_token=${tok}`);
      const meJson = await meRes.json();
      console.log("META_ME_RESPONSE", summarizeHttp(meRes.status, meJson));
    } catch (e) {
      console.warn("META_ME_FAIL", safeErrorMessage(e));
    }

    // /me/businesses
    try {
      const bizRes = await fetch(
        `${GRAPH}/me/businesses?fields=id,name,verification_status,owned_pages{id,name},owned_instagram_accounts{id,username},owned_whatsapp_business_accounts{id,name}&limit=100&access_token=${tok}`,
      );
      const bizJson = (await bizRes.json()) as Record<string, unknown>;
      const bizData = Array.isArray((bizJson as { data?: unknown[] }).data)
        ? (bizJson as { data: unknown[] }).data
        : [];
      console.log("META_ME_BUSINESSES_RESPONSE", {
        status: bizRes.status,
        ok: bizRes.ok,
        count: bizData.length,
      });
    } catch (e) {
      console.warn("META_ME_BUSINESSES_FAIL", safeErrorMessage(e));
    }

    // /me/accounts — páginas Facebook do usuário + IG + WhatsApp vinculados
    const accountsUrl =
      `${GRAPH}/me/accounts` +
      `?fields=id,name,tasks,access_token,category,` +
      `instagram_business_account{id,username},` +
      `connected_whatsapp_business_account{id}` +
      `&limit=100&access_token=${tok}`;
    const accountsRes = await fetch(accountsUrl);
    const accountsJson = (await accountsRes.json()) as Record<string, unknown>;
    const errObj = (accountsJson as { error?: { code?: number; message?: string } }).error;
    const root = accountsJson as { data?: unknown[] };
    const pageCount = Array.isArray(root.data) ? root.data.length : 0;
    console.log("META_ME_ACCOUNTS_RESPONSE", {
      status: accountsRes.status,
      ok: accountsRes.ok,
      error_code: errObj?.code ?? null,
      error_message: errObj?.message ?? null,
      page_count: pageCount,
      granted_scopes: grantedScopes,
      intent,
    });

    if (errObj) {
      // O payload bruto contém access_token por página — logar só o erro.
      console.error("META_ME_ACCOUNTS_ERROR", summarizeHttp(accountsRes.status, accountsJson));
      throw new Error(`Graph API: ${errObj.message ?? "erro desconhecido"}`);
    }

    type RawPage = {
      id: string;
      name: string;
      access_token: string;
      instagram_business_account?: { id?: string; username?: string };
      connected_whatsapp_business_account?: { id?: string };
    };
    const accounts: RawPage[] = Array.isArray(root.data) ? (root.data as RawPage[]) : [];

    console.log(
      "META_PAGES_DETAIL",
      accounts.map((p) => ({
        id: p.id,
        name: p.name,
        ig: p.instagram_business_account?.id ?? null,
        ig_username: p.instagram_business_account?.username ?? null,
        whatsapp: p.connected_whatsapp_business_account?.id ?? null,
      })),
    );

    const list: AvailablePage[] = accounts.map((p) => ({
      id: p.id,
      name: p.name,
      access_token: p.access_token,
      ig_business_account_id: p.instagram_business_account?.id ?? null,
      ig_username: p.instagram_business_account?.username ?? null,
    }));
    console.log("META_PAGES_FOUND", { count: list.length });
    setAvailable(list);

    if (list.length === 0) {
      setInfo(null);
      setError(
        "Nenhuma Página foi retornada pela Meta. Confirme que pages_show_list foi concedida na Configuration e que sua conta administra a Página desejada.",
      );
    } else {
      setError(null);
      setInfo(`Login Meta conectado. ${list.length} página(s) disponível(is) para conexão.`);
    }
  }, []);

  // Troca o `code` do OAuth por um access_token via edge function meta-connect.
  const exchangeCodeForToken = useCallback(
    async (code: string) => {
      try {
        const { supabase } = await import("@/integrations/supabase/client");
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
        await loadPagesFromToken(res.access_token);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Falha ao trocar código Meta");
      }
    },
    [loadPagesFromToken],
  );

  // Retomar fluxo após callback OAuth: code vem via postMessage da popup,
  // ou via sessionStorage no fallback (popup bloqueado / mesma janela).
  useEffect(() => {
    if (typeof window === "undefined") return;

    // Fallback (sem popup): callback gravou o code em sessionStorage.
    const pendingCode = window.sessionStorage.getItem("META_OAUTH_CODE");
    if (pendingCode) {
      const expected = window.sessionStorage.getItem("META_OAUTH_STATE");
      const received = window.sessionStorage.getItem("META_OAUTH_STATE_RX");
      window.sessionStorage.removeItem("META_OAUTH_CODE");
      window.sessionStorage.removeItem("META_OAUTH_STATE_RX");
      window.sessionStorage.removeItem("META_OAUTH_STATE");
      if (!expected || expected !== received) {
        setError("Sessão OAuth inválida. Tente conectar novamente.");
        console.warn("META_OAUTH_STATE_MISMATCH", {
          hasExpected: !!expected,
          hasReceived: !!received,
        });
      } else {
        setConnecting(true);
        void exchangeCodeForToken(pendingCode).finally(() => setConnecting(false));
      }
    }
    // Legado: ainda suporta token salvo (caso alguma popup antiga responda assim).
    const legacyTok = window.sessionStorage.getItem("META_OAUTH_TOKEN");
    if (legacyTok) {
      window.sessionStorage.removeItem("META_OAUTH_TOKEN");
      void loadPagesFromToken(legacyTok).catch((e) => {
        setError(e instanceof Error ? e.message : "Falha ao listar páginas Meta");
      });
    }

    const onMessage = (ev: MessageEvent) => {
      if (ev.origin !== window.location.origin) return;
      const data = ev.data as {
        type?: string;
        code?: string;
        state?: string;
        access_token?: string;
        error?: string;
        error_reason?: string;
        error_description?: string;
        error_code?: string;
        raw?: Record<string, string>;
      } | null;
      if (!data || data.type !== "META_OAUTH_RESULT") return;
      console.log("META_OAUTH_CALLBACK_RESPONSE", {
        payload: { ...data, code: data.code ? "[redacted]" : undefined },
      });
      if (data.error) {
        console.error("META_OAUTH_POPUP_ERROR", {
          error: data.error,
          error_reason: data.error_reason,
          error_description: data.error_description,
          error_code: data.error_code,
        });
        setConnecting(false);
        setError(data.error);
        return;
      }
      if (data.code) {
        const expected = window.sessionStorage.getItem("META_OAUTH_STATE");
        window.sessionStorage.removeItem("META_OAUTH_STATE");
        if (!expected || expected !== data.state) {
          console.warn("META_OAUTH_STATE_MISMATCH", {
            hasExpected: !!expected,
            hasReceived: !!data.state,
          });
          setConnecting(false);
          setError("Sessão OAuth inválida. Tente conectar novamente.");
          return;
        }
        void exchangeCodeForToken(data.code).finally(() => setConnecting(false));
        return;
      }
      if (data.access_token) {
        setConnecting(false);
        void loadPagesFromToken(data.access_token).catch((e) => {
          setError(e instanceof Error ? e.message : "Falha ao listar páginas Meta");
        });
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [loadPagesFromToken, exchangeCodeForToken]);

  // intent="facebook_page" usa uma Login Configuration dedicada (com
  // pages_manage_posts + pages_read_engagement) exclusivamente para habilitar
  // publicação em Página Facebook. NÃO altera o fluxo padrão (Instagram/Ads).
  const onConnect = async (intent: "default" | "facebook_page" = "default") => {
    setError(null);
    setInfo(null);
    setAvailable([]);
    setShortToken(null);
    setConnecting(true);
    try {
      const config = await getMetaBusinessConfig();
      setMetaConfig(config);
      if (!config.hasAppId) {
        throw new Error(
          "Configure META_APP_ID no projeto antes de conectar (App ID do Meta for Developers).",
        );
      }
      if (intent === "facebook_page" && !config.hasPageLoginConfigId) {
        throw new Error(
          "META_PAGE_LOGIN_CONFIG_ID ausente no servidor. Cadastre a Configuration do Facebook Login for Business (com pages_manage_posts).",
        );
      }

      if (typeof window !== "undefined") {
        // Limpa qualquer sessão antiga (token do app anterior)
        window.sessionStorage.removeItem("META_OAUTH_TOKEN");
        window.localStorage.removeItem("META_OAUTH_TOKEN");
        const state = crypto.randomUUID();
        window.sessionStorage.setItem("META_OAUTH_STATE", state);
        window.sessionStorage.setItem("META_OAUTH_INTENT", intent);

        // Escolhe qual Login Configuration usar. Facebook Page publishing
        // usa uma config dedicada; default preserva o comportamento atual
        // (Instagram/Ads via businessConfigId).
        const chosenConfigId =
          intent === "facebook_page" ? config.pageLoginConfigId : config.businessConfigId;
        const useBusinessConfig =
          intent === "facebook_page"
            ? !!config.hasPageLoginConfigId && !!config.pageLoginConfigId
            : !!config.hasBusinessConfigId && !!config.businessConfigId;
        console.log("META_OAUTH_LOGIN_MODE", {
          intent,
          mode: useBusinessConfig ? "business_config" : "classic_scope",
          config_id: useBusinessConfig ? chosenConfigId : null,
        });

        console.log("META_OAUTH_REDIRECT_URI_USED", { redirect_uri: REDIRECT_URI });

        const base =
          `https://www.facebook.com/v21.0/dialog/oauth` +
          `?client_id=${encodeURIComponent(config.appId)}` +
          `&redirect_uri=${encodeURIComponent(REDIRECT_URI)}` +
          `&response_type=code` +
          `&state=${encodeURIComponent(state)}` +
          `&auth_type=rerequest`;
        // Facebook Login for Business: escopos vêm da Login Configuration no painel Meta.
        // Fallback manual (sem config_id) mantém o OAuth clássico com scope=.
        const oauthUrl = useBusinessConfig
          ? `${base}&config_id=${encodeURIComponent(chosenConfigId)}`
          : `${base}&scope=${encodeURIComponent(REQUIRED_SCOPES)}`;

        console.log("META_OAUTH_URL", {
          intent,
          url: oauthUrl,
          app_id: config.appId,
          mode: useBusinessConfig ? "business_config" : "classic_scope",
        });

        // Abre em nova janela/popup para manter o app aberto
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
          setInfo(
            "Abrimos o login Meta em outra aba. Conclua o login lá e volte para esta página.",
          );
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Falha ao iniciar login Meta");
      setConnecting(false);
    }
  };

  const onSelectPage = async (page: AvailablePage) => {
    if (!shortToken) {
      setError("Sessão Facebook expirou. Clique em Conectar novamente.");
      return;
    }
    setError(null);
    setInfo(null);
    setSavingPageId(page.id);
    const intent =
      typeof window !== "undefined"
        ? (window.sessionStorage.getItem("META_OAUTH_INTENT") ?? "default")
        : "default";
    try {
      const { supabase } = await import("@/integrations/supabase/client");
      const { data, error } = await supabase.functions.invoke("meta-connect", {
        body: {
          mode: "connect_page",
          intent,
          shortLivedToken: shortToken,
          page: {
            id: page.id,
            name: page.name,
            access_token: page.access_token,
            ig_business_account_id: page.ig_business_account_id,
            ig_username: page.ig_username,
          },
        },
      });

      if (error) throw error;
      const result = data as {
        page?: { name?: string; ig_username?: string | null };
        webhook_subscribed?: boolean;
      };
      const savedName = result?.page?.name ?? page.name;
      const igLabel = result?.page?.ig_username ? ` · Instagram: @${result.page.ig_username}` : "";
      const webhookLabel = result?.webhook_subscribed
        ? " · Webhook ativo"
        : " · Webhook não confirmado";

      // Validação extra do fluxo Facebook Page publishing: confirma escopos
      // necessários no token do usuário (pages_manage_posts + pages_read_engagement)
      // e que page_id realmente pertence ao token retornado.
      if (intent === "facebook_page") {
        try {
          const GRAPH = "https://graph.facebook.com/v25.0";
          const tok = encodeURIComponent(shortToken);
          const dbg = await fetch(`${GRAPH}/debug_token?input_token=${tok}&access_token=${tok}`);
          const dbgJson = (await dbg.json()) as {
            data?: { scopes?: string[] };
          };
          const scopes = dbgJson.data?.scopes ?? [];
          const hasPost = scopes.includes("pages_manage_posts");
          const hasRead = scopes.includes("pages_read_engagement");
          console.log("META_FB_PAGE_PUBLISH_VALIDATION", {
            page_id: page.id,
            hasPost,
            hasRead,
            granted_scopes: scopes,
          });
          if (!hasPost || !hasRead) {
            setError(
              `Página conectada, mas faltam permissões para publicar: ${
                !hasPost ? "pages_manage_posts" : ""
              }${!hasPost && !hasRead ? " + " : ""}${
                !hasRead ? "pages_read_engagement" : ""
              }. Refaça "Conectar publicação do Facebook" e marque essas permissões no dialog.`,
            );
          } else {
            setInfo(`✅ Facebook pronto para publicar: ${savedName}${igLabel}${webhookLabel}`);
          }
        } catch (e) {
          console.warn("META_FB_PAGE_PUBLISH_VALIDATION_FAIL", safeErrorMessage(e));
          setInfo(`Conectado: ${savedName}${igLabel}${webhookLabel}`);
        }
      } else {
        setInfo(`Conectado: ${savedName}${igLabel}${webhookLabel}`);
      }
      console.log("META_TOKEN_SAVED", {
        page_id: page.id,
        ig: result?.page?.ig_username,
        intent,
      });
      setAvailable((prev) => prev.filter((p) => p.id !== page.id));
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Falha ao salvar página");
    } finally {
      setSavingPageId(null);
      if (typeof window !== "undefined") {
        window.sessionStorage.removeItem("META_OAUTH_INTENT");
      }
    }
  };

  const onDisconnect = async (pageId: string) => {
    if (!confirm("Desconectar esta página? Mensagens antigas serão mantidas.")) return;
    try {
      const { supabase } = await import("@/integrations/supabase/client");
      const { error } = await supabase.functions.invoke("meta-connect", {
        method: "DELETE",
        body: { pageId },
      });
      if (error) throw error;
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Falha ao desconectar");
    }
  };

  if (!companyId) return null;

  // Log no momento do render para detectar overwrites/race conditions.
  console.log("META_RENDERING_PAGES", {
    available_count: available.length,
    available,
    connected_count: pages.length,
    connecting,
    loading,
  });

  return (
    <section className="rounded-lg border border-border bg-card p-5">
      <div className="flex items-center gap-2 mb-1">
        <Plug className="h-4 w-4 text-primary" />
        <h2 className="text-sm font-semibold">Instagram & Facebook (Meta)</h2>
      </div>
      <p className="text-xs text-muted-foreground mb-4">
        Conecte páginas do Facebook + Instagram Business para receber DMs, mensagens do Messenger e
        comentários direto na sua caixa de atendimento.
      </p>

      {error && (
        <div className="mb-3 rounded-md bg-[var(--status-urgent)]/10 text-[var(--status-urgent)] text-xs px-3 py-2">
          {error}
        </div>
      )}
      {info && (
        <div className="mb-3 rounded-md bg-[var(--status-won)]/10 text-[var(--status-won)] text-xs px-3 py-2">
          {info}
        </div>
      )}

      {loading && (
        <p className="text-xs text-muted-foreground inline-flex items-center gap-1.5 mb-3">
          <Loader2 className="h-3 w-3 animate-spin" /> Carregando páginas…
        </p>
      )}

      {pages.length > 0 && (
        <p className="text-xs font-semibold mb-2">
          Páginas conectadas{" "}
          <span className="text-muted-foreground font-normal">({pages.length})</span>
        </p>
      )}
      {pages.length > 0 && (
        <ul className="space-y-2 mb-4">
          {pages.map((p) => (
            <li
              key={p.id}
              className="flex items-center justify-between gap-2 rounded-md border border-border bg-background px-3 py-2"
            >
              <div className="min-w-0">
                <p className="text-sm font-medium truncate">{p.page_name}</p>
                <p className="text-[11px] text-muted-foreground truncate">
                  FB page: {p.page_id}
                  {p.ig_username && <> · IG: @{p.ig_username}</>}
                  {p.token_expires_at && (
                    <>
                      {" · "}
                      Token expira {new Date(p.token_expires_at).toLocaleDateString("pt-BR")}
                    </>
                  )}
                </p>
                {p.last_error && (
                  <p className="text-[11px] text-[var(--status-urgent)] truncate">{p.last_error}</p>
                )}
              </div>
              <button
                onClick={() => onDisconnect(p.page_id)}
                className="inline-flex items-center gap-1 text-xs rounded-md bg-secondary hover:bg-accent px-2.5 py-1.5"
              >
                <PowerOff className="h-3.5 w-3.5" /> Desconectar
              </button>
            </li>
          ))}
        </ul>
      )}

      {available.length > 0 && (
        <div className="mb-4">
          <p className="text-xs font-semibold mb-2">
            Páginas disponíveis{" "}
            <span className="text-muted-foreground font-normal">
              ({available.length} encontrada{available.length === 1 ? "" : "s"})
            </span>
          </p>
          <ul className="space-y-2">
            {available.map((p) => (
              <li
                key={p.id}
                className="flex items-center justify-between gap-2 rounded-md border border-dashed border-border bg-background px-3 py-2"
              >
                <div className="min-w-0">
                  <p className="text-sm font-medium truncate">{p.name}</p>
                  <p className="text-[11px] text-muted-foreground truncate">
                    FB: {p.id}
                    {p.ig_username ? ` · IG: @${p.ig_username}` : " · sem Instagram vinculado"}
                  </p>
                </div>
                <button
                  onClick={() => onSelectPage(p)}
                  disabled={savingPageId === p.id}
                  className="inline-flex items-center gap-1 text-xs font-semibold rounded-md bg-primary text-primary-foreground px-2.5 py-1.5 hover:opacity-90 disabled:opacity-60"
                >
                  {savingPageId === p.id ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Plug className="h-3.5 w-3.5" />
                  )}
                  Conectar
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {pages.length === 0 && available.length === 0 && !loading && (
        <div className="mb-4 rounded-md border border-dashed border-border bg-background px-3 py-4 text-center">
          <p className="text-xs text-muted-foreground">
            Nenhuma página conectada ainda. Clique em <strong>Conectar Instagram / Facebook</strong>{" "}
            abaixo.
          </p>
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        <button
          onClick={() => onConnect("default")}
          disabled={connecting}
          className="inline-flex items-center gap-2 text-xs font-semibold rounded-md bg-[#1877F2] text-white px-3 py-2 hover:opacity-90 disabled:opacity-60"
        >
          {connecting ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Plug className="h-3.5 w-3.5" />
          )}
          {pages.length > 0 ? "Conectar outra página" : "Conectar Instagram / Facebook"}
        </button>
        <button
          onClick={() => onConnect("facebook_page")}
          disabled={connecting || !metaConfig?.hasPageLoginConfigId}
          title={
            metaConfig?.hasPageLoginConfigId
              ? "Fluxo dedicado: solicita pages_manage_posts + pages_read_engagement para publicar na Página."
              : "Defina META_PAGE_LOGIN_CONFIG_ID para habilitar."
          }
          className="inline-flex items-center gap-2 text-xs font-semibold rounded-md bg-emerald-600 text-white px-3 py-2 hover:opacity-90 disabled:opacity-60"
        >
          {connecting ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Plug className="h-3.5 w-3.5" />
          )}
          Conectar publicação do Facebook
        </button>
      </div>

      <div className="mt-3">
        <button
          onClick={onDebugToken}
          disabled={debugLoading || !shortToken}
          className="inline-flex items-center gap-2 text-xs font-semibold rounded-md bg-amber-500 text-black px-3 py-2 hover:opacity-90 disabled:opacity-60"
        >
          {debugLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
          Debug Meta Token
        </button>
        {!shortToken && (
          <p className="mt-1 text-[11px] text-muted-foreground">
            Faça login Meta acima primeiro para habilitar o debug.
          </p>
        )}
        {debugResult !== null && (
          <pre className="mt-2 max-h-96 overflow-auto rounded bg-muted/40 p-2 text-[10px] text-foreground">
            {JSON.stringify(debugResult, null, 2)}
          </pre>
        )}
      </div>

      {metaConfig?.hasAppId === false && (
        <p className="mt-3 text-[11px] text-muted-foreground">
          Defina <code className="bg-muted px-1 rounded">META_APP_ID</code> com o App ID do seu app
          Meta para habilitar o login.
        </p>
      )}
      {metaConfig?.hasAppId === true && metaConfig.hasBusinessConfigId === false && (
        <p className="mt-3 text-[11px] text-muted-foreground">
          Defina <code className="bg-muted px-1 rounded">META_BUSINESS_CONFIG_ID</code> com o
          Configuration ID do Facebook Login for Business.
        </p>
      )}
    </section>
  );
}
