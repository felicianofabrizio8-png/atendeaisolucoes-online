// ============================================================================
// Sequências narrativas de carrossel.
//
// Um carrossel comercial conta uma história curta: chama a atenção, apresenta,
// mostra benefícios e diferenciais e termina com a chamada. Cada sequência
// define, por finalidade comercial, o papel de cada página e um modelo visual
// para ele — variados entre si, mas da mesma família.
//
// Nada aqui escreve texto pelo usuário: as páginas nascem só com o que ele
// informou (título, subtítulo, chamada) e com dicas do que escrever em cada
// papel. Preço, prazo e característica nunca são inventados.
// ============================================================================

import type { TemplateId, VideoLayout } from "../video-editor/layout.types";
import type { ScenePurpose } from "../video-editor/scene.types";
import { fitPaletteToScene, type BrandColorsInput } from "../video-editor/palette";
import { getScene, type SceneFormat } from "../video-editor/scenes/registry";
import { KIND_FORMATS, KIND_PAGE_LIMITS, STUDIO_DOC_VERSION, blankPage, type PageImageRef, type PageRole, type PageText, type StudioDocument, type StudioPage } from "./document";
import { applyTemplate } from "./layout-ops";

export interface RecipeStep {
  role: Exclude<PageRole, "livre">;
  template: TemplateId;
}

export interface CarouselRecipe {
  id: ScenePurpose;
  label: string;
  description: string;
  steps: RecipeStep[];
}

const steps = (...templates: [TemplateId, TemplateId, TemplateId, TemplateId, TemplateId]): RecipeStep[] => [
  { role: "impacto", template: templates[0] },
  { role: "apresentacao", template: templates[1] },
  { role: "beneficio", template: templates[2] },
  { role: "diferencial", template: templates[3] },
  { role: "cta", template: templates[4] },
];

export const CAROUSEL_RECIPES: CarouselRecipe[] = [
  { id: "oferta", label: "Oferta", description: "Promoção com urgência: a oferta, o produto, as vantagens e a chamada.", steps: steps("oferta", "split", "etiqueta", "moderno", "impacto") },
  { id: "lancamento", label: "Lançamento", description: "Novidade: capa de impacto, apresentação e motivos para conhecer.", steps: steps("revista", "duotone", "gradiente", "moderno", "impacto") },
  { id: "produto", label: "Produto", description: "Vitrine: o produto em destaque, detalhes e diferenciais.", steps: steps("split", "moldura", "recorte", "cartao", "moderno") },
  { id: "servico", label: "Serviço", description: "O que você faz, como funciona, vantagens e contato.", steps: steps("bloco", "lateral", "cartao", "legenda", "glass") },
  { id: "institucional", label: "Institucional", description: "A empresa: quem é, o que entrega e como falar com ela.", steps: steps("institucional", "arco", "legenda", "glass", "clean") },
  { id: "luxo", label: "Luxo", description: "Sofisticado: fundo escuro, serifas e poucos elementos.", steps: steps("luxo", "editorial", "premium", "revista", "premium") },
  { id: "evento", label: "Datas e eventos", description: "Datas comemorativas e eventos, com clima festivo.", steps: steps("festivo", "faixa", "neon", "moldura", "faixa") },
];

export function getRecipe(id: string | null | undefined): CarouselRecipe {
  return CAROUSEL_RECIPES.find((r) => r.id === id) ?? CAROUSEL_RECIPES[0];
}

/** O que escrever em cada papel — orientação, nunca texto pronto. */
export const ROLE_HINTS: Record<PageRole, { purpose: string; headline: string; subheadline: string; cta: string }> = {
  impacto: {
    purpose: "Faz a pessoa parar de rolar: a oferta ou a novidade em poucas palavras.",
    headline: "A oferta ou novidade principal",
    subheadline: "Um complemento curto (opcional)",
    cta: "Geralmente fica só na última página",
  },
  apresentacao: {
    purpose: "Mostra o que é: o produto, o serviço ou a empresa.",
    headline: "O nome do produto ou serviço",
    subheadline: "O que é, em uma frase",
    cta: "Geralmente fica só na última página",
  },
  beneficio: {
    purpose: "Um benefício real para o cliente. Use só o que é verdade no seu negócio.",
    headline: "Um benefício para o cliente",
    subheadline: "Explique em uma frase (opcional)",
    cta: "Geralmente fica só na última página",
  },
  diferencial: {
    purpose: "O que só a sua empresa oferece: garantia, prazo, atendimento.",
    headline: "Um diferencial da sua empresa",
    subheadline: "Explique em uma frase (opcional)",
    cta: "Geralmente fica só na última página",
  },
  cta: {
    purpose: "Diz o que fazer agora: chamar no WhatsApp, visitar, comprar.",
    headline: "O convite final",
    subheadline: "Como ou onde (opcional)",
    cta: "Ex.: Chame no WhatsApp",
  },
  livre: {
    purpose: "Página livre.",
    headline: "Título desta página",
    subheadline: "Texto de apoio (opcional)",
    cta: "Chamada (opcional)",
  },
};

