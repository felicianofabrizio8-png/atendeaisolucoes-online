import { createFileRoute } from "@tanstack/react-router";
import { useSyncExternalStore, useState, useEffect } from "react";
import {
  Settings as SettingsIcon,
  Clock,
  Check,
  XCircle,
  Plus,
  Pencil,
  Trash2,
  X,
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

        <section className="rounded-lg border border-dashed border-border p-5 text-center">
          <p className="text-xs text-muted-foreground">
            Em breve: integrações com WhatsApp, Instagram e Facebook.
          </p>
        </section>
      </div>
    </div>
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
