// Primitivas de gráfico: formatação, escalas e hooks de animação.
//
// Sem biblioteca de charts de propósito. Recharts já está no projeto, mas ele
// resolve o caso genérico — e o que estas telas precisam é de meia dúzia de
// formas muito específicas (coluna com topo arredondado, funil, heatmap,
// sparkline) com animação de entrada controlada. Em SVG direto isso são ~40
// linhas por forma, com total domínio do DOM para animar; via biblioteca
// seriam wrappers lutando contra o layout dela.

import { useEffect, useRef, useState } from "react";

// ---------------------------------------------------------------------------
// Formatação
// ---------------------------------------------------------------------------

/** Reais sem centavos — dashboard não é extrato; centavo só polui. */
export function brl(value: number): string {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
    maximumFractionDigits: 0,
  }).format(value);
}

/** Forma curta para eixo e legenda: 12,5 mil / 1,2 mi. */
export function brlCompact(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 1_000_000) return `R$ ${(value / 1_000_000).toFixed(1).replace(".", ",")} mi`;
  if (abs >= 1_000) return `R$ ${Math.round(value / 1000)} mil`;
  return brl(value);
}

export function num(value: number): string {
  return new Intl.NumberFormat("pt-BR").format(value);
}

export function pct(value: number, digits = 1): string {
  return `${value.toFixed(digits).replace(".", ",")}%`;
}

/**
 * Variação percentual entre dois períodos.
 *
 * Devolve `null` quando o período anterior é zero: "subiu 100%" partindo do
 * nada é um número que mente. Quem consome mostra "—" e a comparação some.
 */
export function delta(current: number, previous: number): number | null {
  if (previous === 0) return null;
  return ((current - previous) / previous) * 100;
}

// ---------------------------------------------------------------------------
// Escala
// ---------------------------------------------------------------------------

/**
 * Teto "redondo" acima do máximo, para o eixo terminar em número limpo.
 * 0 vira 1 para não gerar divisão por zero em série vazia.
 */
export function niceMax(max: number): number {
  if (max <= 0) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(max));
  const normalized = max / magnitude;
  // Escada fina de propósito. Com os degraus clássicos (1 / 2 / 5 / 10) um
  // máximo de 51 mil sobe para 100 mil — o dobro — e TODAS as colunas caem
  // para metade da altura disponível. Medido: a maior barra usava 51% do
  // espaço. Com estes degraus o teto de 51 mil vira 60 mil e a barra usa 85%.
  const degraus = [1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10];
  const step = degraus.find((d) => normalized <= d) ?? 10;
  return step * magnitude;
}

/** Caminho de uma área suavizada (Catmull-Rom convertido para Bézier). */
export function areaPath(points: Array<{ x: number; y: number }>, baseline: number): string {
  if (points.length === 0) return "";
  if (points.length === 1) {
    const p = points[0];
    return `M${p.x},${baseline} L${p.x},${p.y} L${p.x},${baseline} Z`;
  }
  return `${linePath(points)} L${points[points.length - 1].x},${baseline} L${points[0].x},${baseline} Z`;
}

export function linePath(points: Array<{ x: number; y: number }>): string {
  if (points.length === 0) return "";
  return `M${points[0].x},${points[0].y}${curveCommands(points)}`;
}

/**
 * Só os comandos de curva, SEM o `M` inicial.
 *
 * Existe separado para poder compor uma fita: a borda de cima vai da esquerda
 * para a direita, a de baixo volta da direita para a esquerda, e as duas
 * precisam virar um único `path` fechado. Com `linePath` nos dois trechos o
 * `M` do segundo quebraria o preenchimento em duas sub-formas.
 */
export function curveCommands(points: Array<{ x: number; y: number }>): string {
  if (points.length < 2) return "";
  if (points.length < 3)
    return points
      .slice(1)
      .map((p) => ` L${p.x},${p.y}`)
      .join("");
  // Tensão 0.5: curva o bastante para não parecer serrilhada e pouco o
  // bastante para não inventar picos que o dado não tem.
  let d = "";
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[Math.max(i - 1, 0)];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[Math.min(i + 2, points.length - 1)];
    const c1x = p1.x + (p2.x - p0.x) / 6;
    const c1y = p1.y + (p2.y - p0.y) / 6;
    const c2x = p2.x - (p3.x - p1.x) / 6;
    const c2y = p2.y - (p3.y - p1.y) / 6;
    d += ` C${c1x},${c1y} ${c2x},${c2y} ${p2.x},${p2.y}`;
  }
  return d;
}

/**
 * Fita fechada entre uma borda superior e uma inferior, ambas suavizadas.
 *
 * É a forma do gráfico de fluxo: cada faixa é o espaço ENTRE duas curvas, não
 * uma área até a linha de base. Por isso não dá para reaproveitar `areaPath`.
 */
export function ribbonPath(
  top: Array<{ x: number; y: number }>,
  bottom: Array<{ x: number; y: number }>,
): string {
  if (top.length === 0 || bottom.length === 0) return "";
  const volta = [...bottom].reverse();
  return (
    `M${top[0].x},${top[0].y}` +
    curveCommands(top) +
    ` L${volta[0].x},${volta[0].y}` +
    curveCommands(volta) +
    " Z"
  );
}

