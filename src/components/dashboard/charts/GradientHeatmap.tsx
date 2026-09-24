import { useState } from "react";
import { cn } from "@/lib/utils";
import { num, useInView } from "./primitives";

const PARADAS = 6;

/**
 * Suaviza o campo com um núcleo 3×3 antes de colorir.
 *
 * É o que produz o gradiente entre os blocos. Sem isto, dois quadradinhos
 * vizinhos podem cair em cores muito distantes e a grade fica picotada; com
 * a média ponderada, células vizinhas recebem valores próximos e a cor
 * escorre de uma para a outra, exatamente como na referência.
 *
 * O valor bruto NÃO se perde: o que se suaviza é só a variável usada para a
 * cor. O hover e o rótulo acessível continuam lendo a contagem real — o
 * borrão é estético e não pode virar mentira sobre o número.
 */
function suavizar(valores: number[][]): number[][] {
  const linhas = valores.length;
  const colunas = valores[0]?.length ?? 0;
  const peso = [
    [1, 2, 1],
    [2, 4, 2],
    [1, 2, 1],
  ];
  return valores.map((linha, l) =>
    linha.map((_, c) => {
      let soma = 0;
      let total = 0;
      for (let dl = -1; dl <= 1; dl++) {
        for (let dc = -1; dc <= 1; dc++) {
          const ll = l + dl;
          const cc = c + dc;
          if (ll < 0 || ll >= linhas || cc < 0 || cc >= colunas) continue;
          const p = peso[dl + 1][dc + 1];
          soma += valores[ll][cc] * p;
          total += p;
        }
      }
      return total > 0 ? soma / total : 0;
    }),
  );
}

/**
 * Cor contínua na rampa, interpolando entre dois degraus vizinhos.
 *
 * `color-mix` entre duas paradas dá a transição contínua a partir de tokens
 * discretos — sem isto a rampa teria seis patamares visíveis e a grade
 * voltaria a parecer picotada, que é justamente o que a suavização evita.
 */
function corDe(fracao: number): string {
  const p = Math.max(0, Math.min(1, fracao)) * (PARADAS - 1);
  const baixo = Math.floor(p);
  const alto = Math.min(PARADAS - 1, baixo + 1);
  const t = p - baixo;
  if (baixo === alto) return `var(--viz-rb-${baixo})`;
  return `color-mix(in oklab, var(--viz-rb-${alto}) ${(t * 100).toFixed(1)}%, var(--viz-rb-${baixo}))`;
}

/**
 * Campo de calor em blocos pequenos, com gradiente entre eles.
 *
 * As colunas correm da ESQUERDA PARA A DIREITA no tempo, seguindo o mesmo
 * filtro do resto da tela (dias ou meses). As linhas são as horas do dia, de
 * cima para baixo. É esse cruzamento que dá densidade: um bloco por dia
 * renderia trinta quadradinhos soltos; hora × dia rende centenas, e a forma
 * das manchas passa a dizer alguma coisa.
 *
 * Sem número dentro dos blocos, de propósito: com esta escala de célula
 * qualquer texto seria ilegível, e é a MANCHA que se lê aqui. O valor exato
 * fica no hover e no rótulo acessível de cada bloco.
 */
