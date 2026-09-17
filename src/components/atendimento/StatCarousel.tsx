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
      <div className="overflow-hidden rounded-[28px]">
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
                  "aspect-[16/11] max-h-[230px] rounded-[28px] p-5 flex flex-col justify-between",
                  "outline-none transition-[box-shadow,transform] duration-200",
                  "focus-visible:ring-2 focus-visible:ring-white/70",
                  selected && "ring-2 ring-white/80",
                )}
                style={{ background: stat.gradient }}
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
                <span className="relative text-[15px] font-bold text-white/95 drop-shadow-sm">
                  {stat.label}:
                </span>
                <span className="relative">
                  <span className="block text-[54px] leading-none font-extrabold text-white tabular-nums drop-shadow">
                    {stat.count}
                  </span>
                  <span className="mt-1.5 block text-[11px] font-medium leading-snug text-white/85">
                    {stat.caption}
                  </span>
                </span>
                {selected && (
                  <span className="relative self-start rounded-full bg-black/25 px-2 py-0.5 text-[10px] font-semibold text-white backdrop-blur">
                    filtrando
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* Indicadores: barrinha que enche em 7s no ativo, ponto nos demais.
          O <button> é só a área de toque (o app impõe 44px de altura mínima
          no mobile); quem desenha o traço é o <span> centralizado dentro. */}
      <div className="flex items-center gap-1.5 px-1">
        {stats.map((stat, i) => (
          <button
            key={stat.key}
            type="button"
            aria-label={`Ver métrica ${stat.label}`}
            aria-current={i === index}
            onClick={() => go(i)}
            className="flex h-8 items-center py-3"
          >
            <span
              className={cn(
                "block h-1 overflow-hidden rounded-full transition-all duration-300",
                i === index ? "w-7 bg-foreground/30" : "w-1.5 bg-foreground/20 hover:bg-foreground/40",
              )}
            >
              {i === index && !paused && !reduceMotion && (
                <span
                  key={`${index}-${tick}`}
                  className="block h-full rounded-full bg-foreground"
                  style={{ animation: `atendimento-tick ${ROTATION_MS}ms linear forwards` }}
                />
              )}
            </span>
          </button>
        ))}
        <span className="ml-auto text-[10px] font-medium text-muted-foreground">
          {paused ? "pausado" : "troca a cada 7s"}
        </span>
      </div>
    </div>
  );
}
