import { cn } from "@/lib/utils";
import { brlCompact, num, pct, useInView } from "./primitives";

export interface LinhaMatriz {
  key: string;
  label: string;
  leads: number;
  conversas: number;
  orcamentos: number;
  vendas: number;
  receita: number;
  conversao: number;
}

const ETAPAS = [
  { campo: "leads", curto: "Leads" },
  { campo: "conversas", curto: "Conv." },
  { campo: "orcamentos", curto: "Orç." },
  { campo: "vendas", curto: "Vendas" },
] as const;

/**
 * Matriz canal × etapa.
 *
 * O painel anterior era uma barra de participação por canal. Ela responde
 * "de onde vem VOLUME" — e quem decide onde investir precisa de outra
 * resposta: "de onde vem VENDA". São perguntas diferentes, e a primeira
 * sozinha mente com frequência: o canal que traz metade dos contatos é
 * rotineiramente o que converte pior.
 *
 * A intensidade é calculada por COLUNA, não sobre a tabela inteira. Comparar
 * "300 leads" com "4 vendas" numa escala comum pintaria a coluna de vendas
 * inteira de vazio; por coluna, cada etapa mostra quem lidera nela.
 *
 * A cor é uma rampa de um tom só sobre o trilho — magnitude é grandeza
 * contínua e pede rampa sequencial. A identidade do canal continua no ponto
 * colorido com o nome ao lado: verde do WhatsApp e rosa do Instagram ficam a
 * ΔE 4,3 em deuteranopia e nenhum ajuste resolve sem perder a marca, então a
 * cor da marca é reforço e nunca o portador da identidade.
 */
export function ChannelMatrix({
  linhas,
  className,
}: {
  linhas: LinhaMatriz[];
  className?: string;
}) {
  const [ref, inView] = useInView<HTMLDivElement>();

  const maxPorEtapa = Object.fromEntries(
    ETAPAS.map((e) => [e.campo, Math.max(...linhas.map((l) => l[e.campo]), 1)]),
  ) as Record<(typeof ETAPAS)[number]["campo"], number>;
  const maxConversao = Math.max(...linhas.map((l) => l.conversao), 1);

  return (
    <div ref={ref} className={cn("min-w-0", className)}>
      {/* Sem largura mínima: a matriz precisa caber num cartão de quatro
          colunas (~320px numa tela de 1280). Com `min-w` a coluna de vendas
          — a que mais importa — ficava cortada na borda do cartão, e um
          corte sem barra de rolagem visível é informação perdida em
          silêncio. */}
      <div className="-mx-1 overflow-x-auto px-1">
        <div>
          <div className="grid grid-cols-[minmax(78px,1.4fr)_repeat(4,minmax(24px,1fr))] items-center gap-1 pb-1.5">
            <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
              Canal
            </span>
            {ETAPAS.map((e) => (
              <span key={e.campo} className="text-center text-[10px] text-muted-foreground">
                {e.curto}
              </span>
            ))}
          </div>

          <div className="space-y-1">
            {linhas.map((linha, i) => (
              <div
                key={linha.key}
                className="grid grid-cols-[minmax(78px,1.4fr)_repeat(4,minmax(24px,1fr))] items-stretch gap-1"
              >
                <span className="flex min-w-0 items-center gap-1.5 pr-1.5">
                  <span
                    aria-hidden
                    className="h-2 w-2 shrink-0 rounded-full"
                    style={{ background: `var(--channel-${linha.key})` }}
                  />
                  <span className="min-w-0 truncate text-[11px] font-medium text-foreground">
                    {linha.label}
                  </span>
                </span>

                {ETAPAS.map((e, col) => {
                  const valor = linha[e.campo];
                  // Teto em 0,55: acima disso o fundo começa a disputar com o
                  // texto, e o número é o que se veio ler.
                  const intensidade = (valor / maxPorEtapa[e.campo]) * 0.55;
                  return (
                    <span
                      key={e.campo}
                      className="grid h-8 place-items-center rounded-md text-xs font-semibold tabular-nums text-foreground transition-[background-color,opacity] duration-500"
                      style={{
                        background: `color-mix(in oklab, var(--viz-1) ${(intensidade * 100).toFixed(1)}%, var(--viz-track))`,
                        opacity: inView ? 1 : 0,
                        transitionDelay: `${Math.min(i * 90 + col * 45, 700)}ms`,
                      }}
                    >
                      {valor > 0 ? num(valor) : <span className="text-muted-foreground">—</span>}
                    </span>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      </div>

      <ul className="mt-3 space-y-2 border-t border-border pt-3">
        {linhas.map((linha) => (
          <li key={linha.key} className="min-w-0">
            <div className="flex items-baseline justify-between gap-2">
              <span className="min-w-0 truncate text-[11px] text-muted-foreground">
                {linha.label}
              </span>
              <span className="shrink-0 text-[11px] tabular-nums text-foreground">
                {linha.vendas > 0 ? brlCompact(linha.receita) : "sem venda"}
                <span className="ml-2 font-semibold">{pct(linha.conversao, 1)}</span>
              </span>
            </div>
            <div className="mt-1 h-[3px] w-full overflow-hidden rounded-full bg-[var(--viz-track)]">
              <div
                className="h-full rounded-full transition-[width] duration-700 ease-out"
                style={{
                  width: inView ? `${(linha.conversao / maxConversao) * 100}%` : "0%",
                  background: "var(--viz-1)",
                }}
              />
            </div>
          </li>
        ))}
      </ul>
      <p className="mt-2 text-[10px] text-muted-foreground">
        Barra: taxa de conversão do canal (vendas ÷ leads).
      </p>
    </div>
  );
}
