import { useId, useRef, useEffect, useState } from "react";

export type MarketingArtKind =
  | "orbit"
  | "ribbon"
  | "wave"
  | "bloom"
  | "capsule"
  | "prism"
  | "signal";

/** Resolution-independent optical studies. Refraction is an SVG approximation, not WebGL. */
export function MarketingArtwork({ kind = "orbit" }: { kind?: MarketingArtKind }) {
  const id = useId().replace(/:/g, "");
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    if (!ref.current || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting), {
      rootMargin: "40px",
    });
    observer.observe(ref.current);
    return () => observer.disconnect();
  }, []);
  const paint = (name: string) => `url(#${id}-${name})`;
  return (
    <div ref={ref} className={`mkt-art mkt-art-${kind}`} data-visible={visible} aria-hidden="true">
      <svg className="mkt-glass-object" viewBox="0 0 320 320" fill="none" focusable="false">
        <defs>
          <linearGradient
            id={`${id}-edge`}
            x1="48"
            y1="20"
            x2="270"
            y2="290"
            gradientUnits="userSpaceOnUse"
          >
            <stop stopColor="#effcff" />
            <stop offset=".13" stopColor="#6f8dff" />
            <stop offset=".29" stopColor="#6c2bff" />
            <stop offset=".42" stopColor="#180934" />
            <stop offset=".56" stopColor="#ff6ccc" />
            <stop offset=".7" stopColor="#ffdba0" />
            <stop offset=".85" stopColor="#6c2bff" />
            <stop offset="1" stopColor="#c8eaff" />
          </linearGradient>
          <linearGradient
            id={`${id}-body`}
            x1="45"
            y1="20"
            x2="258"
            y2="284"
            gradientUnits="userSpaceOnUse"
          >
            <stop stopColor="#3349ff" stopOpacity=".45" />
            <stop offset=".2" stopColor="#a091ff" stopOpacity=".2" />
            <stop offset=".43" stopColor="#09031c" stopOpacity=".88" />
            <stop offset=".65" stopColor="#4920bd" stopOpacity=".5" />
            <stop offset=".83" stopColor="#ff4a9e" stopOpacity=".5" />
            <stop offset="1" stopColor="#ffbe71" stopOpacity=".2" />
          </linearGradient>
          <linearGradient
            id={`${id}-heat`}
            x1="50"
            y1="0"
            x2="265"
            y2="300"
            gradientUnits="userSpaceOnUse"
          >
            <stop stopColor="#2525ff" />
            <stop offset=".22" stopColor="#6c2bff" />
            <stop offset=".46" stopColor="#ff2daa" />
            <stop offset=".66" stopColor="#ff4a2b" />
            <stop offset=".83" stopColor="#ff8a1f" />
            <stop offset="1" stopColor="#ffd23f" />
          </linearGradient>
          <linearGradient
            id={`${id}-facet`}
            x1="68"
            y1="30"
            x2="270"
            y2="270"
            gradientUnits="userSpaceOnUse"
          >
            <stop stopColor="#a5c4ff" />
            <stop offset=".2" stopColor="#5c39ff" />
            <stop offset=".4" stopColor="#ff76df" />
            <stop offset=".62" stopColor="#ffe393" />
            <stop offset=".8" stopColor="#e5539b" />
            <stop offset="1" stopColor="#2d16a4" />
          </linearGradient>
          <radialGradient id={`${id}-flare`}>
            <stop stopColor="#ffe5f6" />
            <stop offset=".2" stopColor="#bc6cff" stopOpacity=".8" />
            <stop offset=".55" stopColor="#6c2bff" stopOpacity=".45" />
            <stop offset="1" stopColor="#2b2bff" stopOpacity="0" />
          </radialGradient>
          <radialGradient id={`${id}-warm`}>
            <stop stopColor="#ffd23f" />
            <stop offset=".3" stopColor="#ff4a2b" />
            <stop offset=".65" stopColor="#ff2daa" stopOpacity=".7" />
            <stop offset="1" stopColor="#6c2bff" stopOpacity="0" />
          </radialGradient>
          <filter
            id={`${id}-refract`}
            x="-20%"
            y="-20%"
            width="140%"
            height="140%"
            colorInterpolationFilters="sRGB"
          >
            <feTurbulence
              type="fractalNoise"
              baseFrequency=".012 .028"
              numOctaves="1"
              seed="8"
              result="grain"
            />
            <feDisplacementMap
              in="SourceGraphic"
              in2="grain"
              scale="14"
              xChannelSelector="R"
              yChannelSelector="B"
            />
          </filter>
          <clipPath id={`${id}-capsule`}>
            <rect x="94" y="30" width="132" height="250" rx="66" />
          </clipPath>
          <clipPath id={`${id}-signal`}>
            <rect x="57" y="48" width="207" height="207" rx="56" />
          </clipPath>
        </defs>
        <ellipse
          className="lume-object-shadow"
          cx="160"
          cy="288"
          rx="100"
          ry="16"
          fill={paint("flare")}
          opacity=".65"
        />
        <g className="lume-object-float">
          {kind === "capsule" ? (
            <g transform="rotate(35 160 155)">
              <rect
                x="90"
                y="26"
                width="140"
                height="258"
                rx="70"
                fill={paint("body")}
                stroke={paint("edge")}
                strokeWidth="7"
              />
              <g clipPath={paint("capsule")}>
                <g filter={paint("refract")} opacity=".8">
                  <ellipse cx="204" cy="212" rx="64" ry="115" fill={paint("warm")} />
                  <path d="M90 210C220 245 110 60 238 50" stroke={paint("heat")} strokeWidth="39" />
                </g>
                <ellipse cx="130" cy="238" rx="71" ry="50" fill={paint("flare")} />
              </g>
              <rect
                x="97"
                y="33"
                width="126"
                height="244"
                rx="63"
                stroke={paint("edge")}
                strokeWidth="1.5"
              />
              <ellipse
                cx="160"
                cy="157"
                rx="69"
                ry="30"
                fill="#09031a"
                fillOpacity=".24"
                stroke={paint("edge")}
                strokeWidth="5"
              />
              <ellipse cx="160" cy="153" rx="66" ry="28" stroke="#f2d9ff" strokeOpacity=".4" />
              <path
                d="M108 108V88C108 58 131 40 155 39M212 204v18c0 29-20 48-43 50"
                stroke="#edecff"
                strokeOpacity=".8"
                strokeWidth="4"
                strokeLinecap="round"
              />
              <path
                d="M103 188C124 201 140 206 159 204"
                stroke="#ffb3e0"
                strokeOpacity=".7"
                strokeWidth="2"
              />
            </g>
          ) : kind === "signal" ? (
            <g transform="rotate(-13 160 160)">
              <rect
                x="60"
                y="56"
                width="212"
                height="212"
                rx="58"
                fill="#170944"
                stroke={paint("edge")}
                strokeWidth="5"
              />
              <rect
                x="49"
                y="39"
                width="218"
                height="218"
                rx="59"
                fill={paint("body")}
                stroke={paint("edge")}
                strokeWidth="8"
              />
              <g clipPath={paint("signal")}>
                <g filter={paint("refract")}>
                  <ellipse cx="175" cy="213" rx="127" ry="95" fill={paint("flare")} />
                  <path
                    d="M15 190C120 260 193 45 297 91"
                    stroke={paint("heat")}
                    strokeWidth="25"
                    opacity=".45"
                  />
                </g>
              </g>
              <rect
                x="58"
                y="48"
                width="200"
                height="200"
                rx="50"
                stroke={paint("edge")}
                strokeWidth="1.5"
              />
              <path
                d="M89 104V89C89 74 101 66 117 65H191"
                stroke="#e4dcff"
                strokeWidth="3"
                strokeLinecap="round"
              />
              <path
                d="M112 190L157 99Q163 87 170 100L210 184Q215 196 202 197H123Q108 198 112 190Z"
                fill={paint("body")}
                stroke={paint("edge")}
                strokeWidth="5"
              />
              <path d="M124 184L165 106L179 143Z" fill={paint("heat")} fillOpacity=".7" />
              <path
                d="M145 195L195 152M117 186L162 99"
                stroke="#e6c7ff"
                strokeWidth="2"
                strokeOpacity=".75"
              />
            </g>
          ) : kind === "prism" ? (
            <g transform="rotate(-12 160 156)">
              <path
                d="M150 34L246 80L280 173L225 260L124 282L43 208L39 107Z"
                fill={paint("body")}
                stroke={paint("edge")}
                strokeWidth="4"
              />
              <path
                d="M150 34L125 102L39 107ZM246 80L212 128L150 34ZM280 173L212 128L225 260ZM124 282L130 223L43 208Z"
                fill={paint("facet")}
                fillOpacity=".88"
              />
              <path
                d="M39 107L125 102L81 173L43 208ZM150 34L212 128L125 102ZM225 260L130 223L124 282Z"
                fill={paint("edge")}
                fillOpacity=".65"
              />
              <path
                d="M125 102L212 128L216 200L130 223L81 173Z"
                fill={paint("body")}
                stroke={paint("edge")}
                strokeWidth="2"
              />
              <path d="M125 102L212 128L169 163L81 173Z" fill={paint("heat")} opacity=".8" />
              <path d="M169 163L212 128L216 200L130 223Z" fill={paint("facet")} opacity=".55" />
              <path
                d="M39 107L81 173L130 223L225 260M125 102L150 34M212 128L246 80M216 200L280 173"
                stroke="#fff1f9"
                strokeOpacity=".65"
              />
              <path
                d="M49 105L148 43L239 82"
                stroke="#ffeaff"
                strokeWidth="3"
                strokeLinecap="round"
              />
              <ellipse cx="211" cy="222" rx="65" ry="42" fill={paint("flare")} opacity=".55" />
            </g>
          ) : kind === "orbit" ? (
            <g transform="rotate(-25 160 160)">
              {Array.from({ length: 9 }, (_, i) => (
                <ellipse
                  key={i}
                  cx={155 + i * 2}
                  cy={109 + i * 10}
                  rx={87 - i * 1.4}
                  ry={53 - i * 0.7}
                  fill={paint("body")}
                  stroke={paint("edge")}
                  strokeWidth="5"
                  opacity={0.4 + i * 0.065}
                />
              ))}
              <ellipse
                cx="172"
                cy="189"
                rx="48"
                ry="26"
                fill="#080316"
                stroke={paint("heat")}
                strokeWidth="2"
              />
            </g>
          ) : kind === "wave" ? (
            <g transform="rotate(-12 160 160)">
              <path
                d="M48 225C91 244 119 241 161 196S229 101 276 115L266 176C220 162 195 259 138 271S76 263 48 249Z"
                fill={paint("body")}
                stroke={paint("edge")}
                strokeWidth="2"
              />
              {Array.from({ length: 18 }, (_, i) => (
                <path
                  key={i}
                  d={`M${48 + i * 12} 215C${25 + i * 12} 158 ${70 + i * 10} 110 ${51 + i * 12} 59`}
                  stroke={i % 3 === 0 ? paint("edge") : paint("heat")}
                  strokeWidth="9"
                  opacity={0.55 + (i % 3) * 0.2}
                />
              ))}
              <path d="M53 59C106 16 197 116 256 58" stroke={paint("edge")} strokeWidth="2" />
            </g>
          ) : (
            <g transform={`rotate(${kind === "ribbon" ? -14 : 22} 160 160)`}>
              {Array.from({ length: 12 }, (_, i) => (
                <path
                  key={i}
                  d={`M${73 + i * 7} 42C${284 + i * 2} 88 ${-32 + i * 7} 192 ${199 + i * 4} 263L${205 + i * 4} 270C${-14 + i * 7} 191 ${297 + i * 2} 90 ${80 + i * 7} 42Z`}
                  fill={paint(i % 3 === 0 ? "edge" : "heat")}
                  stroke={paint("edge")}
                  strokeWidth=".65"
                  opacity={0.45 + i * 0.045}
                />
              ))}
              <ellipse cx="164" cy="174" rx="52" ry="78" fill={paint("flare")} opacity=".2" />
            </g>
          )}
        </g>
      </svg>
    </div>
  );
}
