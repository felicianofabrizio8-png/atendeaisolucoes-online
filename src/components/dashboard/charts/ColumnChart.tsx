import { useState } from "react";
import { cn } from "@/lib/utils";
import { columnPath, niceMax, stagger, useInView } from "./primitives";

export interface ColumnDatum {
  label: string;
  value: number;
  /** Rótulo cheio do eixo, usado no tooltip quando o do eixo é abreviado. */
  fullLabel?: string;
}

/**
 * Colunas com topo arredondado e base reta.
 *
 * Série única de propósito: magnitude ao longo do tempo não precisa de
 * identidade por cor, então não há legenda nem risco de daltonismo. Duas
 * medidas de escalas diferentes viram DOIS gráficos, nunca dois eixos y.
 *
 * A coluna é limitada a 24px e o que sobra da faixa vira ar — coluna colada
 * na vizinha lê como bloco único.
 */
export function ColumnChart({
  data,
  color = "var(--viz-1)",
  height = 160,
  format,
  className,
  highlightLast = true,
}: {
  data: ColumnDatum[];
  color?: string;
  height?: number;
  format: (value: number) => string;
  className?: string;
  /** Destaca a última coluna — normalmente o período corrente. */
  highlightLast?: boolean;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const [ref, inView] = useInView<HTMLDivElement>();

  if (data.length === 0) return null;

  const W = 640;
  const H = height;
  const padBottom = 22;
  const plotH = H - padBottom;

  const max = niceMax(Math.max(...data.map((d) => d.value)));
  const band = W / data.length;
  const barW = Math.min(24, band * 0.62);

  return (
    <div ref={ref} className={cn("relative", className)}>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full"
        style={{ height }}
        role="img"
        aria-label={`Gráfico de colunas com ${data.length} períodos`}
        preserveAspectRatio="none"
      >
        {/* Trilho: dá noção do teto sem precisar de gridline atravessando. */}
        {data.map((d, i) => (
          <rect
            key={`track-${d.label}`}
            x={i * band + (band - barW) / 2}
            y={0}
            width={barW}
            height={plotH}
            rx={4}
            fill="var(--viz-track)"
            opacity={hover === i ? 0.9 : 0.45}
            className="transition-opacity duration-200"
          />
        ))}

        {inView &&
          data.map((d, i) => {
            const h = max > 0 ? (d.value / max) * plotH : 0;
            const x = i * band + (band - barW) / 2;
            const y = plotH - h;
            const isLast = highlightLast && i === data.length - 1;
            return (
              <path
                key={d.label}
                d={columnPath(x, y, barW, h, 4)}
                fill={color}
                opacity={hover === null || hover === i ? 1 : 0.35}
                className="viz-grow transition-opacity duration-200"
                style={{ animationDelay: stagger(i) }}
                // Coluna corrente em destaque: sem isso o olho não sabe onde
                // "hoje" está numa série de 12 barras iguais.
                filter={isLast ? "url(#viz-col-glow)" : undefined}
              />
            );
          })}

        {/* Área de captura larga: a coluna tem 24px, o alvo do mouse tem a
            faixa inteira. Alvo do tamanho da marca é alvo que ninguém acerta. */}
        {data.map((d, i) => (
          <rect
            key={`hit-${d.label}`}
            x={i * band}
            y={0}
            width={band}
            height={plotH}
            fill="transparent"
            onMouseEnter={() => setHover(i)}
            onMouseLeave={() => setHover(null)}
          />
        ))}

        {data.map((d, i) => (
          <text
            key={`lbl-${d.label}`}
            x={i * band + band / 2}
            y={H - 6}
            textAnchor="middle"
            className="fill-muted-foreground"
            style={{ fontSize: 10 }}
          >
            {d.label}
          </text>
        ))}

        <defs>
          <filter id="viz-col-glow" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="3" result="b" />
            <feMerge>
              <feMergeNode in="b" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>
      </svg>

      {hover !== null && (
        <div
          role="status"
          className="pointer-events-none absolute -top-1 z-10 -translate-x-1/2 -translate-y-full whitespace-nowrap rounded-lg border border-border bg-popover px-2.5 py-1.5 text-xs shadow-lg"
          style={{ left: `${((hover + 0.5) / data.length) * 100}%` }}
        >
          <span className="block font-semibold tabular-nums">{format(data[hover].value)}</span>
          <span className="block text-[10px] text-muted-foreground">
            {data[hover].fullLabel ?? data[hover].label}
          </span>
        </div>
      )}
    </div>
  );
}
