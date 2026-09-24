import { cn } from "@/lib/utils";
import { num, pct, stagger, useInView } from "./primitives";

export interface FunnelStage {
  label: string;
  value: number;
  hint?: string;
}

/**
 * Funil comercial em barras proporcionais.
 *
 * Trapézio 3D é bonito e mente: a área do desenho não é proporcional ao
 * número, então etapas parecidas viram degraus dramáticos. Barra horizontal
 * com largura proporcional lê o valor direto.
 *
 * A taxa mostrada entre as etapas é a conversão daquele PASSO, não do topo —
 * é ela que diz onde o dinheiro vaza.
 */
export function FunnelChart({ stages, className }: { stages: FunnelStage[]; className?: string }) {
  const [ref, inView] = useInView<HTMLDivElement>();
  if (stages.length === 0) return null;

  const top = Math.max(stages[0].value, 1);

  return (
    <div ref={ref} className={cn("space-y-1", className)}>
      {stages.map((stage, i) => {
        const width = (stage.value / top) * 100;
        const previous = i > 0 ? stages[i - 1].value : null;
        const stepRate = previous && previous > 0 ? (stage.value / previous) * 100 : null;
        // Perda relevante no passo: acende o número para o olho parar nele.
        const leaking = stepRate !== null && stepRate < 50;

        return (
          <div key={stage.label}>
            {stepRate !== null && (
              <div className="flex items-center gap-2 py-1 pl-1">
                <span aria-hidden className="h-3 w-px bg-border" />
                <span
                  className={cn(
                    "text-[10px] font-medium tabular-nums",
                    leaking ? "text-status-urgent" : "text-muted-foreground",
                  )}
                >
                  {pct(stepRate, 0)} avança
                </span>
              </div>
            )}

            {/* Rótulo FORA da marca. Dentro ele exigiria escolher a cor do
                texto pela luminância do preenchimento e, numa etapa curta,
                metade da palavra cairia fora da barra — meio texto sobre a
                cor, meio sobre o trilho. Fora, é sempre legível. */}
            <div className="mb-1 flex items-baseline justify-between gap-3">
              <span className="min-w-0 truncate text-xs font-semibold text-foreground">
                {stage.label}
              </span>
              <span className="shrink-0 text-sm font-bold tabular-nums text-foreground">
                {num(stage.value)}
              </span>
            </div>

            <div className="h-4 w-full overflow-hidden rounded-full bg-[var(--viz-track)]">
              <div
                className="h-full rounded-full transition-[width] duration-700 ease-out"
                style={{
                  width: inView ? `${Math.max(width, 2)}%` : "0%",
                  // Preenchimento SÓLIDO. A primeira versão desbotava a ponta
                  // num degradê e ficava impossível ver onde o valor termina —
                  // a barra de 100% parecia ter 40%. Numa barra a extremidade
                  // É o dado; apagá-la apaga a leitura.
                  background: "var(--viz-1)",
                  transitionDelay: stagger(i, 90, 400),
                }}
              />
            </div>

            {stage.hint && (
              <p className="mt-0.5 pl-1 text-[10px] text-muted-foreground">{stage.hint}</p>
            )}
          </div>
        );
      })}
    </div>
  );
}
