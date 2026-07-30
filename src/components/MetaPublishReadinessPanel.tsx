// MetaPublishReadinessPanel — checklist + seleção de conta de anúncios e página Meta.
// Auto-seleciona se houver apenas 1 conta. Permite entrada manual do ad_account_id.

import { useEffect, useState, useCallback, useRef } from "react";
import { useServerFn } from "@tanstack/react-start";
import {
  getMetaPublishReadiness,
  listMetaAdAccounts,
  listMetaPages,
  selectMetaAdAccount,
  clearMetaAdAccount,
  selectMetaPage,
  setMetaBetaFlag,
  diagnoseMetaToken,
  adoptMetaUserToken,
  verifyPersistedMetaUserToken,
} from "@/lib/meta-ads.functions";
import type { Campaign } from "@/lib/campaigns";
import { Check, X, Loader2, RefreshCw, ChevronDown, ChevronUp, ShieldCheck, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { sanitizeForLog, safeErrorMessage, summarizeHttp } from "@/lib/audit/sanitize";

type Readiness = {
  ok: true;
  betaEnabled: boolean;
  isAdmin: boolean;
  metaConnected: boolean;
  integrationId: string | null;
  integrationName: string;
  integrationCount: number;
  adAccountId: string;
  pageId: string;
  igBusinessAccountId: string;
  whatsappConnected: boolean;
};

type AdAccount = {
  id: string;
  account_id: string;
  name: string;
  status: number;
  currency: string;
  timezone: string;
  business: string | null;
  source: string;
};

type MetaPage = {
  id: string;
  page_id: string;
  page_name: string;
  ig_username: string | null;
};

type MetaBusinessConfig = {
  appId: string;
  businessConfigId: string;
  hasAppId: boolean;
  hasBusinessConfigId: boolean;
};

type AvailablePage = {
  id: string;
  name: string;
  access_token: string;
  ig_business_account_id: string | null;
  ig_username: string | null;
};

const GRAPH = "https://graph.facebook.com/v25.0";
const META_REDIRECT_URI = "https://app.atendeaisolucoes.online/auth/meta/callback";
const META_REQUIRED_SCOPES = [
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
].join(",");

async function getMetaBusinessConfig(): Promise<MetaBusinessConfig> {
  const res = await fetch("/api/meta/config");
  if (!res.ok) throw new Error("Falha ao carregar configuração Meta.");
  return (await res.json()) as MetaBusinessConfig;
}

const ACCOUNT_STATUS_LABEL: Record<number, string> = {
  1: "Ativa", 2: "Desativada", 3: "Não solucionada", 7: "Pendente análise",
  9: "Em revisão", 101: "Encerrada", 201: "Pausada por admin", 202: "Pendência financeira",
};

function CheckRow({ ok, label, hint }: { ok: boolean; label: string; hint?: string }) {
  return (
    <li className="flex items-start gap-2 text-sm">
      <span className={cn("mt-0.5 inline-flex h-5 w-5 items-center justify-center rounded-full shrink-0",
        ok ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400" : "bg-muted text-muted-foreground")}>
        {ok ? <Check className="h-3.5 w-3.5" /> : <X className="h-3.5 w-3.5" />}
      </span>
      <span className="leading-5">
        <span className={cn(!ok && "text-muted-foreground")}>{label}</span>
        {hint ? <span className="block text-[11px] text-muted-foreground">{hint}</span> : null}
      </span>
    </li>
  );
}

export function MetaPublishReadinessPanel({ campaign }: { campaign: Campaign }) {
  const [readiness, setReadiness] = useState<Readiness | null>(null);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(true);
  const [accounts, setAccounts] = useState<AdAccount[] | null>(null);
  const [pages, setPages] = useState<MetaPage[] | null>(null);
  const [loadingAccounts, setLoadingAccounts] = useState(false);
  const [missingScopes, setMissingScopes] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [reconnecting, setReconnecting] = useState(false);
  const [togglingBeta, setTogglingBeta] = useState(false);
  const [manualAd, setManualAd] = useState("");
  const autoSelectedRef = useRef(false);

  const fetchReadiness = useServerFn(getMetaPublishReadiness);
  const fetchAccounts = useServerFn(listMetaAdAccounts);
  const fetchPages = useServerFn(listMetaPages);
  const saveAccount = useServerFn(selectMetaAdAccount);
  const clearAccount = useServerFn(clearMetaAdAccount);
  const savePage = useServerFn(selectMetaPage);
  const toggleBeta = useServerFn(setMetaBetaFlag);
  const diagnoseToken = useServerFn(diagnoseMetaToken);
  const adoptToken = useServerFn(adoptMetaUserToken);
  const verifyPersisted = useServerFn(verifyPersistedMetaUserToken);

  const [manualToken, setManualToken] = useState("");
  const [diagnosing, setDiagnosing] = useState(false);
  const [adopting, setAdopting] = useState(false);
  const [verification, setVerification] = useState<
    | null
    | {
        ok: boolean;
        error?: string;
        message?: string;
        persistedTokenSuffix?: string;
        debugToken?: {
          type: string | null;
          is_valid: boolean;
          scopes: string[];
          has_ads_read: boolean;
          has_ads_management: boolean;
          has_business_management: boolean;
        };
        me?: { id: string; name: string } | null;
        meError?: string | null;
        adAccounts?: Array<{ id: string; account_id: string; name: string; status: number }>;
        adAccountsError?: string | null;
      }
  >(null);
  const [diagnosis, setDiagnosis] = useState<
    | null
    | {
        tokenSuffix: string;
        debugToken: {
          type: string | null;
          is_valid: boolean;
          app_id: string | null;
          expires_at: number | null;
          scopes: string[];
          has_ads_read: boolean;
          has_ads_management: boolean;
          has_business_management: boolean;
          has_pages_show_list: boolean;
        };
        me: { id: string; name: string } | null;
        meError: string | null;
        adAccounts: Array<{ id: string; account_id: string; name: string; status: number }>;
        adAccountsError: string | null;
      }
  >(null);

  async function runDiagnosis() {
    if (!manualToken.trim()) return;
    setDiagnosing(true);
    setDiagnosis(null);
    try {
      const r = await diagnoseToken({ data: { token: manualToken.trim() } });
      if (r.ok) {
        setDiagnosis({
          tokenSuffix: r.tokenSuffix,
          debugToken: r.debugToken,
          me: r.me,
          meError: r.meError,
          adAccounts: r.adAccounts,
          adAccountsError: r.adAccountsError,
        });
      } else {
        toast.error(("message" in r && r.message) || "Falha no diagnóstico.");
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro no diagnóstico.");
    } finally {
      setDiagnosing(false);
    }
  }

  async function adoptDiagnosedToken() {
    if (!manualToken.trim()) return;
    setAdopting(true);
    setVerification(null);
    try {
      const inputSuffix = `***${manualToken.trim().slice(-6)}`;
      const r = await adoptToken({ data: { token: manualToken.trim() } });
      if (r.ok) {
        toast.success(`Token ${r.type} salvo em ${r.updated} integração(ões). Verificando...`);
        // Verifica o que foi efetivamente persistido em integrations.access_token
        const v = await verifyPersisted({ data: { expectedTokenSuffix: inputSuffix } });
        if (v.ok) {
          setVerification({
            ok: true,
            persistedTokenSuffix: v.persistedTokenSuffix,
            debugToken: v.debugToken,
            me: v.me,
            meError: v.meError,
            adAccounts: v.adAccounts,
            adAccountsError: v.adAccountsError,
          });
          toast.success("Token persistido validado.");
        } else {
          setVerification({
            ok: false,
            error: ("error" in v && v.error) || "verify_failed",
            message: ("message" in v && v.message) || "Falha ao verificar token persistido.",
            persistedTokenSuffix: ("persistedTokenSuffix" in v ? v.persistedTokenSuffix : undefined),
          });
          toast.error(("message" in v && v.message) || "Falha ao verificar token persistido.");
        }
        setManualToken("");
        setDiagnosis(null);
        await refresh({ silent: true });
        await loadAssets();
      } else {
        toast.error(("message" in r && r.message) || "Falha ao adotar token.");
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao adotar token.");
    } finally {
      setAdopting(false);
    }
  }

  const refresh = useCallback(async (opts?: { silent?: boolean }) => {
    console.log("[MetaPanel] refresh readiness");
    setLoading(true);
    try {
      const r = await fetchReadiness();
      console.log("[MetaPanel] readiness response", sanitizeForLog(r));
      if (r.ok) {
        setReadiness(r as Readiness);
        if (!opts?.silent) toast.success("Status atualizado.");
      } else {
        toast.error((("message" in r && typeof r.message === "string" && r.message) || "Falha ao verificar prontidão."));
      }
    } catch (e) {
      console.error("[MetaPanel] refresh error", safeErrorMessage(e));
      toast.error(e instanceof Error ? e.message : "Erro ao verificar prontidão.");
    } finally { setLoading(false); }
  }, [fetchReadiness]);

  const loadAssets = useCallback(async () => {
    console.log("[MetaPanel] load assets clicked");
    setLoadingAccounts(true);
    try {
      const [a, p] = await Promise.all([fetchAccounts(), fetchPages()]);
      // As páginas trazem access_token no payload — logar apenas contagens.
      console.log("[MetaPanel] assets response", {
        accounts_ok: a.ok,
        accounts_count: Array.isArray((a as { accounts?: unknown[] }).accounts) ? (a as { accounts: unknown[] }).accounts.length : 0,
        pages_ok: p.ok,
        pages_count: Array.isArray((p as { pages?: unknown[] }).pages) ? (p as { pages: unknown[] }).pages.length : 0,
      });
      if (a.ok) {
        const accs = a.accounts as AdAccount[];
        setAccounts(accs);
        setMissingScopes(a.missingScopes as string[]);
        if (accs.length === 0) {
          toast.warning("Nenhuma conta de anúncios Meta encontrada. Cole o ID manualmente abaixo.");
        } else {
          toast.success(`${accs.length} conta(s) carregada(s).`);
        }
      } else {
        toast.error(("message" in a && a.message) || "Erro ao listar contas Meta.");
      }
      if (p.ok) {
        const pgs = p.pages as MetaPage[];
        setPages(pgs);
        if (pgs.length === 0) toast.warning("Nenhuma página Facebook encontrada.");
      } else {
        toast.error((("message" in p && typeof p.message === "string" && p.message) || "Erro ao listar páginas."));
      }
    } catch (e) {
      console.error("[MetaPanel] loadAssets error", safeErrorMessage(e));
      toast.error(e instanceof Error ? e.message : "Erro ao carregar assets Meta.");
    } finally { setLoadingAccounts(false); }
  }, [fetchAccounts, fetchPages]);

  const completeReconnectWithCode = useCallback(async (code: string) => {
    setReconnecting(true);
    try {
      const { supabase } = await import("@/integrations/supabase/client");
      const { data: exchangeData, error: exchangeError } = await supabase.functions.invoke("meta-connect", {
        body: { mode: "exchange_code", code, redirectUri: META_REDIRECT_URI },
      });
      if (exchangeError) throw exchangeError;
      const exchange = exchangeData as { access_token?: string; error?: string };
      const userToken = exchange.access_token;
      if (!userToken) throw new Error(exchange.error ?? "OAuth Meta não retornou token de usuário.");

      const { data: debugData, error: debugError } = await supabase.functions.invoke("meta-connect", {
        body: { mode: "debug_token", shortLivedToken: userToken },
      });
      if (debugError) throw debugError;
      const debug = debugData as {
        debug_token?: { type?: string; is_valid?: boolean; scopes?: string[] } | null;
        me?: { id?: string; name?: string; error?: { message?: string } } | null;
      };
      const tokenType = debug.debug_token?.type ?? null;
      const scopes = debug.debug_token?.scopes ?? [];
      console.log("META_RECONNECT_VALIDATION", {
        token_type: tokenType,
        is_valid: debug.debug_token?.is_valid ?? null,
        me_id: debug.me?.id ?? null,
        requested_scopes: META_REQUIRED_SCOPES.split(","),
        granted_scopes: scopes,
        has_ads_read: scopes.includes("ads_read"),
        has_ads_management: scopes.includes("ads_management"),
        has_business_management: scopes.includes("business_management"),
        has_pages_manage_ads: scopes.includes("pages_manage_ads"),
        has_pages_read_engagement: scopes.includes("pages_read_engagement"),
      });
      if (tokenType !== "USER" && tokenType !== "SYSTEM_USER") {
        throw new Error("Reconexão inválida: token de Página salvo. Reconecte com token de usuário.");
      }

      const tok = encodeURIComponent(userToken);
      const adRes = await fetch(`${GRAPH}/me/adaccounts?fields=id,account_id,name,account_status,currency,timezone_name,business{id,name}&limit=200&access_token=${tok}`);
      const adJson = (await adRes.json()) as { data?: Array<Record<string, unknown>>; error?: { message?: string } };
      console.log("META_RECONNECT_ME_ADACCOUNTS", {
        ...summarizeHttp(adRes.status, adJson),
        count: Array.isArray(adJson.data) ? adJson.data.length : 0,
      });
      if (!adRes.ok || adJson.error) throw new Error(adJson.error?.message ?? "GET /me/adaccounts falhou.");
      const adAccounts = Array.isArray(adJson.data) ? adJson.data : [];
      if (adAccounts.length === 0) throw new Error("Reconexão feita, mas /me/adaccounts não retornou contas de anúncios.");

      const pagesRes = await fetch(`${GRAPH}/me/accounts?fields=id,name,access_token,instagram_business_account{id,username}&limit=100&access_token=${tok}`);
      const pagesJson = (await pagesRes.json()) as { data?: Array<{ id: string; name: string; access_token: string; instagram_business_account?: { id?: string; username?: string } }>; error?: { message?: string } };
      if (!pagesRes.ok || pagesJson.error) throw new Error(pagesJson.error?.message ?? "GET /me/accounts falhou.");
      const pageList: AvailablePage[] = (pagesJson.data ?? []).map((p) => ({
        id: p.id,
        name: p.name,
        access_token: p.access_token,
        ig_business_account_id: p.instagram_business_account?.id ?? null,
        ig_username: p.instagram_business_account?.username ?? null,
      }));
      const preferredPageId = readiness?.pageId || "";
      const selectedPage = (preferredPageId ? pageList.find((p) => p.id === preferredPageId) : null) ?? (pageList.length === 1 ? pageList[0] : null);
      if (!selectedPage) throw new Error("Selecione a página Meta em Configurações para concluir a reconexão.");

      const { data: saveData, error: saveError } = await supabase.functions.invoke("meta-connect", {
        body: { mode: "connect_page", shortLivedToken: userToken, page: selectedPage },
      });
      if (saveError) throw saveError;
      const saveResult = saveData as { ok?: boolean; error?: string };
      if (saveResult?.ok === false) throw new Error(saveResult.error ?? "Falha ao salvar token USER Meta.");

      setAccounts(adAccounts.map((a) => ({
        id: String(a.id ?? ""),
        account_id: String((a.account_id as string | undefined) ?? String(a.id ?? "").replace(/^act_/, "")),
        name: String(a.name ?? a.id ?? ""),
        status: Number(a.account_status ?? 0),
        currency: String(a.currency ?? ""),
        timezone: String(a.timezone_name ?? ""),
        business: ((a.business as { name?: string } | undefined)?.name) ?? null,
        source: "me",
      })));
      setMissingScopes([]);
      toast.success(`Meta reconectada com token ${tokenType}.`);
      await refresh({ silent: true });
      await loadAssets();
    } catch (e) {
      console.error("META_RECONNECT_FAILED", safeErrorMessage(e));
      toast.error(e instanceof Error ? e.message : "Falha ao reconectar Meta.");
    } finally {
      setReconnecting(false);
    }
  }, [loadAssets, readiness?.pageId, refresh]);

  useEffect(() => { void refresh({ silent: true }); }, [refresh]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const pendingCode = window.sessionStorage.getItem("META_OAUTH_CODE");
    if (pendingCode) {
      const expected = window.sessionStorage.getItem("META_OAUTH_STATE");
      const received = window.sessionStorage.getItem("META_OAUTH_STATE_RX");
      window.sessionStorage.removeItem("META_OAUTH_CODE");
      window.sessionStorage.removeItem("META_OAUTH_STATE_RX");
      window.sessionStorage.removeItem("META_OAUTH_STATE");
      if (!expected || expected !== received) {
        toast.error("Sessão OAuth inválida. Tente conectar novamente.");
      } else {
        void completeReconnectWithCode(pendingCode);
      }
    }

    const onMessage = (ev: MessageEvent) => {
      if (ev.origin !== window.location.origin) return;
      const data = ev.data as { type?: string; code?: string; state?: string; error?: string } | null;
      if (!data || data.type !== "META_OAUTH_RESULT") return;
      if (data.error) {
        setReconnecting(false);
        toast.error(data.error);
        return;
      }
      if (data.code) {
        const expected = window.sessionStorage.getItem("META_OAUTH_STATE");
        window.sessionStorage.removeItem("META_OAUTH_STATE");
        if (!expected || expected !== data.state) {
          setReconnecting(false);
          toast.error("Sessão OAuth inválida. Tente conectar novamente.");
          return;
        }
        void completeReconnectWithCode(data.code);
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [completeReconnectWithCode]);

  const startMetaReconnect = useCallback(async () => {
    setReconnecting(true);
    try {
      const config = await getMetaBusinessConfig();
      if (!config.hasAppId) throw new Error("Configuração Meta incompleta: App ID ausente.");
      const state = crypto.randomUUID();
      window.sessionStorage.removeItem("META_OAUTH_TOKEN");
      window.localStorage.removeItem("META_OAUTH_TOKEN");
      window.sessionStorage.setItem("META_OAUTH_STATE", state);
      const base =
        `https://www.facebook.com/v21.0/dialog/oauth` +
        `?client_id=${encodeURIComponent(config.appId)}` +
        `&redirect_uri=${encodeURIComponent(META_REDIRECT_URI)}` +
        `&response_type=code` +
        `&state=${encodeURIComponent(state)}` +
        `&auth_type=rerequest`;
      const oauthUrl = config.hasBusinessConfigId && config.businessConfigId
        ? `${base}&config_id=${encodeURIComponent(config.businessConfigId)}`
        : `${base}&scope=${encodeURIComponent(META_REQUIRED_SCOPES)}`;
      console.log("META_RECONNECT_OAUTH_URL", { mode: config.hasBusinessConfigId ? "business_config" : "classic_scope" });
      const width = 600;
      const height = 720;
      const left = window.screenX + Math.max(0, (window.outerWidth - width) / 2);
      const top = window.screenY + Math.max(0, (window.outerHeight - height) / 2);
      const popup = window.open(oauthUrl, "meta-oauth", `width=${width},height=${height},left=${left},top=${top},resizable=yes,scrollbars=yes`);
      if (!popup) window.open(oauthUrl, "_blank", "noopener,noreferrer");
    } catch (e) {
      setReconnecting(false);
      toast.error(e instanceof Error ? e.message : "Falha ao iniciar reconexão Meta.");
    }
  }, []);

  // Carrega assets automaticamente assim que tivermos integração Meta conectada.
  useEffect(() => {
    if (readiness?.metaConnected && accounts === null && !loadingAccounts) {
      void loadAssets();
    }
  }, [readiness?.metaConnected, accounts, loadingAccounts, loadAssets]);

  async function persistAdAccount(adAccountId: string, integrationId?: string) {
    setSaving(true);
    try {
      const r = await saveAccount({ data: { adAccountId, integrationId } });
      if (r.ok) {
        toast.success(`Conta de anúncios salva: ${adAccountId}`);
        await refresh();
      } else {
        toast.error(("message" in r && r.message) || "Falha ao salvar conta.");
      }
    } finally { setSaving(false); }
  }

  async function removeManualAdAccount() {
    setSaving(true);
    try {
      const r = await clearAccount();
      if (r.ok) {
        toast.success(`ID manual removido (${r.cleared ?? 0} integração(ões)).`);
        await refresh({ silent: true });
        await loadAssets();
      } else {
        toast.error(("message" in r && r.message) || "Falha ao remover ID manual.");
      }
    } finally { setSaving(false); }
  }

  async function persistPage(pageId: string) {
    setSaving(true);
    try {
      const r = await savePage({ data: { pageId } });
      if (r.ok) {
        toast.success(`Página salva: ${pageId}`);
        await refresh();
      } else {
        toast.error(("message" in r && r.message) || "Falha ao salvar página.");
      }
    } finally { setSaving(false); }
  }

  // Auto-select se houver exatamente 1 conta de anúncios e ainda nada selecionado.
  useEffect(() => {
    if (autoSelectedRef.current) return;
    if (!readiness || readiness.adAccountId) return;
    if (!accounts || accounts.length !== 1) return;
    autoSelectedRef.current = true;
    console.log("[MetaPanel] auto-selecting single ad account", accounts[0]);
    void persistAdAccount(accounts[0].account_id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accounts, readiness]);

  async function onToggleBeta(enabled: boolean) {
    setTogglingBeta(true);
    try {
      const r = await toggleBeta({ data: { enabled } });
      if (r.ok) { toast.success(enabled ? "Beta ativado." : "Beta desativado."); await refresh(); }
      else toast.error(("message" in r && r.message) || "Falha ao alterar flag.");
    } finally { setTogglingBeta(false); }
  }

  if (loading && !readiness) {
    return (
      <div className="rounded-xl border bg-card p-4 text-sm text-muted-foreground flex items-center gap-2">
        <Loader2 className="h-4 w-4 animate-spin" /> Verificando prontidão Meta…
      </div>
    );
  }
  if (!readiness) return null;

  const channel = campaign.objective; // "whatsapp" | "messenger" | "instagram"
  const goalValid = campaign.goal === "leads";
  const imageValid = Boolean(campaign.media_url) && campaign.media_type !== "video";
  const budgetValid = Number(campaign.daily_budget ?? 0) > 0;
  const campaignValid = goalValid && Number(campaign.daily_budget ?? 0) > 0;
  const channelLabelMap = { whatsapp: "WhatsApp", messenger: "Messenger", instagram: "Instagram" } as const;

  const selectedAdNorm = readiness.adAccountId.replace(/^act_/, "");
  const adAccountFromGraph = Boolean(
    readiness.adAccountId && accounts && accounts.some((a) => a.account_id === selectedAdNorm),
  );
  const isManualAdAccount = Boolean(
    readiness.adAccountId && accounts !== null && !adAccountFromGraph,
  );
  const adAccountHint = readiness.adAccountId
    ? `${readiness.adAccountId}${isManualAdAccount ? " (manual — não validado)" : ""}`
    : "Escolha ou digite o ID abaixo.";

  // Checks comuns
  const baseChecks = [
    { ok: readiness.betaEnabled, label: "Beta Meta Ads liberado" },
    { ok: readiness.metaConnected, label: "Meta conectado", hint: readiness.metaConnected ? `${readiness.integrationCount} integração(ões)` : "Conecte a Meta." },
    { ok: adAccountFromGraph, label: "Conta de anúncios selecionada", hint: adAccountHint },
    { ok: Boolean(readiness.pageId), label: "Página Facebook selecionada", hint: readiness.pageId || "Escolha a página abaixo." },
  ];

  // Checks específicos por canal
  const channelChecks =
    channel === "whatsapp"
      ? [
          { ok: readiness.whatsappConnected, label: "WhatsApp Business conectado" },
          { ok: campaignValid, label: "Campanha válida (WhatsApp + Leads)" },
        ]
      : channel === "messenger"
      ? [
          { ok: Boolean(readiness.pageId), label: "Página Facebook vinculada (Messenger)" },
          { ok: campaignValid, label: "Campanha válida (Messenger + Leads)" },
        ]
      : [
          { ok: Boolean(readiness.igBusinessAccountId), label: "Instagram Business vinculado", hint: readiness.igBusinessAccountId || "Vincule um Instagram à página." },
          { ok: Boolean(readiness.pageId), label: "Página Facebook vinculada (Instagram)" },
          { ok: campaignValid, label: "Campanha válida (Instagram + Leads)" },
        ];

  const checks = [
    ...baseChecks,
    ...channelChecks,
    { ok: imageValid, label: "Imagem válida" },
    { ok: budgetValid, label: "Orçamento diário válido" },
  ];
  void channelLabelMap;
  const passed = checks.filter((c) => c.ok).length;
  const ready = checks.every((c) => c.ok);

  return (
    <div className="rounded-xl border bg-card overflow-hidden">
      <button type="button" onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between gap-3 p-4 text-left hover:bg-muted/30 transition">
        <div className="flex items-center gap-2 min-w-0">
          <ShieldCheck className={cn("h-4 w-4 shrink-0", ready ? "text-emerald-500" : "text-amber-500")} />
          <div className="min-w-0">
            <h2 className="text-sm font-semibold">Prontidão para publicar na Meta</h2>
            <p className="text-xs text-muted-foreground">
              {passed}/{checks.length} requisitos {ready ? "· tudo pronto" : "· complete antes de publicar"}
            </p>
          </div>
        </div>
        {open ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
      </button>

      {open && (
        <div className="border-t p-4 space-y-4">
          <ul className="grid sm:grid-cols-2 gap-x-4 gap-y-2">
            {checks.map((c) => <CheckRow key={c.label} ok={c.ok} label={c.label} hint={c.hint} />)}
          </ul>

          {/* Ações */}
          <div className="flex flex-wrap items-center gap-2 pt-2 border-t">
            {readiness.isAdmin && !readiness.betaEnabled && (
              <button onClick={() => onToggleBeta(true)} disabled={togglingBeta}
                className="inline-flex items-center gap-1 h-8 px-3 rounded-md bg-primary text-primary-foreground text-xs font-medium hover:bg-primary/90 disabled:opacity-60">
                {togglingBeta ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null} Ativar Beta
              </button>
            )}
            <button onClick={() => { setAccounts(null); setPages(null); void loadAssets(); }}
              disabled={loadingAccounts}
              className="inline-flex items-center gap-1 h-8 px-3 rounded-md border text-xs hover:bg-muted disabled:opacity-60">
              {loadingAccounts ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
              Recarregar assets Meta
            </button>
            <button onClick={startMetaReconnect}
              disabled={reconnecting}
              className="inline-flex items-center gap-1 h-8 px-3 rounded-md border text-xs hover:bg-muted disabled:opacity-60">
              {reconnecting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
              Reconectar Meta
            </button>
            <button onClick={() => { void refresh(); }}
              disabled={loading}
              className="inline-flex items-center gap-1 h-8 px-2 rounded-md text-xs text-muted-foreground hover:text-foreground disabled:opacity-60">
              {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
              Reverificar
            </button>
          </div>

          {/* Picker de conta de anúncios */}
          {readiness.metaConnected && (
            <div className="rounded-lg border bg-muted/20 p-3 space-y-3">
              <div className="text-xs font-medium">Conta de anúncios</div>

              {isManualAdAccount && (
                <div className="flex items-start gap-2 text-[11px] text-amber-700 dark:text-amber-300 bg-amber-500/10 rounded p-2">
                  <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                  <div className="flex-1 space-y-1.5">
                    <div>
                      <span className="inline-block mr-1 px-1.5 py-0.5 rounded bg-amber-500/20 text-[10px] font-semibold uppercase tracking-wide">
                        Manual
                      </span>
                      ID <code>{readiness.adAccountId}</code> salvo manualmente. Não foi retornado pela Graph API e não comprova permissão válida — publicação bloqueada até reconectar.
                    </div>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={removeManualAdAccount}
                        disabled={saving}
                        className="inline-flex items-center gap-1 h-7 px-2 rounded-md bg-amber-500/20 hover:bg-amber-500/30 text-amber-700 dark:text-amber-300 font-medium"
                      >
                        {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : <X className="h-3 w-3" />}
                        Remover ID manual
                      </button>
                      <button
                        type="button"
                        onClick={startMetaReconnect}
                        disabled={reconnecting}
                        className="inline-flex items-center gap-1 h-7 px-2 rounded-md bg-amber-500/20 hover:bg-amber-500/30 text-amber-700 dark:text-amber-300 font-medium"
                      >
                        {reconnecting ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
                        Reconectar Meta
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {missingScopes.length > 0 && (
                <div className="flex items-start gap-2 text-[11px] text-amber-600 dark:text-amber-400 bg-amber-500/10 rounded p-2">
                  <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                  <div className="flex-1 space-y-1.5">
                    <div>Permissões faltando no token: {missingScopes.join(", ")}.</div>
                    <button
                      type="button"
                      onClick={startMetaReconnect}
                      disabled={reconnecting}
                      className="inline-flex items-center gap-1 h-7 px-2 rounded-md bg-amber-500/20 hover:bg-amber-500/30 text-amber-700 dark:text-amber-300 font-medium"
                    >
                      {reconnecting ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
                      Reconectar Meta
                    </button>
                  </div>
                </div>
              )}

              {loadingAccounts ? (
                <div className="text-xs text-muted-foreground flex items-center gap-2">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" /> Carregando contas via Graph API…
                </div>
              ) : accounts && accounts.length > 0 ? (
                <ul className="space-y-1.5 max-h-56 overflow-auto">
                  {accounts.map((a) => {
                    const selected = a.account_id === selectedAdNorm;
                    const statusLabel = ACCOUNT_STATUS_LABEL[a.status] ?? `Status ${a.status}`;
                    return (
                      <li key={a.id}>
                        <button type="button" onClick={() => persistAdAccount(a.account_id)} disabled={saving}
                          className={cn("w-full text-left rounded-md border p-2 hover:bg-card transition disabled:opacity-60",
                            selected && "border-primary bg-primary/5")}>
                          <div className="flex items-center justify-between gap-2">
                            <div className="min-w-0">
                              <div className="text-sm font-medium truncate">{a.name}</div>
                              <div className="text-[11px] text-muted-foreground truncate">
                                ID {a.account_id} · {statusLabel} · {a.currency || "—"}{a.business ? ` · ${a.business}` : ""}
                              </div>
                            </div>
                            {selected && <span className="text-[10px] px-1.5 py-0.5 rounded bg-primary/15 text-primary">Selecionada</span>}
                          </div>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <div className="text-xs text-muted-foreground">
                  Nenhuma conta de anúncios retornada pela Graph API. Cole abaixo o ID da conta (do Gerenciador de Anúncios).
                </div>
              )}

              {/* Entrada manual sempre disponível como fallback */}
              <div className="flex gap-2 items-center pt-2 border-t border-dashed">
                <input
                  type="text"
                  inputMode="numeric"
                  placeholder="ID da conta (ex: 1234567890 ou act_1234567890)"
                  value={manualAd}
                  onChange={(e) => setManualAd(e.target.value.trim())}
                  className="flex-1 h-8 px-2 rounded border bg-background text-xs"
                />
                <button
                  disabled={saving || !/^(act_)?[0-9]+$/.test(manualAd)}
                  onClick={() => persistAdAccount(manualAd)}
                  className="inline-flex items-center gap-1 h-8 px-3 rounded-md bg-primary text-primary-foreground text-xs font-medium hover:bg-primary/90 disabled:opacity-60"
                >
                  Salvar ID manual
                </button>
              </div>
            </div>
          )}

          {/* Diagnóstico seguro de token Meta manual (admin) */}
          {readiness.isAdmin && (
            <div className="rounded-lg border bg-muted/20 p-3 space-y-3">
              <div className="flex items-center justify-between gap-2">
                <div className="text-xs font-medium">Diagnóstico de token Meta (manual)</div>
                <span className="text-[10px] text-muted-foreground">não salva sem confirmação</span>
              </div>
              <p className="text-[11px] text-muted-foreground">
                Cole um token gerado em <code>developers.facebook.com</code> (Graph API Explorer) para validar tipo e
                permissões. O token completo não é exibido nem registrado em logs.
              </p>
              <div className="flex gap-2 items-center">
                <input
                  type="password"
                  autoComplete="off"
                  placeholder="EAAB... (cole o token aqui)"
                  value={manualToken}
                  onChange={(e) => setManualToken(e.target.value)}
                  className="flex-1 h-8 px-2 rounded border bg-background text-xs font-mono"
                />
                <button
                  type="button"
                  disabled={diagnosing || manualToken.trim().length < 20}
                  onClick={runDiagnosis}
                  className="inline-flex items-center gap-1 h-8 px-3 rounded-md border text-xs hover:bg-muted disabled:opacity-60"
                >
                  {diagnosing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ShieldCheck className="h-3.5 w-3.5" />}
                  Diagnosticar
                </button>
              </div>

              {diagnosis && (
                <div className="space-y-2 rounded-md border bg-background p-2 text-[11px]">
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    <span>
                      <strong>Token:</strong> <code>{diagnosis.tokenSuffix}</code>
                    </span>
                    <span>
                      <strong>Type:</strong>{" "}
                      <code
                        className={cn(
                          diagnosis.debugToken.type === "USER" || diagnosis.debugToken.type === "SYSTEM_USER"
                            ? "text-emerald-600 dark:text-emerald-400"
                            : "text-red-600 dark:text-red-400",
                        )}
                      >
                        {diagnosis.debugToken.type ?? "?"}
                      </code>
                    </span>
                    <span>
                      <strong>is_valid:</strong>{" "}
                      <code>{diagnosis.debugToken.is_valid ? "true" : "false"}</code>
                    </span>
                    <span>
                      <strong>app_id:</strong> <code>{diagnosis.debugToken.app_id ?? "?"}</code>
                    </span>
                    {diagnosis.debugToken.expires_at ? (
                      <span>
                        <strong>expira:</strong>{" "}
                        <code>{new Date(diagnosis.debugToken.expires_at * 1000).toLocaleString("pt-BR")}</code>
                      </span>
                    ) : null}
                  </div>

                  <div className="flex flex-wrap gap-1.5">
                    {[
                      ["ads_read", diagnosis.debugToken.has_ads_read],
                      ["ads_management", diagnosis.debugToken.has_ads_management],
                      ["business_management", diagnosis.debugToken.has_business_management],
                      ["pages_show_list", diagnosis.debugToken.has_pages_show_list],
                    ].map(([name, ok]) => (
                      <span
                        key={String(name)}
                        className={cn(
                          "inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium",
                          ok
                            ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300"
                            : "bg-red-500/15 text-red-700 dark:text-red-300",
                        )}
                      >
                        {ok ? <Check className="h-3 w-3" /> : <X className="h-3 w-3" />} {String(name)}
                      </span>
                    ))}
                  </div>

                  <div>
                    <strong>granted_scopes ({diagnosis.debugToken.scopes?.length ?? 0}):</strong>
                    <div className="mt-1 flex flex-wrap gap-1">
                      {(diagnosis.debugToken.scopes ?? []).map((s) => (
                        <span key={s} className="px-1.5 py-0.5 rounded bg-muted text-[10px] font-mono">{s}</span>
                      ))}
                      {(!diagnosis.debugToken.scopes || diagnosis.debugToken.scopes.length === 0) && (
                        <span className="text-red-600 dark:text-red-400">nenhum</span>
                      )}
                    </div>
                  </div>



                  <div>
                    <strong>/me:</strong>{" "}
                    {diagnosis.me
                      ? <code>{diagnosis.me.name} ({diagnosis.me.id})</code>
                      : <span className="text-red-600 dark:text-red-400">{diagnosis.meError ?? "—"}</span>}
                  </div>

                  <div>
                    <strong>/me/adaccounts:</strong>{" "}
                    {diagnosis.adAccounts.length > 0 ? (
                      <span>
                        {diagnosis.adAccounts.length} conta(s) ·{" "}
                        <code>{diagnosis.adAccounts.map((a) => `act_${a.account_id}`).join(", ")}</code>
                      </span>
                    ) : (
                      <span className="text-red-600 dark:text-red-400">{diagnosis.adAccountsError ?? "vazio"}</span>
                    )}
                  </div>

                  {(() => {
                    const isUser =
                      diagnosis.debugToken.type === "USER" || diagnosis.debugToken.type === "SYSTEM_USER";
                    const hasTarget = diagnosis.adAccounts.some(
                      (a) => a.account_id === "504693369540667" || `act_${a.account_id}` === "act_504693369540667",
                    );
                    if (!isUser) {
                      return (
                        <div className="text-red-700 dark:text-red-300">
                          Token rejeitado: não é USER/SYSTEM_USER. Não pode ser salvo.
                        </div>
                      );
                    }
                    if (!hasTarget) {
                      return (
                        <div className="text-amber-700 dark:text-amber-300">
                          Token USER válido, mas a conta <code>act_504693369540667</code> não aparece em /me/adaccounts.
                        </div>
                      );
                    }
                    return (
                      <div className="pt-1">
                        <button
                          type="button"
                          disabled={adopting}
                          onClick={adoptDiagnosedToken}
                          className="inline-flex items-center gap-1 h-8 px-3 rounded-md bg-primary text-primary-foreground text-xs font-medium hover:bg-primary/90 disabled:opacity-60"
                        >
                          {adopting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                          Usar este token para Meta Ads
                        </button>
                      </div>
                    );
                  })()}
                </div>
              )}
            </div>
          )}

          {/* Verificação do token persistido em integrations.access_token */}
          {verification && (
            <div className={cn(
              "rounded-lg border p-3 space-y-2 text-xs",
              verification.ok
                ? "border-emerald-500/40 bg-emerald-500/5"
                : "border-red-500/40 bg-red-500/5",
            )}>
              <div className="font-medium">
                {verification.ok
                  ? "Verificação do token persistido"
                  : "Erro de verificação"}
                {verification.persistedTokenSuffix && (
                  <span className="ml-2 font-mono text-muted-foreground">
                    {verification.persistedTokenSuffix}
                  </span>
                )}
              </div>
              {!verification.ok && (
                <div className="text-red-700 dark:text-red-300">
                  {verification.message || "Falha ao persistir USER token."}
                </div>
              )}
              {verification.ok && verification.debugToken && (
                <>
                  <div>
                    token_type: <strong>{verification.debugToken.type ?? "?"}</strong> · is_valid: <strong>{String(verification.debugToken.is_valid)}</strong>
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {verification.debugToken.scopes.map((s) => (
                      <span key={s} className="px-1.5 py-0.5 rounded bg-muted text-[10px]">{s}</span>
                    ))}
                  </div>
                  <div>
                    GET /me: {verification.me
                      ? <strong>{verification.me.name} ({verification.me.id})</strong>
                      : <span className="text-red-700 dark:text-red-300">{verification.meError ?? "sem retorno"}</span>}
                  </div>
                  <div>
                    GET /me/adaccounts: <strong>{verification.adAccounts?.length ?? 0}</strong> conta(s)
                    {verification.adAccountsError && (
                      <span className="ml-1 text-red-700 dark:text-red-300">— {verification.adAccountsError}</span>
                    )}
                  </div>
                  {verification.adAccounts && verification.adAccounts.length > 0 && (
                    <ul className="space-y-0.5 max-h-32 overflow-auto">
                      {verification.adAccounts.map((a) => (
                        <li key={a.id} className="font-mono text-[11px]">
                          act_{a.account_id} — {a.name}
                        </li>
                      ))}
                    </ul>
                  )}
                </>
              )}
            </div>
          )}




          {/* Picker de página */}
          {readiness.metaConnected && pages && pages.length > 0 && (
            <div className="rounded-lg border bg-muted/20 p-3 space-y-2">
              <div className="text-xs font-medium">Página Facebook ({pages.length} disponíveis)</div>
              <ul className="space-y-1.5 max-h-48 overflow-auto">
                {pages.map((p) => {
                  const selected = p.page_id === readiness.pageId;
                  return (
                    <li key={p.id}>
                      <button type="button" onClick={() => persistPage(p.page_id)} disabled={saving}
                        className={cn("w-full text-left rounded-md border p-2 hover:bg-card transition disabled:opacity-60",
                          selected && "border-primary bg-primary/5")}>
                        <div className="flex items-center justify-between gap-2">
                          <div className="min-w-0">
                            <div className="text-sm font-medium truncate">{p.page_name}</div>
                            <div className="text-[11px] text-muted-foreground truncate">
                              ID {p.page_id}{p.ig_username ? ` · @${p.ig_username}` : ""}
                            </div>
                          </div>
                          {selected && <span className="text-[10px] px-1.5 py-0.5 rounded bg-primary/15 text-primary">Selecionada</span>}
                        </div>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
