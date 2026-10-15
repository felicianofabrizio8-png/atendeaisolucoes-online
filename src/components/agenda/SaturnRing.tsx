import { useId, useMemo } from "react";

/**
 * Anel de Saturno da Agenda: faixas finas concêntricas em roxo da paleta, com a divisão
 * vazia no meio, varrendo o canto do bloco, e algumas estrelas. Fica atrás do conteúdo e
 * some em direção ao texto (máscara no CSS), para se misturar ao fundo do bloco.
 * Sorteio determinístico: o desenho é o mesmo em toda renderização.
 */

const PALETTE = ["#5b3bd0", "#7b5cff", "#9b7bf0", "#b594ff", "#6d45d6", "#dcc6ff"];

function seeded(seed: number) {
  let value = seed;
  return () => {
    value = (value * 16807) % 2147483647;
    return (value - 1) / 2147483646;
  };
}

const CENTER = { x: 780, y: 640 };
const TILT = -14;

export function SaturnRing({ className = "" }: { className?: string }) {
  const id = useId().replace(/:/g, "");
  const { bands, stars, sparkles } = useMemo(() => {
    const random = seeded(7);
    const bands: Array<{ rx: number; ry: number; width: number; color: string; opacity: number }> =
      [];
    let rx = 560;
    while (rx < 860) {
      // Divisão de Cassini: uma faixa vazia entre os dois anéis principais.
      if (rx > 680 && rx < 712) {
        rx += 32;
        continue;
      }
      const width = 0.5 + random() * 2.2;
      bands.push({
        rx,
        ry: rx * 0.34,
        width,
        color: PALETTE[Math.floor(random() * PALETTE.length)],
        opacity: 0.18 + random() * 0.55,
      });
      rx += width + 2.5 + random() * 6;
    }
    const stars = Array.from({ length: 34 }, () => ({
      x: random() * 1000,
      y: random() * 420,
      r: 0.4 + random() * 0.9,
      opacity: 0.15 + random() * 0.45,
    }));
    const sparkles = [
      { x: 742, y: 74, size: 7, delay: 0 },
      { x: 410, y: 128, size: 5, delay: 2.4 },
      { x: 905, y: 210, size: 6, delay: 4.1 },
      { x: 560, y: 300, size: 4, delay: 1.3 },
    ];
    return { bands, stars, sparkles };
  }, []);

  return (
    <div className={`ag-saturn ${className}`} aria-hidden="true">
      <svg
        viewBox="0 0 1000 600"
        preserveAspectRatio="xMaxYMax slice"
        fill="none"
        focusable="false"
      >
        <defs>
          <linearGradient id={`${id}-sheen`} x1="0" y1="0" x2="1" y2="0">
            <stop offset="0" stopColor="#fff" stopOpacity="0" />
            <stop offset="0.45" stopColor="#fff" stopOpacity="0.9" />
            <stop offset="0.7" stopColor="#fff" stopOpacity="0.35" />
            <stop offset="1" stopColor="#fff" stopOpacity="0" />
          </linearGradient>
          <mask id={`${id}-fade`}>
            <rect width="1000" height="600" fill={`url(#${id}-sheen)`} />
          </mask>
          <filter id={`${id}-glow`} x="-10%" y="-10%" width="120%" height="120%">
            <feGaussianBlur stdDeviation="6" />
          </filter>
        </defs>

        {stars.map((star, index) => (
          <circle
            key={index}
            cx={star.x}
            cy={star.y}
            r={star.r}
            fill="#e9e1ff"
            opacity={star.opacity}
          />
        ))}
        {sparkles.map((star) => (
          <path
            key={`${star.x}-${star.y}`}
            className="ag-saturn-sparkle"
            style={{ animationDelay: `${star.delay}s` }}
            d={`M${star.x} ${star.y - star.size} L${star.x + star.size * 0.18} ${star.y - star.size * 0.18} L${star.x + star.size} ${star.y} L${star.x + star.size * 0.18} ${star.y + star.size * 0.18} L${star.x} ${star.y + star.size} L${star.x - star.size * 0.18} ${star.y + star.size * 0.18} L${star.x - star.size} ${star.y} L${star.x - star.size * 0.18} ${star.y - star.size * 0.18}Z`}
            fill="#f3eeff"
          />
        ))}

        <g className="ag-saturn-rings" transform={`rotate(${TILT} ${CENTER.x} ${CENTER.y})`}>
          {/* Brilho difuso por baixo das faixas. */}
          <ellipse
            cx={CENTER.x}
            cy={CENTER.y}
            rx={700}
            ry={238}
            stroke="#7b5cff"
            strokeOpacity="0.22"
            strokeWidth="70"
            filter={`url(#${id}-glow)`}
          />
          {bands.map((band, index) => (
            <ellipse
              key={index}
              cx={CENTER.x}
              cy={CENTER.y}
              rx={band.rx}
              ry={band.ry}
              stroke={band.color}
              strokeOpacity={band.opacity}
              strokeWidth={band.width}
            />
          ))}
          {/* Reflexo: uma faixa clara que só aparece no meio do arco. */}
          <g mask={`url(#${id}-fade)`}>
            <ellipse
              cx={CENTER.x}
              cy={CENTER.y}
              rx={640}
              ry={218}
              stroke="#efe6ff"
              strokeOpacity="0.5"
              strokeWidth="1"
            />
            <ellipse
              cx={CENTER.x}
              cy={CENTER.y}
              rx={770}
              ry={262}
              stroke="#efe6ff"
              strokeOpacity="0.35"
              strokeWidth="0.8"
            />
          </g>
        </g>
      </svg>
    </div>
  );
}
