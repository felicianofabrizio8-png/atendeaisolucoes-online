import { cn } from "@/lib/utils";

/**
 * Orbe da IA.
 *
 * Portada do snippet original com duas mudanças obrigatórias:
 *
 * 1. **O CSS saiu do componente.** O original usa `<style jsx>`, que é do
 *    Next.js e não existe aqui (Vite + TanStack Start). Mais importante: a
 *    regra `@property --angle` precisa estar registrada no documento, senão
 *    `--angle` é tratado como texto e a rotação não interpola — a orbe
 *    simplesmente fica parada. O CSS mora em `src/styles.css`.
 *
 * 2. **Tema invertido.** Neste projeto o escuro é o padrão (`:root`) e o claro
 *    é a exceção (`:root.light`); o snippet assumia o contrário (`.dark`).
 *
 * As cores padrão são mais escuras que as do snippet (lightness ~50% em vez de
 * ~78%): o painel de atendimento é quase preto, e a paleta clara original
 * brilhava demais ao lado do resto da interface.
 */

export interface SiriOrbColors {
  bg?: string;
  c1?: string;
  c2?: string;
  c3?: string;
}

interface SiriOrbProps {
  /** Lado do quadrado, em px. */
  size?: number;
  className?: string;
  colors?: SiriOrbColors;
  /** Duração de uma volta completa, em segundos. */
  animationDuration?: number;
}

/**
 * Paleta bem mais escura que a do snippet (lightness ~35% contra ~78%).
 *
 * Dois motivos: o painel é quase preto, e o `contrast()` do CSS amplifica o
 * que já está aceso — a paleta original virava uma bola sólida e berrante ao
 * lado do resto da interface. Com lightness baixa a orbe volta a ser uma
 * névoa, que é o efeito do original.
 */
const DEFAULT_COLORS: Required<SiriOrbColors> = {
  bg: "transparent",
  c1: "oklch(38% 0.13 350)",
  c2: "oklch(34% 0.10 250)",
  c3: "oklch(31% 0.12 300)",
};

export function SiriOrb({ size = 192, className, colors, animationDuration = 20 }: SiriOrbProps) {
  const final = { ...DEFAULT_COLORS, ...colors };

  // Proporcionais ao tamanho: o mesmo blur absoluto que dá volume a 192px
  // deixa uma orbe de 64px num borrão sem forma.
  const blur = Math.max(size * 0.08, 8);
  const contrast = Math.max(size * 0.003, 1.8);

  return (
    <div
      role="img"
      aria-label="Assistente de IA"
      className={cn("siri-orb", className)}
      style={
        {
          width: size,
          height: size,
          "--bg": final.bg,
          "--c1": final.c1,
          "--c2": final.c2,
          "--c3": final.c3,
          "--animation-duration": `${animationDuration}s`,
          "--blur-amount": `${blur}px`,
          "--contrast-amount": contrast,
        } as React.CSSProperties
      }
    />
  );
}

export default SiriOrb;
