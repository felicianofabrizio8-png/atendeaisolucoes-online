import { useId, useState } from "react";
import { cn } from "@/lib/utils";
import { curveCommands, niceMax, ribbonPath, stagger, useInView } from "./primitives";

export interface StreamBand {
  key: string;
  label: string;
  color: string;
}

export interface StreamPoint {
  label: string;
  fullLabel: string;
  total: number;
  porCanal: Record<string, number>;
}

interface Ponto {
  x: number;
  y: number;
}

/**
 * Gráfico de fluxo (stream / theme river).
 *
 * POR QUE ESTA FORMA, e não colunas empilhadas: a pergunta aqui não é "quanto
 * exatamente no dia 12" — é "a composição está mudando?". Coluna empilhada
 * responde a primeira e esconde a segunda, porque cada segmento começa numa
 * altura diferente e o olho não consegue comparar os pedaços de cima entre
 * si. No fluxo cada faixa tem a própria linha de base suave e a espessura
 * lê-se direta; a soma continua sendo a espessura total.
 *
 * As faixas são centradas (não empilhadas a partir do chão) para que nenhuma
 * fique com o piso distorcido pelas outras. Esse é o ponto do formato.
 *
 * COR: rampa ORDINAL (--viz-flow-*), não categórica. A posição na pilha é
 * fixa e conhecida; com a luminosidade caindo do topo para a base a ordem
 * lê-se sem legenda, e as faixas ainda são rotuladas direto na maior delas.
 */
