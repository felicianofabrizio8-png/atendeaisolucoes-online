// ============================================================================
// Biblioteca de elementos gráficos (Onda 2+).
//
// Nesta onda o registro está vazio de propósito. A arquitetura já existe para
// que futuras cenas e o painel de "Elementos" possam consumir ondas,
// pinceladas, molduras, splash, efeito de vidro, brilho, etc. sem precisar
// mudar `SceneRenderer` além de adicionar o render específico do novo tipo.
//
// Como estender no futuro:
//  1) Adicionar um novo `GraphicElement` no array `ELEMENTS`.
//  2) Se o elemento for de um tipo novo (svg/lottie/imagem), estender
//     `SceneLayer` em `scene.types.ts` OU implementar o render em
//     `SceneRenderer.tsx` via `elementId`.
// ============================================================================

export type GraphicElementCategory =
  | "wave"
  | "brush"
  | "frame"
  | "splash"
  | "glass"
  | "glow"
  | "shape"
  | "divider";

export interface GraphicElement {
  id: string;
  category: GraphicElementCategory;
  label: string;
  /** SVG inline (sem <?xml?>). Vazio nesta onda. */
  svg?: string;
  /** URL de asset externo (Onda 3, opcional). */
  assetUrl?: string;
}

export const ELEMENTS: GraphicElement[] = [];

export function getElement(id: string): GraphicElement | null {
  return ELEMENTS.find((e) => e.id === id) ?? null;
}
