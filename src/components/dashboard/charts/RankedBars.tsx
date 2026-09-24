import { cn } from "@/lib/utils";
import { num, pct, stagger, useInView } from "./primitives";

export interface RankedDatum {
  label: string;
  value: number;
}

/**
 * Barras horizontais ordenadas.
 *
 * Forma certa para "qual é o maior?" quando o rótulo é texto e não cabe
 * deitado embaixo de uma coluna — motivo de perda, objeção, produto.
 *
 * Série única e ordenada: a ordem já é a informação, então não há legenda
 * nem cor por categoria. A barra de baixo do ranking usa o mesmo tom com
 * menos opacidade, o que dá profundidade sem inventar uma segunda dimensão.
 */
export function RankedBars({
  data,
  total,
  color = "var(--viz-1)",
  className,
  emptyText = "Sem dados no período",
}: {
  data: RankedDatum[];
  /** Base para o percentual. Sem isto, usa a soma dos itens exibidos. */
  total?: number;
  color?: string;
  className?: string;
  emptyText?: string;
}) {
  const [ref, inView] = useInView<HTMLUListElement>();

  if (data.length === 0) {
    return <p className="py-6 text-center text-xs text-muted-foreground">{emptyText}</p>;
  }

  const max = Math.max(...data.map((d) => d.value), 1);
  const base = total ?? data.reduce((sum, d) => sum + d.value, 0);

  return (
    <ul ref={ref} className={cn("space-y-2.5", className)}>
      {data.map((d, i) => {
        const share = base > 0 ? (d.value / base) * 100 : 0;
        return (
          <li key={d.label}>
            <div className="mb-1 flex items-baseline justify-between gap-3">
              <span className="min-w-0 truncate text-xs text-foreground">{d.label}</span>
              <span className="shrink-0 text-xs font-semibold tabular-nums text-foreground">
                {num(d.value)}
                <span className="ml-1.5 font-normal text-muted-foreground">{pct(share, 0)}</span>
              </span>
            </div>
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-[var(--viz-track)]">
              <div
                className="h-full rounded-full transition-[width] duration-700 ease-out"
                style={{
                  width: inView ? `${(d.value / max) * 100}%` : "0%",
                  // UMA cor para todas as barras, opacidade cheia.
                  // A versão anterior esmaecia conforme o ranking. É um
                  // anti-padrão conhecido: motivo de perda e objeção são
                  // categorias NOMINAIS, sem ordem própria — esmaecer duplica
                  // na cor o que o comprimento já diz e gasta o único canal
                  // livre com informação repetida.
                  background: color,
                  transitionDelay: stagger(i, 70, 400),
                }}
              />
            </div>
          </li>
        );
      })}
    </ul>
  );
}
