import * as React from "react";

/**
 * Altura (px) ocupada pelo teclado virtual sobre a viewport.
 *
 * Usa a `visualViewport` API, que é a única fonte confiável no iOS: lá o
 * teclado não redimensiona a `layout viewport`, então `100dvh` e `resize` não
 * ajudam e o composer fixo fica escondido atrás do teclado.
 *
 * Contrato:
 *  · Retorna `0` em SSR, no primeiro paint e quando o teclado está fechado.
 *  · Retorna `0` quando a API não existe (navegadores antigos, jsdom) — o
 *    layout então depende só de `safe-bottom`, que já é o comportamento atual.
 *  · Ignora variações menores que `MIN_INSET_PX` para não reagir a barras de
 *    URL que encolhem durante a rolagem.
 *
 * Deliberadamente não mexe em altura fixa nem em `position` — o consumidor
 * aplica o valor como padding/translate, o que evita os hacks frágeis de
 * `height: 100vh` que quebram ao girar a tela.
 */
const MIN_INSET_PX = 80;

export function useKeyboardInset(): number {
  const [inset, setInset] = React.useState(0);

  React.useEffect(() => {
    const vv = typeof window !== "undefined" ? window.visualViewport : undefined;
    if (!vv) return;

    let frame = 0;
    const update = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        // Quanto da janela está coberto por algo (teclado, barra de acessórios).
        const covered = window.innerHeight - vv.height - vv.offsetTop;
        setInset(covered > MIN_INSET_PX ? Math.round(covered) : 0);
      });
    };

    update();
    vv.addEventListener("resize", update);
    vv.addEventListener("scroll", update);
    return () => {
      cancelAnimationFrame(frame);
      vv.removeEventListener("resize", update);
      vv.removeEventListener("scroll", update);
    };
  }, []);

  return inset;
}
