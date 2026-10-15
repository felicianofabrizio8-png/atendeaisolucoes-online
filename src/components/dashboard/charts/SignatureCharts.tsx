import { useId, useRef, useState } from "react";
import { num, pct, brlCompact, arcPath } from "./primitives";
import type { DashboardMetrics, SerieItem } from "../useDashboardMetrics";

const CHANNEL_COLORS = ["var(--dash-purple)", "var(--dash-cyan)", "var(--dash-lime)"];

/** Equal units above and below the baseline; partial blocks preserve exact quantities. */
export function LeadComparison({
  current,
  previous,
}: {
  current: SerieItem[];
  previous: SerieItem[];
}) {
  const [selected, setSelected] = useState<number | null>(null);
  const max = Math.max(1, ...current.map((d) => d.value), ...previous.map((d) => d.value));
  const unit = Math.max(1, Math.ceil(max / 5));
  const rows = Math.ceil(max / unit);
  const block = (value: number, row: number, tone: string, direction = "top") => {
    const fraction = Math.max(0, Math.min(1, (value - row * unit) / unit));
    return (
      <span
        className="dash-lead-block"
        style={{
          background: fraction
            ? `linear-gradient(to ${direction}, ${tone} ${fraction * 100}%, var(--dash-track) ${fraction * 100}%)`
            : "var(--dash-track)",
          opacity: fraction ? 1 : 0.35,
        }}
      />
    );
  };
  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-2 text-[11px] text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <i className="h-2 w-2 rounded-sm bg-[var(--dash-lime)]" />
          Atual
        </span>
        <span className="flex items-center gap-1.5">
          <i className="h-2 w-2 rounded-sm bg-[var(--dash-purple)]" />
          Anterior
        </span>
        <span className="ml-auto">1 bloco = {num(unit)} leads</span>
      </div>
      <div
        className="dash-block-comparison"
        role="group"
        aria-label="Comparação de leads por intervalo"
      >
        {current.map((d, i) => (
          <button
            type="button"
            key={d.fullLabel}
            className="dash-block-column"
            aria-label={`${d.fullLabel}: ${num(d.value)} leads; intervalo equivalente anterior: ${num(previous[i]?.value ?? 0)}`}
            aria-pressed={selected === i}
            onFocus={() => setSelected(i)}
            onMouseEnter={() => setSelected(i)}
            onClick={() => setSelected(i)}
          >
            <span className="dash-block-half" aria-hidden>
              {Array.from({ length: rows }, (_, j) =>
                block(d.value, rows - j - 1, "var(--dash-lime)"),
              ).map((b, j) => (
                <span key={j}>{b}</span>
              ))}
            </span>
            <span className="my-2 block text-[10px] text-muted-foreground">{d.label}</span>
            <span className="dash-block-half" aria-hidden>
              {Array.from({ length: rows }, (_, j) =>
                block(previous[i]?.value ?? 0, j, "var(--dash-purple)", "bottom"),
              ).map((b, j) => (
                <span key={j}>{b}</span>
              ))}
            </span>
          </button>
        ))}
      </div>
      <p
        className="mt-4 min-h-8 text-[11px] leading-relaxed text-muted-foreground"
        aria-live="polite"
      >
        {selected === null ? (
          "Compare a entrada de leads com o mesmo intervalo do período anterior."
        ) : (
          <>
            <span className="text-foreground">{current[selected]?.fullLabel}</span> ·{" "}
            {num(current[selected]?.value ?? 0)} agora / {num(previous[selected]?.value ?? 0)} antes
          </>
        )}
      </p>
    </div>
  );
}

