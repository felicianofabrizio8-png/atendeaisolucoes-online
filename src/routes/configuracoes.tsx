import { createFileRoute } from "@tanstack/react-router";
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
  type Integration,
} from "@/data/integrationRepo";
import { useAuth } from "@/auth/AuthContext";
import { cn } from "@/lib/utils";

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
      <header className="h-14 px-6 border-b border-border flex items-center gap-3">
        <SettingsIcon className="h-4 w-4 text-primary" />
        <div>
          <h1 className="text-sm font-semibold">Configurações</h1>
          <p className="text-[11px] text-muted-foreground">
            SLA, integrações e preferências da loja
          </p>
        </div>
      </header>

      <div className="p-6 max-w-2xl space-y-8">
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
      <div className="flex items-center gap-2 mb-1">
        <Plug className="h-4 w-4 text-primary" />
        <h2 className="text-sm font-semibold">Integrações de canais</h2>
      </div>
      <p className="text-xs text-muted-foreground mb-4">
        Conecte o WhatsApp da sua empresa para receber mensagens reais no inbox e
        responder sem sair do sistema. Use a Cloud API da Meta.
      </p>

      <div className="rounded-md bg-secondary/40 border border-border p-3 mb-4 text-[11px] space-y-1">
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

      {error && (
        <div className="mb-3 rounded-md bg-[var(--status-urgent)]/10 text-[var(--status-urgent)] text-xs px-3 py-2">
          {error}
        </div>
      )}

      <ul className="space-y-2">
        {loading && (
          <li className="text-xs text-muted-foreground inline-flex items-center gap-1.5">
            <Loader2 className="h-3 w-3 animate-spin" /> Carregando…
          </li>
        )}
        {!loading && items.length === 0 && (
          <li className="text-xs text-muted-foreground">
            Nenhuma integração configurada ainda.
          </li>
        )}
        {items.map((it) => (
          <IntegrationItem key={it.id} item={it} onChanged={reload} />
        ))}
      </ul>

      <div className="mt-4 pt-4 border-t border-border">
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
            <MessageCircle className="h-3.5 w-3.5" /> Conectar WhatsApp
          </button>
        )}
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
  return (
    <li className="flex items-center gap-3 rounded-md border border-border bg-background px-3 py-2.5">
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
    </li>
  );
}

function randomToken(len = 24) {
  const chars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let out = "";
  for (let i = 0; i < len; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
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
      setErr(e instanceof Error ? e.message : "Falha ao salvar");
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

function Field({ label, children }: { label: string; children: React.ReactNode }) {
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
