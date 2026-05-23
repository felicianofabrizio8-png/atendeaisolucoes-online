import { createFileRoute } from "@tanstack/react-router";
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
  QrCode,
  Cloud,
  ChevronRight,
  ArrowLeft,
} from "lucide-react";
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

type ConnectionMode = "chooser" | "qrcode" | "cloud";

function IntegrationsSection() {
  const { profile } = useAuth();
  const companyId = profile?.company_id ?? null;
  const [items, setItems] = useState<Integration[]>([]);
  const [loading, setLoading] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<ConnectionMode>("chooser");

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
      <div className="flex items-center gap-2 mb-1">
        <Plug className="h-4 w-4 text-primary" />
        <h2 className="text-sm font-semibold">Integrações de canais</h2>
      </div>
      <p className="text-xs text-muted-foreground mb-4">
        Conecte o WhatsApp da sua empresa para receber mensagens reais no inbox e
        responder sem sair do sistema.
      </p>

      {error && (
        <div className="mb-3 rounded-md bg-[var(--status-urgent)]/10 text-[var(--status-urgent)] text-xs px-3 py-2">
          {error}
        </div>
      )}

      {/* Lista de integrações já conectadas (independente do modo) */}
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

      {/* Seleção de modo de conexão */}
      {mode === "chooser" && (
        <div className="space-y-3">
          <ConnectionOption
            icon={<QrCode className="h-5 w-5" />}
            iconBg="bg-[#25D366]"
            recommended
            title="WhatsApp Business via QR Code"
            description="Conecte seu WhatsApp Business escaneando um QR Code. Ideal para quem quer usar o número atual sem custo por conversa."
            ctaLabel="Conectar por QR Code"
            onClick={() => setMode("qrcode")}
          />
          <ConnectionOption
            icon={<Cloud className="h-5 w-5" />}
            iconBg="bg-[#1877F2]"
            title="WhatsApp Cloud API"
            description="Use a API oficial da Meta para alto volume, automações avançadas e multiatendimento profissional."
            ctaLabel="Configurar API oficial"
            onClick={() => setMode("cloud")}
          />
        </div>
      )}

      {/* QR Code (placeholder preparado para integração futura) */}
      {mode === "qrcode" && (
        <QrCodePanel onBack={() => setMode("chooser")} />
      )}

      {/* Cloud API (fluxo atual, preservado) */}
      {mode === "cloud" && (
        <div className="space-y-4">
          <button
            onClick={() => {
              setMode("chooser");
              setShowForm(false);
            }}
            className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="h-3 w-3" /> Voltar
          </button>

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
      )}
    </section>
  );
}

function ConnectionOption({
  icon,
  iconBg,
  title,
  description,
  ctaLabel,
  recommended,
  onClick,
}: {
  icon: ReactNode;
  iconBg: string;
  title: string;
  description: string;
  ctaLabel: string;
  recommended?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full text-left rounded-lg border border-border bg-background hover:bg-accent/40 transition-colors p-4 flex items-start gap-3 group"
    >
      <div
        className={cn(
          "h-10 w-10 rounded-md inline-flex items-center justify-center text-white shrink-0",
          iconBg,
        )}
      >
        {icon}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-0.5">
          <h3 className="text-sm font-semibold">{title}</h3>
          {recommended && (
            <span className="text-[9px] font-bold uppercase tracking-wide rounded px-1.5 py-0.5 bg-primary/15 text-primary">
              Recomendado
            </span>
          )}
        </div>
        <p className="text-xs text-muted-foreground mb-2">{description}</p>
        <span className="inline-flex items-center gap-1 text-xs font-semibold text-primary">
          {ctaLabel}
          <ChevronRight className="h-3 w-3 transition-transform group-hover:translate-x-0.5" />
        </span>
      </div>
    </button>
  );
}

