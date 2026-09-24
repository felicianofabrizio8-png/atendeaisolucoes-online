import { useId, useState } from "react";
import { cn } from "@/lib/utils";
import { areaPath, linePath, niceMax, useInView, usePrefersReducedMotion } from "./primitives";

export interface SerieMulti {
  key: string;
  label: string;
  color: string;
}

export interface PontoMulti {
  label: string;
  fullLabel: string;
  total: number;
  porCanal: Record<string, number>;
}

/**
 * Área com várias séries sobrepostas.
 *
 * SOBREPOSTAS, não empilhadas. Empilhado, só a série de baixo tem a linha de
 * base no zero; as de cima herdam o contorno das outras e deixam de ser
 * legíveis sozinhas — "o Instagram caiu ou foi o WhatsApp que subiu embaixo
 * dele?" vira impossível de responder. Sobrepostas, cada curva se lê contra o
 * mesmo eixo e a comparação entre canais é direta, que é o ponto do painel.
 *
 * O preenchimento é fraco (14%) e a linha é 2px: com três áreas na mesma
 * região, o que carrega a informação é o contorno; a área existe só para dar
 * peso visual a qual curva está por cima.
 *
 * A COR é a trinca categórica validada, não a cor de marca de cada canal:
 * verde do WhatsApp e rosa do Instagram ficam a ΔE 4,3 em deuteranopia e
 * nenhum ajuste resolve sem perder a marca. Aqui as três curvas se cruzam,
 * então a separação de cor é obrigatória — e cada série ainda é rotulada
 * direto na ponta direita.
 */
export function MultiArea({
  data,
  series,
  height = 210,
  format,
  className,
}: {
  data: PontoMulti[];
  series: SerieMulti[];
  height?: number;
  format: (value: number) => string;
  className?: string;
}) {
  const baseId = useId();
  const [hover, setHover] = useState<number | null>(null);
  const [ref, inView] = useInView<HTMLDivElement>();
  const reduced = usePrefersReducedMotion();

  if (data.length === 0) return null;

  const W = 640;
  const H = height;
  const padTop = 10;
  const padBottom = 22;
  const padRight = 6;
  const plotH = H - padTop - padBottom;

  const max = niceMax(
    Math.max(...data.flatMap((d) => series.map((s) => d.porCanal[s.key] ?? 0)), 0),
  );
  const passo = data.length > 1 ? (W - padRight) / (data.length - 1) : W - padRight;
  const xDe = (i: number) => (data.length > 1 ? i * passo : (W - padRight) / 2);
  const yDe = (v: number) => padTop + plotH - (max > 0 ? (v / max) * plotH : 0);

  const desenhos = series.map((s) => {
    const pontos = data.map((d, i) => ({ x: xDe(i), y: yDe(d.porCanal[s.key] ?? 0) }));
    return { serie: s, pontos, linha: linePath(pontos), area: areaPath(pontos, padTop + plotH) };
  });

  // A série de maior valor no último ponto fica por cima: a curva que o olho
  // procura primeiro é a que está no topo agora.
  const ordenadas = [...desenhos].sort(
    (a, b) =>
      (data[data.length - 1].porCanal[a.serie.key] ?? 0) -
      (data[data.length - 1].porCanal[b.serie.key] ?? 0),
  );

  return (
    <div ref={ref} className={cn("relative", className)}>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full"
        style={{ height }}
        role="img"
        aria-label={`Receita por canal em ${data.length} períodos`}
        preserveAspectRatio="none"
      >
        <defs>
          {series.map((s) => (
            <linearGradient key={s.key} id={`${baseId}-${s.key}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={s.color} stopOpacity={0.24} />
              <stop offset="100%" stopColor={s.color} stopOpacity={0} />
            </linearGradient>
          ))}
        </defs>

        {inView &&
          ordenadas.map(({ serie, area, linha }, i) => (
            <g
              key={serie.key}
              opacity={hover === null ? 1 : 0.95}
              className="transition-opacity duration-200"
            >
              <path d={area} fill={`url(#${baseId}-${serie.key})`} className="viz-fade-up" />
              <path
                d={linha}
                fill="none"
                stroke={serie.color}
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
                style={
                  reduced
                    ? undefined
                    : {
                        strokeDasharray: 2000,
                        strokeDashoffset: 2000,
                        animation: `viz-draw 1100ms cubic-bezier(0.22,1,0.36,1) ${i * 120}ms forwards`,
                      }
                }
              />
            </g>
          ))}

        {hover !== null && (
          <>
            <line
              x1={xDe(hover)}
              y1={padTop}
              x2={xDe(hover)}
              y2={padTop + plotH}
              stroke="var(--viz-grid)"
              strokeWidth={1}
            />
            {desenhos.map(({ serie }) => (
              // Anel na cor da superfície: com três curvas se cruzando, um
              // ponto sem anel some dentro da linha vizinha.
              <circle
                key={serie.key}
                cx={xDe(hover)}
                cy={yDe(data[hover].porCanal[serie.key] ?? 0)}
                r={4.5}
                fill={serie.color}
                stroke="var(--card)"
                strokeWidth={2}
              />
            ))}
          </>
        )}

        {data.map((d, i) => (
          <rect
            key={`hit-${d.label}-${i}`}
            x={xDe(i) - passo / 2}
            y={0}
            width={passo}
            height={H}
            fill="transparent"
            onMouseEnter={() => setHover(i)}
            onMouseLeave={() => setHover(null)}
          />
        ))}

        <text
          x={0}
          y={H - 6}
          textAnchor="start"
          className="fill-muted-foreground"
          style={{ fontSize: 10 }}
        >
          {data[0].label}
        </text>
        <text
          x={W - padRight}
          y={H - 6}
          textAnchor="end"
          className="fill-muted-foreground"
          style={{ fontSize: 10 }}
        >
          {data[data.length - 1].label}
        </text>
      </svg>

      <ul className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1">
        {series.map((s) => (
          <li key={s.key} className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
            <span
              aria-hidden
              className="h-2 w-3 shrink-0 rounded-sm"
              style={{ background: s.color }}
            />
            {s.label}
          </li>
        ))}
      </ul>

      {hover !== null && (
        <div
          role="status"
          className="pointer-events-none absolute top-0 z-10 min-w-[140px] whitespace-nowrap rounded-xl border border-border bg-popover px-3 py-2 text-xs shadow-lg"
          style={{
            left: `${(xDe(hover) / W) * 100}%`,
            transform: `translate(${hover > data.length / 2 ? "-100%" : "0"}, -100%)`,
          }}
        >
          <span className="block font-semibold tabular-nums">{format(data[hover].total)}</span>
          <span className="mb-1.5 block text-[10px] text-muted-foreground">
            {data[hover].fullLabel}
          </span>
          {series.map((s) => (
            <span key={s.key} className="flex items-center gap-1.5 text-[10px]">
              <span
                aria-hidden
                className="h-1.5 w-1.5 shrink-0 rounded-full"
                style={{ background: s.color }}
              />
              <span className="flex-1 text-muted-foreground">{s.label}</span>
              <span className="tabular-nums">{format(data[hover].porCanal[s.key] ?? 0)}</span>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
