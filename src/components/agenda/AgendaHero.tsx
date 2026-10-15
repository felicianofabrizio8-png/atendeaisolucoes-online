import { useEffect, useState, type CSSProperties } from "react";
import { format, formatDistanceToNowStrict, startOfDay } from "date-fns";
import { ptBR } from "date-fns/locale";
import { Plus, Sparkles } from "lucide-react";
import { eventEnd, TYPE_HUE, type AgendaEvent, type AgendaPulse } from "./agenda-model";

/** Topo da Agenda: tipografia editorial, pulso do dia e o mostrador do dia. */
export function AgendaHero({
  pulse,
  today,
  onCreate,
  onAskLume,
}: {
  pulse: AgendaPulse;
  /** Compromissos de hoje (já com a cor do tipo, se houver). */
  today: AgendaEvent[];
  onCreate: () => void;
  onAskLume?: () => void;
}) {
  const now = useNow();
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

      <DayDial events={today} next={pulse.next} now={now} />
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

const SIZE = 240;
const CENTER = SIZE / 2;
const RADIUS = 100;
const WORK_START = 8;
const WORK_END = 18;

/** Ângulo (graus, 0 = topo, horário) de um instante dentro das 24 h do dia. */
function angleOf(date: Date, dayStart: Date) {
  const minutes = (date.getTime() - dayStart.getTime()) / 60_000;
  return (Math.max(0, Math.min(1440, minutes)) / 1440) * 360;
}

function point(angle: number, radius = RADIUS) {
  const radians = ((angle - 90) * Math.PI) / 180;
  return { x: CENTER + radius * Math.cos(radians), y: CENTER + radius * Math.sin(radians) };
}

function arc(from: number, to: number, radius = RADIUS) {
  const sweep = Math.max(0.6, to - from);
  const start = point(from, radius);
  const end = point(from + sweep, radius);
  return `M ${start.x} ${start.y} A ${radius} ${radius} 0 ${sweep > 180 ? 1 : 0} 1 ${end.x} ${end.y}`;
}

/**
 * Mostrador do dia: o anel são as 24 horas, o trecho mais claro é o expediente, cada
 * compromisso é um arco na sua cor e o ponto branco é o agora. No centro, o próximo.
 */
function DayDial({
  events,
  next,
  now,
}: {
  events: AgendaEvent[];
  next: AgendaEvent | null;
  now: Date;
}) {
  const dayStart = startOfDay(now);
  const workFrom = (WORK_START / 24) * 360;
  const workTo = (WORK_END / 24) * 360;
  const nowPoint = point(angleOf(now, dayStart));
  const visible = events.filter((event) => event.status !== "cancelada");
  return (
    <div className="ag-dial">
      <p className="ag-dial-corner ag-mono">Seu dia · {visible.length} compromissos</p>
      <svg
        viewBox={`0 0 ${SIZE} ${SIZE}`}
        role="img"
        aria-label="Compromissos de hoje ao longo do dia"
      >
        <circle className="ag-dial-track" cx={CENTER} cy={CENTER} r={RADIUS} strokeWidth={1} />
        <path className="ag-dial-work" d={arc(workFrom, workTo)} strokeWidth={1.5} />
        {[0, 6, 12, 18].map((hour) => {
          const inner = point((hour / 24) * 360, RADIUS - 6);
          const outer = point((hour / 24) * 360, RADIUS + 6);
          const label = point((hour / 24) * 360, RADIUS + 16);
          return (
            <g key={hour}>
              <line className="ag-dial-tick" x1={inner.x} y1={inner.y} x2={outer.x} y2={outer.y} />
              <text className="ag-dial-hour" x={label.x} y={label.y + 3} textAnchor="middle">
                {String(hour).padStart(2, "0")}
              </text>
            </g>
          );
        })}
        {visible.map((event) => (
          <path
            key={event.id}
            className="ag-dial-arc"
            data-past={eventEnd(event) < now}
            d={arc(
              angleOf(new Date(event.scheduled_at), dayStart),
              angleOf(eventEnd(event), dayStart),
            )}
            strokeWidth={6}
            style={
              {
                ["--ag-hue" as string]: String(
                  event.type_hue ?? TYPE_HUE[event.appointment_type] ?? 300,
                ),
              } as CSSProperties
            }
          >
            <title>
              {format(new Date(event.scheduled_at), "HH:mm")} · {event.title}
            </title>
          </path>
        ))}
        <circle className="ag-dial-now" cx={nowPoint.x} cy={nowPoint.y} r={4} />
      </svg>
      <div className="ag-dial-center">
        {next ? (
          <>
            <p className="ag-mono">Próximo</p>
            <p className="mt-1 text-[34px] font-semibold leading-none tracking-tight tabular-nums">
              {format(new Date(next.scheduled_at), "HH:mm")}
            </p>
            <p className="mt-2 line-clamp-2 text-[13px] font-medium leading-snug">{next.title}</p>
            <p className="mt-1 text-[11.5px] text-[var(--ag-muted)]">
              {formatDistanceToNowStrict(new Date(next.scheduled_at), {
                locale: ptBR,
                addSuffix: true,
              })}
            </p>
          </>
        ) : (
          <>
            <p className="ag-mono">Agenda livre</p>
            <p className="mt-2 text-[15px] font-medium leading-snug">Nada pela frente.</p>
          </>
        )}
      </div>
    </div>
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
