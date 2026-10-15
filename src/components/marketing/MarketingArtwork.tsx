import { useEffect, useId, useRef, useState, type CSSProperties } from "react";

/**
 * Glass objects, each used in exactly one place:
 * lens → overview hero, prism → brand notebook, orb → Lume generating, ring → empty calendar.
 * Colours come from `--g-*` tokens in marketing.css, so `tone="auto"` follows the theme and
 * `tone="dark"` stays dark glass (for objects sitting on a dark surface in any theme).
 * Only the wrapper is animated (composited transform); the SVG never repaints per frame.
 */
export type MarketingArtKind = "lens" | "prism" | "orb" | "ring";

const stop = (offset: number, token: string, opacity = 1) => (
  <stop
    offset={offset}
    style={{ stopColor: `var(${token})`, stopOpacity: opacity } as CSSProperties}
  />
);

export function MarketingArtwork({
  kind,
  tone = "auto",
  className = "",
}: {
  kind: MarketingArtKind;
  tone?: "auto" | "dark";
  className?: string;
}) {
  const id = useId().replace(/:/g, "");
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    if (!ref.current || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting), {
      rootMargin: "60px",
    });
    observer.observe(ref.current);
    return () => observer.disconnect();
  }, []);
  const u = (name: string) => `url(#${id}-${name})`;
  const n = (name: string) => `${id}-${name}`;
  return (
    <div
      ref={ref}
      className={`mkt-art mkt-art-${kind} ${className}`}
      data-tone={tone}
      data-visible={visible}
      aria-hidden="true"
    >
      <div className="mkt-art-float">
        <svg className="mkt-glass" viewBox="0 0 400 400" fill="none" focusable="false">
          <defs>
            <filter id={n("soft")} x="-30%" y="-30%" width="160%" height="160%">
              <feGaussianBlur stdDeviation="9" />
            </filter>
            <filter id={n("blur")} x="-30%" y="-30%" width="160%" height="160%">
              <feGaussianBlur stdDeviation="3.2" />
            </filter>
            <filter id={n("hair")} x="-30%" y="-30%" width="160%" height="160%">
              <feGaussianBlur stdDeviation="1.1" />
            </filter>
            <radialGradient id={n("floor")}>
              {stop(0, "--g-glow", 0.55)}
              {stop(0.55, "--g-glow", 0.16)}
              {stop(1, "--g-glow", 0)}
            </radialGradient>
            <linearGradient id={n("rim")} x1="0" y1="0" x2="1" y2="1">
              {stop(0, "--g-hi", 0.95)}
              {stop(0.22, "--g-rim", 0.55)}
              {stop(0.5, "--g-rim", 0.06)}
              {stop(0.78, "--g-cool", 0.35)}
              {stop(1, "--g-hi", 0.7)}
            </linearGradient>
          </defs>
          <ellipse
            cx="200"
            cy="362"
            rx={kind === "ring" ? 150 : 118}
            ry="17"
            fill={u("floor")}
            filter={u("soft")}
          />
          {kind === "lens" && <Lens u={u} n={n} />}
          {kind === "prism" && <Prism u={u} n={n} />}
          {kind === "orb" && <Orb u={u} n={n} />}
          {kind === "ring" && <Ring u={u} n={n} />}
        </svg>
      </div>
    </div>
  );
}

type Paint = { u: (name: string) => string; n: (name: string) => string };