export function StreamChart({
  data,
  bands,
  height = 210,
  format,
  className,
}: {
  data: StreamPoint[];
  bands: StreamBand[];
  height?: number;
  format: (value: number) => string;
  className?: string;
}) {
  const clipId = useId();
  const [hover, setHover] = useState<number | null>(null);
  const [ref, inView] = useInView<HTMLDivElement>();

  if (data.length === 0) return null;

  const W = 720;
  const H = height;
  const padTop = 30;
  const padBottom = 24;
  const plotH = H - padTop - padBottom;
  const meio = padTop + plotH / 2;

  const max = niceMax(Math.max(...data.map((d) => d.total)));
  // 0.88 deixa ar em cima e embaixo: fita encostando na borda do painel lê
  // como cortada, e a mira do hover precisa de onde pousar.
  const escala = (v: number) => (max > 0 ? (v / max) * plotH * 0.88 : 0);
  const passo = data.length > 1 ? W / (data.length - 1) : W;
  const xDe = (i: number) => (data.length > 1 ? i * passo : W / 2);

  // Bordas de cada faixa. Empilha para baixo a partir do topo da pilha, que
  // por sua vez é centrado — daí a pilha inteira flutuar no meio.
  const bordas: Array<{ band: StreamBand; top: Ponto[]; bottom: Ponto[] }> = bands.map((b) => ({
    band: b,
    top: [],
    bottom: [],
  }));

  data.forEach((d, i) => {
    const x = xDe(i);
    let y = meio - escala(d.total) / 2;
    bordas.forEach((borda) => {
      const alturaFaixa = escala(d.porCanal[borda.band.key] ?? 0);
      borda.top.push({ x, y });
      borda.bottom.push({ x, y: y + alturaFaixa });
      y += alturaFaixa;
    });
  });

  // Rótulo direto: vai no balde onde a faixa é mais grossa, e só se couber.
  // Texto sobre fita fina fica metade dentro, metade fora — pior que legenda.
  const rotulos = bordas
    .map(({ band, top, bottom }) => {
      let melhor = -1;
      let grossura = 0;
      top.forEach((p, i) => {
        const e = bottom[i].y - p.y;
        if (e > grossura) {
          grossura = e;
          melhor = i;
        }
      });
      if (melhor < 0 || grossura < 18) return null;
      return {
        key: band.key,
        label: band.label,
        x: Math.min(Math.max(top[melhor].x, 46), W - 46),
        y: (top[melhor].y + bottom[melhor].y) / 2,
      };
    })
    .filter((r): r is NonNullable<typeof r> => r !== null);

  const atual = hover !== null ? data[hover] : null;

  return (
    <div ref={ref} className={cn("relative", className)}>
      <svg
        viewBox={"0 0 " + W + " " + H}
        className="w-full"
        style={{ height }}
        role="img"
        aria-label={`Gráfico de fluxo de ${data.length} períodos por canal`}
        preserveAspectRatio="none"
      >
        <defs>
          <clipPath id={clipId}>
            {/* O recorte é que anima. A fita já nasce com a forma final; o
                que corre da esquerda para a direita é a janela. */}
            <rect className="viz-wipe" x={0} y={0} width={W} height={H} />
          </clipPath>
        </defs>

        {inView && (
          <g clipPath={`url(#${clipId})`}>
            {bordas.map(({ band, top, bottom }, i) => (
              <path
                key={band.key}
                d={ribbonPath(top, bottom)}
                fill={band.color}
                opacity={hover === null ? 1 : 0.55}
                className="transition-opacity duration-200"
                style={{ animationDelay: stagger(i, 90, 300) }}
              />
            ))}

            {/* Linha de crista: um fio claro no topo da pilha dá a silhueta
                do total sem precisar de um segundo gráfico. */}
            <path
              d={`M${bordas[0].top[0].x},${bordas[0].top[0].y}${curveCommands(bordas[0].top)}`}
              fill="none"
              stroke="var(--viz-flow-0)"
              strokeWidth={1.5}
              strokeLinecap="round"
              opacity={0.75}
            />
          </g>
        )}

        {rotulos.map((r) => (
          <text
            key={r.key}
            x={r.x}
            y={r.y + 3}
            textAnchor="middle"
            className="pointer-events-none select-none fill-background font-semibold"
            style={{ fontSize: 10, letterSpacing: "0.02em" }}
          >
            {r.label}
          </text>
        ))}

        {atual && hover !== null && (
          <g className="pointer-events-none">
            <line
              x1={xDe(hover)}
              y1={padTop - 8}
              x2={xDe(hover)}
              y2={padTop + plotH}
              stroke="var(--foreground)"
              strokeWidth={1}
              opacity={0.45}
            />
            <circle cx={xDe(hover)} cy={padTop - 8} r={3} fill="var(--foreground)" opacity={0.6} />
          </g>
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

        {data.map((d, i) => (
          <text
            key={`lbl-${d.label}-${i}`}
            x={xDe(i)}
            y={H - 6}
            textAnchor={i === 0 ? "start" : i === data.length - 1 ? "end" : "middle"}
            className="fill-muted-foreground"
            style={{ fontSize: 10 }}
          >
            {d.label}
          </text>
        ))}
      </svg>

      {/* Legenda obrigatória, mesmo com rótulo direto nas faixas grossas: a
          faixa fina do terceiro canal nunca cabe um rótulo dentro, e sem a
          legenda ela vira uma cor sem nome. Rótulo direto e legenda não se
          excluem — um serve a faixa larga, o outro cobre o resto. */}
      <ul className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1">
        {bands.map((b) => (
          <li key={b.key} className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
            <span
              aria-hidden
              className="h-2 w-3 shrink-0 rounded-sm"
              style={{ background: b.color }}
            />
            {b.label}
          </li>
        ))}
      </ul>

      {atual && hover !== null && (
        <div
          role="status"
          className="pointer-events-none absolute top-0 z-10 min-w-[140px] whitespace-nowrap rounded-xl border border-border bg-popover px-3 py-2 text-xs shadow-lg"
          style={{
            left: `${(xDe(hover) / W) * 100}%`,
            transform: `translate(${hover > data.length / 2 ? "-100%" : "0"}, -100%)`,
          }}
        >
          <span className="block font-semibold tabular-nums">{format(atual.total)}</span>
          <span className="mb-1.5 block text-[10px] text-muted-foreground">{atual.fullLabel}</span>
          {bands.map((b) => (
            <span key={b.key} className="flex items-center gap-1.5 text-[10px]">
              <span
                aria-hidden
                className="h-1.5 w-1.5 shrink-0 rounded-full"
                style={{ background: b.color }}
              />
              <span className="flex-1 text-muted-foreground">{b.label}</span>
              <span className="tabular-nums">{format(atual.porCanal[b.key] ?? 0)}</span>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
