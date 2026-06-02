// MetaPublishReadinessPanel — checklist + seleção de conta de anúncios Meta.
// Aparece na tela de detalhe da campanha, ANTES do botão "Publicar campanha".
// Não toca em inbox/WhatsApp/IA/storage — só lê e atualiza integrations/companies.

import { useEffect, useState, useCallback } from "react";
import { useServerFn } from "@tanstack/react-start";
import {
  getMetaPublishReadiness,
  listMetaAdAccounts,
  selectMetaAdAccount,
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
};

const ACCOUNT_STATUS_LABEL: Record<number, string> = {
  1: "Ativa",
  2: "Desativada",
  3: "Não solucionada",
  7: "Pendente análise",
  9: "Em revisão",
  101: "Encerrada",
  102: "Qualquer ativa",
  201: "Pausada por admin",
  202: "Pendência financeira",
};

function CheckRow({ ok, label, hint }: { ok: boolean; label: string; hint?: string }) {
  return (
    <li className="flex items-start gap-2 text-sm">
      <span
        className={cn(
          "mt-0.5 inline-flex h-5 w-5 items-center justify-center rounded-full shrink-0",
          ok ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400" : "bg-muted text-muted-foreground",
        )}
      >
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
  const [pickerOpen, setPickerOpen] = useState(false);
  const [accounts, setAccounts] = useState<AdAccount[] | null>(null);
  const [loadingAccounts, setLoadingAccounts] = useState(false);
  const [missingScopes, setMissingScopes] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [togglingBeta, setTogglingBeta] = useState(false);

  const fetchReadiness = useServerFn(getMetaPublishReadiness);
  const fetchAccounts = useServerFn(listMetaAdAccounts);
  const saveAccount = useServerFn(selectMetaAdAccount);
  const toggleBeta = useServerFn(setMetaBetaFlag);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetchReadiness();
      if (r.ok) setReadiness(r as Readiness);
    } catch {
      /* noop */
    } finally {
      setLoading(false);
    }
  }, [fetchReadiness]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function openPicker() {
    setPickerOpen((v) => !v);
    if (accounts || loadingAccounts) return;
    setLoadingAccounts(true);
    try {
      const r = await fetchAccounts();
      if (r.ok) {
        setAccounts(r.accounts as AdAccount[]);
        setMissingScopes(r.missingScopes as string[]);
      } else {
        toast.error(("message" in r && r.message) || "Erro ao listar contas Meta.");
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao listar contas Meta.");
    } finally {
      setLoadingAccounts(false);
    }
  }

  async function pickAccount(acc: AdAccount) {
    if (!readiness?.integrationId || saving) return;
    setSaving(true);
    try {
      const r = await saveAccount({
        data: { integrationId: readiness.integrationId, adAccountId: acc.account_id },
      });
      if (r.ok) {
        toast.success(`Conta selecionada: ${acc.name}`);
        await refresh();
        setPickerOpen(false);
      } else {
        toast.error(("message" in r && r.message) || "Falha ao salvar conta.");
      }
    } finally {
      setSaving(false);
    }
  }

  async function onToggleBeta(enabled: boolean) {
    if (togglingBeta) return;
    setTogglingBeta(true);
    try {
      const r = await toggleBeta({ data: { enabled } });
      if (r.ok) {
        toast.success(enabled ? "Beta Meta Ads ativado." : "Beta Meta Ads desativado.");
        await refresh();
      } else {
        toast.error(("message" in r && r.message) || "Falha ao alterar flag.");
      }
    } finally {
      setTogglingBeta(false);
    }
  }

  if (loading && !readiness) {
    return (
      <div className="rounded-xl border bg-card p-4 text-sm text-muted-foreground flex items-center gap-2">
        <Loader2 className="h-4 w-4 animate-spin" /> Verificando prontidão Meta…
      </div>
    );
  }
  if (!readiness) return null;

  const campaignValid =
    campaign.objective === "whatsapp" &&
    campaign.goal === "leads" &&
    Number(campaign.daily_budget ?? 0) > 0;
  const imageValid = Boolean(campaign.media_url) && campaign.media_type !== "video";
  const budgetValid = Number(campaign.daily_budget ?? 0) > 0;

  const checks = [
    { ok: readiness.betaEnabled, label: "Beta Meta Ads liberado", hint: readiness.betaEnabled ? undefined : "Ative o beta para esta empresa." },
    { ok: readiness.metaConnected, label: "Meta conectado", hint: readiness.metaConnected ? readiness.integrationName : "Conecte a Meta na tela de WhatsApp/Integrações." },
    { ok: Boolean(readiness.adAccountId), label: "Conta de anúncios selecionada", hint: readiness.adAccountId || "Escolha uma conta abaixo." },
    { ok: Boolean(readiness.pageId), label: "Página Facebook selecionada", hint: readiness.pageId || "Vincule uma página Facebook." },
    { ok: readiness.whatsappConnected, label: "WhatsApp conectado" },
    { ok: campaignValid, label: "Campanha válida (WhatsApp + Leads)" },
    { ok: imageValid, label: "Imagem válida" },
    { ok: budgetValid, label: "Orçamento diário válido" },
  ];
  const passed = checks.filter((c) => c.ok).length;
  const ready = checks.every((c) => c.ok);

  return (
    <div className="rounded-xl border bg-card overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between gap-3 p-4 text-left hover:bg-muted/30 transition"
      >
        <div className="flex items-center gap-2 min-w-0">
          <ShieldCheck className={cn("h-4 w-4 shrink-0", ready ? "text-emerald-500" : "text-amber-500")} />
          <div className="min-w-0">
            <h2 className="text-sm font-semibold">Prontidão para publicar na Meta</h2>
            <p className="text-xs text-muted-foreground">
              {passed}/{checks.length} requisitos atendidos {ready ? "· tudo pronto" : "· complete antes de publicar"}
            </p>
          </div>
        </div>
        {open ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
      </button>

      {open && (
        <div className="border-t p-4 space-y-4">
          <ul className="grid sm:grid-cols-2 gap-x-4 gap-y-2">
            {checks.map((c) => (
              <CheckRow key={c.label} ok={c.ok} label={c.label} hint={c.hint} />
            ))}
          </ul>

          {/* Ações */}
          <div className="flex flex-wrap items-center gap-2 pt-2 border-t">
            {readiness.isAdmin && !readiness.betaEnabled && (
              <button
                onClick={() => onToggleBeta(true)}
                disabled={togglingBeta}
                className="inline-flex items-center gap-1 h-8 px-3 rounded-md bg-primary text-primary-foreground text-xs font-medium hover:bg-primary/90 disabled:opacity-60"
              >
                {togglingBeta ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                Ativar Beta Meta Ads
              </button>
            )}
            {readiness.isAdmin && readiness.betaEnabled && (
              <button
                onClick={() => onToggleBeta(false)}
                disabled={togglingBeta}
                className="inline-flex items-center gap-1 h-8 px-3 rounded-md border text-xs hover:bg-muted disabled:opacity-60"
              >
                Desativar Beta
              </button>
            )}
            {readiness.metaConnected && (
              <button
                onClick={openPicker}
                className="inline-flex items-center gap-1 h-8 px-3 rounded-md border text-xs hover:bg-muted"
              >
                <RefreshCw className="h-3.5 w-3.5" /> Escolher conta de anúncios
              </button>
            )}
            <button
              onClick={refresh}
              className="inline-flex items-center gap-1 h-8 px-2 rounded-md text-xs text-muted-foreground hover:text-foreground"
            >
              Reverificar
            </button>
          </div>

          {/* Picker de conta de anúncios */}
          {pickerOpen && (
            <div className="rounded-lg border bg-muted/20 p-3 space-y-2">
              <div className="text-xs font-medium">Contas de anúncios disponíveis</div>
              {missingScopes.length > 0 && (
                <div className="flex items-start gap-2 text-[11px] text-amber-600 dark:text-amber-400 bg-amber-500/10 rounded p-2">
                  <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                  <div>
                    Permissões faltando no token: {missingScopes.join(", ")}. Reconecte a Meta concedendo essas permissões para publicar anúncios.
                  </div>
                </div>
              )}
              {loadingAccounts ? (
                <div className="text-xs text-muted-foreground flex items-center gap-2">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" /> Carregando contas…
                </div>
              ) : accounts && accounts.length > 0 ? (
                <ul className="space-y-1.5 max-h-64 overflow-auto">
                  {accounts.map((a) => {
                    const selected = a.account_id === readiness.adAccountId.replace(/^act_/, "");
                    const statusLabel = ACCOUNT_STATUS_LABEL[a.status] ?? `Status ${a.status}`;
                    return (
                      <li key={a.id}>
                        <button
                          type="button"
                          onClick={() => pickAccount(a)}
                          disabled={saving}
                          className={cn(
                            "w-full text-left rounded-md border p-2 hover:bg-card transition disabled:opacity-60",
                            selected && "border-primary bg-primary/5",
                          )}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <div className="min-w-0">
                              <div className="text-sm font-medium truncate">{a.name}</div>
                              <div className="text-[11px] text-muted-foreground truncate">
                                ID {a.account_id} · {statusLabel} · {a.currency || "—"} · {a.timezone || "—"}
                                {a.business ? ` · ${a.business}` : ""}
                              </div>
                            </div>
                            {selected && (
                              <span className="text-[10px] px-1.5 py-0.5 rounded bg-primary/15 text-primary">
                                Selecionada
                              </span>
                            )}
                          </div>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <div className="text-xs text-muted-foreground">Nenhuma conta de anúncios encontrada para este token.</div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
