import { cn } from "@/lib/utils";
import { useState } from "react";
import { ChartExplorer } from "./ChartExplorer";
import type { ChartContext } from "@/lib/dashboard-analysis";

/** Dense charts are mounted only when requested, keeping the overview lightweight. */
export function ChartDetails({ title, children }: { title: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <details className="dash-details" onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary>{title}</summary>
      {open && children}
    </details>
  );
}

/**
 * Carcaça dos painéis da dashboard.
 *
 * Existe para o layout ser decidido em UM lugar: raio, respiro, hierarquia de
 * título e o lugar da ação do canto. Sem isso cada painel inventa o próprio
 * espaçamento e a grade perde o alinhamento óptico.
 */
export function ChartCard({
  title,
  subtitle,
  action,
  children,
  className,
  delay,
  analysis,
}: {
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  /** Atraso da entrada, para os painéis surgirem em cascata. */
  delay?: string;
  analysis?: ChartContext;
}) {
  return (
    <section
      className={cn(
        "lume-dash-card viz-fade-up flex min-w-0 flex-col rounded-2xl border border-border bg-card p-5 shadow-sm shadow-foreground/5",
        className,
      )}
      style={delay ? { animationDelay: delay } : undefined}
    >
      <header className="mb-4 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="truncate text-sm font-semibold text-foreground">{title}</h2>
          {subtitle && <p className="mt-1 text-xs text-muted-foreground">{subtitle}</p>}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {action}
          <ChartExplorer
            title={title}
            subtitle={subtitle}
            chartClass={className
              ?.split(" ")
              .filter((c) => c.startsWith("dash-"))
              .join(" ")}
            context={analysis}
          >
            {children}
          </ChartExplorer>
        </div>
      </header>
      <div className="min-w-0 flex-1">{children}</div>
    </section>
  );
}

/** Estado vazio. Um gráfico sem dado é pior que nenhum: parece quebrado. */
export function ChartEmpty({ text }: { text: string }) {
  return (
    <div className="flex h-full min-h-[120px] items-center justify-center rounded-xl border border-dashed border-border px-4 text-center text-xs text-muted-foreground">
      {text}
    </div>
  );
}

/** Rótulo com bolinha da cor da série — identidade nunca vem do texto colorido. */
export function SeriesKey({ color, label }: { color: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground">
      <span aria-hidden className="h-2 w-2 shrink-0 rounded-full" style={{ background: color }} />
      {label}
    </span>
  );
}
