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

/**
 * A thick liquid-glass capsule lying on a diagonal. Realism comes from layering what real
 * glass does: a mostly see-through body, an inverted (refracted) view of the surroundings,
 * a thick edge with internal reflection, a lit bevel, crisp tapered speculars, a faint
 * colour fringe on the rim and light focused into a caustic at the far end.
 */
function Lens({ u, n }: Paint) {
  const capsule = { x: 128, y: 46, width: 144, height: 300, rx: 72 };
  const edge =
    "M200 46a72 72 0 0 1 72 72v156a72 72 0 0 1-144 0V118a72 72 0 0 1 72-72Z" +
    "M200 60a58 58 0 0 0-58 58v156a58 58 0 0 0 116 0V118a58 58 0 0 0-58-58Z";
  return (
    <g transform="rotate(-28 200 196)">
      <defs>
        <linearGradient id={n("lens-body")} x1="0" y1="0" x2="0.3" y2="1">
          {stop(0, "--g-body-a", 0.5)}
          {stop(0.45, "--g-body-b", 0.32)}
          {stop(0.8, "--g-body-a", 0.42)}
          {stop(1, "--g-glow", 0.55)}
        </linearGradient>
        <linearGradient id={n("lens-edge")} x1="0" y1="0" x2="1" y2="0">
          {stop(0, "--g-hi", 0.34)}
          {stop(0.16, "--g-hi", 0.06)}
          {stop(0.5, "--g-body-c", 0.1)}
          {stop(0.84, "--g-glow", 0.28)}
          {stop(1, "--g-rim", 0.5)}
        </linearGradient>
        <linearGradient id={n("lens-streak")} x1="0" y1="0" x2="0" y2="1">
          {stop(0, "--g-hi", 0)}
          {stop(0.25, "--g-hi", 0.95)}
          {stop(0.7, "--g-hi", 0.75)}
          {stop(1, "--g-hi", 0)}
        </linearGradient>
        <linearGradient id={n("lens-outline")} x1="0" y1="0" x2="1" y2="1">
          {stop(0, "--g-hi", 0.9)}
          {stop(0.3, "--g-hi", 0.28)}
          {stop(0.55, "--g-hi", 0.05)}
          {stop(0.85, "--g-rim", 0.55)}
          {stop(1, "--g-hi", 0.8)}
        </linearGradient>
        <radialGradient id={n("lens-caustic")} cx="0.5" cy="0.5" r="0.5">
          {stop(0, "--g-hi", 0.85)}
          {stop(0.18, "--g-rim", 0.75)}
          {stop(0.55, "--g-glow", 0.4)}
          {stop(1, "--g-glow", 0)}
        </radialGradient>
        <radialGradient id={n("lens-behind")} cx="0.5" cy="0.5" r="0.5">
          {stop(0, "--g-glow", 0.6)}
          {stop(1, "--g-glow", 0)}
        </radialGradient>
        <clipPath id={n("lens-clip")}>
          <rect {...capsule} />
        </clipPath>
        {/* Bevel: a blurred copy of the shape lit from the top-left reads as rounded glass. */}
        <filter id={n("lens-bevel")} x="-10%" y="-10%" width="120%" height="120%">
          <feGaussianBlur in="SourceAlpha" stdDeviation="6" result="height" />
          <feSpecularLighting
            in="height"
            surfaceScale="5"
            specularConstant="1.15"
            specularExponent="42"
            lightingColor="#ffffff"
            result="light"
          >
            <feDistantLight azimuth="235" elevation="38" />
          </feSpecularLighting>
          <feComposite in="light" in2="SourceAlpha" operator="in" />
        </filter>
      </defs>

      {/* Light passing through the glass and pooling behind it. */}
      <ellipse cx="214" cy="250" rx="96" ry="120" fill={u("lens-behind")} filter={u("soft")} />

      <rect {...capsule} fill={u("lens-body")} />
      <g clipPath={u("lens-clip")}>
        {/* Refraction flips the surroundings: dark horizon up top, light gathered below. */}
        <ellipse
          cx="196"
          cy="156"
          rx="96"
          ry="42"
          fill="var(--g-body-c)"
          opacity=".55"
          filter={u("soft")}
        />
        <path
          d="M110 214C152 196 196 226 236 206S290 176 300 182"
          stroke="var(--g-glow)"
          strokeOpacity=".45"
          strokeWidth="26"
          filter={u("blur")}
        />
        <ellipse cx="224" cy="292" rx="52" ry="40" fill={u("lens-caustic")} filter={u("blur")} />
        <ellipse
          cx="230"
          cy="300"
          rx="16"
          ry="9"
          fill="var(--g-hi)"
          opacity=".55"
          filter={u("hair")}
        />
        {/* Thick wall: internal reflection keeps the edge brighter than the core. */}
        <path d={edge} fillRule="evenodd" fill={u("lens-edge")} filter={u("hair")} />
        <rect
          x="142"
          y="60"
          width="116"
          height="272"
          rx="58"
          stroke="var(--g-hi)"
          strokeOpacity=".16"
          strokeWidth="1"
        />
        <rect
          {...capsule}
          fill="#ffffff"
          opacity=".38"
          filter={u("lens-bevel")}
          style={{ mixBlendMode: "screen" }}
        />
        {/* Window reflection on the far wall. */}
        <rect
          x="232"
          y="110"
          width="14"
          height="120"
          rx="7"
          fill="var(--g-hi)"
          opacity=".1"
          filter={u("hair")}
        />
      </g>

      {/* Chromatic fringe: the rim splits light slightly into cool and warm edges. */}
      <rect
        {...capsule}
        transform="translate(-1.2 0.6)"
        stroke="var(--g-cool)"
        strokeOpacity=".4"
        strokeWidth="1"
      />
      <rect
        {...capsule}
        transform="translate(1.2 -0.6)"
        stroke="var(--g-rim)"
        strokeOpacity=".35"
        strokeWidth="1"
      />
      <rect {...capsule} stroke={u("lens-outline")} strokeWidth="1.4" />

      {/* Crisp, tapered speculars: long edge streak, cap crescent and a hot spot. */}
      <path d="M151 122C139 164 139 230 151 274C146 230 146 164 156 124Z" fill={u("lens-streak")} />
      <path
        d="M146 98A62 62 0 0 1 230 62A54 54 0 0 0 152 102Z"
        fill="var(--g-hi)"
        opacity=".9"
        filter={u("hair")}
      />
      <ellipse cx="168" cy="86" rx="7" ry="3" transform="rotate(-36 168 86)" fill="var(--g-hi)" />
      <path
        d="M262 300A64 64 0 0 1 186 334"
        stroke="var(--g-rim)"
        strokeOpacity=".85"
        strokeWidth="2.2"
        strokeLinecap="round"
        filter={u("hair")}
      />
      <path
        d="M254 150C258 176 258 214 254 238"
        stroke="var(--g-hi)"
        strokeOpacity=".35"
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
