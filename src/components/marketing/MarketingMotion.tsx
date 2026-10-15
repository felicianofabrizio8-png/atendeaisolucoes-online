import { useEffect, type RefObject } from "react";
import { motion, useReducedMotion, useSpring, useTransform } from "framer-motion";
import { MarketingArtwork } from "./MarketingArtwork";

export const lumeEase = [0.22, 1, 0.36, 1] as const;
export const lumeSpring = { stiffness: 150, damping: 24, mass: 1 };

/** One visibility listener per workspace; decorative loops never run in a hidden tab. */
export function useMarketingAmbient(root: RefObject<HTMLDivElement | null>) {
  useEffect(() => {
    const el = root.current;
    if (!el) return;
    const visibility = () => {
      el.dataset.motionPaused = String(document.hidden);
    };
    visibility();
    document.addEventListener("visibilitychange", visibility);
    let frame = 0;
    let target: HTMLElement | null = null;
    let bounds: DOMRect | null = null;
    const move = (event: PointerEvent) => {
      if (event.pointerType !== "mouse" || matchMedia("(prefers-reduced-motion: reduce)").matches)
        return;
      const next = (event.target as Element).closest<HTMLElement>("[data-lume-light]");
      if (next !== target) {
        target = next;
        bounds = next?.getBoundingClientRect() ?? null;
      }
      if (!target || !bounds) return;
      const current = target;
      const x = event.clientX - bounds.left,
        y = event.clientY - bounds.top;
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        current.style.setProperty("--light-x", `${x}px`);
        current.style.setProperty("--light-y", `${y}px`);
      });
    };
    const clear = () => {
      target = null;
      bounds = null;
    };
    el.addEventListener("pointermove", move, { passive: true });
    el.addEventListener("pointerleave", clear);
    window.addEventListener("scroll", clear, { passive: true, capture: true });
    window.addEventListener("resize", clear);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener("visibilitychange", visibility);
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerleave", clear);
      window.removeEventListener("scroll", clear, true);
      window.removeEventListener("resize", clear);
    };
  }, [root]);
}

export function LumeNumber({ value }: { value: number | null }) {
  const reduce = useReducedMotion();
  const spring = useSpring(value ?? 0, lumeSpring);
  const display = useTransform(spring, (n) => Math.round(n).toLocaleString("pt-BR"));
  useEffect(() => {
    if (reduce) spring.jump(value ?? 0);
    else spring.set(value ?? 0);
  }, [value, reduce, spring]);
  if (value === null) return <>—</>;
  return (
    <>
      <span className="sr-only">{value.toLocaleString("pt-BR")}</span>
      <motion.span aria-hidden>{display}</motion.span>
    </>
  );
}

/** Decorative replacement for inline spinners; the adjacent text provides the status. */
export function LumePulse({ className = "" }: { className?: string }) {
  return (
    <span aria-hidden="true" className={`lume-pulse ${className.replace(/animate-spin/g, "")}`}>
      <i />
      <i />
      <i />
    </span>
  );
}

/** Active-item pill shared by every segmented bar; slides between items via layoutId. */
export function PillIndicator({ layoutId }: { layoutId: string }) {
  const reduce = useReducedMotion();
  return (
    <motion.span
      aria-hidden
      className="mkt-pill-indicator"
      layoutId={layoutId}
      transition={
        reduce ? { duration: 0 } : { type: "spring", stiffness: 420, damping: 36, mass: 0.9 }
      }
    />
  );
}

export function LumeThinking({
  label = "A Lume está conectando suas ideias.",
}: {
  label?: string;
}) {
  return (
    <div className="lume-thinking" role="status">
      <MarketingArtwork kind="orb" className="lume-thinking-object" />
      <div>
        <p aria-label={label}>
          {label.split(" ").map((word, index) => (
            <span aria-hidden key={index} style={{ animationDelay: `${index * 65}ms` }}>
              {word}{" "}
            </span>
          ))}
        </p>
        <small>Você poderá revisar tudo antes de continuar.</small>
      </div>
    </div>
  );
}
