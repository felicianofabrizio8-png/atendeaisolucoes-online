import { useState } from "react";
import { cn } from "@/lib/utils";
import { num, pct, useInView } from "./primitives";

export interface CelulaFunil {
  linha: string;
  coluna: string;
  entrou: number;
  avancou: number;
  /** null quando ninguém entrou: ausência de medida, não zero. */
  taxa: number | null;
}

export interface EtapaFunil {
  label: string;
  value: number;
  hint?: string;
}

const NIVEIS = 6;

/**
 * Converte a taxa num degrau da rampa frio→quente.
 *
 * A escala é RELATIVA à própria tabela: o pior avanço fica na ponta fria, o
 * melhor na quente. Foi uma escolha medida, não de gosto — com a escala
 * ancorada em 0–100% um funil real (quase tudo abaixo de 40%) usava só o
 * terço frio da rampa e as células ficavam todas do mesmo azul, apagando
 * exatamente a comparação que o painel existe para fazer.
 *
 * O preço dessa escolha é que dois períodos diferentes não se comparam PELA
 * COR. Por isso a taxa vem escrita dentro de cada célula e as pontas da
 * legenda mostram os valores reais de mínimo e máximo: a cor ordena, o número
 * mede. Sem os números escritos esta escala seria enganosa.
 */
function nivelDe(taxa: number, min: number, max: number): number {
  if (max <= min) return NIVEIS - 1;
  const fracao = (taxa - min) / (max - min);
  return Math.max(0, Math.min(NIVEIS - 1, Math.round(fracao * (NIVEIS - 1))));
}

/**
 * Mapa de calor do funil: canal × transição.
 *
 * O funil em barras responde "quantos sobraram". Ele não responde a pergunta
 * que decide investimento: "a perda desta etapa é de todo mundo ou de UM
 * canal?". Um funil agregado com 30% de avanço pode ser 60% num canal e 8%
 * noutro — e a barra única mostra os dois como a mesma coisa.
 *
 * Cada célula é uma taxa de avanço, então linhas de tamanhos muito diferentes
 * ficam comparáveis: um canal de 200 leads e um de 20 aparecem na mesma
 * escala, coisa que volume nunca permite.
 *
 * FRIO = o que escapa, QUENTE = o que avança. A direção é do negócio, e é o
 * que faz a tabela ser lida sem legenda: procura-se o roxo.
 */
