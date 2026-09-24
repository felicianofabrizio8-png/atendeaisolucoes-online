import { useState } from "react";
import { cn } from "@/lib/utils";
import { arcPath, num, usePrefersReducedMotion, useInView } from "./primitives";

export type QueueTone = "falha" | "oportunidade" | "sistema";

export interface QueueItem {
  key: string;
  label: string;
  hint: string;
  value: number;
  tone: QueueTone;
}

const TOM: Record<QueueTone, string> = {
  // Vermelho é cor de ESTADO, reservada, e vem sempre com rótulo — aqui o
  // estado é "o cliente falou e ninguém respondeu".
  falha: "var(--status-urgent)",
  oportunidade: "var(--viz-3)",
  sistema: "var(--viz-2)",
};

const INICIO = 10;
const VARREDURA = 340;

/**
 * Fila de atenção como anéis concêntricos.
 *
 * Antes isto era uma lista de cinco números. Lista responde "quanto" item a
 * item e não responde a única pergunta que importa numa fila: ONDE está a
 * pressão. Com os anéis, a comparação é a primeira coisa que o olho faz — o
 * arco mais cheio salta antes de qualquer número ser lido.
 *
 * O comprimento do arco é proporcional ao maior valor da fila, não ao total:
 * a pergunta é "qual é o pior", não "que fatia cada um representa". Fatia de
 * pizza responderia a segunda e achataria a primeira.
 *
 * Cada anel tem seu trilho completo desenhado atrás. Sem o trilho, um arco
 * curto no raio de fora e um arco longo no raio de dentro parecem
 * equivalentes — o trilho devolve a escala a cada anel.
 *
 * Sem ícone: o raio do anel é a identidade, e a legenda traz o mesmo arco em
 * miniatura como marcador. Ícone genérico aqui só empataria com os outros
 * quatro ícones genéricos da lista.
 */
export function RadialQueue({
  items,
  className,
  renderItem,
}: {
  items: QueueItem[];
  className?: string;
  /** A linha da legenda, para o consumidor decidir se ela é link. */
  renderItem: (item: QueueItem, marcador: React.ReactNode, ativo: boolean) => React.ReactNode;
}) {
  const [hover, setHover] = useState<string | null>(null);
  const [ref, inView] = useInView<HTMLDivElement>();
  const reduced = usePrefersReducedMotion();

  if (items.length === 0) return null;

  const S = 176;
  const centro = S / 2;
  const max = Math.max(...items.map((i) => i.value), 1);
  // Folga entre anéis maior que metade do traço. Com folga menor os anéis
  // encostam e o conjunto lê como uma espiral única em vez de seis medidas
  // independentes — medido na tela, não no papel.
  const passo = items.length > 4 ? 12.5 : 16;
  const traco = items.length > 4 ? 6.5 : 8.5;
  const raioDe = (i: number) => centro - 10 - i * passo;

  // Empilhado, nunca lado a lado. O breakpoint `sm` mede a JANELA, e este
  // painel ocupa quatro das doze colunas: numa tela de 1280px o cartão tem
  // ~320px de largura enquanto a janela diz "640+". Medido na tela: com o
  // mostrador ao lado sobravam ~80px para o rótulo e "Sem resposta" aparecia
  // como "S…". Empilhar devolve a largura inteira do cartão à legenda.
  return (
    <div ref={ref} className={cn("flex flex-col gap-4", className)}>
      <svg
        viewBox={`0 0 ${S} ${S}`}
        className="mx-auto h-[156px] w-[156px] shrink-0"
        role="img"
        aria-label={`Fila: ${items.map((i) => `${i.label} ${num(i.value)}`).join(", ")}`}
      >
        {items.map((item, i) => {
          const r = raioDe(i);
          if (r <= traco) return null;
          const fracao = item.value / max;
          const varredura = Math.max(fracao * VARREDURA, item.value > 0 ? 6 : 0);
          const comprimento = 2 * Math.PI * r * (varredura / 360);
          const ativo = hover === null || hover === item.key;

          return (
            <g key={item.key} opacity={ativo ? 1 : 0.3} className="transition-opacity duration-200">
              <path
                d={arcPath(centro, centro, r, INICIO, INICIO + VARREDURA)}
                fill="none"
                stroke="var(--viz-track)"
                strokeWidth={traco}
                strokeLinecap="round"
                // Trilho de item zerado recua: seis trilhos cheios competem
                // com os arcos e a fila parece mais carregada do que está.
                opacity={item.value > 0 ? 1 : 0.45}
              />
              {item.value > 0 && inView && (
                <path
                  d={arcPath(centro, centro, r, INICIO, INICIO + varredura)}
                  fill="none"
                  stroke={TOM[item.tone]}
                  strokeWidth={traco}
                  strokeLinecap="round"
                  className="viz-stroke"
                  style={{
                    strokeDasharray: comprimento,
                    strokeDashoffset: reduced ? 0 : comprimento,
                    animationDelay: `${i * 90}ms`,
                  }}
                />
              )}
            </g>
          );
        })}
      </svg>

      <ul className="min-w-0 flex-1 space-y-1">
        {items.map((item, i) => {
          const r = raioDe(i);
          const ativo = hover === null || hover === item.key;
          const marcador = (
            <svg
              aria-hidden
              viewBox="0 0 16 16"
              className="h-4 w-4 shrink-0"
              style={{ overflow: "visible" }}
            >
              <path
                d={arcPath(8, 8, 5.5, INICIO, INICIO + VARREDURA)}
                fill="none"
                stroke="var(--viz-track)"
                strokeWidth={3}
                strokeLinecap="round"
              />
              <path
                d={arcPath(8, 8, 5.5, INICIO, INICIO + Math.max((item.value / max) * VARREDURA, 8))}
                fill="none"
                stroke={item.value > 0 ? TOM[item.tone] : "var(--viz-track)"}
                strokeWidth={3}
                strokeLinecap="round"
              />
            </svg>
          );
          return (
            <li
              key={item.key}
              onMouseEnter={() => setHover(item.key)}
              onMouseLeave={() => setHover(null)}
              onFocus={() => setHover(item.key)}
              onBlur={() => setHover(null)}
              style={{ ["--anel-raio" as string]: `${r}px` }}
            >
              {renderItem(item, marcador, ativo)}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
