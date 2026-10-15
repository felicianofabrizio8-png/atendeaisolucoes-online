import { format, formatDistanceToNowStrict } from "date-fns";
import { ptBR } from "date-fns/locale";
import { Plus, Sparkles } from "lucide-react";
import { TYPE_LABEL, type AgendaPulse } from "./agenda-model";

/** Topo da Agenda: tipografia editorial, pulso do dia e o próximo compromisso no vidro. */
export function AgendaHero({
  pulse,
  onCreate,
  onAskLume,
}: {
  pulse: AgendaPulse;
  onCreate: () => void;
  onAskLume?: () => void;
}) {
  const today = new Date();
  const next = pulse.next;
  return (
    <section className="ag-hero" aria-label="Resumo da agenda">
      <div className="flex min-w-0 flex-col justify-between gap-8">
        <div>
          <p className="ag-mono">Lume · Agenda da equipe</p>
          <h1 className="ag-hero-title mt-4">
            Agenda
            <span className="capitalize">{format(today, "EEEE", { locale: ptBR })}</span>
          </h1>
          <div className="mt-5 flex items-center gap-4">
            <div className="ag-hero-rule" />
            <p className="text-sm text-[var(--ag-muted)] first-letter:uppercase">
              {format(today, "d 'de' MMMM 'de' yyyy", { locale: ptBR })}
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

      <div className="ag-fluted" aria-hidden={!next}>
        <span className="ag-fluted-label ag-mono">{format(today, "yyyy")} · Lume</span>
        <div className="ag-fluted-next">
          {next ? (
            <>
              <p className="ag-mono !text-white/70">Próximo compromisso</p>
              <p className="mt-2 text-[clamp(22px,3vw,34px)] font-semibold leading-none tracking-tight text-white">
                {format(new Date(next.scheduled_at), "HH:mm")}
                <span className="ml-3 text-base font-medium text-white/70">
                  {formatDistanceToNowStrict(new Date(next.scheduled_at), {
                    locale: ptBR,
                    addSuffix: true,
                  })}
                </span>
              </p>
              <p className="mt-2 truncate text-sm font-medium text-white">{next.title}</p>
              <p className="truncate text-xs text-white/65">
                {[TYPE_LABEL[next.appointment_type]?.label, next.customer_name, next.city]
                  .filter(Boolean)
                  .join(" · ")}
              </p>
            </>
          ) : (
            <>
              <p className="ag-mono !text-white/70">Agenda livre</p>
              <p className="mt-2 text-2xl font-semibold tracking-tight text-white">
                Nenhum compromisso pela frente.
              </p>
            </>
          )}
        </div>
      </div>
    </section>
  );
}

function Pulse({ value, label }: { value: number; label: string }) {
  return (
    <div className="ag-pulse-item">
      <strong>{value}</strong>
      <span className="mt-1 block text-[11.5px] text-[var(--ag-muted)]">{label}</span>
    </div>
  );
}
