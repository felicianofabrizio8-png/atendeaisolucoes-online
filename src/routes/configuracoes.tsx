import { createFileRoute } from "@tanstack/react-router";
import { useSyncExternalStore, useState, useEffect } from "react";
import { Settings as SettingsIcon, Clock, Check } from "lucide-react";
import {
  getSettings,
  subscribeSettings,
  updateSettings,
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

        <section className="rounded-lg border border-dashed border-border p-5 text-center">
          <p className="text-xs text-muted-foreground">
            Em breve: integrações com WhatsApp, Instagram e Facebook, motivos
            de perda customizados.
          </p>
        </section>
      </div>
    </div>
  );
}