/** Ponto no círculo. Ângulo em graus, 0 = topo, sentido horário. */
export function polar(cx: number, cy: number, r: number, deg: number): { x: number; y: number } {
  const rad = ((deg - 90) * Math.PI) / 180;
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
}

/**
 * Arco aberto (sem preenchimento) — o traço de um anel.
 *
 * Desenhado como `path` e não como `circle` com `stroke-dasharray` calculado
 * na mão porque aqui o começo e o fim do arco são conhecidos; dasharray fica
 * reservado para a ANIMAÇÃO de desenho, sem disputar com a geometria.
 */
export function arcPath(cx: number, cy: number, r: number, from: number, to: number): string {
  const varredura = Math.abs(to - from);
  if (varredura <= 0) return "";
  // 360° num único arco elíptico é degenerado (começo = fim): quebra em dois.
  if (varredura >= 359.99) {
    const meio = from + 180;
    return `${arcPath(cx, cy, r, from, meio)} ${arcPath(cx, cy, r, meio, from + 359.99)}`;
  }
  const a = polar(cx, cy, r, from);
  const b = polar(cx, cy, r, to);
  const grande = varredura > 180 ? 1 : 0;
  return `M${a.x},${a.y} A${r},${r} 0 ${grande} 1 ${b.x},${b.y}`;
}

/**
 * Retângulo com os DOIS cantos de cima arredondados e a base reta.
 *
 * `rect` com `rx` arredonda os quatro cantos e a coluna desgruda da linha de
 * base. A especificação é topo arredondado, base quadrada — daí o path à mão.
 * O raio é limitado a metade da largura e à própria altura, senão uma coluna
 * baixa vira uma pílula deformada.
 */
export function columnPath(x: number, y: number, w: number, h: number, r = 4): string {
  const radius = Math.max(0, Math.min(r, w / 2, h));
  if (h <= 0) return "";
  return [
    `M${x},${y + h}`,
    `L${x},${y + radius}`,
    `Q${x},${y} ${x + radius},${y}`,
    `L${x + w - radius},${y}`,
    `Q${x + w},${y} ${x + w},${y + radius}`,
    `L${x + w},${y + h}`,
    "Z",
  ].join(" ");
}

// ---------------------------------------------------------------------------
// Animação
// ---------------------------------------------------------------------------

export function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const apply = () => setReduced(mq.matches);
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, []);
  return reduced;
}

/**
 * Número que sobe até o valor.
 *
 * Usa `requestAnimationFrame` com easing, não `setInterval`: o intervalo
 * desalinha do frame e produz aquele tremor típico de contador feito na mão.
 * Respeita `prefers-reduced-motion` entregando o valor final de imediato.
 */
export function useCountUp(target: number, duration = 900): number {
  const reduced = usePrefersReducedMotion();
  const [value, setValue] = useState(reduced ? target : 0);
  const fromRef = useRef(0);

  useEffect(() => {
    if (reduced) {
      setValue(target);
      return;
    }
    const from = fromRef.current;
    const start = performance.now();
    let raf = 0;

    const tick = (now: number) => {
      const t = Math.min((now - start) / duration, 1);
      // easeOutCubic: chega rápido perto do fim, que é onde o olho confere.
      const eased = 1 - (1 - t) ** 3;
      setValue(from + (target - from) * eased);
      if (t < 1) raf = requestAnimationFrame(tick);
      else fromRef.current = target;
    };

    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, duration, reduced]);

  return value;
}

/**
 * Dispara a animação só quando o elemento entra na tela.
 *
 * Sem isto, um painel no fim da página termina a animação antes de alguém
 * olhar — e o usuário rola até um gráfico já parado, perdendo a leitura de
 * crescimento que a animação carrega.
 *
 * A REDE DE SEGURANÇA não é opcional. `inView === false` esconde as marcas, e
 * aqui isso significa gráfico em branco. Observado na tela: recarregando a
 * página com o navegador restaurando a rolagem, o observador não entregava a
 * primeira leitura dos painéis que já estavam visíveis e eles ficavam vazios
 * até alguém rolar. Por isso a medida direta com `getBoundingClientRect` no
 * quadro seguinte à montagem: se o elemento já está na tela, liga sem esperar
 * o observador. Animação que falha deve terminar mostrando o dado, nunca
 * escondendo.
 */
export function useInView<T extends Element>(): [React.RefObject<T | null>, boolean] {
  const ref = useRef<T>(null);
  const [inView, setInView] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined") {
      setInView(true);
      return;
    }

    let raf = 0;
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setInView(true);
          io.disconnect();
        }
      },
      { threshold: 0.2 },
    );
    io.observe(el);

    // Um quadro depois: o layout já assentou e a rolagem restaurada já foi
    // aplicada, então o retângulo é confiável.
    raf = requestAnimationFrame(() => {
      const r = el.getBoundingClientRect();
      const altura = window.innerHeight || document.documentElement.clientHeight;
      if (r.height > 0 && r.top < altura && r.bottom > 0) {
        setInView(true);
        io.disconnect();
      }
    });

    return () => {
      cancelAnimationFrame(raf);
      io.disconnect();
    };
  }, []);

  return [ref, inView];
}

/** Atraso em cascata das marcas, com teto para série longa não demorar. */
export function stagger(index: number, step = 40, max = 480): string {
  return `${Math.min(index * step, max)}ms`;
}
