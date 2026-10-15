import { useId } from "react";

/**
 * Escultura de vidro da Agenda — mesma linguagem óptica do Marketing (vidro escuro,
 * aro lilás, reflexos brancos): um anel inclinado com duas órbitas de luz e uma esfera
 * percorrendo a órbita, como o tempo girando. Só o invólucro anima (transform), o SVG
 * não repinta a cada quadro; com movimento reduzido, fica parada.
 */
export function AgendaArtwork({ className = "" }: { className?: string }) {
  const id = useId().replace(/:/g, "");
  const n = (name: string) => `${id}-${name}`;
  const u = (name: string) => `url(#${n(name)})`;
  return (
    <div className={`ag-art ${className}`} aria-hidden="true">
      <div className="ag-art-float">
        <svg viewBox="0 0 520 420" fill="none" focusable="false">
          <defs>
            <filter id={n("soft")} x="-40%" y="-40%" width="180%" height="180%">
              <feGaussianBlur stdDeviation="14" />
            </filter>
            <filter id={n("blur")} x="-30%" y="-30%" width="160%" height="160%">
              <feGaussianBlur stdDeviation="4" />
            </filter>
            <filter id={n("hair")} x="-30%" y="-30%" width="160%" height="160%">
              <feGaussianBlur stdDeviation="1.2" />
            </filter>
            <radialGradient id={n("aura")} cx="0.5" cy="0.5" r="0.5">
              <stop offset="0" stopColor="#7b5cff" stopOpacity="0.42" />
              <stop offset="0.55" stopColor="#4652f2" stopOpacity="0.12" />
              <stop offset="1" stopColor="#4652f2" stopOpacity="0" />
            </radialGradient>
            <linearGradient id={n("body")} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="#3a2470" stopOpacity="0.96" />
              <stop offset="0.5" stopColor="#170e2c" stopOpacity="0.96" />
              <stop offset="1" stopColor="#06040b" />
            </linearGradient>
            <linearGradient id={n("rim")} x1="0" y1="0" x2="1" y2="1">
              <stop offset="0" stopColor="#ffffff" stopOpacity="0.95" />
              <stop offset="0.35" stopColor="#dcc6ff" stopOpacity="0.55" />
              <stop offset="0.7" stopColor="#7d8cff" stopOpacity="0.25" />
              <stop offset="1" stopColor="#dcc6ff" stopOpacity="0.7" />
            </linearGradient>
            <linearGradient id={n("wall")} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="#a463ff" stopOpacity="0" />
              <stop offset="1" stopColor="#a463ff" stopOpacity="0.85" />
            </linearGradient>
            <linearGradient id={n("orbit")} x1="0" y1="0" x2="1" y2="0">
              <stop offset="0" stopColor="#7d8cff" stopOpacity="0" />
              <stop offset="0.3" stopColor="#b9a6ff" stopOpacity="0.9" />
              <stop offset="0.55" stopColor="#ffffff" stopOpacity="0.95" />
              <stop offset="0.8" stopColor="#a463ff" stopOpacity="0.7" />
              <stop offset="1" stopColor="#a463ff" stopOpacity="0" />
            </linearGradient>
            <radialGradient id={n("pearl")} cx="0.35" cy="0.3" r="0.75">
              <stop offset="0" stopColor="#ffffff" />
              <stop offset="0.25" stopColor="#dcc6ff" />
              <stop offset="0.65" stopColor="#6b4fd0" />
              <stop offset="1" stopColor="#1b1035" />
            </radialGradient>
            <mask id={n("ring-mask")}>
              <ellipse cx="260" cy="216" rx="170" ry="92" fill="#fff" />
              <ellipse cx="260" cy="204" rx="94" ry="38" fill="#000" />
            </mask>
            <clipPath id={n("hole")}>
              <ellipse cx="260" cy="204" rx="94" ry="38" />
            </clipPath>
          </defs>

          {/* Aura atrás do vidro. */}
          <ellipse cx="260" cy="210" rx="250" ry="190" fill={u("aura")} />

          {/* Órbita de trás (passa atrás do anel). */}
          <g transform="rotate(-14 260 210)">
            <ellipse
              cx="260"
              cy="210"
              rx="236"
              ry="70"
              stroke={u("orbit")}
              strokeOpacity="0.35"
              strokeWidth="1.2"
            />
          </g>

          {/* Anel de vidro. */}
          <g transform="rotate(-10 260 210)">
            <g mask={u("ring-mask")}>
              <ellipse cx="260" cy="216" rx="170" ry="92" fill={u("body")} />
              <ellipse
                cx="260"
                cy="276"
                rx="132"
                ry="32"
                fill="#a463ff"
                opacity=".34"
                filter={u("soft")}
              />
              <ellipse
                cx="260"
                cy="156"
                rx="120"
                ry="16"
                fill="#7d8cff"
                opacity=".22"
                filter={u("blur")}
              />
            </g>
            <g clipPath={u("hole")}>
              <ellipse cx="260" cy="226" rx="98" ry="36" fill={u("wall")} filter={u("blur")} />
            </g>
            <ellipse cx="260" cy="216" rx="170" ry="92" stroke={u("rim")} strokeWidth="2" />
            <ellipse
              cx="260"
              cy="204"
              rx="94"
              ry="38"
              stroke="#ffffff"
              strokeOpacity=".26"
              strokeWidth="1.2"
            />
            <path
              d="M116 184C148 142 206 124 264 124"
              stroke="#ffffff"
              strokeOpacity=".85"
              strokeWidth="4"
              strokeLinecap="round"
              filter={u("hair")}
            />
            <path
              d="M196 238C230 249 292 249 326 236"
              stroke="#ffffff"
              strokeOpacity=".4"
              strokeWidth="2"
              strokeLinecap="round"
              filter={u("hair")}
            />
            <ellipse
              cx="156"
              cy="158"
              rx="17"
              ry="5"
              transform="rotate(-28 156 158)"
              fill="#ffffff"
              opacity=".85"
              filter={u("hair")}
            />
          </g>

          {/* Órbita da frente: meia elipse que cruza na frente do anel. */}
          <g transform="rotate(-14 260 210)">
            <path
              d="M24 210A236 70 0 0 0 496 210"
              stroke={u("orbit")}
              strokeWidth="1.6"
              strokeLinecap="round"
            />
            <path
              d="M58 236A208 58 0 0 0 470 222"
              stroke={u("orbit")}
              strokeOpacity="0.45"
              strokeWidth="1"
              strokeLinecap="round"
            />
          </g>

          {/* Esfera de vidro sobre a órbita. */}
          <g className="ag-art-pearl">
            <circle cx="420" cy="225" r="30" fill="#7b5cff" opacity=".35" filter={u("soft")} />
            <circle cx="420" cy="225" r="17" fill={u("pearl")} />
            <circle cx="420" cy="225" r="17" stroke="#ffffff" strokeOpacity=".35" strokeWidth="1" />
            <ellipse
              cx="414"
              cy="218"
              rx="6"
              ry="3.4"
              transform="rotate(-30 414 218)"
              fill="#ffffff"
              opacity=".9"
            />
          </g>
        </svg>
      </div>
    </div>
  );
}