export function FunnelHeatmap({
  celulas,
  linhas,
  colunas,
  etapas,
  className,
}: {
  celulas: CelulaFunil[];
  linhas: string[];
  colunas: string[];
  /** Totais absolutos por etapa — o que a tabela de taxas não carrega. */
  etapas: EtapaFunil[];
  className?: string;
}) {
  const [hover, setHover] = useState<CelulaFunil | null>(null);
  const [ref, inView] = useInView<HTMLDivElement>();

  const porChave = new Map(celulas.map((c) => [`${c.linha}|${c.coluna}`, c]));
  const taxas = celulas.map((c) => c.taxa).filter((t): t is number => t !== null);
  const minTaxa = taxas.length > 0 ? Math.min(...taxas) : 0;
  const maxTaxa = taxas.length > 0 ? Math.max(...taxas) : 100;

  return (
    <div ref={ref} className={cn("min-w-0", className)}>
      {/* Os números absolutos das etapas ficam ACIMA da matriz. A matriz fala
          de taxas; sem os volumes ao lado, "50% de avanço" não distingue 1 de
          2 leads de 400 de 800. */}
      <ol className="mb-4 flex items-stretch gap-1.5">
        {etapas.map((etapa, i) => (
          <li key={etapa.label} className="min-w-0 flex-1">
            <p className="truncate text-[10px] uppercase tracking-wide text-muted-foreground">
              {etapa.label}
            </p>
            <p className="mt-0.5 text-lg font-bold leading-none tabular-nums text-foreground">
              {num(etapa.value)}
            </p>
            <span
              aria-hidden
              className="mt-1.5 block h-[3px] rounded-full transition-[width] duration-700 ease-out"
              style={{
                width: inView ? "100%" : "0%",
                background: `var(--viz-cw-${Math.min(NIVEIS - 1, NIVEIS - 1 - i)})`,
                transitionDelay: `${i * 80}ms`,
              }}
            />
          </li>
        ))}
      </ol>

      <div className="-mx-1 overflow-x-auto px-1">
        <div className="min-w-[380px]">
          <div
            className="grid gap-1 pb-1"
            style={{ gridTemplateColumns: `minmax(62px,1fr) repeat(${colunas.length}, 1fr)` }}
          >
            <span />
            {colunas.map((coluna) => (
              <span
                key={coluna}
                className="text-center text-[9px] font-medium leading-tight text-muted-foreground"
              >
                {coluna}
              </span>
            ))}
          </div>

          <div className="space-y-1">
            {linhas.map((linha, l) => (
              <div
                key={linha}
                className="grid gap-1"
                style={{ gridTemplateColumns: `minmax(62px,1fr) repeat(${colunas.length}, 1fr)` }}
              >
                <span className="flex items-center truncate text-[11px] font-medium text-foreground">
                  {linha === "Todos" ? (
                    <span className="font-bold">Todos</span>
                  ) : (
                    <>
                      <span
                        aria-hidden
                        className="mr-1.5 h-2 w-2 shrink-0 rounded-full"
                        style={{ background: `var(--channel-${CHAVE[linha] ?? "whatsapp"})` }}
                      />
                      <span className="truncate">{linha}</span>
                    </>
                  )}
                </span>

                {colunas.map((coluna, c) => {
                  const celula = porChave.get(`${linha}|${coluna}`);
                  const taxa = celula?.taxa ?? null;
                  const nivel = taxa === null ? null : nivelDe(taxa, minTaxa, maxTaxa);
                  const destacada =
                    hover !== null && hover.linha === linha && hover.coluna === coluna;

                  return (
                    <button
                      key={coluna}
                      type="button"
                      onMouseEnter={() => celula && setHover(celula)}
                      onMouseLeave={() => setHover(null)}
                      onFocus={() => celula && setHover(celula)}
                      onBlur={() => setHover(null)}
                      aria-label={
                        taxa === null
                          ? `${linha}, ${coluna}: sem base de cálculo`
                          : `${linha}, ${coluna}: ${pct(taxa, 0)} avança, ${num(celula?.avancou ?? 0)} de ${num(celula?.entrou ?? 0)}`
                      }
                      className={cn(
                        "grid h-11 place-items-center rounded-md text-xs font-bold tabular-nums transition-[opacity,transform] duration-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground",
                        destacada && "scale-[1.04]",
                      )}
                      style={{
                        // Célula sem base fica com o trilho neutro: pintar de
                        // roxo diria "escapa tudo" onde não houve ninguém.
                        background: nivel === null ? "var(--viz-track)" : `var(--viz-cw-${nivel})`,
                        // Nenhuma cor de texto única contrasta com as duas
                        // pontas da rampa; troca no meio.
                        color:
                          nivel === null
                            ? "var(--muted-foreground)"
                            : nivel <= 2
                              ? "oklch(0.97 0 0)"
                              : "oklch(0.2 0.02 300)",
                        opacity: inView ? 1 : 0,
                        transitionDelay: `${Math.min(l * 90 + c * 45, 800)}ms`,
                      }}
                    >
                      {taxa === null ? "—" : pct(taxa, 0)}
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3">
        <span className="text-[10px] text-muted-foreground" role="status">
          {hover && hover.taxa !== null
            ? `${hover.linha} · ${hover.coluna}: ${num(hover.avancou)} de ${num(hover.entrou)} avançaram — ${num(hover.entrou - hover.avancou)} escaparam`
            : "Cada célula é a taxa de avanço de uma etapa, por canal"}
        </span>
        {/* As pontas trazem os valores REAIS, não "0%" e "100%". A escala é
            relativa a esta tabela, e uma legenda genérica faria o roxo
            parecer catástrofe mesmo quando o pior avanço é 40%. */}
        <span className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
          <span className="tabular-nums">
            {taxas.length > 0 ? pct(minTaxa, 0) : "—"} escapa mais
          </span>
          {Array.from({ length: NIVEIS }, (_, n) => (
            <span
              key={n}
              aria-hidden
              className="h-2.5 w-3.5 rounded-[2px]"
              style={{ background: `var(--viz-cw-${n})` }}
            />
          ))}
          <span className="tabular-nums">
            {taxas.length > 0 ? pct(maxTaxa, 0) : "—"} avança mais
          </span>
        </span>
      </div>
    </div>
  );
}

/** Rótulo do canal → chave do token de cor da marca. */
const CHAVE: Record<string, string> = {
  WhatsApp: "whatsapp",
  Instagram: "instagram",
  Facebook: "facebook",
};
