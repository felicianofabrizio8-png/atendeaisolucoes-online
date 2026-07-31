import { useState, useSyncExternalStore } from "react";
import { formatBRL } from "@/data/mock";
import { useAuth } from "@/auth/AuthContext";
import { cn } from "@/lib/utils";
import { FileText, Calendar, Target, CheckCircle2, XCircle, Loader2, X, DollarSign } from "lucide-react";
import { getSettings, subscribeSettings } from "@/data/settings";

export function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="text-sm text-right">{value}</span>
    </div>
  );
}

export function ActionButton({
  icon: Icon,
  children,
  variant = "default",
  onClick,
  disabled,
  title,
}: {
  icon: typeof FileText;
  children: React.ReactNode;
  variant?: "default" | "won" | "lost";
  onClick?: () => void;
  disabled?: boolean;
  title?: string;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={cn(
        "w-full inline-flex items-center gap-2 rounded-md px-2.5 py-2 text-sm hover:bg-accent transition-colors disabled:opacity-40 disabled:cursor-not-allowed",
        variant === "won" && "text-[var(--status-won)]",
        variant === "lost" && "text-[var(--status-lost)]",
      )}
    >
      <Icon className="h-4 w-4" />
      {children}
    </button>
  );
}

export function CloseSaleModal({
  defaultValue,
  leadName,
  onCancel,
  onConfirm,
}: {
  defaultValue?: number;
  leadName: string;
  onCancel: () => void;
  onConfirm: (value: number) => void;
}) {
  const [raw, setRaw] = useState<string>(defaultValue ? String(defaultValue) : "");
  const value = Number(raw.replace(/[^\d]/g, ""));
  const valid = value > 0;

  return (
    <div
      className="fixed inset-0 z-50 bg-background/70 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={onCancel}
    >
      <div
        className="w-full max-w-sm rounded-lg border border-border bg-card shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-4 border-b border-border flex items-center gap-2">
          <CheckCircle2 className="h-4 w-4 text-[var(--status-won)]" />
          <h2 className="text-sm font-semibold">Fechar venda — {leadName}</h2>
          <button onClick={onCancel} className="ml-auto p-1 rounded hover:bg-accent">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="p-4 space-y-3">
          <label className="block">
            <span className="text-xs text-muted-foreground">Valor da venda (R$)</span>
            <div className="mt-1 flex items-center gap-2 rounded-md bg-input px-3 py-2 focus-within:ring-2 focus-within:ring-ring">
              <DollarSign className="h-4 w-4 text-muted-foreground" />
              <input
                autoFocus
                inputMode="numeric"
                value={raw}
                onChange={(e) => setRaw(e.target.value.replace(/[^\d]/g, ""))}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && valid) onConfirm(value);
                }}
                placeholder="Ex: 28500"
                className="flex-1 bg-transparent outline-none text-sm"
              />
            </div>
            {valid && (
              <span className="text-[11px] text-muted-foreground mt-1 block">
                {formatBRL(value)}
              </span>
            )}
          </label>
        </div>
        <div className="p-4 border-t border-border flex justify-end gap-2">
          <button
            onClick={onCancel}
            className="text-xs rounded-md bg-secondary px-3 py-2 hover:bg-accent"
          >
            Cancelar
          </button>
          <button
            disabled={!valid}
            onClick={() => onConfirm(value)}
            className="inline-flex items-center gap-1.5 text-xs font-semibold rounded-md bg-[var(--status-won)] text-white px-3 py-2 hover:opacity-90 disabled:opacity-40"
          >
            <CheckCircle2 className="h-3.5 w-3.5" /> Confirmar venda
          </button>
        </div>
      </div>
    </div>
  )
}

