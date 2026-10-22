import { useCallback, useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import type { ArtLayer, StatSnapshot } from "@/lib/atendimento/stats";

const ROTATION_MS = 7000;

/**
 * Cartão de métricas com artes de luz que se transformam entre os indicadores.
 *
 * Troca de métrica a cada 7s no mesmo cartão. Decisões que valem
 * comentário:
 * - As artes permanecem montadas e só opacidade/escala mudam. Assim a luz
 *   flui entre métricas sem deslocar o cartão nem recalcular layout.
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
      className={cn("at-stat min-w-0 shrink-0 select-none", className)}
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
      <div className="at-stat-surface">
        {/* Todas as artes ficam montadas; só a ativa aparece. A troca é um
            cruzamento lento de opacidade e escala, então a luz "se
            transforma" de uma métrica na outra em vez de piscar. */}
        {stats.map((stat, i) => (
          <StatArt key={stat.key} layers={stat.art} active={i === currentIndex} />
        ))}
        <span aria-hidden="true" className="at-stat-veil" />
        <span aria-hidden="true" className="at-stat-grain" />

        {/* Só o essencial: o nome da fila e o número. A explicação longa
            mora no tooltip — no cartão ela competia com o número. */}
        <button
          type="button"
          onClick={() => onSelect(selected ? null : current.key)}
          title={`${current.caption} — clique para filtrar a fila`}
          aria-pressed={selected}
          className="at-stat-body"
        >
          <span
            key={current.key}
            className="at-stat-main"
            style={
              reduceMotion
                ? undefined
                : { animation: "atendimento-stat-content 420ms cubic-bezier(0.22, 1, 0.36, 1)" }
            }
          >
            <span className="at-stat-label">
              {current.label}
              {selected && <span className="at-stat-filtering">filtrando</span>}
            </span>
            <span className="at-stat-number tabular-nums">{current.count}</span>
          </span>
        </button>

        {/* Régua no topo: o traço ativo enche em 7s e congela no hover. */}
        <div className="at-stat-bars">
          {stats.map((stat, i) => (
            <button
              key={stat.key}
              type="button"
              aria-label={`Ver métrica ${stat.label}`}
              aria-current={i === currentIndex}
              onClick={() => go(i)}
            >
              <span data-on={i === currentIndex || undefined}>
                {i === currentIndex && (
                  <i
                    key={`${currentIndex}-${tick}`}
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

/** Focos de luz desfocados de uma métrica (ver `ArtLayer`). */
function StatArt({ layers, active }: { layers: ArtLayer[]; active: boolean }) {
  return (
    <span aria-hidden="true" className="at-stat-art" data-on={active || undefined}>
      {layers.map((layer, i) => (
        <span
          key={i}
          style={{
            left: `${layer.x}%`,
            top: `${layer.y}%`,
            width: layer.w,
            height: layer.h,
            opacity: layer.opacity,
            filter: `blur(${layer.blur}px)`,
            transform: `translate(-50%, -50%) rotate(${layer.rotate ?? 0}deg)`,
            ...(layer.ring
              ? { border: `${layer.ring}px solid ${layer.color}` }
              : { background: layer.color }),
          }}
        />
      ))}
    </span>
  );
}

/**
 * Versão de celular das métricas: uma faixa de contadores compactos que
 * desliza na horizontal. O cartão giratório ocupava metade da tela e
 * empurrava a lista de conversas para o pé da página; aqui cada métrica
 * custa uma pílula, todas ficam à vista e o toque continua filtrando a fila.
 * As pílulas são neutras, com o ponto de cor da métrica: a arte inteira fica
 * para o cartão grande.
 */
export function StatStrip({
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
  if (stats.length === 0) return null;
  return (
    <div
      role="toolbar"
      aria-label="Filtrar conversas por situação"
      className={cn(
        "at-stat-strip -mx-3 flex gap-2 overflow-x-auto px-3 pb-0.5 scrollbar-none",
        className,
      )}
    >
      {stats.map((stat) => {
        const active = activeKey === stat.key;
        return (
          <button
            key={stat.key}
            type="button"
            aria-pressed={active}
            title={stat.caption}
            onClick={() => onSelect(active ? null : stat.key)}
            className="at-stat-pill"
            style={{ ["--pill-accent" as string]: stat.accent }}
          >
            <i aria-hidden="true" />
            <span className="at-stat-pill-label">{stat.label}</span>
            <span className="at-stat-pill-count">{stat.count}</span>
          </button>
        );
      })}
    </div>
  );
}
