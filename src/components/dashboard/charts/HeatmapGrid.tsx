import { useState } from "react";
import { cn } from "@/lib/utils";
import { num, stagger, useInView } from "./primitives";

export interface HeatCell {
  day: number; // 0 = domingo
  hour: number;
  value: number;
}

const DIAS = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];

/**
 * Mapa de calor hora × dia.
 *
 * Rampa SEQUENCIAL de um tom só (claro→escuro), nunca arco-íris: a grandeza
 * aqui é magnitude, e arco-íris inventa fronteira onde o dado é contínuo —
 * o olho lê "mudou de categoria" onde só houve um degrau a mais.
 *
 * A escala é por quantil, não linear: numa semana típica meia dúzia de
 * horários concentra quase tudo, e escala linear deixaria o resto todo no
 * mesmo tom escuro, sem informação.
 */
export function HeatmapGrid({
  cells,
  hours,
  className,
}: {
  cells: HeatCell[];
  /** Faixa de horas exibida. Fora do horário comercial é ruído. */
  hours: number[];
  className?: string;
}) {
  const [hover, setHover] = useState<HeatCell | null>(null);
  const [ref, inView] = useInView<HTMLDivElement>();

  const byKey = new Map(cells.map((c) => [`${c.day}-${c.hour}`, c.value]));
  const values = cells
    .map((c) => c.value)
    .filter((v) => v > 0)
    .sort((a, b) => a - b);

  const level = (value: number): number => {
    if (value <= 0 || values.length === 0) return 0;
    const rank = values.filter((v) => v <= value).length / values.length;
    if (rank <= 0.25) return 1;
    if (rank <= 0.5) return 2;
    if (rank <= 0.8) return 3;
    return 4;
  };

  return (
    <div ref={ref} className={cn("min-w-0", className)}>
      <div className="flex gap-1">
        <div className="flex shrink-0 flex-col gap-1 pr-1 pt-[18px]">
          {DIAS.map((d) => (
            <span
              key={d}
              className="flex h-4 items-center text-[9px] leading-none text-muted-foreground"
            >
              {d}
            </span>
          ))}
        </div>

        <div className="min-w-0 flex-1 overflow-x-auto">
          <div className="min-w-[320px]">
            <div
              className="mb-1 grid gap-1"
              style={{ gridTemplateColumns: `repeat(${hours.length}, minmax(0, 1fr))` }}
            >
              {hours.map((h) => (
                <span key={h} className="text-center text-[9px] leading-none text-muted-foreground">
                  {h % 3 === 0 ? h : ""}
                </span>
              ))}
            </div>

            <div className="flex flex-col gap-1">
              {DIAS.map((_, day) => (
                <div
                  key={day}
                  className="grid gap-1"
                  style={{ gridTemplateColumns: `repeat(${hours.length}, minmax(0, 1fr))` }}
                >
                  {hours.map((hour, i) => {
                    const value = byKey.get(`${day}-${hour}`) ?? 0;
                    const lv = level(value);
                    return (
                      <button
                        key={`${day}-${hour}`}
                        type="button"
                        aria-label={`${DIAS[day]} ${hour}h: ${num(value)} mensagens`}
                        onMouseEnter={() => setHover({ day, hour, value })}
                        onMouseLeave={() => setHover(null)}
                        onFocus={() => setHover({ day, hour, value })}
                        onBlur={() => setHover(null)}
                        className="h-4 rounded-[3px] transition-[transform,opacity] duration-150 hover:scale-125 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-foreground"
                        style={{
                          background: `var(--viz-ramp-${lv})`,
                          opacity: inView ? 1 : 0,
                          transitionDelay: stagger(day * 2 + i, 6, 300),
                        }}
                      />
                    );
                  })}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className="mt-3 flex items-center justify-between">
        <span className="text-[10px] text-muted-foreground" role="status">
          {hover
            ? `${DIAS[hover.day]}, ${hover.hour}h — ${num(hover.value)} mensagem${hover.value === 1 ? "" : "s"}`
            : "Passe o mouse para ver o volume"}
        </span>
        <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
          Menos
          {[0, 1, 2, 3, 4].map((l) => (
            <span
              key={l}
              aria-hidden
              className="h-2.5 w-2.5 rounded-[2px]"
              style={{ background: `var(--viz-ramp-${l})` }}
            />
          ))}
          Mais
        </span>
      </div>
    </div>
  );
}
