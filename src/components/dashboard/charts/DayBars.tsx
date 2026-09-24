import { useState } from "react";
import { cn } from "@/lib/utils";
import { num, pct, useInView } from "./primitives";

export interface DiaMovimento {
  day: number;
  label: string;
  faixas: number[];
  total: number;
  picoHora: number | null;
  picoValor: number;
}

export interface FaixaDia {
  key: string;
  label: string;
  hint: string;
  color: string;
}

/**
 * Barras horizontais por dia, uma por faixa do dia.
 *
 * POR QUE HORIZONTAL: o rótulo é o dia da semana, e nome deitado embaixo de
 * uma coluna vertical ou gira 45° ou abrevia. Na horizontal o nome fica na
 * linha de base da própria barra, no tamanho normal, e o olho compara sete
 * comprimentos que começam todos no mesmo x.
 *
 * POR QUE TRÊS BARRAS E NÃO UMA EMPILHADA: empilhada, só o primeiro segmento
 * começa no zero; os outros dois flutuam e deixam de ser comparáveis entre
 * dias — que é justamente a comparação que este painel existe para permitir
 * ("a tarde de terça contra a tarde de sexta"). Três barras com a mesma
 * origem resolvem isso; o total continua escrito no fim da linha.
 *
 * A COR é a rampa ordinal: manhã, tarde e noite têm ordem, e com a
 * luminosidade caindo do topo para a base a ordem lê-se sem consultar a
 * legenda.
 */
export function DayBars({
  data,
  bands,
  className,
}: {
  data: DiaMovimento[];
  bands: FaixaDia[];
  className?: string;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const [ref, inView] = useInView<HTMLDivElement>();

  if (data.length === 0) return null;

  // Escala comum a TODAS as barras do painel. Escala por linha faria o dia
  // mais parado parecer tão cheio quanto o pico.
  const max = Math.max(...data.flatMap((d) => d.faixas), 1);
  const totalGeral = data.reduce((s, d) => s + d.total, 0);

  const diaPico = data.reduce((melhor, d) => (d.total > melhor.total ? d : melhor), data[0]);
  const faixaPico = bands.reduce(
    (melhor, b, i) => {
      const soma = data.reduce((s, d) => s + (d.faixas[i] ?? 0), 0);
      return soma > melhor.soma ? { label: b.label, soma, cor: b.color } : melhor;
    },
    { label: bands[0].label, soma: -1, cor: bands[0].color },
  );

  return (
    <div ref={ref} className={cn("min-w-0", className)}>
      {/* Cabeçalho de leitura: o gráfico mostra a forma, estas duas frases
          dizem o que fazer com ela. Sem isto o usuário tem de reconstruir a
          conclusão contando barras. */}
      <div className="mb-4 grid grid-cols-2 gap-4 border-b border-border pb-4">
        <div className="min-w-0">
          <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
            Dia mais movimentado
          </p>
          <p className="mt-1 text-xl font-bold leading-none text-foreground">
            {DIA_LONGO[diaPico.day]}
          </p>
          <p className="mt-1.5 truncate text-[11px] text-muted-foreground">
            {num(diaPico.total)} registros
            {diaPico.picoHora !== null ? ` · pico às ${diaPico.picoHora}h` : ""}
          </p>
        </div>
        <div className="min-w-0 border-l border-border pl-4">
          <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
            Faixa mais forte
          </p>
          <p className="mt-1 flex items-center gap-2 text-xl font-bold leading-none text-foreground">
            <span
              aria-hidden
              className="h-3 w-3 shrink-0 rounded-full"
              style={{ background: faixaPico.cor }}
            />
            {faixaPico.label}
          </p>
          <p className="mt-1.5 truncate text-[11px] text-muted-foreground">
            {totalGeral > 0 ? pct((faixaPico.soma / totalGeral) * 100, 0) : "—"} de todo o movimento
          </p>
        </div>
      </div>

      <ul className="space-y-2.5">
        {data.map((dia, linha) => {
          const ativo = hover === null || hover === linha;
          return (
            <li
              key={dia.label}
              className="grid grid-cols-[34px_minmax(0,1fr)_auto] items-center gap-3 transition-opacity duration-200"
              style={{ opacity: ativo ? 1 : 0.4 }}
              onMouseEnter={() => setHover(linha)}
              onMouseLeave={() => setHover(null)}
              onFocus={() => setHover(linha)}
              onBlur={() => setHover(null)}
            >
              <span className="text-[11px] font-medium text-muted-foreground">{dia.label}</span>

              <span className="flex min-w-0 flex-col gap-[3px]">
                {bands.map((faixa, i) => {
                  const valor = dia.faixas[i] ?? 0;
                  return (
                    <span
                      key={faixa.key}
                      className="relative block h-[9px] w-full overflow-hidden rounded-full bg-[var(--viz-track)]"
                      title={`${dia.label} · ${faixa.label}: ${num(valor)}`}
                    >
                      <span
                        className="absolute inset-y-0 left-0 rounded-full transition-[width] duration-700 ease-out"
                        style={{
                          width: inView ? `${(valor / max) * 100}%` : "0%",
                          background: faixa.color,
                          transitionDelay: `${Math.min(linha * 70 + i * 40, 800)}ms`,
                        }}
                      />
                    </span>
                  );
                })}
              </span>

              <span className="w-10 text-right text-xs font-semibold tabular-nums text-foreground">
                {num(dia.total)}
              </span>
            </li>
          );
        })}
      </ul>

      <ul className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-border pt-3">
        {bands.map((faixa) => (
          <li
            key={faixa.key}
            className="flex items-center gap-1.5 text-[10px] text-muted-foreground"
          >
            <span
              aria-hidden
              className="h-2 w-3 shrink-0 rounded-sm"
              style={{ background: faixa.color }}
            />
            <span className="font-medium text-foreground">{faixa.label}</span>
            {faixa.hint}
          </li>
        ))}
      </ul>
    </div>
  );
}

const DIA_LONGO = ["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"] as const;
