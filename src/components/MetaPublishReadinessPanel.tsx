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
} from "@/lib/meta-ads.functions";
import type { Campaign } from "@/lib/campaigns";
import { Check, X, Loader2, RefreshCw, ChevronDown, ChevronUp, ShieldCheck, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

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

  const refresh = useCallback(async (opts?: { silent?: boolean }) => {
    console.log("[MetaPanel] refresh readiness");
    setLoading(true);
    try {
      const r = await fetchReadiness();
      console.log("[MetaPanel] readiness response", r);
      if (r.ok) {
        setReadiness(r as Readiness);
        if (!opts?.silent) toast.success("Status atualizado.");
      } else {
        toast.error((("message" in r && typeof r.message === "string" && r.message) || "Falha ao verificar prontidão."));
      }
    } catch (e) {
      console.error("[MetaPanel] refresh error", e);
      toast.error(e instanceof Error ? e.message : "Erro ao verificar prontidão.");
    } finally { setLoading(false); }
  }, [fetchReadiness]);

  const loadAssets = useCallback(async () => {
    console.log("[MetaPanel] load assets clicked");
    setLoadingAccounts(true);
    try {
      const [a, p] = await Promise.all([fetchAccounts(), fetchPages()]);
      console.log("[MetaPanel] assets response", { accounts: a, pages: p });
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
      console.error("[MetaPanel] loadAssets error", e);
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
        me: debug.me ?? null,
        has_ads_read: scopes.includes("ads_read"),
        has_ads_management: scopes.includes("ads_management"),
      });
      if (tokenType !== "USER" && tokenType !== "SYSTEM_USER") {
        throw new Error("Reconexão inválida: token de Página salvo. Reconecte com token de usuário.");
      }

      const tok = encodeURIComponent(userToken);
      const adRes = await fetch(`${GRAPH}/me/adaccounts?fields=id,account_id,name,account_status,currency,timezone_name,business{id,name}&limit=200&access_token=${tok}`);
      const adJson = (await adRes.json()) as { data?: Array<Record<string, unknown>>; error?: { message?: string } };
      console.log("META_RECONNECT_ME_ADACCOUNTS", { status: adRes.status, ok: adRes.ok, payload: adJson });
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
      console.error("META_RECONNECT_FAILED", e);
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
      window.sessionStorage.removeItem("META_OAUTH_CODE");
      window.sessionStorage.removeItem("META_OAUTH_STATE_RX");
      void completeReconnectWithCode(pendingCode);
    }

    const onMessage = (ev: MessageEvent) => {
      if (ev.origin !== window.location.origin) return;
      const data = ev.data as { type?: string; code?: string; error?: string } | null;
      if (!data || data.type !== "META_OAUTH_RESULT") return;
      if (data.error) {
        setReconnecting(false);
        toast.error(data.error);
        return;
      }
      if (data.code) void completeReconnectWithCode(data.code);
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
        `&auth_type=reauthenticate`;
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
  const selectedAdNorm = readiness.adAccountId.replace(/^act_/, "");

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