/** A thick liquid-glass capsule lying on a diagonal, refracting a band of light. */
function Lens({ u, n }: Paint) {
  return (
    <g transform="rotate(-28 200 196)">
      <defs>
        <linearGradient id={n("lens-body")} x1="0" y1="0" x2="0.35" y2="1">
          {stop(0, "--g-body-a", 0.92)}
          {stop(0.42, "--g-body-b", 0.86)}
          {stop(1, "--g-body-c", 0.96)}
        </linearGradient>
        <radialGradient id={n("lens-light")} cx="0.5" cy="0.5" r="0.5">
          {stop(0, "--g-glow", 0.95)}
          {stop(0.6, "--g-glow", 0.28)}
          {stop(1, "--g-glow", 0)}
        </radialGradient>
        <linearGradient id={n("lens-band")} x1="0" y1="0" x2="1" y2="0">
          {stop(0, "--g-body-c", 0)}
          {stop(0.5, "--g-body-c", 0.95)}
          {stop(1, "--g-body-c", 0)}
        </linearGradient>
        <clipPath id={n("lens-clip")}>
          <rect x="128" y="46" width="144" height="300" rx="72" />
        </clipPath>
      </defs>
      <rect x="128" y="46" width="144" height="300" rx="72" fill={u("lens-body")} />
      <g clipPath={u("lens-clip")}>
        <ellipse cx="226" cy="268" rx="78" ry="104" fill={u("lens-light")} filter={u("soft")} />
        <ellipse
          cx="164"
          cy="104"
          rx="52"
          ry="40"
          fill={u("lens-light")}
          opacity=".45"
          filter={u("soft")}
        />
        <path
          d="M96 236C150 214 190 252 238 222S300 176 316 186"
          stroke={u("lens-band")}
          strokeWidth="34"
          filter={u("blur")}
        />
        <path
          d="M120 258C168 240 204 272 246 246S292 214 306 220"
          stroke="var(--g-hi)"
          strokeOpacity=".5"
          strokeWidth="1.6"
          filter={u("hair")}
        />
        <path
          d="M132 160C170 150 206 170 240 152"
          stroke="var(--g-cool)"
          strokeOpacity=".28"
          strokeWidth="10"
          filter={u("blur")}
        />
      </g>
      <rect
        x="141"
        y="59"
        width="118"
        height="274"
        rx="59"
        stroke="var(--g-hi)"
        strokeOpacity=".12"
        strokeWidth="1.4"
      />
      <rect x="128" y="46" width="144" height="300" rx="72" stroke={u("rim")} strokeWidth="2.4" />
      <path
        d="M146 128C140 160 140 228 146 262"
        stroke="var(--g-hi)"
        strokeOpacity=".75"
        strokeWidth="5"
        strokeLinecap="round"
        filter={u("hair")}
      />
      <path
        d="M156 76C172 62 196 56 220 60"
        stroke="var(--g-hi)"
        strokeOpacity=".85"
        strokeWidth="3"
        strokeLinecap="round"
        filter={u("hair")}
      />
      <ellipse
        cx="172"
        cy="90"
        rx="13"
        ry="5"
        transform="rotate(-24 172 90)"
        fill="var(--g-hi)"
        opacity=".9"
        filter={u("hair")}
      />
      <path
        d="M258 300C250 318 236 330 216 336"
        stroke="var(--g-rim)"
        strokeOpacity=".7"
        strokeWidth="2"
        strokeLinecap="round"
        filter={u("hair")}
      />
    </g>
  );
}

