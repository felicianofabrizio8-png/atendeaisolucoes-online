import { useState } from "react";
import { cn } from "@/lib/utils";
import { num, pct, useInView } from "./primitives";

export interface ItemArea {
  label: string;
  value: number;
}

interface Bloco extends ItemArea {
  x: number;
  y: number;
  w: number;
  h: number;
}

const W = 320;
const H = 132;

/**
 * Squarified treemap.
 *
 * Empilha os itens em faixas ao longo do lado MENOR do espaço que sobrou e
 * fecha a faixa quando acrescentar mais um pioraria a proporção dos
 * retângulos. É esse teste que evita as lascas compridas do treemap ingênuo —
 * e lasca comprida é o que estraga a leitura, porque a área deixa de ser
 * percebida quando a forma é muito alongada.
 */
function squarify(entrada: ItemArea[], largura: number, altura: number): Bloco[] {
  const saida: Bloco[] = [];
  const itens = entrada.filter((d) => d.value > 0).sort((a, b) => b.value - a.value);
  const total = itens.reduce((s, d) => s + d.value, 0);
  if (total <= 0 || largura <= 0 || altura <= 0) return saida;

  const escala = (largura * altura) / total;
  const fila = itens.map((d) => ({ ...d, area: d.value * escala }));

  let x = 0;
  let y = 0;
  let w = largura;
  let h = altura;
  let linha: Array<(typeof fila)[number]> = [];

  const lado = () => Math.min(w, h);

  /** Pior razão de aspecto da faixa, com ou sem um candidato a mais. */
  const razao = (grupo: typeof linha): number => {
    if (grupo.length === 0) return Infinity;
    const soma = grupo.reduce((a, d) => a + d.area, 0);
    if (soma <= 0) return Infinity;
    const maior = Math.max(...grupo.map((d) => d.area));
    const menor = Math.min(...grupo.map((d) => d.area));
    const l = lado();
    return Math.max((l * l * maior) / (soma * soma), (soma * soma) / (l * l * menor));
  };

  const despejar = () => {
    const soma = linha.reduce((a, d) => a + d.area, 0);
    if (soma <= 0) {
      linha = [];
      return;
    }
    if (w >= h) {
      const faixaW = soma / h;
      let cy = y;
      for (const d of linha) {
        const alturaBloco = d.area / faixaW;
        saida.push({ label: d.label, value: d.value, x, y: cy, w: faixaW, h: alturaBloco });
        cy += alturaBloco;
      }
      x += faixaW;
      w -= faixaW;
    } else {
      const faixaH = soma / w;
      let cx = x;
      for (const d of linha) {
        const larguraBloco = d.area / faixaH;
        saida.push({ label: d.label, value: d.value, x: cx, y, w: larguraBloco, h: faixaH });
        cx += larguraBloco;
      }
      y += faixaH;
      h -= faixaH;
    }
    linha = [];
  };

  for (const d of fila) {
    if (linha.length === 0 || razao([...linha, d]) <= razao(linha)) {
      linha.push(d);
    } else {
      despejar();
      linha.push(d);
    }
  }
  despejar();
  return saida;
}

/**
 * Treemap de participação.
 *
 * POR QUE ÁREA e não mais uma fileira de barras: a pergunta deste painel não
 * é "qual objeção é a maior" — o ranking já está na ordem — é "o quanto ela
 * PESA no total". Comprimento responde a primeira; área responde a segunda,
 * porque o retângulo ocupa visivelmente a fração do quadro que ocupa nos
 * números. Cinco barras de comprimentos parecidos parecem um empate; cinco
 * retângulos mostram de imediato que um deles come metade do espaço.
 *
 * A luminosidade acompanha o valor. Isso é redundância deliberada, e aqui é
 * certo pelo motivo oposto ao das barras: comparar ÁREAS é impreciso (um
 * retângulo alto e estreito e outro baixo e largo com a mesma área não
 * parecem iguais), então a cor devolve a ordem que a forma embaralha. Na
 * barra segmentada a redundância era desperdício porque o comprimento já era
 * exato; aqui ela é correção.
 */
