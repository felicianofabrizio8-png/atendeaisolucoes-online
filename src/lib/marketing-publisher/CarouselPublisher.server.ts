// ============================================================================
// Publicação de carrossel (várias imagens em um post) — Instagram e Facebook.
//
// Módulo isolado e sem IO próprio: recebe a função de envio (`post`, o mesmo
// `postGraph` do publicador, que já passa pelo guarda de ambiente) e os links
// das imagens. Assim é testado por inteiro com um envio falso.
//
// DESLIGADO POR PADRÃO: só é chamado quando `isCarouselPublishEnabled()` —
// ver `carousel-flag.ts`. Ainda não foi exercitado contra a Meta de verdade.
//
// Idempotência: cada id que a Meta devolve (imagens enviadas, container) é
// persistido em `pending` assim que chega. Uma nova tentativa reaproveita o
// que já existe em vez de enviar de novo — sem imagem nem post duplicado.
// ============================================================================

import type { OutboundResult } from "@/lib/outbound/MetaOutboundContract";
import { isFailure, isSimulation } from "@/lib/outbound/MetaOutboundContract";

export const CAROUSEL_LIMITS = { min: 2, max: 10 } as const;

export interface CarouselPost {
  (input: {
    companyId: string;
    action: string;
    url: string;
    method: "POST";
    headers: Record<string, string>;
    body: string;
    logicalPayload?: Record<string, unknown>;
    agentId: string;
    extractExternalId?: (json: unknown) => string | null;
  }): Promise<OutboundResult<{ id?: string; post_id?: string }>>;
}

export interface CarouselPending {
  /** Instagram: containers-filho já criados, na ordem das imagens. */
  children?: string[];
  /** Instagram: container do carrossel. */
  container_id?: string;
  /** Facebook: fotos já enviadas (não publicadas), na ordem. */
  photo_ids?: string[];
}

export interface CarouselInput {
  companyId: string;
  graph: string;
  accessToken: string;
  /** Links públicos (assinados) das imagens, na ordem das páginas. */
  imageUrls: string[];
  caption: string;
  pending?: CarouselPending | null;
  onPending?: (patch: CarouselPending) => Promise<void>;
  post: CarouselPost;
}

export type CarouselOutcome =
  | { success: true; simulated: boolean; platformPostId: string | null; platformResponse: unknown }
  | { success: false; errorCode: string; errorMessage: string; retryable: boolean };

const FORM = { "Content-Type": "application/x-www-form-urlencoded" };
const fail = (errorCode: string, errorMessage: string, retryable = false): CarouselOutcome => ({ success: false, errorCode, errorMessage: errorMessage.slice(0, 500), retryable });
const simulated = (): CarouselOutcome => ({ success: true, simulated: true, platformPostId: null, platformResponse: { simulated: true } });

