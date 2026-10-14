import { useEffect, useId, useRef, useState } from "react";
import { areaPath, linePath, niceMax, num } from "./primitives";
import type { SerieItem } from "../useDashboardMetrics";

/** One common zero baseline. Native buttons make every interval readable on touch and keyboard. */
export function TimelineChart({
  data,
  kind = "area",
  format = num,
  formatValue = format,
  color = "var(--dash-purple)",
  label,
}: {
  data: SerieItem[];
  kind?: "area" | "bars";
  format?: (n: number) => string;
  formatValue?: (n: number) => string;
  color?: string;
  label: string;
}) {
  const id = useId().replace(/:/g, "");
  const host = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(600);
  useEffect(() => {
    const element = host.current;
    if (!element || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry.contentRect.width > 0) setWidth(entry.contentRect.width);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const [selected, setSelected] = useState<number | null>(null);
  const index = selected === null ? null : Math.min(selected, data.length - 1);
  const value = index === null ? null : data[index];
  const ceiling = niceMax(Math.max(0, ...data.map((d) => d.value)));
  const max = kind === "bars" ? Math.max(2, Math.ceil(ceiling / 2) * 2) : ceiling;
  const bottom = 178,
    top = 16,
    left = 56,
    right = width - 12;
  const step = (right - left) / Math.max(data.length, 1);
  const points = data.map((d, i) => ({
    x: left + step * (i + 0.5),
    y: bottom - (d.value / max) * (bottom - top),
  }));
  return (
    <div ref={host}>
      <div className="mb-2 flex min-h-7 items-baseline justify-between gap-3 text-xs">
        <span className="text-muted-foreground">
          {value?.fullLabel ?? "Selecione um ponto para ver o valor"}
        </span>
        <strong className="shrink-0 tabular-nums text-foreground">
          {value ? formatValue(value.value) : ""}
        </strong>
      </div>
      <div className="relative">
        <svg
          viewBox={`0 0 ${width} 208`}
          className="h-[208px] w-full overflow-visible"
          aria-hidden="true"
        >
          <defs>
            <linearGradient id={id + "-line"} x1="0" y1="0" x2="1" y2="0">
              <stop stopColor="var(--dash-revenue-start, var(--dash-blue))" />
              <stop offset="45%" stopColor={color} />
              <stop offset="100%" stopColor="var(--dash-revenue-end, var(--dash-lilac))" />
            </linearGradient>
            <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity={kind === "bars" ? ".95" : ".5"} />
              <stop offset="100%" stopColor={color} stopOpacity={kind === "bars" ? ".4" : "0"} />
            </linearGradient>
          </defs>
          {[0, 0.5, 1].map((f) => (
            <g key={f}>
              <line
                x1={left}
                x2={right}
                y1={bottom - f * (bottom - top)}
                y2={bottom - f * (bottom - top)}
                stroke="var(--border)"
                strokeDasharray={f ? "3 6" : undefined}
              />
              <text
                x={left - 9}
                y={bottom - f * (bottom - top) + 3}
                textAnchor="end"
                fill="var(--muted-foreground)"
                fontSize="10"
              >
                {format(max * f)}
              </text>
            </g>
          ))}
          {kind === "area" ? (
            <>
              <path d={areaPath(points, bottom)} fill={`url(#${id})`} />
              <path
                d={linePath(points)}
                fill="none"
                stroke={`url(#${id}-line)`}
                strokeWidth="12"
                opacity=".09"
                strokeLinecap="round"
              />
              <path
                d={linePath(points)}
                fill="none"
                stroke={`url(#${id}-line)`}
                strokeWidth="3"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              {points.map((p, i) => (
                <g key={i}>
                  {i === index && (
                    <line
                      x1={p.x}
                      x2={p.x}
                      y1={top}
                      y2={bottom}
                      stroke={color}
                      strokeOpacity=".3"
                      strokeDasharray="3 4"
                    />
                  )}
                  {i === index && <circle cx={p.x} cy={p.y} r="10" fill={color} opacity=".18" />}
                  <circle
                    cx={p.x}
                    cy={p.y}
                    r={i === index ? 5 : 3}
                    fill={i === index ? "var(--foreground)" : color}
                    stroke="var(--card)"
                    strokeWidth="2"
                  />
                </g>
              ))}
              {index !== null && value && points[index] && (
                <g>
                  <rect
                    x={Math.max(left, Math.min(right - 104, points[index].x - 52))}
                    y={Math.max(0, points[index].y - 35)}
                    width="104"
                    height="23"
                    rx="11.5"
                    fill={color}
                  />
                  <text
                    x={Math.max(left, Math.min(right - 104, points[index].x - 52)) + 52}
                    y={Math.max(0, points[index].y - 35) + 15}
                    textAnchor="middle"
                    fill="var(--dash-tooltip-text)"
                    fontSize="10"
                    fontWeight="600"
                  >
                    {formatValue(value.value)}
                  </text>
                </g>
              )}
            </>
          ) : (
            points.map((p, i) => (
              <g key={i}>
                <rect
                  x={p.x - step * 0.27}
                  y={top}
                  width={step * 0.54}
                  height={bottom - top}
                  rx={Math.min(step * 0.27, 14)}
                  fill="var(--dash-track)"
                  opacity=".5"
                />
                {data[i].value > 0 && (
                  <rect
                    x={p.x - step * 0.27}
                    y={p.y}
                    width={step * 0.54}
                    height={bottom - p.y}
                    rx={Math.min(step * 0.27, 14, (bottom - p.y) / 2)}
                    fill={i === index ? color : `url(#${id})`}
                  />
                )}
              </g>
            ))
          )}
          {points.map((p, i) => (
            <text
              key={i}
              x={p.x}
              y="199"
              textAnchor="middle"
              fill="var(--muted-foreground)"
              fontSize="10"
            >
              {data[i].label}
            </text>
          ))}
        </svg>
        <div
          className="absolute bottom-0 top-0 flex"
          style={{ left, right: 12 }}
          role="group"
          aria-label={label}
        >
          {data.map((d, i) => (
            <button
              type="button"
              key={d.fullLabel + i}
              className="min-w-0 flex-1 rounded-xl focus-visible:bg-foreground/5"
              aria-label={`${d.fullLabel}: ${formatValue(d.value)}`}
              aria-pressed={index === i}
              onMouseEnter={() => setSelected(i)}
              onFocus={() => setSelected(i)}
              onClick={() => setSelected(i)}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
