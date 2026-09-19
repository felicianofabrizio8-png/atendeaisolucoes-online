import { useCallback, useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import type { StatSnapshot } from "@/lib/atendimento/stats";

const ROTATION_MS = 7000;

/**
 * Carrossel dos cartões coloridos de métrica.
 *
 * Troca de cartão a cada 7s deslizando para o lado. Decisões que valem
 * comentário:
 * - O trilho inteiro é um flex que anda com `translateX`; só uma propriedade
 *   animada (transform), então roda na GPU e não causa layout thrash numa tela
 *   que já renderiza lista virtualizada + chat.
 * - O relógio pausa no hover, no foco do teclado e quando a aba está oculta.
 *   Nada pior do que voltar para a aba e o cartão ter passado 40 vezes.
 * - `prefers-reduced-motion` desliga o deslize (vira corte seco) mas mantém a
 *   rotação — quem pediu menos movimento não quer perder a informação.
 * - Clicar no cartão filtra a fila. O número não é enfeite.
 */
export function StatCarousel({
  stats,
  activeKey,
  onSelect,
  className,
}: {
  stats: StatSnapshot[];
  activeKey: string | null;
  onSelect: (key: string | null) => void;
  className?: string;
}) {
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const [reduceMotion, setReduceMotion] = useState(false);
  const [tick, setTick] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const apply = () => setReduceMotion(mq.matches);
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, []);

  // Pausa quando a aba sai de vista — evita "pular" métricas em segundo plano.
  useEffect(() => {
    if (typeof document === "undefined") return;
    const onVisibility = () => setPaused(document.hidden);
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, []);

  const go = useCallback(
    (next: number) => {
      if (stats.length === 0) return;
      setIndex(((next % stats.length) + stats.length) % stats.length);
      setTick((t) => t + 1);
    },
    [stats.length],
  );

  useEffect(() => {
    if (paused || stats.length <= 1) return;
    const id = window.setTimeout(() => go(index + 1), ROTATION_MS);
    return () => window.clearTimeout(id);
  }, [index, paused, stats.length, go, tick]);

  if (stats.length === 0) return null;

  const current = stats[index];

  return (
    <div
      ref={containerRef}
      className={cn("select-none", className)}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocusCapture={() => setPaused(true)}
      onBlurCapture={() => setPaused(false)}
      onKeyDown={(e) => {
        if (e.key === "ArrowRight") { e.preventDefault(); go(index + 1); }
        if (e.key === "ArrowLeft") { e.preventDefault(); go(index - 1); }
      }}
    >
      <div className="relative overflow-hidden rounded-[28px]">
        <div
          className="flex"
          style={{
            transform: `translateX(-${index * 100}%)`,
            transition: reduceMotion
              ? "none"
              : "transform 700ms cubic-bezier(0.22, 1, 0.36, 1)",
          }}
        >
          {stats.map((stat) => {
            const selected = activeKey === stat.key;
            return (
              <button
                key={stat.key}
                type="button"
                // aria-hidden nos slides fora de tela evita que o leitor de
                // tela anuncie sete métricas em sequência.
                aria-hidden={stat.key !== current.key}
                tabIndex={stat.key === current.key ? 0 : -1}
                onClick={() => onSelect(selected ? null : stat.key)}
                title={`${stat.caption} — clique para filtrar a fila`}
                className={cn(
                  "group relative shrink-0 basis-full text-left",
                  // pt maior que o resto: o topo é a faixa dos indicadores.
                  "aspect-[16/11] max-h-[230px] rounded-[28px] px-6 pb-5 pt-12 flex flex-col justify-center",
                  "outline-none transition-[box-shadow,transform] duration-200",
                  "focus-visible:ring-2 focus-visible:ring-white/70",
                  selected && "ring-2 ring-white/80",
                )}
              >
                {/* Brilho sutil no topo: dá volume ao cartão chapado. */}
                <span
                  aria-hidden
                  className="pointer-events-none absolute inset-0 rounded-[28px] opacity-60"
                  style={{
                    background:
                      "radial-gradient(120% 80% at 15% 0%, rgba(255,255,255,0.28), transparent 60%)",
                  }}
                />
                {/* Rótulo e número colados, número dominando o cartão. A
                    explicação da métrica vive no title do cartão — na face
                    ela competia com o número pelo mesmo olhar. */}
                <span className="relative">
                  <span className="block text-[22px] font-bold leading-none text-white drop-shadow-sm">
                    {stat.label}:
                  </span>
                  <span className="mt-1 block text-[80px] font-extrabold leading-[0.9] tracking-tight text-white tabular-nums drop-shadow">
                    {stat.count}
                  </span>
                </span>
                {selected && (
                  <span className="absolute bottom-4 left-6 rounded-full bg-black/25 px-2 py-0.5 text-[10px] font-semibold text-white backdrop-blur">
                    filtrando
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* Indicadores dentro do cartão, no topo e centralizados. A barra do
            slide ativo enche em 7s — é ela que comunica o ritmo da troca e o
            estado de pausa (a animação congela no hover), então não sobra
            nenhum rótulo de texto para explicar isso.

            O <button> é só a área de toque, porque o app impõe 44px de altura
            mínima em telas pequenas; quem desenha o traço é o <span> dentro.
            O container é pointer-events-none para não roubar o clique do
            cartão nos vãos entre as barras. */}
        <div className="pointer-events-none absolute inset-x-0 top-0 z-10 flex justify-center gap-1.5 px-4 pt-2.5">
          {stats.map((stat, i) => (
            <button
              key={stat.key}
              type="button"
              aria-label={`Ver métrica ${stat.label}`}
              aria-current={i === index}
              onClick={() => go(i)}
              className="pointer-events-auto flex h-6 items-center py-2"
            >
              {/* Traço curto — menor que a faixa de antes, mas com proporção
                  bem longe de um ponto (20x5). */}
              <span
                className={cn(
                  "block h-[5px] w-5 overflow-hidden rounded-full shadow-sm transition-colors duration-300",
                  i === index ? "bg-black/25" : "bg-white/35 hover:bg-white/60",
                )}
              >
                {i === index && (
                  <span
                    key={`${index}-${tick}`}
                    className="block h-full rounded-full bg-white"
                    style={
                      reduceMotion
                        ? { width: "100%" }
                        : {
                            animation: `atendimento-tick ${ROTATION_MS}ms linear forwards`,
                            animationPlayState: paused ? "paused" : "running",
                          }
                    }
                  />
                )}
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