function QrCodePanel({ onBack }: { onBack: () => void }) {
  type QrStatus = "disconnected" | "waiting" | "connected";
  const [status, setStatus] = useState<QrStatus>("disconnected");

  const statusLabel: Record<QrStatus, string> = {
    disconnected: "Desconectado",
    waiting: "Aguardando QR Code",
    connected: "Conectado",
  };
  const statusClass: Record<QrStatus, string> = {
    disconnected: "bg-secondary text-muted-foreground",
    waiting: "bg-[var(--status-urgent)]/15 text-[var(--status-urgent)]",
    connected: "bg-[var(--status-won)]/15 text-[var(--status-won)]",
  };

  return (
    <div className="space-y-4">
      <button
        onClick={onBack}
        className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-3 w-3" /> Voltar
      </button>

      <div className="flex items-center gap-3">
        <div className="h-10 w-10 rounded-md inline-flex items-center justify-center text-white bg-[#25D366]">
          <QrCode className="h-5 w-5" />
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="text-sm font-semibold">WhatsApp Business via QR Code</h3>
          <p className="text-[11px] text-muted-foreground">
            Conecte escaneando o QR Code direto no app do WhatsApp.
          </p>
        </div>
        <span
          className={cn(
            "text-[10px] font-semibold uppercase tracking-wide rounded px-1.5 py-0.5",
            statusClass[status],
          )}
        >
          {statusLabel[status]}
        </span>
      </div>

      <div className="rounded-lg border border-dashed border-border bg-background/50 p-6 flex flex-col items-center justify-center text-center min-h-[260px]">
        {status === "waiting" ? (
          <>
            <div className="h-44 w-44 rounded-md bg-secondary/60 border border-border flex items-center justify-center mb-3">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
            <p className="text-xs text-muted-foreground max-w-xs">
              Gerando QR Code… Abra o WhatsApp no celular em{" "}
              <strong>Aparelhos conectados → Conectar um aparelho</strong>.
            </p>
          </>
        ) : status === "connected" ? (
          <>
            <div className="h-12 w-12 rounded-full bg-[var(--status-won)]/15 text-[var(--status-won)] inline-flex items-center justify-center mb-3">
              <Check className="h-6 w-6" />
            </div>
            <p className="text-sm font-semibold mb-1">WhatsApp conectado</p>
            <p className="text-xs text-muted-foreground max-w-xs">
              Suas conversas começarão a aparecer no inbox.
            </p>
          </>
        ) : (
          <>
            <div className="h-44 w-44 rounded-md bg-secondary/40 border border-border flex items-center justify-center mb-3">
              <QrCode className="h-16 w-16 text-muted-foreground/50" />
            </div>
            <p className="text-xs text-muted-foreground max-w-xs">
              Clique em <strong>Gerar QR Code</strong> para iniciar a conexão.
            </p>
          </>
        )}
      </div>

      <div className="rounded-md bg-secondary/40 border border-border p-3 text-[11px] text-muted-foreground">
        <strong className="text-foreground">Em breve:</strong> integração via QR
        Code com WhatsApp Business. Esta tela já está preparada para receber o
        QR Code assim que o serviço de conexão estiver disponível.
      </div>

      <div className="flex flex-wrap gap-2">
        {status === "disconnected" && (
          <button
            onClick={() => setStatus("waiting")}
            className="inline-flex items-center gap-1.5 text-xs font-semibold rounded-md bg-primary text-primary-foreground px-3 py-1.5 hover:opacity-90"
          >
            <QrCode className="h-3.5 w-3.5" /> Gerar QR Code
          </button>
        )}
        {status === "waiting" && (
          <>
            <button
              onClick={() => setStatus("waiting")}
              disabled
              className="inline-flex items-center gap-1.5 text-xs font-semibold rounded-md bg-secondary text-muted-foreground px-3 py-1.5 cursor-not-allowed"
            >
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> Aguardando…
            </button>
            <button
              onClick={() => setStatus("disconnected")}
              className="inline-flex items-center gap-1.5 text-xs font-semibold rounded-md bg-secondary px-3 py-1.5 hover:bg-accent"
            >
              <X className="h-3.5 w-3.5" /> Cancelar
            </button>
          </>
        )}
        {status === "connected" && (
          <button
            onClick={() => setStatus("disconnected")}
            className="inline-flex items-center gap-1.5 text-xs font-semibold rounded-md bg-secondary px-3 py-1.5 hover:bg-accent"
          >
            <PowerOff className="h-3.5 w-3.5" /> Desconectar
          </button>
        )}
      </div>
    </div>
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
          {isWhatsApp && (
            <div className="text-[11px] text-muted-foreground mt-0.5">
              Último evento recebido:{" "}
              <span className="font-mono">
                {item.lastSyncedAt
                  ? new Date(item.lastSyncedAt).toLocaleString("pt-BR")
                  : "nenhum ainda"}
              </span>
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
      tokenPrefix?: string | null;
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
          tokenPrefix?: string | null;
          endpoint?: string;
        };
      };
      console.log("[WhatsAppTestPanel] response", { httpStatus: res.status, json });
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
              <div>
                token (primeiros 6):{" "}
                {result.diagnostics.tokenPrefix
                  ? `${result.diagnostics.tokenPrefix}…`
                  : "—"}
              </div>
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

function WhatsAppCloudDebugPanel() {
  const [token, setToken] = useState("");
  const [wabaId, setWabaId] = useState("");
  const [phoneId, setPhoneId] = useState("");
  const [toNumber, setToNumber] = useState("");
  const [testMessage, setTestMessage] = useState("Teste Atende Ai ✅");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<unknown>(null);
  const [err, setErr] = useState<string | null>(null);

  const run = async () => {
    setErr(null);
    setResult(null);
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
      console.log("[WhatsAppCloudDebug] result", json);
      setResult(json);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Falha no debug");
    } finally {
      setLoading(false);
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

      <div className="flex justify-end">
        <button
          onClick={run}
          disabled={loading}
          className="inline-flex items-center gap-1.5 text-xs font-semibold rounded-md bg-primary text-primary-foreground px-3 py-2 hover:opacity-90 disabled:opacity-50"
        >
          {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
          Rodar debug
        </button>
      </div>

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
      console.error("[WhatsAppForm] save failed", e);
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

function LossReasonsSection({ reasons }: { reasons: string[] }) {
  const [newReason, setNewReason] = useState("");
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [editingValue, setEditingValue] = useState("");

  const handleAdd = () => {
    if (!newReason.trim()) return;
    addLossReason(newReason);
    setNewReason("");
  };

  const startEdit = (index: number) => {
    setEditingIndex(index);
    setEditingValue(reasons[index]);
  };

  const commitEdit = () => {
    if (editingIndex === null) return;
    updateLossReason(editingIndex, editingValue);
    setEditingIndex(null);
    setEditingValue("");
  };

  const cancelEdit = () => {
    setEditingIndex(null);
    setEditingValue("");
  };

  return (
    <section className="rounded-lg border border-border bg-card p-5">
      <div className="flex items-center gap-2 mb-1">
        <XCircle className="h-4 w-4 text-[var(--status-lost)]" />
        <h2 className="text-sm font-semibold">Motivos de perda</h2>
      </div>
      <p className="text-xs text-muted-foreground mb-4">
        Quando você marcar um lead como{" "}
        <span className="font-semibold">perdido</span> na conversa, vai escolher
        um destes motivos. Eles entram automaticamente nos relatórios para
        você entender por que está perdendo vendas.
      </p>

      <ul className="space-y-1.5">
        {reasons.map((reason, index) => (
          <li
            key={`${index}-${reason}`}
            className="flex items-center gap-2 rounded-md border border-border bg-background px-3 py-2"
          >
            {editingIndex === index ? (
              <>
                <input
                  type="text"
                  value={editingValue}
                  onChange={(e) => setEditingValue(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") commitEdit();
                    if (e.key === "Escape") cancelEdit();
                  }}
                  autoFocus
                  className="flex-1 h-8 px-2 text-sm rounded-md border border-border bg-card focus:outline-none focus:ring-1 focus:ring-ring"
                />
                <button
                  onClick={commitEdit}
                  className="text-[11px] font-semibold rounded-md bg-primary text-primary-foreground px-2 py-1 hover:opacity-90"
                >
                  Salvar
                </button>
                <button
                  onClick={cancelEdit}
                  className="text-[11px] font-semibold rounded-md border border-border bg-background px-2 py-1 hover:bg-accent"
                >
                  Cancelar
                </button>
              </>
            ) : (
              <>
                <span className="flex-1 text-sm">{reason}</span>
                <button
                  onClick={() => startEdit(index)}
                  aria-label="Editar"
                  className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent"
                >
                  <Pencil className="h-3.5 w-3.5" />
                </button>
                <button
                  onClick={() => removeLossReason(index)}
                  aria-label="Excluir"
                  disabled={reasons.length <= 1}
                  className="p-1.5 rounded-md text-muted-foreground hover:text-destructive hover:bg-destructive/10 disabled:opacity-30 disabled:cursor-not-allowed"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </>
            )}
          </li>
        ))}
      </ul>

      <div className="mt-4 pt-4 border-t border-border">
        <label className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">
          Adicionar motivo
        </label>
        <div className="mt-1.5 flex items-center gap-2">
          <input
            type="text"
            value={newReason}
            onChange={(e) => setNewReason(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleAdd();
            }}
            placeholder="Ex.: Cliente sumiu após orçamento"
            className="flex-1 h-9 px-3 text-sm rounded-md border border-border bg-background focus:outline-none focus:ring-1 focus:ring-ring"
          />
          <button
            onClick={handleAdd}
            disabled={!newReason.trim()}
            className="inline-flex items-center gap-1.5 text-xs font-semibold rounded-md bg-primary text-primary-foreground px-3 py-1.5 hover:opacity-90 disabled:opacity-40"
          >
            <Plus className="h-3.5 w-3.5" /> Adicionar
          </button>
        </div>
        {reasons.length <= 1 && (
          <p className="mt-2 text-[11px] text-muted-foreground inline-flex items-center gap-1">
            <X className="h-3 w-3" /> É preciso manter ao menos um motivo
            cadastrado.
          </p>
        )}
      </div>
    </section>
  );
}

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
  hasAppId: boolean;
  hasBusinessConfigId: boolean;
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

function MetaIntegrationSection() {
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
      console.log("META_DEBUG_TOKEN_RESULT", data);
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

  const onConnect = async () => {
    setError(null);
    setInfo(null);
    setAvailable([]);
    setConnecting(true);
    try {
      const config = await getMetaBusinessConfig();
      setMetaConfig(config);
      if (!config.hasAppId) {
        throw new Error(
          "Configure META_APP_ID no projeto antes de conectar (App ID do Meta for Developers).",
        );
      }
      if (!config.hasBusinessConfigId) {
        throw new Error(
          "Configure META_BUSINESS_CONFIG_ID com o Configuration ID do Facebook Login for Business antes de conectar.",
        );
      }

      await loadFbSdk(config.appId);

      // Logar origem atual para diagnosticar domínio bloqueado pelo Meta
      const currentOrigin = typeof window !== "undefined" ? window.location.origin : "";
      const currentHref = typeof window !== "undefined" ? window.location.href : "";
      const currentHost = typeof window !== "undefined" ? window.location.host : "";
      console.log("META_REDIRECT_URI", { origin: currentOrigin, href: currentHref });
      console.log("META_CALLBACK_URL", { callback: `${currentOrigin}/`, host: currentHost });

      // Scopes obrigatórios para listar páginas e Instagram Business
      const REQUIRED_SCOPES = [
        "public_profile",
        "pages_show_list",
        "pages_read_engagement",
        "pages_manage_metadata",
        "pages_messaging",
        "instagram_basic",
        "business_management",
      ].join(",");

      // Limpar sessão FB antiga para evitar reutilizar token com escopo reduzido
      try {
        await new Promise<void>((resolve) => {
          window.FB!.getLoginStatus((statusRes: unknown) => {
            const s = (statusRes as { status?: string })?.status;
            console.log("META_FB_PREVIOUS_STATUS", s);
            if (s === "connected") {
              window.FB!.logout(() => {
                console.log("META_FB_LOGGED_OUT_PREVIOUS");
                resolve();
              });
            } else {
              resolve();
            }
          });
        });
      } catch (e) {
        console.warn("META_FB_LOGOUT_FAIL", e);
      }

      const loginOptions = {
        config_id: config.businessConfigId,
        scope: REQUIRED_SCOPES,
        auth_type: "rerequest" as const,
        return_scopes: true,
        response_type: "token" as const,
        override_default_response_type: true,
      };
      console.log("META_LOGIN_SCOPE_SENT", {
        scope: REQUIRED_SCOPES,
        scopes_array: REQUIRED_SCOPES.split(","),
        config_id: config.businessConfigId,
        auth_type: "rerequest",
      });
      console.log("META_OAUTH_URL", {
        approx: `https://www.facebook.com/v21.0/dialog/oauth?client_id=${config.appId}&config_id=${config.businessConfigId}&scope=${encodeURIComponent(REQUIRED_SCOPES)}&auth_type=rerequest&response_type=token`,
      });

      const auth = await new Promise<{
        accessToken: string;
        userID: string;
        grantedScopes?: string;
      }>((resolve, reject) => {
        window.FB!.login(
          (res) => {
            console.log("META_LOGIN_RESPONSE", res);
            const ar = (res as unknown as {
              authResponse?: {
                accessToken: string;
                userID: string;
                grantedScopes?: string;
              };
            }).authResponse;
            if (ar?.accessToken)
              resolve({
                accessToken: ar.accessToken,
                userID: ar.userID,
                grantedScopes: ar.grantedScopes,
              });
            else reject(new Error("Login cancelado ou negado"));
          },
          loginOptions,
        );
      });
      setShortToken(auth.accessToken);
      console.log("META_LOGIN_SUCCESS", { userID: auth.userID });
      console.log("META_ACCESS_TOKEN", {
        token_preview: `${auth.accessToken.slice(0, 12)}...${auth.accessToken.slice(-6)}`,
        length: auth.accessToken.length,
      });
      console.log("META_GRANTED_SCOPES", {
        granted_scopes: auth.grantedScopes ?? null,
        scopes_array: auth.grantedScopes ? auth.grantedScopes.split(",") : [],
      });

      // Inspeciona o token para confirmar se é USER token (não system user)
      try {
        const debugUrl =
          `https://graph.facebook.com/v25.0/debug_token` +
          `?input_token=${encodeURIComponent(auth.accessToken)}` +
          `&access_token=${encodeURIComponent(auth.accessToken)}`;
        const debugRes = await fetch(debugUrl);
        const debugJson = await debugRes.json();
        const debugData = (debugJson as { data?: { type?: string; scopes?: string[]; granular_scopes?: unknown } })?.data ?? {};
        const tokenType = debugData.type ?? null;
        console.log("META_TOKEN_DEBUG", {
          type: tokenType,
          is_user_token: tokenType === "USER",
          payload: debugJson,
        });
        console.log("META_TOKEN_SCOPES", {
          scopes: debugData.scopes ?? null,
          granular_scopes: debugData.granular_scopes ?? null,
          granted_via_login: auth.grantedScopes ?? null,
        });
      } catch (e) {
        console.warn("META_TOKEN_DEBUG_FAIL", e);
      }

      // Busca páginas + Instagram vinculado direto na Graph API (v25.0).
      const accountsUrl =
        `https://graph.facebook.com/v25.0/me/accounts` +
        `?fields=id,name,access_token,instagram_business_account{id,username}` +
        `&limit=100&access_token=${encodeURIComponent(auth.accessToken)}`;
      const accountsRes = await fetch(accountsUrl);
      const accountsJson = (await accountsRes.json()) as Record<string, unknown>;
      console.log("META_ME_ACCOUNTS_RESPONSE", {
        status: accountsRes.status,
        ok: accountsRes.ok,
        payload: accountsJson,
      });

      const errObj = (accountsJson as { error?: { message?: string } }).error;
      if (errObj) {
        console.error("META_PAGES_ERROR", { error: errObj, fullPayload: accountsJson });
        throw new Error(`Graph API: ${errObj.message ?? "erro desconhecido"}`);
      }

      // Parsing defensivo: aceita {data:[...]}, {data:{data:[...]}} e {pages:[...]}.
      type RawPage = {
        id: string;
        name: string;
        access_token: string;
        instagram_business_account?: { id?: string; username?: string };
      };
      const root = accountsJson as {
        data?: RawPage[] | { data?: RawPage[] };
        pages?: RawPage[];
      };
      let accounts: RawPage[] = [];
      if (Array.isArray(root.data)) accounts = root.data;
      else if (root.data && Array.isArray((root.data as { data?: RawPage[] }).data))
        accounts = (root.data as { data: RawPage[] }).data;
      else if (Array.isArray(root.pages)) accounts = root.pages;

      console.log("META_ACCOUNTS_RAW_DATA", {
        count: accounts.length,
        accounts,
        used_key: Array.isArray(root.data)
          ? "data"
          : root.data && Array.isArray((root.data as { data?: RawPage[] }).data)
            ? "data.data"
            : Array.isArray(root.pages)
              ? "pages"
              : "none",
      });

      if (!accounts?.length) {
        console.warn("META_ME_ACCOUNTS_EMPTY", {
          fullPayload: accountsJson,
          hint: "Nenhuma página retornada. Verifique se o usuário é admin de alguma página e se concedeu pages_show_list.",
        });
      }

      const list: AvailablePage[] = accounts.map((p) => ({
        id: p.id,
        name: p.name,
        access_token: p.access_token,
        ig_business_account_id: p.instagram_business_account?.id ?? null,
        ig_username: p.instagram_business_account?.username ?? null,
      }));

      for (const p of list) {
        console.log("META_PAGE_FOUND", {
          page_id: p.id,
          page_name: p.name,
          has_access_token: Boolean(p.access_token),
          ig_business_account_id: p.ig_business_account_id,
          ig_username: p.ig_username,
        });
        if (p.ig_business_account_id) {
          console.log("META_IG_FOUND", {
            page_id: p.id,
            page_name: p.name,
            ig_business_account_id: p.ig_business_account_id,
            ig_username: p.ig_username,
          });
        }
      }

      console.log("META_PAGES_FOUND", {
        count: list.length,
        pages: list.map((p) => ({ id: p.id, name: p.name })),
      });
      const withIg = list.filter((p) => p.ig_business_account_id);
      console.log("META_IG_FOUND_SUMMARY", {
        count: withIg.length,
        igs: withIg.map((p) => p.ig_username),
      });

      console.log("META_RENDERING_PAGES", {
        count: list.length,
        payload: list,
      });
      setAvailable(list);

      // Registro "basic" isolado — não pode derrubar o state das páginas.
      try {
        const { supabase } = await import("@/integrations/supabase/client");
        await supabase.functions.invoke("meta-connect", {
          body: {
            mode: "basic",
            shortLivedToken: auth.accessToken,
            userID: auth.userID,
          },
        });
      } catch (basicErr) {
        console.warn("META_BASIC_INVOKE_FAIL", basicErr);
      }

      if (list.length === 0) {
        setInfo(
          "Login Meta conectado, mas nenhuma página Facebook foi encontrada nesta conta. Verifique se você é admin de alguma página.",
        );
      } else {
        setInfo(
          `Login Meta conectado. ${list.length} página(s) disponível(is) para conexão.`,
        );
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Falha ao conectar");
    } finally {
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
    try {
      const { supabase } = await import("@/integrations/supabase/client");
      const { data, error } = await supabase.functions.invoke("meta-connect", {
        body: {
          mode: "connect_page",
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
      const igLabel = result?.page?.ig_username
        ? ` · Instagram: @${result.page.ig_username}`
        : "";
      const webhookLabel = result?.webhook_subscribed
        ? " · Webhook ativo"
        : " · Webhook não confirmado";
      setInfo(`Conectado: ${savedName}${igLabel}${webhookLabel}`);
      console.log("META_TOKEN_SAVED", { page_id: page.id, ig: result?.page?.ig_username });
      setAvailable((prev) => prev.filter((p) => p.id !== page.id));
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Falha ao salvar página");
    } finally {
      setSavingPageId(null);
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
        Conecte páginas do Facebook + Instagram Business para receber DMs, mensagens
        do Messenger e comentários direto na sua caixa de atendimento.
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
                      Token expira{" "}
                      {new Date(p.token_expires_at).toLocaleDateString("pt-BR")}
                    </>
                  )}
                </p>
                {p.last_error && (
                  <p className="text-[11px] text-[var(--status-urgent)] truncate">
                    {p.last_error}
                  </p>
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

      <div className="mb-4">
        <p className="text-xs font-semibold mb-2">
          Páginas disponíveis{" "}
          <span className="text-muted-foreground font-normal">
            ({available.length} encontrada{available.length === 1 ? "" : "s"})
          </span>
        </p>
        {/* Debug temporário — remover após validar render */}
        <pre className="mb-2 max-h-32 overflow-auto rounded bg-muted/40 p-2 text-[10px] text-muted-foreground">
          {JSON.stringify(available, null, 2)}
        </pre>
        {available.length === 0 ? (
          <div className="rounded-md border border-dashed border-border bg-background px-3 py-4 text-center">
            <p className="text-xs text-muted-foreground">
              Clique em <strong>Conectar Instagram / Facebook</strong> abaixo para listar suas páginas.
            </p>
          </div>
        ) : (
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
        )}
      </div>

      <button
        onClick={onConnect}
        disabled={connecting}
        className="inline-flex items-center gap-2 text-xs font-semibold rounded-md bg-[#1877F2] text-white px-3 py-2 hover:opacity-90 disabled:opacity-60"
      >
        {connecting ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : (
          <Plug className="h-3.5 w-3.5" />
        )}
        Conectar Instagram / Facebook
      </button>

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
          Defina <code className="bg-muted px-1 rounded">META_APP_ID</code> com o App ID do
          seu app Meta para habilitar o login.
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