/** Confere a lista antes de qualquer chamada: nada é enviado pela metade por erro de entrada. */
export function validateCarouselImages(urls: string[]): { ok: true } | { ok: false; code: string; message: string } {
  if (urls.length < CAROUSEL_LIMITS.min) return { ok: false, code: "carousel_too_few_images", message: `Um carrossel precisa de pelo menos ${CAROUSEL_LIMITS.min} imagens.` };
  if (urls.length > CAROUSEL_LIMITS.max) return { ok: false, code: "carousel_too_many_images", message: `Um carrossel aceita no máximo ${CAROUSEL_LIMITS.max} imagens.` };
  if (urls.some((u) => !/^https:\/\//.test(u))) return { ok: false, code: "carousel_invalid_image_url", message: "Imagem do carrossel sem link público válido." };
  return { ok: true };
}

async function savePending(input: CarouselInput, patch: CarouselPending): Promise<void> {
  try {
    await input.onPending?.(patch);
  } catch {
    // Sem persistir, uma nova tentativa recriaria itens; o post em si só é
    // publicado uma vez (a linha guarda o platform_post_id).
  }
}

/** Instagram: um container por imagem → container CAROUSEL → media_publish. */
export async function publishInstagramCarousel(input: CarouselInput & { igUserId: string }): Promise<CarouselOutcome> {
  const check = validateCarouselImages(input.imageUrls);
  if (!check.ok) return fail(check.code, check.message);
  const base = `${input.graph}/${encodeURIComponent(input.igUserId)}`;

  const children = [...(input.pending?.children ?? [])].slice(0, input.imageUrls.length);
  let containerId = input.pending?.container_id ?? null;

  if (!containerId) {
    for (let i = children.length; i < input.imageUrls.length; i++) {
      const body = new URLSearchParams({ image_url: input.imageUrls[i], is_carousel_item: "true", access_token: input.accessToken });
      const res = await input.post({
        companyId: input.companyId,
        action: "marketing_publisher.instagram.carousel.item",
        url: `${base}/media`,
        method: "POST",
        headers: FORM,
        body: body.toString(),
        logicalPayload: { index: i, is_carousel_item: true },
        agentId: "marketing-publisher",
      });
      if (isSimulation(res)) return simulated();
      if (isFailure(res)) return fail(`carousel_item_error_${res.status ?? "network"}`, res.error, res.retryable);
      const id = res.raw?.id;
      if (!id) return fail("carousel_no_item_id", "Meta não retornou o id de uma imagem do carrossel.");
      children.push(id);
      await savePending(input, { children: [...children] });
    }

    const body = new URLSearchParams({ media_type: "CAROUSEL", children: children.join(","), caption: input.caption, access_token: input.accessToken });
    const res = await input.post({
      companyId: input.companyId,
      action: "marketing_publisher.instagram.carousel.container",
      url: `${base}/media`,
      method: "POST",
      headers: FORM,
      body: body.toString(),
      logicalPayload: { media_type: "CAROUSEL", children: children.length },
      agentId: "marketing-publisher",
    });
    if (isSimulation(res)) return simulated();
    if (isFailure(res)) return fail(`carousel_container_error_${res.status ?? "network"}`, res.error, res.retryable);
    containerId = res.raw?.id ?? null;
    if (!containerId) return fail("no_container_id", "Meta não retornou o container do carrossel.");
    await savePending(input, { children: [...children], container_id: containerId });
  }

  const body = new URLSearchParams({ creation_id: containerId, access_token: input.accessToken });
  const res = await input.post({
    companyId: input.companyId,
    action: "marketing_publisher.instagram.carousel.publish",
    url: `${base}/media_publish`,
    method: "POST",
    headers: FORM,
    body: body.toString(),
    logicalPayload: { creation_id: containerId },
    agentId: "marketing-publisher",
    extractExternalId: (json) => (json as { id?: string } | null)?.id ?? null,
  });
  if (isSimulation(res)) return simulated();
  if (isFailure(res)) return fail(`publish_error_${res.status ?? "network"}`, res.error, res.retryable);
  return { success: true, simulated: false, platformPostId: res.externalId, platformResponse: { id: res.raw?.id ?? null, images: children.length } };
}

/** Facebook: cada foto enviada sem publicar → um post no feed com todas anexadas. */
export async function publishFacebookCarousel(input: CarouselInput & { pageId: string }): Promise<CarouselOutcome> {
  const check = validateCarouselImages(input.imageUrls);
  if (!check.ok) return fail(check.code, check.message);
  const base = `${input.graph}/${encodeURIComponent(input.pageId)}`;

  const photoIds = [...(input.pending?.photo_ids ?? [])].slice(0, input.imageUrls.length);
  for (let i = photoIds.length; i < input.imageUrls.length; i++) {
    const body = new URLSearchParams({ url: input.imageUrls[i], published: "false", access_token: input.accessToken });
    const res = await input.post({
      companyId: input.companyId,
      action: "marketing_publisher.facebook.carousel.photo",
      url: `${base}/photos`,
      method: "POST",
      headers: FORM,
      body: body.toString(),
      logicalPayload: { index: i, published: false },
      agentId: "marketing-publisher",
    });
    if (isSimulation(res)) return simulated();
    if (isFailure(res)) return fail(`carousel_photo_error_${res.status ?? "network"}`, res.error, res.retryable);
    const id = res.raw?.id;
    if (!id) return fail("no_photo_id", "Upload de uma imagem do carrossel não retornou id.");
    photoIds.push(id);
    await savePending(input, { photo_ids: [...photoIds] });
  }

  const body = new URLSearchParams({ message: input.caption, access_token: input.accessToken });
  photoIds.forEach((id, i) => body.set(`attached_media[${i}]`, JSON.stringify({ media_fbid: id })));
  const res = await input.post({
    companyId: input.companyId,
    action: "marketing_publisher.facebook.carousel.publish",
    url: `${base}/feed`,
    method: "POST",
    headers: FORM,
    body: body.toString(),
    logicalPayload: { attached_media: photoIds.length },
    agentId: "marketing-publisher",
    extractExternalId: (json) => {
      const j = json as { id?: string; post_id?: string } | null;
      return j?.post_id ?? j?.id ?? null;
    },
  });
  if (isSimulation(res)) return simulated();
  if (isFailure(res)) return fail(`publish_error_${res.status ?? "network"}`, res.error, res.retryable);
  return { success: true, simulated: false, platformPostId: res.externalId, platformResponse: { id: res.raw?.id ?? null, images: photoIds.length } };
}
