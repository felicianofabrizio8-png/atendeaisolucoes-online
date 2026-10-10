// Regras puras (sem IO) que dizem se um carrossel pode ser publicado. Usadas
// pelo agendamento (antes de entrar na fila) e pelo publicador (na hora de
// enviar): as duas pontas recusam pelos mesmos motivos.

export const CAROUSEL_LIMITS = { min: 2, max: 10 } as const;

/** Proporção (largura ÷ altura) que o Instagram aceita em carrossel: 4:5 a 1,91:1. */
export const INSTAGRAM_CAROUSEL_ASPECT = { min: 0.8, max: 1.91 } as const;
const ASPECT_TOLERANCE = 0.01;

export type CarouselChannel = "instagram" | "facebook";

export interface CarouselProblem {
  code: string;
  message: string;
}

export interface CarouselImageInfo {
  width: number | null;
  height: number | null;
  mime_type: string | null;
}

/**
 * Confere o conteúdo: quantidade de imagens e se elas ainda correspondem às
 * páginas do documento do estúdio (editar sem concluir de novo deixa as
 * imagens exportadas para trás).
 */
export function carouselContentProblem(content: { media_ids: unknown; design?: unknown }, channel: CarouselChannel): CarouselProblem | null {
  const count = Array.isArray(content.media_ids) ? content.media_ids.length : 0;
  const design = content.design && typeof content.design === "object" ? (content.design as { kind?: unknown; format?: unknown; pages?: unknown }) : null;
  const isStudioCarousel = design?.kind === "carousel" && Array.isArray(design.pages);
  if (count === 0 || (isStudioCarousel && (design!.pages as unknown[]).length !== count)) {
    return {
      code: "carousel_export_outdated",
      message: "As imagens do carrossel não correspondem às páginas atuais. Abra o conteúdo no estúdio e clique em Concluir para gerar as imagens de novo.",
    };
  }
  if (count < CAROUSEL_LIMITS.min) return { code: "carousel_too_few_images", message: `Um carrossel precisa de pelo menos ${CAROUSEL_LIMITS.min} imagens.` };
  if (count > CAROUSEL_LIMITS.max) return { code: "carousel_too_many_images", message: `Um carrossel aceita no máximo ${CAROUSEL_LIMITS.max} imagens.` };
  if (channel === "instagram" && isStudioCarousel && design!.format === "story") {
    return { code: "carousel_aspect_unsupported", message: "O Instagram não aceita carrossel em formato Story (9:16). Use 4:5 ou 1:1." };
  }
  return null;
}

/**
 * Confere os arquivos (na ordem das páginas). Só o Instagram restringe
 * proporção e tipo; medidas desconhecidas não bloqueiam — a Meta decide.
 */
export function carouselImagesProblem(images: CarouselImageInfo[], channel: CarouselChannel): CarouselProblem | null {
  if (channel !== "instagram") return null;
  for (const [i, image] of images.entries()) {
    if (image.mime_type && image.mime_type.toLowerCase() !== "image/jpeg") {
      return { code: "carousel_image_not_jpeg", message: `A imagem da página ${i + 1} não é JPEG, o único tipo que o Instagram aceita. Abra no estúdio e clique em Concluir.` };
    }
    if (image.width && image.height && image.width > 0 && image.height > 0) {
      const aspect = image.width / image.height;
      if (aspect < INSTAGRAM_CAROUSEL_ASPECT.min - ASPECT_TOLERANCE || aspect > INSTAGRAM_CAROUSEL_ASPECT.max + ASPECT_TOLERANCE) {
        return {
          code: "carousel_aspect_unsupported",
          message: `A imagem da página ${i + 1} (${image.width}×${image.height}) está fora da proporção que o Instagram aceita em carrossel (de 4:5 a 1,91:1).`,
        };
      }
    }
  }
  return null;
}

/**
 * Permissão registrada na conexão. Lista vazia = sem evidência: não bloqueia
 * (conexões antigas não guardavam os escopos) e a Meta decide no envio.
 */
export function missingPublishScope(grantedScopes: unknown, channel: CarouselChannel): string | null {
  const scopes = Array.isArray(grantedScopes) ? grantedScopes.filter((s): s is string => typeof s === "string") : [];
  if (scopes.length === 0) return null;
  if (channel === "instagram") {
    return scopes.includes("instagram_content_publish") || scopes.includes("instagram_business_content_publish") ? null : "instagram_content_publish";
  }
  return scopes.includes("pages_manage_posts") ? null : "pages_manage_posts";
}
