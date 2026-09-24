import { useId, useState } from "react";
import { cn } from "@/lib/utils";
import { areaPath, linePath, niceMax, useInView, usePrefersReducedMotion } from "./primitives";

export interface SparkPoint {
  label: string;
  value: number;
}

/**
 * Área com linha, mira e tooltip.
 *
 * A linha é 2px e a área é o mesmo tom a ~10% — um bloco saturado embaixo da
 * curva rouba a leitura da própria curva.
 *
 * O traço é desenhado com `stroke-dasharray` igual ao comprimento do path e
 * animado até zero: é o único jeito de "escrever" a linha da esquerda para a
 * direita sem recalcular pontos frame a frame.
 */
export function AreaSpark({
  data,
  color = "var(--viz-1)",
  height = 150,
  format,
  className,
}: {
  data: SparkPoint[];
  color?: string;
  height?: number;
  format: (value: number) => string;
  className?: string;
}) {
  const gradientId = useId();
  const [hover, setHover] = useState<number | null>(null);
  const [ref, inView] = useInView<HTMLDivElement>();
  const reduced = usePrefersReducedMotion();

  if (data.length === 0) return null;

  const W = 640;
  const H = height;
  const padBottom = 20;
  const padTop = 8;
  const plotH = H - padBottom - padTop;
  const max = niceMax(Math.max(...data.map((d) => d.value)));
  const step = data.length > 1 ? W / (data.length - 1) : W;

  const points = data.map((d, i) => ({
    x: data.length > 1 ? i * step : W / 2,
    y: padTop + plotH - (max > 0 ? (d.value / max) * plotH : 0),
  }));

  const line = linePath(points);
  const area = areaPath(points, padTop + plotH);

  return (
    <div ref={ref} className={cn("relative", className)}>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full"
        style={{ height }}
        role="img"
        aria-label={`Gráfico de área com ${data.length} pontos`}
        preserveAspectRatio="none"
      >
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity={0.28} />
            <stop offset="100%" stopColor={color} stopOpacity={0} />
          </linearGradient>
        </defs>

        {inView && (
          <>
            <path d={area} fill={`url(#${gradientId})`} className="viz-fade-up" />
            <path
              d={line}
              fill="none"
              stroke={color}
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
              style={
                reduced
                  ? undefined
                  : {
                      strokeDasharray: 2000,
                      strokeDashoffset: 2000,
                      animation: "viz-draw 1100ms cubic-bezier(0.22,1,0.36,1) forwards",
                    }
              }
            />
          </>
        )}

        {hover !== null && (
          <>
            <line
              x1={points[hover].x}
              y1={padTop}
              x2={points[hover].x}
              y2={padTop + plotH}
              stroke="var(--viz-grid)"
              strokeWidth={1}
            />
            {/* Anel na cor da superfície: o ponto continua legível mesmo
                cruzando a linha. */}
            <circle
              cx={points[hover].x}
              cy={points[hover].y}
              r={5}
              fill={color}
              stroke="var(--card)"
              strokeWidth={2}
            />
          </>
        )}

        {data.map((d, i) => (
          <rect
            key={`hit-${d.label}-${i}`}
            x={i * step - step / 2}
            y={0}
            width={step}
            height={H}
            fill="transparent"
            onMouseEnter={() => setHover(i)}
            onMouseLeave={() => setHover(null)}
          />
        ))}
      </svg>

      <div className="mt-1 flex justify-between text-[10px] text-muted-foreground">
        <span>{data[0].label}</span>
        <span>{data[data.length - 1].label}</span>
      </div>

      {hover !== null && (
        <div
          role="status"
          className="pointer-events-none absolute top-0 z-10 -translate-x-1/2 -translate-y-full whitespace-nowrap rounded-lg border border-border bg-popover px-2.5 py-1.5 text-xs shadow-lg"
          style={{ left: `${(points[hover].x / W) * 100}%` }}
        >
          <span className="block font-semibold tabular-nums">{format(data[hover].value)}</span>
          <span className="block text-[10px] text-muted-foreground">{data[hover].label}</span>
        </div>
      )}
    </div>
  );
}
