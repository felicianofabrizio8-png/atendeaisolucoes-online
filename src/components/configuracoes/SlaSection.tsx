// Seção "SLA — Tempo máximo de resposta" da aba Atendimento.
// Movida de src/routes/configuracoes.tsx.

import { useEffect, useState } from "react";
import { Check, Clock } from "lucide-react";
import { SLA_OPTIONS, updateSettings } from "@/data/settings";
import { cn } from "@/lib/utils";

export function SlaSection({ slaMinutes }: { slaMinutes: number }) {
  const [customMinutes, setCustomMinutes] = useState<string>(String(slaMinutes));
  const [savedAt, setSavedAt] = useState<number | null>(null);

  useEffect(() => {
    setCustomMinutes(String(slaMinutes));
  }, [slaMinutes]);

  const isPreset = SLA_OPTIONS.some((o) => o.minutes === slaMinutes);

  const apply = (minutes: number) => {
    if (!Number.isFinite(minutes) || minutes <= 0) return;
    updateSettings({ slaMinutes: Math.round(minutes) });
    setSavedAt(Date.now());
  };

  return (
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
          const active = slaMinutes === opt.minutes;
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
            Valor atual: <span className="font-semibold">{slaMinutes} min</span>
          </p>
        )}
      </div>

      {savedAt && (
        <div className="mt-3 inline-flex items-center gap-1.5 text-[11px] text-[var(--status-won)] font-semibold">
          <Check className="h-3 w-3" /> Salvo
        </div>
      )}
    </section>
  );
}
