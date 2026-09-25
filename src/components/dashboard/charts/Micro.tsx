import { cn } from "@/lib/utils";
import { arcPath, stagger, useInView, usePrefersReducedMotion } from "./primitives";

/**
 * Crista: uma fileira de traços finos, um por período.
 *
 * Não tem eixo, não tem rótulo e não tem tooltip — de propósito. Ela não
 * existe para ser lida valor a valor; existe para dar FORMA ao número grande
 * que está em cima dela. "R$ 73.500" não diz se o mês foi subindo ou caindo;
 * a crista diz, em trinta pixels, sem ocupar um painel inteiro.
 *
 * O último traço vem opaco e os outros recuados: numa fileira de doze traços
 * iguais o olho não sabe onde é "agora".
 */
export function MicroRidge({
  data,
  color = "var(--viz-1)",
  className,
}: {
  data: number[];
  color?: string;
  className?: string;
}) {
  const [ref, inView] = useInView<HTMLDivElement>();
  if (data.length === 0) return null;

  const max = Math.max(...data, 1);

  return (
    <div ref={ref} className={cn("flex h-8 items-end gap-[3px]", className)} aria-hidden>
      {data.map((v, i) => {
        const altura = Math.max((v / max) * 100, 6);
        const ultimo = i === data.length - 1;
        return (
          <span
            key={i}
            className="min-w-0 flex-1 rounded-full transition-[height,opacity] duration-500 ease-out"
            style={{
              height: inView ? `${altura}%` : "6%",
              background: color,
              opacity: inView ? (ultimo ? 1 : 0.4) : 0,
              transitionDelay: stagger(i, 34, 420),
            }}
          />
        );
      })}
    </div>
  );
}

/**
 * Arco de proporção.
 *
 * Um arco em vez de uma barra porque aqui o valor é uma FRAÇÃO de um todo
 * conhecido, e o círculo carrega o "de cem" sem precisar escrever a escala.
 * O traço se desenha com dasharray: é o único jeito de animar um arco da
 * origem ao fim sem recalcular o path a cada quadro.
 */
export function MicroArc({
  value,
  max = 100,
  color = "var(--viz-1)",
  size = 34,
  className,
}: {
  value: number;
  max?: number;
  color?: string;
  size?: number;
  className?: string;
}) {
  const [ref, inView] = useInView<SVGSVGElement>();
  const reduced = usePrefersReducedMotion();

  const r = 13;
  const varredura = 300;
  const fracao = max > 0 ? Math.min(value / max, 1) : 0;
  const comprimento = 2 * Math.PI * r * ((fracao * varredura) / 360);

  return (
    <svg
      ref={ref}
      viewBox="0 0 32 32"
      width={size}
      height={size}
      className={cn("shrink-0", className)}
      aria-hidden
    >
      <path
        d={arcPath(16, 16, r, 30, 330)}
        fill="none"
        stroke="var(--viz-track)"
        strokeWidth={3.5}
        strokeLinecap="round"
      />
      {fracao > 0 && inView && (
        <path
          d={arcPath(16, 16, r, 30, 30 + fracao * varredura)}
          fill="none"
          stroke={color}
          strokeWidth={3.5}
          strokeLinecap="round"
          className="viz-stroke"
          style={{
            strokeDasharray: comprimento,
            strokeDashoffset: reduced ? 0 : comprimento,
          }}
        />
      )}
    </svg>
  );
}