/** A cut gem: plum facets, hairline edges and a cool, low-saturation dispersion facet. */
function Prism({ u, n }: Paint) {
  const top = "200,52";
  const bottom = "206,338";
  return (
    <g transform="rotate(-8 200 200)">
      <defs>
        <linearGradient id={n("f1")} x1="0" y1="0" x2="1" y2="1">
          {stop(0, "--g-body-a", 0.95)}
          {stop(1, "--g-body-b", 0.95)}
        </linearGradient>
        <linearGradient id={n("f2")} x1="1" y1="0" x2="0" y2="1">
          {stop(0, "--g-rim", 0.55)}
          {stop(0.45, "--g-body-a", 0.85)}
          {stop(1, "--g-body-c", 0.95)}
        </linearGradient>
        <linearGradient id={n("f3")} x1="0" y1="0" x2="0" y2="1">
          {stop(0, "--g-body-b", 0.95)}
          {stop(1, "--g-body-c", 1)}
        </linearGradient>
        <linearGradient id={n("disp")} x1="0" y1="0" x2="1" y2="0.6">
          {stop(0, "--g-cool", 0.55)}
          {stop(0.5, "--g-glow", 0.7)}
          {stop(1, "--g-rim", 0.25)}
        </linearGradient>
      </defs>
      {/* crown */}
      <polygon points={`${top} 104,168 166,186`} fill={u("f2")} />
      <polygon points={`${top} 166,186 246,184`} fill={u("f1")} />
      <polygon points={`${top} 246,184 302,160`} fill={u("disp")} />
      {/* pavilion */}
      <polygon points={`104,168 166,186 ${bottom}`} fill={u("f3")} />
      <polygon points={`166,186 246,184 ${bottom}`} fill={u("f1")} opacity=".9" />
      <polygon points={`246,184 302,160 ${bottom}`} fill={u("f3")} />
      <polygon
        points={`166,186 246,184 206,250`}
        fill="var(--g-glow)"
        opacity=".22"
        filter={u("blur")}
      />
      <ellipse
        cx="226"
        cy="236"
        rx="40"
        ry="58"
        fill="var(--g-glow)"
        opacity=".28"
        filter={u("soft")}
      />
      <g stroke="var(--g-hi)" strokeLinejoin="round" fill="none">
        <path d={`M${top}L104 168L${bottom}L302 160Z`} strokeOpacity=".42" strokeWidth="1.4" />
        <path d={`M104 168L166 186L246 184L302 160`} strokeOpacity=".38" strokeWidth="1.1" />
        <path
          d={`M200 52L166 186L206 338M200 52L246 184L206 338`}
          strokeOpacity=".22"
          strokeWidth="1"
        />
      </g>
      <path
        d="M196 60L110 166"
        stroke="var(--g-hi)"
        strokeOpacity=".9"
        strokeWidth="3"
        strokeLinecap="round"
        filter={u("hair")}
      />
      <path
        d="M206 62L242 176"
        stroke="var(--g-hi)"
        strokeOpacity=".5"
        strokeWidth="2"
        strokeLinecap="round"
        filter={u("hair")}
      />
      <ellipse
        cx="190"
        cy="92"
        rx="10"
        ry="4"
        transform="rotate(-50 190 92)"
        fill="var(--g-hi)"
        filter={u("hair")}
      />
    </g>
  );
}

/** A glass sphere with a slow inner current; the current is the only animated part. */
function Orb({ u, n }: Paint) {
  return (
    <g>
      <defs>
        <radialGradient id={n("orb-body")} cx="0.62" cy="0.7" r="0.75">
          {stop(0, "--g-body-a", 0.95)}
          {stop(0.55, "--g-body-b", 0.95)}
          {stop(1, "--g-body-c", 1)}
        </radialGradient>
        <radialGradient id={n("orb-fresnel")} cx="0.5" cy="0.5" r="0.5">
          {stop(0.78, "--g-hi", 0)}
          {stop(0.96, "--g-hi", 0.16)}
          {stop(1, "--g-hi", 0.32)}
        </radialGradient>
        <linearGradient id={n("orb-current")} x1="0" y1="0" x2="1" y2="1">
          {stop(0, "--g-cool", 0.75)}
          {stop(0.5, "--g-glow", 0.9)}
          {stop(1, "--g-rim", 0.2)}
        </linearGradient>
        <clipPath id={n("orb-clip")}>
          <circle cx="200" cy="192" r="132" />
        </clipPath>
      </defs>
      <circle cx="200" cy="192" r="132" fill={u("orb-body")} />
      <g clipPath={u("orb-clip")}>
        <g className="mkt-orb-current">
          <path
            d="M70 236C130 150 210 300 330 168"
            stroke={u("orb-current")}
            strokeWidth="46"
            strokeLinecap="round"
            filter={u("soft")}
          />
          <path
            d="M96 150C160 110 220 210 312 120"
            stroke="var(--g-glow)"
            strokeOpacity=".5"
            strokeWidth="18"
            strokeLinecap="round"
            filter={u("blur")}
          />
        </g>
        <ellipse
          cx="214"
          cy="300"
          rx="96"
          ry="34"
          fill="var(--g-glow)"
          opacity=".45"
          filter={u("soft")}
        />
      </g>
      <circle cx="200" cy="192" r="132" fill={u("orb-fresnel")} />
      <circle cx="200" cy="192" r="131" stroke={u("rim")} strokeWidth="2" />
      <path
        d="M110 120C130 90 162 72 196 68"
        stroke="var(--g-hi)"
        strokeOpacity=".85"
        strokeWidth="5"
        strokeLinecap="round"
        filter={u("hair")}
      />
      <ellipse
        cx="140"
        cy="118"
        rx="22"
        ry="9"
        transform="rotate(-38 140 118)"
        fill="var(--g-hi)"
        opacity=".85"
        filter={u("blur")}
      />
      <path
        d="M276 278C258 300 232 314 204 318"
        stroke="var(--g-rim)"
        strokeOpacity=".7"
        strokeWidth="2.4"
        strokeLinecap="round"
        filter={u("hair")}
      />
    </g>
  );
}