/** Each arc encodes the exact share; selection also works through native legend buttons. */
export function ChannelOrbit({ channels }: { channels: DashboardMetrics["canais"] }) {
  const [selected, setSelected] = useState<string | null>(null);
  const total = channels.reduce((s, c) => s + c.leads, 0);
  const active = channels.find((c) => c.key === selected);
  const id = useId().replace(/:/g, "");
  let offset = 0;
  return (
    <div>
      <div className="dash-orbit-wrap">
        <svg
          viewBox="0 0 220 220"
          className="dash-orbit"
          role="img"
          aria-label={`Origem de ${num(total)} leads`}
        >
          <defs>
            {channels.map((c, i) => (
              <linearGradient key={c.key} id={id + i} x1="0" y1="0" x2="1" y2="1">
                <stop stopColor={CHANNEL_COLORS[i % 3]} />
                <stop offset="100%" stopColor={CHANNEL_COLORS[i % 3]} stopOpacity=".6" />
              </linearGradient>
            ))}
          </defs>
          <circle
            cx="110"
            cy="110"
            r="83"
            fill="none"
            stroke="var(--dash-track)"
            strokeWidth="24"
          />
          {channels.map((c, i) => {
            const part = total ? c.leads / total : 0,
              start = offset;
            offset += part;
            if (!part) return null;
            const gap = Math.min(2, part * 180);
            const path = arcPath(110, 110, 83, start * 360 + gap, offset * 360 - gap);
            return (
              <path
                key={c.key}
                d={path}
                fill="none"
                stroke={`url(#${id + i})`}
                strokeWidth={active?.key === c.key ? 29 : 24}
                strokeLinecap="butt"
                opacity={!active || active.key === c.key ? 1 : 0.25}
                className="transition-[opacity,stroke-width] duration-200"
              />
            );
          })}
          <circle
            cx="110"
            cy="110"
            r="61"
            fill="none"
            stroke="var(--border)"
            strokeDasharray="1 6"
          />
        </svg>
        <div className="dash-orbit-center" aria-live="polite">
          <strong className="text-[38px] font-semibold tracking-tight tabular-nums">
            {active ? pct((active.leads / Math.max(total, 1)) * 100, 0) : num(total)}
          </strong>
          <span className="mt-1 text-[11px] text-muted-foreground">
            {active ? active.label : "novos contatos"}
          </span>
        </div>
      </div>
      <div className="space-y-1.5" role="group" aria-label="Selecionar canal">
        {channels.map((c, i) => (
          <button
            key={c.key}
            type="button"
            aria-pressed={selected === c.key}
            onClick={() => setSelected(selected === c.key ? null : c.key)}
            className="dash-channel-row"
          >
            <span
              className="h-2 w-2 shrink-0 rounded-full"
              style={{ background: CHANNEL_COLORS[i % 3] }}
            />
            <span className="min-w-0 flex-1 text-left">
              <span className="block text-xs font-medium">{c.label}</span>
              <span className="block text-[10px] text-muted-foreground">
                {num(c.vendas)} vendas · {brlCompact(c.receita)}
              </span>
            </span>
            <strong className="text-sm tabular-nums">{num(c.leads)}</strong>
            <span className="w-9 text-right text-[11px] text-muted-foreground">
              {pct((c.leads / Math.max(total, 1)) * 100, 0)}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

/** Continuous, unsmoothed ramp: each cell always represents its actual count. */
export function activityHeatColor(value: number, max: number) {
  const stops = ["#241048", "#6829cb", "#c329a3", "#f06464", "#ff9c39", "#ffe66b"];
  const position = Math.max(0, Math.min(1, value / Math.max(1, max))) * (stops.length - 1);
  const low = Math.floor(position),
    high = Math.min(stops.length - 1, low + 1);
  return `color-mix(in oklab, ${stops[high]} ${(position - low) * 100}%, ${stops[low]})`;
}

export function ActivityHeatmap({
  data,
  hours,
}: {
  data: DashboardMetrics["horarios"];
  hours: number[];
}) {
  const days = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
  const values = new Map(data.map((c) => [`${c.day}-${c.hour}`, c.value]));
  const cells = days.flatMap((label, day) =>
    hours.map((hour) => ({ label, day, hour, value: values.get(`${day}-${hour}`) ?? 0 })),
  );
  const max = Math.max(1, ...cells.map((c) => c.value));
  const peak = cells.reduce((a, b) => (b.value > a.value ? b : a), cells[0]);
  const [selected, setSelected] = useState<number>(Math.max(0, cells.indexOf(peak)));
  const buttons = useRef<Array<HTMLButtonElement | null>>([]);
  const active = cells[selected] ?? peak;
  if (!cells.length) return null;
  return (
    <div>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-[10px] uppercase tracking-widest text-muted-foreground">
            Horário de maior movimento
          </p>
          <p className="mt-1 text-2xl font-semibold tracking-tight">
            {peak.label}
            <span className="text-[var(--dash-cyan)]"> · {peak.hour}h</span>
          </p>
        </div>
        <div className="rounded-2xl border border-border bg-secondary/40 px-4 py-2 text-right">
          <strong className="text-lg font-semibold tabular-nums">{num(peak.value)}</strong>
          <p className="text-[10px] text-muted-foreground">registros no pico</p>
        </div>
      </div>
      <div
        className="dash-heat-map"
        role="group"
        aria-label="Movimento por dia e hora"
        style={{ gridTemplateColumns: `28px repeat(${hours.length},minmax(0,1fr))` }}
      >
        <span />
        {hours.map((h, i) => (
          <span key={h} className="text-center text-[9px] text-muted-foreground">
            {i % 3 === 0 || i === hours.length - 1 ? `${h}h` : ""}
          </span>
        ))}
        {days.map((label, day) => (
          <div key={label} className="contents">
            <span className="self-center text-[10px] text-muted-foreground">{label}</span>
            {hours.map((hour, col) => {
              const i = day * hours.length + col,
                c = cells[i];
              return (
                <button
                  ref={(el) => {
                    buttons.current[i] = el;
                  }}
                  type="button"
                  key={hour}
                  tabIndex={selected === i ? 0 : -1}
                  aria-label={`${label}, ${hour}h: ${num(c.value)} registros`}
                  aria-pressed={selected === i}
                  className="dash-heat-cell"
                  style={{ background: activityHeatColor(c.value, max) }}
                  onClick={() => setSelected(i)}
                  onFocus={() => setSelected(i)}
                  onMouseEnter={() => setSelected(i)}
                  onKeyDown={(e) => {
                    const offsets: Record<string, number> = {
                      ArrowLeft: -1,
                      ArrowRight: 1,
                      ArrowUp: -hours.length,
                      ArrowDown: hours.length,
                    };
                    const delta = offsets[e.key];
                    if (delta === undefined) return;
                    e.preventDefault();
                    const next = Math.max(0, Math.min(cells.length - 1, i + delta));
                    setSelected(next);
                    buttons.current[next]?.focus();
                  }}
                ></button>
              );
            })}
          </div>
        ))}
      </div>
      <div className="mt-5 flex flex-wrap items-center justify-between gap-3 text-[11px]">
        <span aria-live="polite" className="text-muted-foreground">
          {active.label}, {active.hour}h ·{" "}
          <strong className="text-foreground">{num(active.value)} registros</strong>
        </span>
        <span className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
          0 <i className="dash-heat-legend" /> {num(max)} registros
        </span>
      </div>
    </div>
  );
}

/** Four independent volumes, not a cohort conversion: width uses the same scale throughout. */
export function StageRibbons({ stages }: { stages: DashboardMetrics["funil"] }) {
  const max = Math.max(1, ...stages.map((s) => s.value));
  const colors = ["var(--dash-purple)", "var(--dash-blue)", "var(--dash-cyan)", "var(--dash-lime)"];
  return (
    <div className="space-y-2.5" role="list" aria-label="Volumes do funil">
      {stages.map((stage, i) => (
        <div key={stage.label} className="dash-stage-row" role="listitem">
          <span className="text-[10px] text-muted-foreground">0{i + 1}</span>
          <span className="text-xs font-medium">{stage.label}</span>
          <div className="dash-stage-track">
            <div
              className="dash-stage-ribbon"
              style={{
                width: `${(stage.value / max) * 100}%`,
                background: `linear-gradient(105deg,${colors[i % 4]},color-mix(in srgb,${colors[i % 4]} 60%,#151020))`,
              }}
            />
          </div>
          <strong className="text-base font-semibold tabular-nums">{num(stage.value)}</strong>
        </div>
      ))}
    </div>
  );
}

export function ObjectionPlot({ items }: { items: { label: string; value: number }[] }) {
  const total = items.reduce((s, d) => s + d.value, 0);
  const tones = ["var(--dash-coral)", "var(--dash-purple)", "var(--dash-cyan)"];
  return (
    <div className="dash-objection-ranking">
      <div className="dash-objection-summary">
        <span>
          <strong>{num(total)}</strong> menções identificadas
        </span>
        <span>{items.length} motivos</span>
      </div>
      <div className="dash-objection-cards">
        {[...items]
          .sort((a, b) => b.value - a.value)
          .map((d, i) => (
            <div
              key={d.label}
              className="dash-objection-item"
              style={{ "--objection-tone": tones[i % tones.length] } as React.CSSProperties}
            >
              <div className="flex items-start gap-3">
                <span className="dash-objection-rank">{String(i + 1).padStart(2, "0")}</span>
                <p className="min-w-0 flex-1 text-sm font-medium leading-relaxed">{d.label}</p>
                <strong className="dash-objection-count">{num(d.value)}</strong>
              </div>
              <div className="dash-objection-share">
                <span>{pct(total ? (d.value / total) * 100 : 0, 0)} das menções</span>
                <span>{i === 0 ? "Mais recorrente" : "Ponto de atenção"}</span>
              </div>
              <div className="dash-objection-track" aria-hidden>
                <span style={{ width: `${total ? (d.value / total) * 100 : 0}%` }} />
              </div>
            </div>
          ))}
      </div>
    </div>
  );
}
