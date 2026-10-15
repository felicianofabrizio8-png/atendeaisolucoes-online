import { useEffect, useState } from "react";
import { format, formatDistanceToNowStrict } from "date-fns";
import { ptBR } from "date-fns/locale";
import { Plus, Sparkles } from "lucide-react";
import type { AgendaPulse } from "./agenda-model";
import { AgendaArtwork } from "./AgendaArtwork";

/** Topo da Agenda: tipografia editorial, pulso do dia e a escultura de vidro da Lume. */
export function AgendaHero({
  pulse,
  onCreate,
  onAskLume,
}: {
  pulse: AgendaPulse;
  onCreate: () => void;
  onAskLume?: () => void;
}) {
  const now = useNow();
  const next = pulse.next;
  return (
    <section className="ag-hero" aria-label="Resumo da agenda">
      <div className="flex min-w-0 flex-col justify-between gap-8">
        <div>
          <p className="ag-mono">Lume · Agenda da equipe</p>
          <h1 className="ag-hero-title mt-4">
            Agenda
            <span className="capitalize">{format(now, "EEEE", { locale: ptBR })}</span>
          </h1>
          <div className="mt-5 flex items-center gap-4">
            <div className="ag-hero-rule" />
            <p className="text-sm text-[var(--ag-muted)] first-letter:uppercase">
              {format(now, "d 'de' MMMM 'de' yyyy", { locale: ptBR })}
            </p>
          </div>
        </div>
        <div className="space-y-4">
          <div className="ag-pulse">
            <Pulse value={pulse.today} label="Hoje" />
            <Pulse value={pulse.week} label="Nesta semana" />
            <Pulse value={pulse.open} label="Em aberto" />
            <Pulse value={pulse.done} label="Finalizados" />
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" className="ag-btn ag-btn-primary" onClick={onCreate}>
              <Plus className="h-4 w-4" />
              Novo compromisso
            </button>
            {onAskLume && (
              <button type="button" className="ag-btn" onClick={onAskLume}>
                <Sparkles className="h-4 w-4" />
                Pedir à Lume
              </button>
            )}
          </div>
        </div>
      </div>

      <figure className="ag-hero-art">
        <AgendaArtwork />
        <figcaption className="ag-hero-caption">
          {next ? (
            <>
              <span className="ag-mono">Próximo</span>
              <span className="text-sm">
                <b className="font-semibold tabular-nums">
                  {format(new Date(next.scheduled_at), "HH:mm")}
                </b>{" "}
                · {next.title}
              </span>
              <span className="text-xs text-[var(--ag-muted)]">
                {formatDistanceToNowStrict(new Date(next.scheduled_at), {
                  locale: ptBR,
                  addSuffix: true,
                })}
              </span>
            </>
          ) : (
            <>
              <span className="ag-mono">Agenda livre</span>
              <span className="text-sm text-[var(--ag-muted)]">
                Nenhum compromisso pela frente.
              </span>
            </>
          )}
        </figcaption>
      </figure>
    </section>
  );
}

function useNow() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(timer);
  }, []);
  return now;
}

function Pulse({ value, label }: { value: number; label: string }) {
  return (
    <div className="ag-pulse-item">
      <strong>{value}</strong>
      <span className="mt-1 block text-[11.5px] text-[var(--ag-muted)]">{label}</span>
    </div>
  );
}