export function MarkLostModal({
  leadName,
  onCancel,
  onConfirm,
}: {
  leadName: string;
  onCancel: () => void;
  onConfirm: (reason: string, notes?: string) => void;
}) {
  const settings = useSyncExternalStore(subscribeSettings, getSettings, getSettings);
  const reasons = settings.lossReasons;
  // Não pré-seleciona — força a vendedora a escolher um motivo conscientemente.
  const [selected, setSelected] = useState<string>("");
  const [custom, setCustom] = useState("");
  const [notes, setNotes] = useState("");
  const useCustom = selected === "__custom__";
  const finalReason = useCustom ? custom.trim() : selected;
  const valid = !!finalReason;

  return (
    <div
      className="fixed inset-0 z-50 bg-background/70 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={onCancel}
    >
      <div
        className="w-full max-w-sm rounded-lg border border-border bg-card shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-4 border-b border-border flex items-center gap-2">
          <XCircle className="h-4 w-4 text-[var(--status-lost)]" />
          <h2 className="text-sm font-semibold">Marcar como perdido — {leadName}</h2>
          <button onClick={onCancel} className="ml-auto p-1 rounded hover:bg-accent">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="p-4 space-y-3">
          <p className="text-xs text-muted-foreground">
            Selecione um motivo <span className="font-semibold text-foreground">(obrigatório)</span>{" "}
            para entrar nos relatórios automaticamente.
          </p>
          <div className="space-y-1.5">
            {reasons.map((r) => (
              <label
                key={r}
                className={cn(
                  "flex items-center gap-2 rounded-md border px-3 py-2 text-sm cursor-pointer transition-colors",
                  selected === r
                    ? "border-[var(--status-lost)] bg-[var(--status-lost)]/10"
                    : "border-border hover:bg-accent",
                )}
              >
                <input
                  type="radio"
                  name="loss-reason"
                  value={r}
                  checked={selected === r}
                  onChange={() => setSelected(r)}
                  className="accent-[var(--status-lost)]"
                />
                <span className="flex-1">{r}</span>
              </label>
            ))}
            <label
              className={cn(
                "flex items-center gap-2 rounded-md border px-3 py-2 text-sm cursor-pointer transition-colors",
                useCustom
                  ? "border-[var(--status-lost)] bg-[var(--status-lost)]/10"
                  : "border-border hover:bg-accent",
              )}
            >
              <input
                type="radio"
                name="loss-reason"
                value="__custom__"
                checked={useCustom}
                onChange={() => setSelected("__custom__")}
                className="accent-[var(--status-lost)]"
              />
              <span className="flex-1">Outro…</span>
            </label>
            {useCustom && (
              <input
                autoFocus
                type="text"
                value={custom}
                onChange={(e) => setCustom(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && valid) onConfirm(finalReason, notes.trim() || undefined);
                }}
                placeholder="Descreva o motivo"
                className="w-full h-9 px-3 text-sm rounded-md border border-border bg-background focus:outline-none focus:ring-1 focus:ring-ring"
              />
            )}
          </div>
          <div>
            <label className="text-[11px] uppercase tracking-wide text-muted-foreground">
              Observações (opcional)
            </label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              placeholder="Detalhes adicionais"
              className="mt-1 w-full text-sm rounded-md border border-border bg-background px-3 py-2 focus:outline-none focus:ring-1 focus:ring-ring"
            />
          </div>
          <p className="text-[11px] text-muted-foreground">
            Você pode gerenciar a lista em{" "}
            <span className="font-semibold">Configurações → Motivos de perda</span>.
          </p>
        </div>
        <div className="p-4 border-t border-border flex justify-end gap-2">
          <button
            onClick={onCancel}
            className="text-xs rounded-md bg-secondary px-3 py-2 hover:bg-accent"
          >
            Cancelar
          </button>
          <button
            disabled={!valid}
            onClick={() => onConfirm(finalReason, notes.trim() || undefined)}
            className="inline-flex items-center gap-1.5 text-xs font-semibold rounded-md bg-[var(--status-lost)] text-white px-3 py-2 hover:opacity-90 disabled:opacity-40"
          >
            <XCircle className="h-3.5 w-3.5" /> Confirmar perda
          </button>
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// NextActionModal — cria "próxima ação" para o lead.
// ============================================================================
export const NEXT_ACTION_TYPES: { value: string; label: string }[] = [
  { value: "Ligação", label: "Ligação" },
  { value: "WhatsApp", label: "WhatsApp" },
  { value: "E-mail", label: "E-mail" },
  { value: "Enviar orçamento", label: "Enviar orçamento" },
  { value: "Agendar visita", label: "Agendar visita" },
  { value: "Retorno", label: "Retorno" },
  { value: "Outro", label: "Outro" },
];

export function NextActionModal({
  leadName,
  onCancel,
  onConfirm,
}: {
  leadName: string;
  onCancel: () => void;
  onConfirm: (payload: { label: string; dueAt: string; notes?: string }) => void | Promise<void>;
}) {
  const { profile } = useAuth();
  const now = new Date();
  const defaultDate = now.toISOString().slice(0, 10);
  const defaultTime = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes() + 30).padStart(2, "0")}`.slice(0, 5);

  const [type, setType] = useState<string>("Ligação");
  const [customLabel, setCustomLabel] = useState("");
  const [date, setDate] = useState(defaultDate);
  const [time, setTime] = useState(defaultTime);
  const [responsible, setResponsible] = useState(profile?.display_name ?? "");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  const isOther = type === "Outro";
  const finalLabel = isOther ? customLabel.trim() : type;
  const valid = !!finalLabel && !!date && !!time;

  async function handleSave() {
    if (!valid || saving) return;
    setSaving(true);
    try {
      const dueAt = new Date(`${date}T${time}:00`).toISOString();
      const composedLabel = responsible.trim()
        ? `${finalLabel} · ${responsible.trim()}`
        : finalLabel;
      await onConfirm({ label: composedLabel, dueAt, notes: notes.trim() || undefined });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 bg-background/70 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={onCancel}
    >
      <div
        className="w-full max-w-md rounded-lg border border-border bg-card shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-4 border-b border-border flex items-center gap-2">
          <Target className="h-4 w-4 text-primary" />
          <h2 className="text-sm font-semibold">Definir próxima ação — {leadName}</h2>
          <button onClick={onCancel} className="ml-auto p-1 rounded hover:bg-accent">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="p-4 space-y-3">
          <div>
            <label className="text-[11px] uppercase tracking-wide text-muted-foreground">Tipo *</label>
            <select
              value={type}
              onChange={(e) => setType(e.target.value)}
              className="mt-1 w-full h-9 px-3 text-sm rounded-md border border-border bg-background focus:outline-none focus:ring-1 focus:ring-ring"
            >
              {NEXT_ACTION_TYPES.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </div>
          {isOther && (
            <div>
              <label className="text-[11px] uppercase tracking-wide text-muted-foreground">Descreva *</label>
              <input
                autoFocus
                value={customLabel}
                onChange={(e) => setCustomLabel(e.target.value)}
                placeholder="Ex.: Enviar catálogo em PDF"
                className="mt-1 w-full h-9 px-3 text-sm rounded-md border border-border bg-background focus:outline-none focus:ring-1 focus:ring-ring"
              />
            </div>
          )}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[11px] uppercase tracking-wide text-muted-foreground">Data *</label>
              <input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="mt-1 w-full h-9 px-3 text-sm rounded-md border border-border bg-background focus:outline-none focus:ring-1 focus:ring-ring"
              />
            </div>
            <div>
              <label className="text-[11px] uppercase tracking-wide text-muted-foreground">Hora *</label>
              <input
                type="time"
                value={time}
                onChange={(e) => setTime(e.target.value)}
                className="mt-1 w-full h-9 px-3 text-sm rounded-md border border-border bg-background focus:outline-none focus:ring-1 focus:ring-ring"
              />
            </div>
          </div>
          <div>
            <label className="text-[11px] uppercase tracking-wide text-muted-foreground">Responsável</label>
            <input
              value={responsible}
              onChange={(e) => setResponsible(e.target.value)}
              placeholder="Nome do responsável"
              className="mt-1 w-full h-9 px-3 text-sm rounded-md border border-border bg-background focus:outline-none focus:ring-1 focus:ring-ring"
            />
          </div>
          <div>
            <label className="text-[11px] uppercase tracking-wide text-muted-foreground">Observações</label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              placeholder="Detalhes adicionais"
              className="mt-1 w-full text-sm rounded-md border border-border bg-background px-3 py-2 focus:outline-none focus:ring-1 focus:ring-ring"
            />
          </div>
        </div>
        <div className="p-4 border-t border-border flex justify-end gap-2">
          <button
            onClick={onCancel}
            className="text-xs rounded-md bg-secondary px-3 py-2 hover:bg-accent"
            disabled={saving}
          >
            Cancelar
          </button>
          <button
            disabled={!valid || saving}
            onClick={handleSave}
            className="inline-flex items-center gap-1.5 text-xs font-semibold rounded-md bg-primary text-primary-foreground px-3 py-2 hover:opacity-90 disabled:opacity-40"
          >
            {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Target className="h-3.5 w-3.5" />}
            Salvar próxima ação
          </button>
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// ScheduleVisitModal — cria uma visita vinculada ao lead.
// ============================================================================
export const VISIT_TYPE_OPTIONS: { value: "visita_tecnica" | "loja" | "retorno_comercial" | "instalacao"; label: string }[] = [
  { value: "visita_tecnica", label: "Residência" },
  { value: "loja", label: "Loja" },
  { value: "instalacao", label: "Empresa" },
  { value: "retorno_comercial", label: "Terreno" },
];

export function ScheduleVisitModal({
  leadName,
  onCancel,
  onConfirm,
}: {
  leadName: string;
  onCancel: () => void;
  onConfirm: (payload: {
    date: string;
    time: string;
    address: string;
    appointmentType: "visita_tecnica" | "loja" | "retorno_comercial" | "instalacao";
    confirmed: boolean;
    notes: string;
  }) => void | Promise<void>;
}) {
  const now = new Date();
  const [date, setDate] = useState(now.toISOString().slice(0, 10));
  const [time, setTime] = useState("09:00");
  const [address, setAddress] = useState("");
  const [appointmentType, setAppointmentType] =
    useState<"visita_tecnica" | "loja" | "retorno_comercial" | "instalacao">("visita_tecnica");
  const [confirmed, setConfirmed] = useState(false);
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  const needsAddress = appointmentType !== "loja";
  const valid = !!date && !!time && (!needsAddress || !!address.trim());

  async function handleSave() {
    if (!valid || saving) return;
    setSaving(true);
    try {
      await onConfirm({ date, time, address: address.trim(), appointmentType, confirmed, notes: notes.trim() });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 bg-background/70 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={onCancel}
    >
      <div
        className="w-full max-w-md rounded-lg border border-border bg-card shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-4 border-b border-border flex items-center gap-2">
          <Calendar className="h-4 w-4 text-primary" />
          <h2 className="text-sm font-semibold">Agendar visita — {leadName}</h2>
          <button onClick={onCancel} className="ml-auto p-1 rounded hover:bg-accent">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="p-4 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[11px] uppercase tracking-wide text-muted-foreground">Data *</label>
              <input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="mt-1 w-full h-9 px-3 text-sm rounded-md border border-border bg-background focus:outline-none focus:ring-1 focus:ring-ring"
              />
            </div>
            <div>
              <label className="text-[11px] uppercase tracking-wide text-muted-foreground">Hora *</label>
              <input
                type="time"
                value={time}
                onChange={(e) => setTime(e.target.value)}
                className="mt-1 w-full h-9 px-3 text-sm rounded-md border border-border bg-background focus:outline-none focus:ring-1 focus:ring-ring"
              />
            </div>
          </div>
          <div>
            <label className="text-[11px] uppercase tracking-wide text-muted-foreground">Tipo *</label>
            <select
              value={appointmentType}
              onChange={(e) => setAppointmentType(e.target.value as typeof appointmentType)}
              className="mt-1 w-full h-9 px-3 text-sm rounded-md border border-border bg-background focus:outline-none focus:ring-1 focus:ring-ring"
            >
              {VISIT_TYPE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-[11px] uppercase tracking-wide text-muted-foreground">
              Endereço {needsAddress ? "*" : "(opcional)"}
            </label>
            <input
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              disabled={!needsAddress}
              placeholder={needsAddress ? "Rua, número, bairro" : "Atendimento na loja"}
              className="mt-1 w-full h-9 px-3 text-sm rounded-md border border-border bg-background focus:outline-none focus:ring-1 focus:ring-ring disabled:opacity-50"
            />
          </div>
          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <input
              type="checkbox"
              checked={confirmed}
              onChange={(e) => setConfirmed(e.target.checked)}
              className="accent-primary"
            />
            Cliente confirmou a visita
          </label>
          <div>
            <label className="text-[11px] uppercase tracking-wide text-muted-foreground">Observações</label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              placeholder="Instruções ao vendedor, referências do local, etc."
              className="mt-1 w-full text-sm rounded-md border border-border bg-background px-3 py-2 focus:outline-none focus:ring-1 focus:ring-ring"
            />
          </div>
        </div>
        <div className="p-4 border-t border-border flex justify-end gap-2">
          <button
            onClick={onCancel}
            className="text-xs rounded-md bg-secondary px-3 py-2 hover:bg-accent"
            disabled={saving}
          >
            Cancelar
          </button>
          <button
            disabled={!valid || saving}
            onClick={handleSave}
            className="inline-flex items-center gap-1.5 text-xs font-semibold rounded-md bg-primary text-primary-foreground px-3 py-2 hover:opacity-90 disabled:opacity-40"
          >
            {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Calendar className="h-3.5 w-3.5" />}
            Agendar visita
          </button>
        </div>
      </div>
    </div>
  );
}