export function GradientHeatmap({
  valores,
  colunas,
  colunasCheias,
  linhas,
  className,
}: {
  /** valores[linha][coluna] — contagem bruta. */
  valores: number[][];
  colunas: string[];
  colunasCheias: string[];
  /** Horas exibidas, de cima para baixo. */
  linhas: number[];
  className?: string;
}) {
  const [hover, setHover] = useState<{ l: number; c: number } | null>(null);
  const [ref, inView] = useInView<HTMLDivElement>();

  if (valores.length === 0 || (valores[0]?.length ?? 0) === 0) return null;

  const suave = suavizar(valores);
  const maxSuave = Math.max(...suave.flat(), 0.0001);
  const brutos = valores.flat();
  const maxBruto = Math.max(...brutos, 0);

  const nLinhas = valores.length;
  const nColunas = valores[0].length;

  // Célula quadrada sempre. A grade é desenhada num viewBox de célula
  // unitária e o SVG escala proporcionalmente, então a proporção do quadrado
  // não depende da largura que o cartão vier a ter.
  const LADO = 10;
  const VAO = 1.4;
  const FAIXA_ROTULO = 9;
  const W = nColunas * LADO;
  const grade = nLinhas * LADO;
  const H = grade + FAIXA_ROTULO;

  const atual = hover
    ? { hora: linhas[hover.l], coluna: colunasCheias[hover.c], valor: valores[hover.l][hover.c] }
    : null;

  return (
    <div ref={ref} className={cn("min-w-0", className)}>
      {/* Teto de altura. Sem ele o filtro "Ano" (12 colunas × 15 linhas)
          daria uma grade mais alta que larga, e num cartão de 570px a altura
          passaria de 700px — o painel empurraria a tela inteira para baixo.
          Com `meet`, o desenho encolhe para caber e fica centrado, mantendo a
          célula quadrada em qualquer filtro. */}
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full"
        style={{ maxHeight: 250 }}
        role="img"
        aria-label="Entrada de leads por hora ao longo do período"
        preserveAspectRatio="xMidYMid meet"
      >
        {suave.map((linha, l) =>
          linha.map((v, c) => {
            const destacado = hover?.l === l && hover?.c === c;
            return (
              <rect
                key={`${l}-${c}`}
                x={c * LADO + VAO / 2}
                y={l * LADO + VAO / 2}
                width={LADO - VAO}
                height={LADO - VAO}
                rx={1.2}
                fill={corDe(v / maxSuave)}
                stroke={destacado ? "var(--foreground)" : "none"}
                strokeWidth={0.8}
                opacity={inView ? 1 : 0}
                className="transition-opacity duration-500"
                style={{ transitionDelay: `${Math.min((l + c) * 12, 520)}ms` }}
                onMouseEnter={() => setHover({ l, c })}
                onMouseLeave={() => setHover(null)}
              >
                <title>{`${colunasCheias[c]}, ${linhas[l]}h: ${num(valores[l][c])} leads`}</title>
              </rect>
            );
          }),
        )}

        {/* Rótulos do eixo DENTRO do svg. Em HTML eles ocupariam a largura do
            cartão, mas a grade centraliza quando é mais estreita que ele — e
            o "1" aparecia longe da primeira coluna. Aqui eles acompanham a
            grade em qualquer filtro. */}
        <text
          x={VAO / 2}
          y={grade + 6.5}
          textAnchor="start"
          className="fill-muted-foreground"
          style={{ fontSize: 5 }}
        >
          {colunas[0]}
        </text>
        <text
          x={W - VAO / 2}
          y={grade + 6.5}
          textAnchor="end"
          className="fill-muted-foreground"
          style={{ fontSize: 5 }}
        >
          {colunas[colunas.length - 1]}
        </text>
      </svg>

      <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
        <span className="min-w-0 truncate text-[10px] text-muted-foreground" role="status">
          {atual
            ? `${atual.coluna}, ${atual.hora}h — ${num(atual.valor)} lead${atual.valor === 1 ? "" : "s"}`
            : `Linhas: ${linhas[0]}h às ${linhas[linhas.length - 1]}h · passe o mouse para ver o número`}
        </span>
        <span className="flex shrink-0 items-center gap-1.5 text-[10px] text-muted-foreground">
          0
          <span
            aria-hidden
            className="h-2.5 w-20 rounded-[2px]"
            style={{
              background: `linear-gradient(to right, ${Array.from(
                { length: PARADAS },
                (_, n) => `var(--viz-rb-${n})`,
              ).join(", ")})`,
            }}
          />
          <span className="tabular-nums">{num(maxBruto)}</span>
        </span>
      </div>
    </div>
  );
}
