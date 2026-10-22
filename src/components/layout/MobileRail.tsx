import {
  Children,
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Carrossel só do mobile, com setas e indicador de página.
 *
 * Abaixo do breakpoint, os filhos viram páginas inteiras (um cartão por vez,
 * sem pedaço do vizinho cortado na borda) que deslizam com o dedo ou pelas
 * setas. Acima dele, o wrapper é o grid de sempre — as classes recebidas em
 * `className` continuam valendo e os controles somem.
 *
 * O CSS do trilho mora em styles.css (`.m-rail` / `.m-rail-sm`).
 */
export function MobileRail({
  children,
  className,
  breakpoint = "md",
  label,
  as: Tag = "div",
}: {
  children: ReactNode;
  className?: string;
  /** "sm": carrossel abaixo de 640px; "md": abaixo de 768px. */
  breakpoint?: "sm" | "md";
  label?: string;
  as?: "div" | "section";
}) {
  const ref = useRef<HTMLElement>(null);
  const count = Children.toArray(children).filter(Boolean).length;
  const [index, setIndex] = useState(0);

  // Página atual pela posição de rolagem — vale para dedo, setas e teclado.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let frame = 0;
    const onScroll = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const first = el.firstElementChild as HTMLElement | null;
        const step = first
          ? first.offsetWidth + parseFloat(getComputedStyle(el).columnGap || "0")
          : el.clientWidth;
        setIndex(Math.max(0, Math.min(count - 1, Math.round(el.scrollLeft / Math.max(1, step)))));
      });
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      cancelAnimationFrame(frame);
      el.removeEventListener("scroll", onScroll);
    };
  }, [count]);

  const go = useCallback((to: number) => {
    const el = ref.current;
    const target = el?.children[to] as HTMLElement | undefined;
    const first = el?.firstElementChild as HTMLElement | null | undefined;
    if (!el || !target || !first) return;
    // Distância até o primeiro cartão = rolagem exata, com ou sem gutter.
    el.scrollTo({ left: target.offsetLeft - first.offsetLeft, behavior: "smooth" });
  }, []);

  const hidden = breakpoint === "sm" ? "sm:hidden" : "md:hidden";

  return (
    <div>
      <Tag
        ref={ref as never}
        aria-label={label}
        className={cn(breakpoint === "sm" ? "m-rail-sm" : "m-rail", className)}
        style={{ "--m-rail-item": "100%", "--m-rail-gap": "32px" } as CSSProperties}
      >
        {children}
      </Tag>
      {count > 1 ? (
        <div className={cn("mt-3 flex items-center justify-between gap-3", hidden)}>
          <button
            type="button"
            aria-label="Anterior"
            onClick={() => go(Math.max(0, index - 1))}
            disabled={index === 0}
            className="m-rail-arrow"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <div className="flex items-center gap-1.5" role="tablist" aria-label="Páginas">
            {Array.from({ length: count }, (_, i) => (
              <button
                key={i}
                type="button"
                role="tab"
                aria-selected={i === index}
                aria-label={`Ir para o cartão ${i + 1}`}
                onClick={() => go(i)}
                className="m-rail-dot"
                data-active={i === index || undefined}
              />
            ))}
          </div>
          <button
            type="button"
            aria-label="Próximo"
            onClick={() => go(Math.min(count - 1, index + 1))}
            disabled={index === count - 1}
            className="m-rail-arrow"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      ) : null}
    </div>
  );
}
