import { createFileRoute, Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { useSyncExternalStore, useState, useEffect, useCallback } from "react";
import {
  Settings as SettingsIcon,
  Clock,
  Check,
  XCircle,
  Plus,
  Pencil,
  Trash2,
  X,
  MessageCircle,
  Plug,
  Power,
  PowerOff,
  Copy,
  Loader2,
  AlertTriangle,
  Bell,
  MapPin,
  Crosshair,
} from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { sanitizeForLog, safeErrorMessage, summarizeHttp } from "@/lib/audit/sanitize";
import {
  getNotificationPrefs,
  setNotificationPrefs,
  subscribeNotificationPrefs,
  getBrowserPermission,
  requestBrowserPermission,
} from "@/lib/notification-prefs";
import {
  getSettings,
  subscribeSettings,
  updateSettings,
  addLossReason,
  updateLossReason,
  removeLossReason,
  SLA_OPTIONS,
} from "@/data/settings";
import {
  listIntegrations,
  upsertWhatsAppIntegration,
  setIntegrationActive,
  deleteIntegration,
  renewWhatsAppToken,
  validateWhatsAppToken,
  type Integration,
} from "@/data/integrationRepo";
import { useAuth } from "@/auth/AuthContext";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { MetaDisconnectButton } from "@/components/MetaDisconnectButton";
import { LossReasonsSection } from "@/components/configuracoes/LossReasonsSection";
import { MetaIntegrationSection } from "@/components/configuracoes/MetaIntegrationSection";
import { WhatsAppUnmappedPanel } from "@/components/configuracoes/WhatsAppUnmappedPanel";
import { NotificationsCard } from "@/components/configuracoes/NotificationsCard";
import { CompanyLocationCard } from "@/components/configuracoes/CompanyLocationCard";

export const Route = createFileRoute("/configuracoes")({
  component: ConfigPage,
});

function useSettings() {
  return useSyncExternalStore(subscribeSettings, getSettings, getSettings);
}

function ConfigPage() {
  const settings = useSettings();
  const [customMinutes, setCustomMinutes] = useState<string>(
    String(settings.slaMinutes),
  );
  const [savedAt, setSavedAt] = useState<number | null>(null);

  useEffect(() => {
    setCustomMinutes(String(settings.slaMinutes));
  }, [settings.slaMinutes]);

  const isPreset = SLA_OPTIONS.some((o) => o.minutes === settings.slaMinutes);

  const apply = (minutes: number) => {
    if (!Number.isFinite(minutes) || minutes <= 0) return;
    updateSettings({ slaMinutes: Math.round(minutes) });
    setSavedAt(Date.now());
  };

  return (
    <div className="flex-1 overflow-y-auto">
      <header className="h-14 px-4 md:px-6 border-b border-border flex items-center gap-3">
        <SettingsIcon className="h-4 w-4 text-primary" />
        <div>
          <h1 className="text-sm font-semibold">Configurações</h1>
          <p className="text-[11px] text-muted-foreground">
            SLA, integrações e preferências da loja
          </p>
        </div>
      </header>

      <div className="p-4 md:p-6 max-w-2xl space-y-8">
        <Link
          to="/configuracoes/usuarios"
          className="flex items-center justify-between gap-3 rounded-lg border border-border bg-card p-4 hover:bg-accent/40 transition-colors"
        >
          <div className="flex items-center gap-3">
            <div className="h-9 w-9 rounded-md bg-primary/10 grid place-items-center">
              <SettingsIcon className="h-4 w-4 text-primary" />
            </div>
            <div>
              <h2 className="text-sm font-semibold">Usuários e Permissões</h2>
              <p className="text-[11px] text-muted-foreground">
                Convide pessoas, defina papéis e gerencie acesso
              </p>
            </div>
          </div>
          <span className="text-xs text-muted-foreground">→</span>
        </Link>

        <Link
          to="/configuracoes/identidade-visual"
          className="flex items-center justify-between gap-3 rounded-lg border border-border bg-card p-4 hover:bg-accent/40 transition-colors"
        >
          <div className="flex items-center gap-3">
            <div className="h-9 w-9 rounded-md bg-primary/10 grid place-items-center">
              <SettingsIcon className="h-4 w-4 text-primary" />
            </div>
            <div>
              <h2 className="text-sm font-semibold">Identidade Visual</h2>
              <p className="text-[11px] text-muted-foreground">
                Logo, cores, tipografia e tokens da marca
              </p>
            </div>
          </div>
          <span className="text-xs text-muted-foreground">→</span>
        </Link>

        <Link
          to="/configuracoes/respostas-rapidas"
          className="flex items-center justify-between gap-3 rounded-lg border border-border bg-card p-4 hover:bg-accent/40 transition-colors"
        >
          <div className="flex items-center gap-3">
            <div className="h-9 w-9 rounded-md bg-primary/10 grid place-items-center">
              <MessageCircle className="h-4 w-4 text-primary" />
            </div>
            <div>
              <h2 className="text-sm font-semibold">Respostas Rápidas</h2>
              <p className="text-[11px] text-muted-foreground">
                Mensagens prontas no botão ➕ do Inbox (itens inclusos, brindes, pagamento…)
              </p>
            </div>
          </div>
          <span className="text-xs text-muted-foreground">→</span>
        </Link>

        <NotificationsCard />

        <CompanyLocationCard />



        <section className="rounded-lg border border-border bg-card p-5">
          <div className="flex items-center gap-2 mb-1">
            <Clock className="h-4 w-4 text-primary" />
            <h2 className="text-sm font-semibold">SLA — Tempo máximo de resposta</h2>
          </div>
          <p className="text-xs text-muted-foreground mb-4">
            Quando o cliente fica esperando mais que esse tempo, o lead é
            marcado como{" "}
            <span className="font-semibold text-[var(--status-urgent)]">
              🔥 parado
            </span>{" "}
            na conversa, para você responder antes de perder a venda.
          </p>

          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {SLA_OPTIONS.map((opt) => {
              const active = settings.slaMinutes === opt.minutes;
              return (
                <button
                  key={opt.minutes}
                  onClick={() => apply(opt.minutes)}
                  className={cn(
                    "h-9 rounded-md border text-xs font-semibold inline-flex items-center justify-center gap-1.5 transition-colors",
                    active
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-border bg-background hover:bg-accent",
                  )}
                >
                  {active && <Check className="h-3 w-3" />}
                  {opt.label}
                </button>
              );
            })}
          </div>

          <div className="mt-4 pt-4 border-t border-border">
            <label className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">
              Personalizado
            </label>
            <div className="mt-1.5 flex items-center gap-2">
              <input
                type="number"
                min={1}
                max={1440}
                value={customMinutes}
                onChange={(e) => setCustomMinutes(e.target.value)}
                className="h-9 w-28 px-3 text-sm rounded-md border border-border bg-background focus:outline-none focus:ring-1 focus:ring-ring"
              />
              <span className="text-xs text-muted-foreground">minutos</span>
              <button
                onClick={() => apply(Number(customMinutes))}
                className="ml-auto text-xs font-semibold rounded-md bg-primary text-primary-foreground px-3 py-1.5 hover:opacity-90"
              >
                Salvar
              </button>
            </div>
            {!isPreset && (
              <p className="mt-2 text-[11px] text-muted-foreground">
                Valor atual: <span className="font-semibold">{settings.slaMinutes} min</span>
              </p>
            )}
          </div>

          {savedAt && (
            <div className="mt-3 inline-flex items-center gap-1.5 text-[11px] text-[var(--status-won)] font-semibold">
              <Check className="h-3 w-3" /> Salvo
            </div>
          )}
        </section>

        <LossReasonsSection reasons={settings.lossReasons} />

        <IntegrationsSection />

        <MetaIntegrationSection />
      </div>
    </div>
  );
}

function IntegrationsSection() {
  const { profile } = useAuth();
  const companyId = profile?.company_id ?? null;
  const [items, setItems] = useState<Integration[]>([]);
  const [loading, setLoading] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (!companyId) return;
    setLoading(true);
    setError(null);
    try {
      setItems(await listIntegrations(companyId));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Falha ao carregar integrações");
    } finally {
      setLoading(false);
    }
  }, [companyId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  if (!companyId) {
    return (
      <section className="rounded-lg border border-dashed border-border p-5 text-center">
        <p className="text-xs text-muted-foreground">
          Faça login para conectar WhatsApp, Instagram e Facebook.
        </p>
      </section>
    );
  }

  const webhookUrl =
    typeof window !== "undefined"
      ? `${window.location.origin}/api/public/whatsapp/webhook`
      : "/api/public/whatsapp/webhook";

  return (
    <section className="rounded-lg border border-border bg-card p-5">
      <div className="flex items-center justify-between gap-2 mb-1">
        <div className="flex items-center gap-2">
          <Plug className="h-4 w-4 text-primary" />
          <h2 className="text-sm font-semibold">Integrações de canais</h2>
        </div>
        <Link
          to="/onboarding/whatsapp"
          className="text-[11px] font-medium text-primary hover:underline"
        >
          Usar assistente guiado →
        </Link>
      </div>
      <p className="text-xs text-muted-foreground mb-4">
        Conecte o WhatsApp oficial da Meta (Cloud API) para receber mensagens
        reais no inbox, automações de IA e follow-ups.
      </p>

      {error && (
        <div className="mb-3 rounded-md bg-[var(--status-urgent)]/10 text-[var(--status-urgent)] text-xs px-3 py-2">
          {error}
        </div>
      )}

      {(loading || items.length > 0) && (
        <ul className="space-y-2 mb-4">
          {loading && (
            <li className="text-xs text-muted-foreground inline-flex items-center gap-1.5">
              <Loader2 className="h-3 w-3 animate-spin" /> Carregando…
            </li>
          )}
          {items.map((it) => (
            <IntegrationItem key={it.id} item={it} onChanged={reload} />
          ))}
        </ul>
      )}

      <WhatsAppUnmappedPanel />


      <div className="space-y-4">
        <div className="rounded-md bg-secondary/40 border border-border p-3 text-[11px] space-y-1">
          <div className="font-semibold text-muted-foreground uppercase tracking-wide">
            URL do webhook (cole no Meta Developer Console)
          </div>
          <div className="flex items-center gap-2">
            <code className="flex-1 text-xs break-all">{webhookUrl}</code>
            <button
              onClick={() => navigator.clipboard?.writeText(webhookUrl)}
              className="p-1.5 rounded hover:bg-accent"
              title="Copiar"
            >
              <Copy className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>

        {showForm ? (
          <WhatsAppForm
            companyId={companyId}
            onCancel={() => setShowForm(false)}
            onSaved={() => {
              setShowForm(false);
              void reload();
            }}
          />
        ) : (
          <button
            onClick={() => setShowForm(true)}
            className="inline-flex items-center gap-1.5 text-xs font-semibold rounded-md bg-primary text-primary-foreground px-3 py-1.5 hover:opacity-90"
          >
            <MessageCircle className="h-3.5 w-3.5" /> Conectar WhatsApp Cloud API
          </button>
        )}

        <WhatsAppCloudDebugPanel
          companyId={companyId}
          onSaved={() => void reload()}
        />
      </div>
    </section>
  );
}


function IntegrationItem({
  item,
  onChanged,
}: {
  item: Integration;
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [showTest, setShowTest] = useState(false);
  const [showRenew, setShowRenew] = useState(false);
  const toggle = async () => {
    setBusy(true);
    try {
      await setIntegrationActive(item.id, !item.active);
      onChanged();
    } finally {
      setBusy(false);
    }
  };
  const remove = async () => {
    if (!confirm("Remover esta integração? As conversas existentes não serão apagadas."))
      return;
    setBusy(true);
    try {
      await deleteIntegration(item.id);
      onChanged();
    } finally {
      setBusy(false);
    }
  };
  const isWhatsApp = item.channel === "whatsapp";
  return (
    <li className="rounded-md border border-border bg-background">
      <div className="flex items-center gap-3 px-3 py-2.5">
        <div
          className={cn(
            "h-8 w-8 rounded-md inline-flex items-center justify-center text-white",
            item.channel === "whatsapp" && "bg-[#25D366]",
            item.channel === "instagram" && "bg-[#E1306C]",
            item.channel === "facebook" && "bg-[#1877F2]",
          )}
        >
          <MessageCircle className="h-4 w-4" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-semibold truncate">{item.displayName}</div>
          {isWhatsApp ? (
            <div className="text-[11px] text-muted-foreground space-y-0.5 mt-0.5">
              {(() => {
                const meta = (item.accountMetadata ?? {}) as Record<string, unknown>;
                const displayPhone = (meta.phone_number as string | undefined) ?? null;
                const wabaId = (meta.waba_id as string | undefined) ?? null;
                return (
                  <>
                    <div>
                      Número:{" "}
                      <span className="font-mono text-foreground">
                        {displayPhone ?? "—"}
                      </span>
                    </div>
                    <div>
                      phone_number_id:{" "}
                      <span className="font-mono">{item.externalAccountId ?? "—"}</span>
                    </div>
                    <div>
                      waba_id: <span className="font-mono">{wabaId ?? "—"}</span>
                    </div>
                    <div>
                      Último evento recebido:{" "}
                      <span className="font-mono">
                        {item.lastSyncedAt
                          ? new Date(item.lastSyncedAt).toLocaleString("pt-BR")
                          : "nenhum ainda"}
                      </span>
                    </div>
                  </>
                );
              })()}
              {!item.hasAccessToken && (
                <div className="text-[var(--status-urgent)]">sem token</div>
              )}
              {item.lastError && (
                <div className="text-[var(--status-urgent)]">erro: {item.lastError}</div>
              )}
            </div>
          ) : (
            <div className="text-[11px] text-muted-foreground truncate">
              {item.channel.toUpperCase()}
              {item.externalAccountId && <> • ID {item.externalAccountId}</>}
              {!item.hasAccessToken && (
                <span className="ml-2 text-[var(--status-urgent)]">sem token</span>
              )}
              {item.lastError && (
                <span className="ml-2 text-[var(--status-urgent)]">erro: {item.lastError}</span>
              )}
            </div>
          )}
          {isWhatsApp && item.hasAccessToken && (
            <TokenExpiryBadge expiresAt={item.tokenExpiresAt} />
          )}
        </div>

        <span
          className={cn(
            "text-[10px] font-semibold uppercase tracking-wide rounded px-1.5 py-0.5",
            item.active
              ? "bg-[var(--status-won)]/15 text-[var(--status-won)]"
              : "bg-secondary text-muted-foreground",
          )}
        >
          {item.active ? "Ativa" : "Inativa"}
        </span>
        {isWhatsApp && item.hasAccessToken && (
          <button
            onClick={() => setShowRenew((v) => !v)}
            className="text-[11px] font-semibold rounded-md bg-secondary text-foreground px-2 py-1 hover:bg-accent"
            title="Renovar ou validar token"
          >
            Renovar token
          </button>
        )}
        {isWhatsApp && item.hasAccessToken && item.active && (
          <button
            onClick={() => setShowTest((v) => !v)}
            className="text-[11px] font-semibold rounded-md bg-primary text-primary-foreground px-2 py-1 hover:opacity-90"
            title="Enviar mensagem de teste"
          >
            Enviar teste
          </button>
        )}
        <button
          onClick={toggle}
          disabled={busy}
          className="p-1.5 rounded hover:bg-accent text-muted-foreground hover:text-foreground"
          title={item.active ? "Desativar" : "Ativar"}
        >
          {item.active ? <PowerOff className="h-3.5 w-3.5" /> : <Power className="h-3.5 w-3.5" />}
        </button>
        <MetaDisconnectButton integrationId={item.id} onDisconnected={onChanged} />
        <button
          onClick={remove}
          disabled={busy}
          className="p-1.5 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive"
          title="Remover"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>
      {isWhatsApp && showRenew && (
        <TokenRenewPanel
          integrationId={item.id}
          currentExpiresAt={item.tokenExpiresAt}
          onClose={() => setShowRenew(false)}
          onChanged={onChanged}
        />
      )}
      {isWhatsApp && showTest && (
        <WhatsAppTestPanel
          integrationId={item.id}
          onClose={() => setShowTest(false)}
          onSent={onChanged}
        />
      )}
    </li>
  );
}

function tokenExpiryState(expiresAt: string | null) {
  if (!expiresAt) return { kind: "permanent" as const };
  const expires = new Date(expiresAt).getTime();
  const now = Date.now();
  const hoursLeft = (expires - now) / 36e5;
  if (hoursLeft <= 0) return { kind: "expired" as const, expires };
  if (hoursLeft <= 24) return { kind: "soon" as const, expires, hoursLeft };
  return { kind: "ok" as const, expires, hoursLeft };
}

function TokenExpiryBadge({ expiresAt }: { expiresAt: string | null }) {
  const s = tokenExpiryState(expiresAt);
  if (s.kind === "permanent") {
    return (
      <div className="text-[11px] text-muted-foreground mt-0.5">
        Token: <span className="font-mono">permanente / sem expiração definida</span>
      </div>
    );
  }
  if (s.kind === "expired") {
    return (
      <div className="text-[11px] mt-0.5 text-[var(--status-urgent)] font-semibold">
        ⚠ Token expirado em {new Date(s.expires).toLocaleString("pt-BR")} — renove agora
      </div>
    );
  }
  if (s.kind === "soon") {
    return (
      <div className="text-[11px] mt-0.5 text-[var(--status-urgent)]">
        ⏰ Token expira em {Math.max(1, Math.round(s.hoursLeft))}h ({new Date(s.expires).toLocaleString("pt-BR")})
      </div>
    );
  }
  return (
    <div className="text-[11px] text-muted-foreground mt-0.5">
      Token expira em {new Date(s.expires).toLocaleString("pt-BR")}
    </div>
  );
}

function TokenRenewPanel({
  integrationId,
  currentExpiresAt,
  onClose,
  onChanged,
}: {
  integrationId: string;
  currentExpiresAt: string | null;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [newToken, setNewToken] = useState("");
  // datetime-local format: yyyy-MM-ddTHH:mm
  const defaultExpiry = (() => {
    const d = new Date(Date.now() + 23 * 60 * 60 * 1000);
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  })();
  const [expiresLocal, setExpiresLocal] = useState(defaultExpiry);
  const [isPermanent, setIsPermanent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{
    ok: boolean;
    error?: string;
    info?: string;
  } | null>(null);

  const save = async () => {
    setBusy(true);
    setResult(null);
    try {
      const expiresAt = isPermanent
        ? null
        : expiresLocal
          ? new Date(expiresLocal).toISOString()
          : null;
      const res = await renewWhatsAppToken(integrationId, newToken.trim(), expiresAt);
      if (res.ok) {
        setResult({
          ok: true,
          info: res.isPermanent
            ? "Token validado e salvo como permanente."
            : `Token validado. Expira em ${res.expiresAt ? new Date(res.expiresAt).toLocaleString("pt-BR") : "—"}.`,
        });
        setNewToken("");
        onChanged();
      } else {
        setResult({ ok: false, error: res.error ?? "Falha ao validar token" });
      }
    } catch (e) {
      setResult({ ok: false, error: e instanceof Error ? e.message : "erro" });
    } finally {
      setBusy(false);
    }
  };

  const revalidate = async () => {
    setBusy(true);
    setResult(null);
    try {
      const res = await validateWhatsAppToken(integrationId);
      if (res.ok) {
        setResult({
          ok: true,
          info: res.isPermanent
            ? "Token atual ainda válido (sem expiração definida)."
            : `Token atual ainda válido. Expira em ${res.expiresAt ? new Date(res.expiresAt).toLocaleString("pt-BR") : "—"}.`,
        });
      } else {
        setResult({ ok: false, error: res.error ?? "Token inválido" });
      }
      onChanged();
    } catch (e) {
      setResult({ ok: false, error: e instanceof Error ? e.message : "erro" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="border-t border-border px-3 py-3 space-y-3 bg-secondary/30">
      <div className="flex items-center justify-between">
        <div className="text-xs font-semibold">Renovar / validar token WhatsApp Cloud API</div>
        <button
          onClick={onClose}
          className="text-[11px] text-muted-foreground hover:text-foreground"
        >
          fechar
        </button>
      </div>
      <p className="text-[11px] text-muted-foreground">
        Cole aqui um novo <strong>token temporário</strong> (válido por ~24h) ou
        o <strong>token permanente</strong> de System User quando a Meta liberar.
        O sistema valida contra a Graph API antes de salvar. O resto da
        integração (webhook, envio, recebimento) continua igual.
        {currentExpiresAt && (
          <> Token atual expira em{" "}
            <span className="font-mono">{new Date(currentExpiresAt).toLocaleString("pt-BR")}</span>.</>
        )}
      </p>
      <textarea
        value={newToken}
        onChange={(e) => setNewToken(e.target.value)}
        rows={2}
        placeholder="Cole o novo access token (EAA...)"
        className="w-full px-2.5 py-1.5 text-xs rounded-md border border-border bg-background font-mono resize-none"
      />
      <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-1.5 text-[11px]">
          <input
            type="checkbox"
            checked={isPermanent}
            onChange={(e) => setIsPermanent(e.target.checked)}
          />
          Token permanente (sem expiração)
        </label>
        {!isPermanent && (
          <label className="flex items-center gap-1.5 text-[11px]">
            Expira em:
            <input
              type="datetime-local"
              value={expiresLocal}
              onChange={(e) => setExpiresLocal(e.target.value)}
              className="text-[11px] rounded-md border border-border bg-background px-2 py-1"
            />
          </label>
        )}
      </div>
      <div className="flex items-center gap-2">
        <button
          onClick={save}
          disabled={busy || !newToken.trim()}
          className="inline-flex items-center gap-1.5 text-xs font-semibold rounded-md bg-primary text-primary-foreground px-3 py-1.5 hover:opacity-90 disabled:opacity-50"
        >
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
          Validar e salvar
        </button>
        <button
          onClick={revalidate}
          disabled={busy}
          className="text-xs font-semibold rounded-md bg-secondary px-3 py-1.5 hover:bg-accent disabled:opacity-50"
        >
          Revalidar token atual
        </button>
      </div>
      {result && (
        <div
          className={cn(
            "text-[11px] rounded-md px-2.5 py-1.5",
            result.ok
              ? "bg-[var(--status-won)]/15 text-[var(--status-won)]"
              : "bg-[var(--status-urgent)]/15 text-[var(--status-urgent)]",
          )}
        >
          {result.ok ? result.info : result.error}
        </div>
      )}
    </div>
  );
}



function WhatsAppTestPanel({
  integrationId,
  onClose,
  onSent,
}: {
  integrationId: string;
  onClose: () => void;
  onSent: () => void;
}) {
  const [to, setTo] = useState("");
  const [text, setText] = useState("Mensagem de teste do Atende AI ✅");
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<{
    ok: boolean;
    status?: number;
    response?: unknown;
    error?: string;
    diagnostics?: {
      phoneNumberId?: string;
      tokenSaved?: string;
      endpoint?: string;
    };
  } | null>(null);

  const send = async () => {
    setSending(true);
    setResult(null);
    try {
      const { supabase } = await import("@/integrations/supabase/client");
      const { data: sess } = await supabase.auth.getSession();
      const token = sess.session?.access_token;
      if (!token) {
        setResult({ ok: false, error: "Sessão expirada. Faça login novamente." });
        return;
      }
      const res = await fetch("/api/whatsapp/test-send", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ integrationId, to, text }),
      });
      const json = (await res.json()) as {
        ok?: boolean;
        status?: number;
        response?: unknown;
        error?: string;
        diagnostics?: {
          phoneNumberId?: string;
          tokenSaved?: string;
          endpoint?: string;
        };
      };
      console.log("[WhatsAppTestPanel] response", summarizeHttp(res.status, json));
      setResult({
        ok: Boolean(json.ok),
        status: json.status ?? res.status,
        response: json.response,
        error: json.error,
        diagnostics: json.diagnostics,
      });
      if (json.ok) onSent();

    } catch (e) {
      const msg = e instanceof Error ? e.message : "Falha ao enviar";
      console.error("[WhatsAppTestPanel] error", msg);
      setResult({ ok: false, error: msg });
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="border-t border-border px-3 py-3 space-y-3 bg-secondary/30">
      <div className="flex items-center justify-between">
        <div className="text-xs font-semibold">Enviar mensagem de teste</div>
        <button
          onClick={onClose}
          className="text-[11px] text-muted-foreground hover:text-foreground"
        >
          fechar
        </button>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-[1fr,2fr] gap-2">
        <input
          type="tel"
          value={to}
          onChange={(e) => setTo(e.target.value)}
          placeholder="Telefone com DDI (ex: 5511999999999)"
          className="text-xs rounded-md border border-border bg-background px-2.5 py-1.5"
        />
        <input
          type="text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Mensagem"
          className="text-xs rounded-md border border-border bg-background px-2.5 py-1.5"
        />
      </div>
      <div className="flex items-center gap-2">
        <button
          onClick={send}
          disabled={sending || !to.trim()}
          className="inline-flex items-center gap-1.5 text-xs font-semibold rounded-md bg-primary text-primary-foreground px-3 py-1.5 hover:opacity-90 disabled:opacity-50"
        >
          {sending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <MessageCircle className="h-3.5 w-3.5" />}
          {sending ? "Enviando…" : "Enviar"}
        </button>
        <p className="text-[10px] text-muted-foreground">
          Apenas dígitos. No modo sandbox da Meta o número precisa estar
          adicionado como testador.
        </p>
      </div>
      {result && (
        <div className="space-y-1">
          <div className="text-[11px]">
            <span
              className={cn(
                "font-semibold uppercase tracking-wide rounded px-1.5 py-0.5",
                result.ok
                  ? "bg-[var(--status-won)]/15 text-[var(--status-won)]"
                  : "bg-[var(--status-urgent)]/15 text-[var(--status-urgent)]",
              )}
            >
              {result.ok ? "OK" : "ERRO"}
            </span>{" "}
            <span className="text-muted-foreground">
              HTTP {result.status ?? "—"}
              {result.error ? ` • ${result.error}` : ""}
            </span>
          </div>
          {result.diagnostics && (
            <div className="text-[10px] text-muted-foreground bg-background border border-border rounded p-2 font-mono space-y-0.5">
              <div>phone_number_id: {result.diagnostics.phoneNumberId || "—"}</div>
              <div>token salvo: {result.diagnostics.tokenSaved ?? "—"}</div>
              {result.diagnostics.endpoint && (
                <div className="break-all">endpoint: {result.diagnostics.endpoint}</div>
              )}
            </div>
          )}
          <pre className="text-[10px] leading-snug bg-background border border-border rounded p-2 overflow-auto max-h-64">
{JSON.stringify(result.response ?? result.error ?? null, null, 2)}
          </pre>
        </div>
      )}

    </div>
  );
}


function randomToken(len = 24) {
  const chars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let out = "";
  for (let i = 0; i < len; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
}

function WhatsAppCloudDebugPanel({
  companyId,
  onSaved,
}: {
  companyId: string;
  onSaved?: () => void;
}) {
  const [token, setToken] = useState("");
  const [wabaId, setWabaId] = useState("");
  const [phoneId, setPhoneId] = useState("");
  const [toNumber, setToNumber] = useState("");
  const [testMessage, setTestMessage] = useState("Teste Atende Ai ✅");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<
    | null
    | {
        test_send?: { status?: number; ok?: boolean; body?: unknown };
        phone_number?: { body?: { display_phone_number?: string; verified_name?: string } };
        waba?: { body?: { id?: string; name?: string } };
      }
  >(null);
  const [err, setErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [savedMsg, setSavedMsg] = useState<string | null>(null);

  const run = async () => {
    setErr(null);
    setResult(null);
    setSavedMsg(null);
    if (!token.trim()) {
      setErr("Cole o access token (temporário ou permanente).");
      return;
    }
    setLoading(true);
    try {
      const { data: sess } = await supabase.auth.getSession();
      const bearer = sess.session?.access_token;
      if (!bearer) throw new Error("Sessão expirada");
      const res = await fetch("/api/whatsapp/debug", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${bearer}` },
        body: JSON.stringify({
          accessToken: token.trim(),
          wabaId: wabaId.trim() || undefined,
          phoneNumberId: phoneId.trim() || undefined,
          toNumber: toNumber.trim() || undefined,
          testMessage: testMessage.trim() || undefined,
        }),
      });
      const json = await res.json();
      console.log("[WhatsAppCloudDebug] result", sanitizeForLog(json));
      setResult(json);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Falha no debug");
    } finally {
      setLoading(false);
    }
  };

  const testStatus = result?.test_send?.status;
  const canSave =
    testStatus === 200 && !!token.trim() && !!phoneId.trim();

  const saveConnection = async () => {
    setErr(null);
    setSavedMsg(null);
    setSaving(true);
    try {
      const displayPhone =
        result?.phone_number?.body?.display_phone_number ?? undefined;
      const verifiedName =
        result?.phone_number?.body?.verified_name ?? "WhatsApp Cloud";
      const rand = () =>
        Array.from(crypto.getRandomValues(new Uint8Array(24)))
          .map((b) => b.toString(16).padStart(2, "0"))
          .join("");
      await upsertWhatsAppIntegration({
        companyId,
        displayName: verifiedName,
        phoneNumberId: phoneId.trim(),
        phoneNumber: displayPhone,
        wabaId: wabaId.trim() || undefined,
        accessToken: token.trim(),
        verifyToken: rand(),
        webhookSecret: rand(),
      });
      setSavedMsg(
        `Conexão salva e ativada${displayPhone ? ` (${displayPhone})` : ""}. Já dá pra enviar pela caixa de atendimento.`,
      );
      onSaved?.();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Falha ao salvar");
    } finally {
      setSaving(false);
    }
  };



  return (
    <div className="rounded-md border border-dashed border-border p-3 space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-sm font-semibold">Debug WhatsApp Cloud API</div>
          <div className="text-[11px] text-muted-foreground">
            Valida token (temporário ou permanente), WABA, phone_number_id e envio de
            mensagem. Não salva nada.
          </div>
        </div>
      </div>

      <Field label="Access token (temporário ou permanente)">
        <textarea
          value={token}
          onChange={(e) => setToken(e.target.value)}
          rows={2}
          placeholder="EAAG..."
          className="w-full px-3 py-2 text-xs rounded-md border border-border bg-background font-mono resize-none focus:outline-none focus:ring-1 focus:ring-ring"
        />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="WABA ID (opcional)">
          <input
            value={wabaId}
            onChange={(e) => setWabaId(e.target.value)}
            className="w-full h-9 px-3 text-sm rounded-md border border-border bg-background focus:outline-none focus:ring-1 focus:ring-ring"
          />
        </Field>
        <Field label="phone_number_id (opcional)">
          <input
            value={phoneId}
            onChange={(e) => setPhoneId(e.target.value)}
            className="w-full h-9 px-3 text-sm rounded-md border border-border bg-background focus:outline-none focus:ring-1 focus:ring-ring"
          />
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Enviar para (E.164, opcional)">
          <input
            value={toNumber}
            onChange={(e) => setToNumber(e.target.value)}
            placeholder="5511999999999"
            className="w-full h-9 px-3 text-sm rounded-md border border-border bg-background focus:outline-none focus:ring-1 focus:ring-ring"
          />
        </Field>
        <Field label="Mensagem teste">
          <input
            value={testMessage}
            onChange={(e) => setTestMessage(e.target.value)}
            className="w-full h-9 px-3 text-sm rounded-md border border-border bg-background focus:outline-none focus:ring-1 focus:ring-ring"
          />
        </Field>
      </div>

      <div className="flex justify-end gap-2">
        <button
          onClick={run}
          disabled={loading}
          className="inline-flex items-center gap-1.5 text-xs font-semibold rounded-md bg-primary text-primary-foreground px-3 py-2 hover:opacity-90 disabled:opacity-50"
        >
          {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
          Rodar debug
        </button>
        {canSave && (
          <button
            onClick={saveConnection}
            disabled={saving}
            className="inline-flex items-center gap-1.5 text-xs font-semibold rounded-md bg-[#25D366] text-white px-3 py-2 hover:opacity-90 disabled:opacity-50"
          >
            {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plug className="h-3.5 w-3.5" />}
            Salvar como conexão ativa
          </button>
        )}
      </div>

      {savedMsg && (
        <div className="rounded-md bg-[#25D366]/10 text-[#1f9d52] text-xs px-3 py-2">
          {savedMsg}
        </div>
      )}

      {err && (
        <div className="rounded-md bg-[var(--status-urgent)]/10 text-[var(--status-urgent)] text-xs px-3 py-2">
          {err}
        </div>
      )}

      {result !== null && (
        <pre className="text-[11px] leading-snug bg-secondary/40 border border-border rounded-md p-3 overflow-auto max-h-96 font-mono">
{JSON.stringify(result, null, 2)}
          </pre>
      )}
    </div>
  );
}



function WhatsAppForm({
  companyId,
  onCancel,
  onSaved,
}: {
  companyId: string;
  onCancel: () => void;
  onSaved: () => void;
}) {
  const [displayName, setDisplayName] = useState("WhatsApp principal");
  const [phoneNumberId, setPhoneNumberId] = useState("");
  const [phoneNumber, setPhoneNumber] = useState("");
  const [wabaId, setWabaId] = useState("");
  const [accessToken, setAccessToken] = useState("");
  const [verifyToken, setVerifyToken] = useState(() => randomToken());
  const [webhookSecret, setWebhookSecret] = useState(() => randomToken(32));
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async () => {
    setErr(null);
    if (!phoneNumberId.trim() || !accessToken.trim() || !verifyToken.trim()) {
      setErr("phone_number_id, access_token e verify_token são obrigatórios.");
      return;
    }
    if (webhookSecret.trim().length < 16) {
      setErr("App secret precisa ter pelo menos 16 caracteres.");
      return;
    }
    setSaving(true);
    try {
      await upsertWhatsAppIntegration({
        companyId,
        displayName: displayName.trim() || "WhatsApp",
        phoneNumberId: phoneNumberId.trim(),
        phoneNumber: phoneNumber.trim() || undefined,
        wabaId: wabaId.trim() || undefined,
        accessToken: accessToken.trim(),
        verifyToken: verifyToken.trim(),
        webhookSecret: webhookSecret.trim(),
      });
      onSaved();
    } catch (e) {
      console.error("[WhatsAppForm] save failed", safeErrorMessage(e));
      setErr(e instanceof Error ? e.message : "Falha ao salvar conexão");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-3">
      <div className="text-xs text-muted-foreground">
        Pegue os valores em <strong>Meta for Developers → seu app → WhatsApp →
        API Setup</strong>. Use um token <em>permanente</em> (System User) em
        produção. O <em>verify token</em> é apenas um segredo que você define e
        cola na Meta junto com a URL do webhook.
      </div>
      <Field label="Nome de exibição">
        <input
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          className="w-full h-9 px-3 text-sm rounded-md border border-border bg-background focus:outline-none focus:ring-1 focus:ring-ring"
        />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="phone_number_id *">
          <input
            value={phoneNumberId}
            onChange={(e) => setPhoneNumberId(e.target.value)}
            placeholder="123456789012345"
            className="w-full h-9 px-3 text-sm rounded-md border border-border bg-background focus:outline-none focus:ring-1 focus:ring-ring"
          />
        </Field>
        <Field label="Número (opcional)">
          <input
            value={phoneNumber}
            onChange={(e) => setPhoneNumber(e.target.value)}
            placeholder="+55 11 9..."
            className="w-full h-9 px-3 text-sm rounded-md border border-border bg-background focus:outline-none focus:ring-1 focus:ring-ring"
          />
        </Field>
      </div>
      <Field label="WhatsApp Business Account ID (opcional)">
        <input
          value={wabaId}
          onChange={(e) => setWabaId(e.target.value)}
          className="w-full h-9 px-3 text-sm rounded-md border border-border bg-background focus:outline-none focus:ring-1 focus:ring-ring"
        />
      </Field>
      <Field label="Access token *">
        <textarea
          value={accessToken}
          onChange={(e) => setAccessToken(e.target.value)}
          rows={2}
          placeholder="EAAG..."
          className="w-full px-3 py-2 text-sm rounded-md border border-border bg-background focus:outline-none focus:ring-1 focus:ring-ring resize-none font-mono"
        />
      </Field>
      <Field label="Verify token *">
        <div className="flex items-center gap-2">
          <input
            value={verifyToken}
            onChange={(e) => setVerifyToken(e.target.value)}
            className="flex-1 h-9 px-3 text-sm rounded-md border border-border bg-background focus:outline-none focus:ring-1 focus:ring-ring"
          />
          <button
            type="button"
            onClick={() => setVerifyToken(randomToken())}
            className="text-[11px] rounded-md bg-secondary px-2 py-1.5 hover:bg-accent"
          >
            Gerar
          </button>
        </div>
      </Field>
      <Field label="App secret * (HMAC do webhook — obrigatório)">
        <div className="flex items-center gap-2">
          <input
            value={webhookSecret}
            onChange={(e) => setWebhookSecret(e.target.value)}
            className="flex-1 h-9 px-3 text-sm rounded-md border border-border bg-background focus:outline-none focus:ring-1 focus:ring-ring"
          />
          <button
            type="button"
            onClick={() => setWebhookSecret(randomToken(32))}
            className="text-[11px] rounded-md bg-secondary px-2 py-1.5 hover:bg-accent"
          >
            Gerar
          </button>
        </div>
      </Field>

      {err && (
        <div className="rounded-md bg-[var(--status-urgent)]/10 text-[var(--status-urgent)] text-xs px-3 py-2">
          {err}
        </div>
      )}

      <div className="flex justify-end gap-2 pt-1">
        <button
          onClick={onCancel}
          disabled={saving}
          className="text-xs rounded-md bg-secondary px-3 py-2 hover:bg-accent"
        >
          Cancelar
        </button>
        <button
          onClick={submit}
          disabled={saving}
          className="inline-flex items-center gap-1.5 text-xs font-semibold rounded-md bg-primary text-primary-foreground px-3 py-2 hover:opacity-90 disabled:opacity-50"
        >
          {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
          Salvar conexão
        </button>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">
        {label}
      </span>
      <div className="mt-1">{children}</div>
    </label>
  );
}