export function Treemap({
  data,
  color,
  className,
  emptyText = "Sem dados no período",
}: {
  data: ItemArea[];
  /** Tom do grupo. A intensidade dentro do grupo sai do valor. */
  color: string;
  className?: string;
  emptyText?: string;
}) {
  const [hover, setHover] = useState<Bloco | null>(null);
  const [ref, inView] = useInView<HTMLDivElement>();

  const blocos = squarify(data, W, H);
  if (blocos.length === 0) {
    return <p className="py-6 text-center text-xs text-muted-foreground">{emptyText}</p>;
  }

  const total = data.reduce((s, d) => s + d.value, 0);
  const maior = Math.max(...blocos.map((b) => b.value), 1);

  return (
    <div ref={ref} className={cn("min-w-0", className)}>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full"
        role="img"
        aria-label={blocos.map((b) => `${b.label}: ${num(b.value)}`).join(", ")}
      >
        {blocos.map((b, i) => {
          const fracao = b.value / maior;
          // Teto em 70%: acima disso o bloco fica claro demais no tema
          // escuro (e escuro demais no claro) e briga com o próprio rótulo.
          const mistura = 30 + fracao * 40;
          const destacado = hover?.label === b.label;
          const cabeRotulo = b.w > 62 && b.h > 28;
          const cabeValor = b.w > 34 && b.h > 17;

          return (
            <g
              key={b.label}
              className={inView ? "viz-dot" : undefined}
              style={{
                animationDelay: `${Math.min(i * 70, 500)}ms`,
                visibility: inView ? undefined : "hidden",
              }}
              onMouseEnter={() => setHover(b)}
              onMouseLeave={() => setHover(null)}
            >
              {/* Vão de 2px entre blocos: sem ele dois retângulos do mesmo
                  tom encostam e leem como um só. */}
              <rect
                x={b.x + 1}
                y={b.y + 1}
                width={Math.max(b.w - 2, 0)}
                height={Math.max(b.h - 2, 0)}
                rx={4}
                fill={`color-mix(in oklab, ${color} ${mistura.toFixed(1)}%, var(--viz-track))`}
                stroke={destacado ? "var(--foreground)" : "transparent"}
                strokeWidth={1}
                strokeOpacity={0.6}
                className="transition-[stroke] duration-200"
              />
              {cabeRotulo && (
                <text
                  x={b.x + 8}
                  y={b.y + 17}
                  className="pointer-events-none select-none fill-foreground"
                  style={{ fontSize: 9.5, fontWeight: 600 }}
                >
                  {recortar(b.label, b.w)}
                </text>
              )}
              {cabeValor && (
                <text
                  x={b.x + 8}
                  y={cabeRotulo ? b.y + 31 : b.y + b.h / 2 + 4}
                  className="pointer-events-none select-none fill-foreground tabular-nums"
                  style={{ fontSize: cabeRotulo ? 12 : 10, fontWeight: 700 }}
                >
                  {num(b.value)}
                  {cabeRotulo && total > 0 && (
                    <tspan style={{ fontSize: 9, fontWeight: 400 }} opacity={0.7}>
                      {"  "}
                      {pct((b.value / total) * 100, 0)}
                    </tspan>
                  )}
                </text>
              )}
            </g>
          );
        })}
      </svg>

      <p className="mt-1.5 truncate text-[10px] text-muted-foreground" role="status">
        {hover
          ? `${hover.label}: ${num(hover.value)}${total > 0 ? ` · ${pct((hover.value / total) * 100, 0)} do total` : ""}`
          : blocos
              .filter((b) => b.w <= 62 || b.h <= 28)
              .map((b) => `${b.label} ${num(b.value)}`)
              .join(" · ") || "A área de cada bloco é a participação no total"}
      </p>
    </div>
  );
}

/** Corta o rótulo ao que cabe na largura do bloco, em ~5px por caractere. */
function recortar(texto: string, largura: number): string {
  const limite = Math.floor((largura - 16) / 5);
  return texto.length > limite ? `${texto.slice(0, Math.max(limite - 1, 1))}…` : texto;
}
