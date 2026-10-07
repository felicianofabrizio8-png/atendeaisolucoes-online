import { useCallback, useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import type { StatSnapshot } from "@/lib/atendimento/stats";

const ROTATION_MS = 7000;

/**
 * Cartão de métricas com fundos que se transformam entre os indicadores.
 *
 * Troca de métrica a cada 7s no mesmo cartão. Decisões que valem
 * comentário:
 * - Os gradientes CSS permanecem montados e só a opacidade/escala muda. Assim
 *   a cor flui entre métricas sem deslocar o cartão nem recalcular layout.
 * - O relógio pausa no hover, no foco do teclado e quando a aba está oculta.
 *   Nada pior do que voltar para a aba e o cartão ter passado 40 vezes.
 * - `prefers-reduced-motion` desliga a transição (vira corte seco) mas mantém a
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

  const currentIndex = index % stats.length;
  const current = stats[currentIndex];
  const selected = activeKey === current.key;

  return (
    <div
      className={cn("@container/stat-card min-w-0 shrink-0 select-none", className)}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocusCapture={() => setPaused(true)}
      onBlurCapture={() => setPaused(false)}
      onKeyDown={(e) => {
        if (e.key === "ArrowRight") {
          e.preventDefault();
          go(currentIndex + 1);
        }
        if (e.key === "ArrowLeft") {
          e.preventDefault();
          go(currentIndex - 1);
        }
      }}
    >
      <div className="relative overflow-hidden rounded-[28px] bg-[#07070b]">
        {stats.map((stat, i) => (
          <span
            key={stat.key}
            aria-hidden="true"
            className={cn(
              "pointer-events-none absolute inset-0 origin-center",
              reduceMotion
                ? "transition-none"
                : "transition-[opacity,transform] duration-[1000ms] ease-[cubic-bezier(0.22,1,0.36,1)]",
              i === currentIndex ? "scale-100 opacity-100" : "scale-110 opacity-0",
            )}
            style={{ background: stat.gradient }}
          />
        ))}
        {/* Luz leve sobre os fundos coloridos, sem imagem ou troca de cartão. */}
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-0"
          style={{
            background:
              "radial-gradient(120% 80% at 15% 0%, rgba(255,255,255,0.07), transparent 58%)",
          }}
        />
        <button
          type="button"
          onClick={() => onSelect(selected ? null : current.key)}
          title={`${current.caption} — clique para filtrar a fila`}
          className={cn(
            "group relative flex h-[clamp(112px,20dvh,168px)] w-full min-w-0 flex-col justify-center rounded-[28px] px-4 pb-3 pt-10 text-left outline-none xl:h-[clamp(132px,24dvh,200px)] xl:px-5 xl:pb-4",
            "focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-white/70",
            selected && "ring-2 ring-inset ring-white/80",
          )}
        >
          <span
            key={current.key}
            className="relative"
            style={
              reduceMotion
                ? undefined
                : { animation: "atendimento-stat-content 550ms ease-out both" }
            }
          >
            <span className="block text-base font-bold leading-none text-white drop-shadow-sm @min-[280px]/stat-card:text-xl">
              {current.label}:
            </span>
            <span className="mt-1 block text-[48px] font-extrabold leading-[0.9] tracking-tight text-white tabular-nums drop-shadow @min-[280px]/stat-card:text-[64px]">
              {current.count}
            </span>
          </span>
          {selected && (
            <span className="absolute bottom-4 left-6 rounded-full border border-white/15 bg-white/10 px-2 py-0.5 text-[10px] font-semibold text-white backdrop-blur">
              filtrando
            </span>
          )}
        </button>

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
              aria-current={i === currentIndex}
              onClick={() => go(i)}
              className="pointer-events-auto flex h-6 items-center py-2"
            >
              {/* Traço curto — menor que a faixa de antes, mas com proporção
                  bem longe de um ponto (20x5). */}
              <span
                className={cn(
                  "block h-[5px] w-5 overflow-hidden rounded-full shadow-sm transition-colors duration-300",
                  // Trilho claro, não escuro: o cartão agora é preto e um
                  // trilho preto sumiria dentro dele.
                  i === currentIndex ? "bg-white/20" : "bg-white/35 hover:bg-white/60",
                )}
              >
                {i === currentIndex && (
                  <span
                    key={`${currentIndex}-${tick}`}
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
