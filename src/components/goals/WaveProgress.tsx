// src/components/goals/WaveProgress.tsx
import { useEffect, useState, type CSSProperties } from "react";
import type { GoalStatus } from "@/lib/goals/model";
import "./goals.css";

/**
 * Barra de progresso em ondas roxas. Duas ondas SVG deslizam em loop (só
 * transform) dentro de um preenchimento que sobe do 0 ao valor ao montar.
 * Com "reduzir movimento", tudo fica parado (regras em goals.css).
 */
export function WaveProgress({
  pct,
  status,
  label,
  size = "lg",
}: {
  pct: number;
  status: GoalStatus;
  label: string;
  size?: "lg" | "sm";
}) {
  const value = Math.round(Math.max(0, Math.min(100, pct)));
  const [shown, setShown] = useState(0);
  useEffect(() => {
    const frame = requestAnimationFrame(() => setShown(value));
    return () => cancelAnimationFrame(frame);
  }, [value]);

  return (
    <div
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={value}
      aria-valuetext={label}
      data-status={status}
      data-size={size}
      className="gw-bar"
    >
      <div className="gw-fill" style={{ "--gw-pct": `${shown}%` } as CSSProperties}>
        <svg
          className="gw-wave gw-wave-back"
          viewBox="0 0 200 20"
          preserveAspectRatio="none"
          aria-hidden
        >
          <path d="M0 10 Q 25 0 50 10 T 100 10 T 150 10 T 200 10 V 20 H 0 Z" />
        </svg>
        <svg
          className="gw-wave gw-wave-front"
          viewBox="0 0 200 20"
          preserveAspectRatio="none"
          aria-hidden
        >
          <path d="M0 12 Q 25 4 50 12 T 100 12 T 150 12 T 200 12 V 20 H 0 Z" />
        </svg>
      </div>
    </div>
  );
}