/** A tilted glass torus: lit inner wall, rim highlights, soft caustic under it. */
function Ring({ u, n }: Paint) {
  return (
    <g transform="rotate(-10 200 210)">
      <defs>
        <linearGradient id={n("ring-body")} x1="0" y1="0" x2="0" y2="1">
          {stop(0, "--g-body-a", 0.95)}
          {stop(0.5, "--g-body-b", 0.95)}
          {stop(1, "--g-body-c", 1)}
        </linearGradient>
        <linearGradient id={n("ring-wall")} x1="0" y1="0" x2="0" y2="1">
          {stop(0, "--g-glow", 0)}
          {stop(1, "--g-glow", 0.85)}
        </linearGradient>
        <mask id={n("ring-mask")}>
          <ellipse cx="200" cy="206" rx="156" ry="86" fill="#fff" />
          <ellipse cx="200" cy="194" rx="86" ry="36" fill="#000" />
        </mask>
        <clipPath id={n("ring-hole")}>
          <ellipse cx="200" cy="194" rx="86" ry="36" />
        </clipPath>
      </defs>
      <g mask={u("ring-mask")}>
        <ellipse cx="200" cy="206" rx="156" ry="86" fill={u("ring-body")} />
        <ellipse
          cx="200"
          cy="262"
          rx="120"
          ry="30"
          fill="var(--g-glow)"
          opacity=".38"
          filter={u("soft")}
        />
        <ellipse
          cx="200"
          cy="150"
          rx="110"
          ry="16"
          fill="var(--g-cool)"
          opacity=".22"
          filter={u("blur")}
        />
      </g>
      <g clipPath={u("ring-hole")}>
        <ellipse cx="200" cy="216" rx="90" ry="34" fill={u("ring-wall")} filter={u("blur")} />
      </g>
      <ellipse cx="200" cy="206" rx="156" ry="86" stroke={u("rim")} strokeWidth="2" />
      <ellipse
        cx="200"
        cy="194"
        rx="86"
        ry="36"
        stroke="var(--g-hi)"
        strokeOpacity=".28"
        strokeWidth="1.2"
      />
      <path
        d="M66 176C96 138 150 120 204 120"
        stroke="var(--g-hi)"
        strokeOpacity=".85"
        strokeWidth="4"
        strokeLinecap="round"
        filter={u("hair")}
      />
      <path
        d="M140 226C172 236 230 236 262 224"
        stroke="var(--g-hi)"
        strokeOpacity=".45"
        strokeWidth="2"
        strokeLinecap="round"
        filter={u("hair")}
      />
      <ellipse
        cx="104"
        cy="152"
        rx="16"
        ry="5"
        transform="rotate(-28 104 152)"
        fill="var(--g-hi)"
        opacity=".85"
        filter={u("hair")}
      />
    </g>
  );
}
