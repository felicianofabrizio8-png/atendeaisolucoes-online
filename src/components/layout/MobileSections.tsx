import { createContext, useContext, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Seções por aba — só no mobile.
 *
 * Páginas de painel (dashboard, relatórios, IA…) no desktop mostram tudo de
 * uma vez em grid. No celular isso vira um rolo de 5.000px: o usuário perde
 * o contexto e não acha o que procura. Aqui a mesma página ganha uma barra
 * de abas fixa no topo e só a seção escolhida aparece.
 *
 * Nada é renderizado em dobro: `<MobileSection>` é um wrapper com
 * `display: contents` no desktop (os filhos continuam no grid do pai, como
 * antes) e `display: none` no mobile quando a aba não está ativa. O CSS mora
 * em styles.css (`.m-section`).
 */

export interface MobileSectionTab {
  id: string;
  label: string;
  icon?: LucideIcon;
}

const ActiveSection = createContext<string | null>(null);

export function MobileSections({
  tabs,
  children,
  defaultTab,
  className,
  label = "Seções",
}: {
  tabs: MobileSectionTab[];
  children: ReactNode;
  defaultTab?: string;
  className?: string;
  label?: string;
}) {
  const [active, setActive] = useState(defaultTab ?? tabs[0]?.id ?? "");
  const barRef = useRef<HTMLDivElement>(null);

  const select = (id: string) => {
    setActive(id);
    // Ao trocar de aba, volta o conteúdo para logo abaixo da barra — sem
    // isso a nova seção abriria no meio, onde a anterior estava rolada.
    const bar = barRef.current;
    if (!bar) return;
    const scroller = findScrollParent(bar);
    const top = bar.getBoundingClientRect().top;
    const scrollerTop = scroller ? scroller.getBoundingClientRect().top : 0;
    if (top <= scrollerTop + 1 && scroller) {
      scroller.scrollTo?.({ top: scroller.scrollTop + (top - scrollerTop) - 1, behavior: "auto" });
    }
  };

  return (
    <ActiveSection.Provider value={active}>
      <div
        ref={barRef}
        className={cn(
          "md:hidden sticky top-0 z-30 -mx-4 mb-4 bg-background/85 px-4 py-2 backdrop-blur-xl supports-[backdrop-filter]:bg-background/70",
          className,
        )}
      >
        <SegmentedTabs tabs={tabs} value={active} onChange={select} label={label} />
      </div>
      {children}
    </ActiveSection.Provider>
  );
}

export function MobileSection({ id, children }: { id: string; children: ReactNode }) {
  const active = useContext(ActiveSection);
  return (
    <div className="m-section" data-section={id} data-active={active === null || active === id}>
      {children}
    </div>
  );
}

/**
 * Abas segmentadas com pastilha deslizante.
 *
 * A pastilha é medida a partir do botão ativo (posição e largura reais), então
 * funciona com rótulos de tamanhos diferentes e quando a barra rola na
 * horizontal. Move só com `transform` + `width` numa transição curta.
 */
export function SegmentedTabs({
  tabs,
  value,
  onChange,
  label,
  className,
}: {
  tabs: MobileSectionTab[];
  value: string;
  onChange: (id: string) => void;
  label?: string;
  className?: string;
}) {
  const listRef = useRef<HTMLDivElement>(null);
  const [pill, setPill] = useState<{ x: number; w: number } | null>(null);

  const measure = () => {
    const list = listRef.current;
    const el = list?.querySelector<HTMLButtonElement>(`[data-tab="${CSS.escape(value)}"]`);
    if (!list || !el) return;
    setPill({ x: el.offsetLeft, w: el.offsetWidth });
    // Mantém a aba ativa visível quando há mais abas do que largura.
    const left = el.offsetLeft - 16;
    const right = el.offsetLeft + el.offsetWidth + 16 - list.clientWidth;
    // scrollTo opcional: navegadores antigos (e o jsdom) não têm em elementos.
    if (left < list.scrollLeft) list.scrollTo?.({ left, behavior: "smooth" });
    else if (right > list.scrollLeft) list.scrollTo?.({ left: right, behavior: "smooth" });
  };

  useIsoLayoutEffect(measure, [value, tabs.length]);
  useEffect(() => {
    const list = listRef.current;
    if (!list || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => measure());
    ro.observe(list);
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  return (
    <div
      ref={listRef}
      role="tablist"
      aria-label={label}
      className={cn(
        // Largura pelo conteúdo: abas curtas ("IA") não ficam isoladas num
        // pedaço enorme de barra; muitas abas rolam na horizontal.
        "relative flex w-fit max-w-full gap-0.5 overflow-x-auto rounded-full bg-secondary/80 p-1 scrollbar-none",
        className,
      )}
    >
      {pill ? (
        <span
          aria-hidden
          className="segmented-pill pointer-events-none absolute inset-y-1 left-0 rounded-full bg-background shadow-sm"
          style={{ width: pill.w, transform: `translate3d(${pill.x}px,0,0)` }}
        />
      ) : null}
      {tabs.map((t) => {
        const Icon = t.icon;
        const selected = t.id === value;
        return (
          <button
            key={t.id}
            type="button"
            role="tab"
            data-tab={t.id}
            aria-selected={selected}
            onClick={() => onChange(t.id)}
            className={cn(
              "relative z-10 inline-flex min-h-9 shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-full px-4 text-[13px] font-semibold transition-colors",
              selected ? "text-foreground" : "text-muted-foreground",
            )}
            style={{ minHeight: 36 }}
          >
            {Icon ? <Icon className="h-3.5 w-3.5" aria-hidden /> : null}
            {t.label}
          </button>
        );
      })}
    </div>
  );
}

const useIsoLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

function findScrollParent(el: HTMLElement): HTMLElement | null {
  let node = el.parentElement;
  while (node) {
    const { overflowY } = getComputedStyle(node);
    if ((overflowY === "auto" || overflowY === "scroll") && node.scrollHeight > node.clientHeight) {
      return node;
    }
    node = node.parentElement;
  }
  return null;
}