/** Papéis para `count` páginas: começa com impacto e termina com a chamada. */
export function narrativeRoles(count: number): PageRole[] {
  if (count <= 0) return [];
  if (count === 1) return ["impacto"];
  const middle: PageRole[] = ["apresentacao", "beneficio", "diferencial"];
  return Array.from({ length: count }, (_, i) => (i === 0 ? "impacto" : i === count - 1 ? "cta" : middle[(i - 1) % middle.length]));
}

function stepFor(recipe: CarouselRecipe, role: PageRole): RecipeStep | undefined {
  return recipe.steps.find((s) => s.role === role);
}

export interface BuildCarouselInput {
  recipe: CarouselRecipe;
  format?: SceneFormat;
  /** Fotos escolhidas pelo usuário, na ordem. */
  images?: PageImageRef[];
  /** Textos que o usuário já escreveu. O que faltar fica em branco. */
  text?: Partial<PageText>;
  /** Número de páginas (padrão: as cinco da sequência, ou uma por foto). */
  pages?: number;
}

/**
 * Carrossel novo seguindo a sequência. Título e subtítulo vão para a página
 * de impacto e a chamada para a última; as demais ficam sem texto, à espera
 * do que o usuário quiser dizer.
 */
export function buildCarousel(input: BuildCarouselInput): StudioDocument {
  const limits = KIND_PAGE_LIMITS.carousel;
  const images = (input.images ?? []).slice(0, limits.max);
  const count = Math.min(limits.max, Math.max(limits.min, input.pages ?? Math.max(input.recipe.steps.length, images.length)));
  const roles = narrativeRoles(count);
  // As páginas usam modelos diferentes, mas as cores da capa: o carrossel
  // precisa parecer uma peça só. (O estúdio troca pelas cores da marca da
  // empresa quando ela tem marca publicada.)
  const coverPalette = getScene(stepFor(input.recipe, "impacto")?.template).palette;
  const pages: StudioPage[] = roles.map((role, i) => {
    const blank = blankPage(stepFor(input.recipe, role)?.template, role);
    const page = { ...blank, layout: { ...blank.layout, colors: fitPaletteToScene(coverPalette, getScene(blank.layout.template)), colorMode: "template" as const } };
    return {
      ...page,
      image: images[i] ? { ...images[i], framing: null } : null,
      text: {
        headline: i === 0 ? (input.text?.headline ?? "") : "",
        subheadline: i === 0 ? (input.text?.subheadline ?? "") : "",
        cta: i === count - 1 ? (input.text?.cta ?? "") : "",
      },
    };
  });
  const format = input.format && KIND_FORMATS.carousel.includes(input.format) ? input.format : "portrait";
  return { version: STUDIO_DOC_VERSION, kind: "carousel", format, pages };
}

/**
 * Aplica os modelos da sequência às páginas existentes, pelo papel de cada
 * uma. Fotos, textos, cores e a escolha de exibir a logo não mudam.
 * `assignRoles` redistribui os papéis pela ordem (impacto → … → chamada).
 */
export function applyRecipe(doc: StudioDocument, recipe: CarouselRecipe, brand: BrandColorsInput | null | undefined, assignRoles = false): StudioDocument {
  const roles = assignRoles ? narrativeRoles(doc.pages.length) : null;
  return {
    ...doc,
    pages: doc.pages.map((page, i) => {
      const role = roles ? roles[i] : page.role;
      const step = stepFor(recipe, role);
      const layout: VideoLayout = step ? applyTemplate(page.layout, getScene(step.template), brand) : page.layout;
      return { ...page, role, layout };
    }),
  };
}
