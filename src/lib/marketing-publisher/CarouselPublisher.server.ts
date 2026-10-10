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
// A chamada final (a que cria o post) pode ter sido aceita pela Meta mesmo
// quando a resposta se perde; por isso, antes de repeti-la, o módulo pergunta
// à Meta se o post já existe (Instagram: estado do container; Facebook: posts
// recentes da Página com as mesmas fotos ou com a mesma legenda).
//
// Facebook, resposta perdida — o que acontece em cada caso:
// - pedido não chegou à Meta        → a consulta não acha o post → publica;
// - Meta criou o post, resposta caiu → a consulta acha → confirma, sem repetir;
// - consulta falhou                  → NÃO publica (fica "não confirmado");
// - post criado há segundos e ainda fora da listagem → espera antes de decidir.
// ============================================================================

import type { OutboundResult } from "@/lib/outbound/MetaOutboundContract";
import { isFailure, isSimulation } from "@/lib/outbound/MetaOutboundContract";
import { CAROUSEL_LIMITS } from "./carousel-readiness";

export { CAROUSEL_LIMITS };

interface CarouselRaw {
  id?: string;
  post_id?: string;
  status_code?: string;
  data?: unknown;
}

export interface CarouselPost {
  (input: {
    companyId: string;
    action: string;
    url: string;
    method: "POST" | "GET";
    headers?: Record<string, string>;
    body?: string;
    logicalPayload?: Record<string, unknown>;
    agentId: string;
    extractExternalId?: (json: unknown) => string | null;
  }): Promise<OutboundResult<CarouselRaw>>;
}

export interface CarouselPending {
  /** Instagram: containers-filho já criados, na ordem das imagens. */
  children?: string[];
  /** Instagram: container do carrossel. */
  container_id?: string | null;
  /** Facebook: fotos já enviadas (não publicadas), na ordem. */
  photo_ids?: string[];
  /**
   * Facebook: quando a criação do post foi tentada sem resposta conclusiva.
   * Presente = a próxima tentativa confere a Página antes de postar de novo.
   */
  publish_attempted_at?: string | null;
  /** Facebook: quando as fotos foram enviadas (fotos não publicadas expiram na Meta). */
  photos_uploaded_at?: string | null;
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
  /** Espera do container do Instagram (padrão: 10 consultas, 3 s entre elas). */
  poll?: { attempts: number; delayMs: number };
  /** Injeção p/ testes. */
  wait?: (ms: number) => Promise<void>;
  now?: () => Date;
}

export type CarouselOutcome =
  | { success: true; simulated: boolean; platformPostId: string | null; platformResponse: unknown }
  | { success: false; errorCode: string; errorMessage: string; retryable: boolean };

type Failure = Extract<OutboundResult<CarouselRaw>, { success: false }>;

const FORM = { "Content-Type": "application/x-www-form-urlencoded" };
const DEFAULT_POLL = { attempts: 10, delayMs: 3000 };
const fail = (errorCode: string, errorMessage: string, retryable = false): CarouselOutcome => ({ success: false, errorCode, errorMessage: errorMessage.slice(0, 500), retryable });
const simulated = (): CarouselOutcome => ({ success: true, simulated: true, platformPostId: null, platformResponse: { simulated: true } });

/** Mensagem da Meta com o código, subcódigo e rastreio quando existem (nunca o token). */
function describeFailure(res: Failure): string {
  const src = res.providerError && typeof res.providerError === "object" ? (res.providerError as Record<string, unknown>) : null;
  const user = typeof src?.error_user_msg === "string" && src.error_user_msg ? src.error_user_msg : null;
  const tags: string[] = [];
  if (typeof src?.code === "number") tags.push(`code=${src.code}`);
  if (typeof src?.error_subcode === "number") tags.push(`subcode=${src.error_subcode}`);
  if (typeof src?.fbtrace_id === "string" && src.fbtrace_id) tags.push(`fbtrace_id=${src.fbtrace_id}`);
  return tags.length > 0 ? `${user ?? res.error} [${tags.join(" ")}]` : (user ?? res.error);
}

/** Confere a lista antes de qualquer chamada: nada é enviado pela metade por erro de entrada. */
export function validateCarouselImages(urls: string[]): { ok: true } | { ok: false; code: string; message: string } {
  if (urls.length < CAROUSEL_LIMITS.min) return { ok: false, code: "carousel_too_few_images", message: `Um carrossel precisa de pelo menos ${CAROUSEL_LIMITS.min} imagens.` };
  if (urls.length > CAROUSEL_LIMITS.max) return { ok: false, code: "carousel_too_many_images", message: `Um carrossel aceita no máximo ${CAROUSEL_LIMITS.max} imagens.` };
  if (urls.some((u) => !/^https:\/\//.test(u))) return { ok: false, code: "carousel_invalid_image_url", message: "Imagem do carrossel sem link público válido." };
  return { ok: true };
}

async function savePending(input: CarouselInput, patch: CarouselPending): Promise<boolean> {
  try {
    await input.onPending?.(patch);
    return true;
  } catch {
    // Sem persistir, uma nova tentativa recriaria itens; o post em si só é
    // publicado uma vez (a linha guarda o platform_post_id).
    return false;
  }
}

type ContainerState = { state: "ready" } | { state: "published" } | { state: "done"; outcome: CarouselOutcome };

/**
 * Instagram: o container do carrossel é processado de forma assíncrona; só
 * pode ser publicado quando a Meta informa FINISHED. PUBLISHED significa que
 * uma tentativa anterior já publicou (a resposta se perdeu).
 */
async function waitInstagramContainer(input: CarouselInput, containerId: string): Promise<ContainerState> {
  const poll = input.poll ?? DEFAULT_POLL;
  const wait = input.wait ?? ((ms: number) => new Promise<void>((res) => setTimeout(res, ms)));
  for (let i = 0; i < poll.attempts; i += 1) {
    const res = await input.post({
      companyId: input.companyId,
      action: "marketing_publisher.instagram.carousel.container_status",
      url: `${input.graph}/${encodeURIComponent(containerId)}?fields=status_code&access_token=${encodeURIComponent(input.accessToken)}`,
      method: "GET",
      logicalPayload: { container_id: containerId },
      agentId: "marketing-publisher",
    });
    if (isSimulation(res)) return { state: "done", outcome: simulated() };
    if (isFailure(res)) return { state: "done", outcome: fail(`container_status_${res.status ?? "network"}`, describeFailure(res), res.retryable) };
    const code = res.raw?.status_code;
    if (code === "FINISHED") return { state: "ready" };
    if (code === "PUBLISHED") return { state: "published" };
    if (code === "ERROR" || code === "EXPIRED") {
      // Container perdido: limpa o andamento para a próxima tentativa recomeçar
      // do zero em vez de insistir no mesmo container.
      await savePending(input, { children: [], container_id: null });
      return {
        state: "done",
        outcome: fail("container_processing_failed", `A Meta não conseguiu processar o carrossel (status ${code}).`, code === "EXPIRED"),
      };
    }
    if (i < poll.attempts - 1) await wait(poll.delayMs);
  }
  return { state: "done", outcome: fail("container_not_ready", "O carrossel ainda está em processamento na Meta. Uma nova tentativa será feita.", true) };
}

/** Instagram: um container por imagem → container CAROUSEL → espera → media_publish. */
export async function publishInstagramCarousel(input: CarouselInput & { igUserId: string }): Promise<CarouselOutcome> {
  const check = validateCarouselImages(input.imageUrls);
  if (!check.ok) return fail(check.code, check.message);
  const base = `${input.graph}/${encodeURIComponent(input.igUserId)}`;

  const children = [...(input.pending?.children ?? [])].slice(0, input.imageUrls.length);
  let containerId = input.pending?.container_id || null;

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
      if (isFailure(res)) return fail(`carousel_item_error_${res.status ?? "network"}`, describeFailure(res), res.retryable);
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
    if (isFailure(res)) return fail(`carousel_container_error_${res.status ?? "network"}`, describeFailure(res), res.retryable);
    containerId = res.raw?.id ?? null;
    if (!containerId) return fail("no_container_id", "Meta não retornou o container do carrossel.");
    await savePending(input, { children: [...children], container_id: containerId });
  }

  const ready = await waitInstagramContainer(input, containerId);
  if (ready.state === "done") return ready.outcome;
  if (ready.state === "published") {
    // Uma tentativa anterior publicou e a resposta se perdeu: não publica de novo.
    return {
      success: true,
      simulated: false,
      platformPostId: null,
      platformResponse: { reconciled: true, reason: "container_already_published", container_id: containerId, images: children.length },
    };
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
  if (isFailure(res)) return fail(`publish_error_${res.status ?? "network"}`, describeFailure(res), res.retryable);
  if (!res.externalId) return fail("no_post_id", "A Meta respondeu sem o id do post. Confira o perfil antes de reprocessar.");
  return { success: true, simulated: false, platformPostId: res.externalId, platformResponse: { id: res.raw?.id ?? null, images: children.length } };
}

/** Ids de foto anexados a um post da Página (anexo único ou subanexos). */
function attachedPhotoIds(post: unknown): string[] {
  const out: string[] = [];
  const visit = (node: unknown) => {
    if (!node || typeof node !== "object") return;
    const o = node as { target?: { id?: unknown }; subattachments?: { data?: unknown }; data?: unknown };
    if (typeof o.target?.id === "string") out.push(o.target.id);
    if (Array.isArray(o.subattachments?.data)) o.subattachments!.data.forEach(visit);
  };
  const data = (post as { attachments?: { data?: unknown } } | null)?.attachments?.data;
  if (Array.isArray(data)) data.forEach(visit);
  return out;
}

/** Tempo mínimo desde a tentativa para aceitar "o post não existe" (a listagem da Página pode atrasar). */
export const FACEBOOK_CONFIRM_MIN_AGE_MS = 60_000;
/** Fotos enviadas sem publicar são descartadas pela Meta em cerca de um dia. */
export const FACEBOOK_PHOTO_MAX_AGE_MS = 20 * 60 * 60_000;

type Lookup = { kind: "found"; postId: string; match: "photos" | "caption" } | { kind: "absent" } | { kind: "simulated" } | { kind: "unknown"; failure: Failure };

/**
 * Facebook: procura, nos posts da Página criados desde a tentativa, o post
 * deste carrossel — pelas fotos anexadas ou, na falta delas, pela legenda
 * idêntica. Errar para o lado de "achou" só deixa de publicar; nunca duplica.
 */
async function findExistingFacebookPost(input: CarouselInput, base: string, photoIds: string[], attemptedAt: string): Promise<Lookup> {
  const sinceMs = new Date(attemptedAt).getTime();
  const since = Number.isFinite(sinceMs) ? Math.floor(sinceMs / 1000) - 120 : null;
  const query = new URLSearchParams({ fields: "id,message,created_time,attachments{target{id},subattachments{target{id}}}", limit: "25", access_token: input.accessToken });
  if (since) query.set("since", String(since));
  const res = await input.post({
    companyId: input.companyId,
    action: "marketing_publisher.facebook.carousel.lookup",
    url: `${base}/published_posts?${query.toString()}`,
    method: "GET",
    logicalPayload: { lookup: "published_posts", photos: photoIds.length },
    agentId: "marketing-publisher",
  });
  if (isSimulation(res)) return { kind: "simulated" };
  if (isFailure(res)) return { kind: "unknown", failure: res };
  // Resposta sem a lista não prova que o post não existe.
  if (!Array.isArray(res.raw?.data)) {
    return { kind: "unknown", failure: { success: false, simulated: false, environment: res.environment, externalRequestSent: true, error: "resposta inesperada da Meta", retryable: true } };
  }
  const wanted = new Set(photoIds);
  const caption = input.caption.trim();
  let byCaption: string | null = null;
  for (const post of res.raw.data as unknown[]) {
    const p = post as { id?: unknown; message?: unknown; created_time?: unknown } | null;
    if (typeof p?.id !== "string") continue;
    if (attachedPhotoIds(post).some((photo) => wanted.has(photo))) return { kind: "found", postId: p.id, match: "photos" };
    const created = typeof p.created_time === "string" ? new Date(p.created_time).getTime() : NaN;
    const afterAttempt = !since || !Number.isFinite(created) || created >= since * 1000;
    if (!byCaption && caption && typeof p.message === "string" && p.message.trim() === caption && afterAttempt) byCaption = p.id;
  }
  return byCaption ? { kind: "found", postId: byCaption, match: "caption" } : { kind: "absent" };
}

/** Facebook: cada foto enviada sem publicar → um post no feed com todas anexadas. */
export async function publishFacebookCarousel(input: CarouselInput & { pageId: string }): Promise<CarouselOutcome> {
  const check = validateCarouselImages(input.imageUrls);
  if (!check.ok) return fail(check.code, check.message);
  const base = `${input.graph}/${encodeURIComponent(input.pageId)}`;
  const now = (input.now?.() ?? new Date()).getTime();

  let photoIds = [...(input.pending?.photo_ids ?? [])].slice(0, input.imageUrls.length);
  let uploadedAt = input.pending?.photos_uploaded_at ?? undefined;

  // Uma tentativa anterior chegou a pedir o post e ficou sem resposta
  // conclusiva: antes de qualquer outro passo, confere se ele já está na Página.
  const attemptedBefore = input.pending?.publish_attempted_at || null;
  if (attemptedBefore) {
    const existing = await findExistingFacebookPost(input, base, photoIds, attemptedBefore);
    if (existing.kind === "simulated") return simulated();
    if (existing.kind === "found") {
      return {
        success: true,
        simulated: false,
        platformPostId: existing.postId,
        platformResponse: { reconciled: true, reason: "post_already_created", matched_by: existing.match, id: existing.postId, images: photoIds.length },
      };
    }
    if (existing.kind === "unknown") {
      return fail(
        "facebook_publish_unconfirmed",
        `Não foi possível confirmar se o post da tentativa anterior foi criado (${describeFailure(existing.failure)}). Confira a Página antes de reprocessar.`,
        existing.failure.retryable,
      );
    }
    // Não achou — mas um post criado há instantes pode ainda não estar listado.
    const age = now - new Date(attemptedBefore).getTime();
    if (Number.isFinite(age) && age < FACEBOOK_CONFIRM_MIN_AGE_MS) {
      return fail("facebook_publish_confirming", "Aguardando a Meta confirmar a tentativa anterior antes de publicar de novo.", true);
    }
  }

  // Fotos antigas demais já foram descartadas pela Meta: envia de novo.
  if (uploadedAt && now - new Date(uploadedAt).getTime() > FACEBOOK_PHOTO_MAX_AGE_MS) {
    photoIds = [];
    uploadedAt = undefined;
  }

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
    if (isFailure(res)) return fail(`carousel_photo_error_${res.status ?? "network"}`, describeFailure(res), res.retryable);
    const id = res.raw?.id;
    if (!id) return fail("no_photo_id", "Upload de uma imagem do carrossel não retornou id.");
    photoIds.push(id);
    uploadedAt ??= new Date(now).toISOString();
    await savePending(input, { photo_ids: [...photoIds], photos_uploaded_at: uploadedAt, ...(attemptedBefore ? { publish_attempted_at: attemptedBefore } : {}) });
  }

  // Marca a tentativa ANTES de pedir o post. Sem conseguir gravar, não pede:
  // uma resposta perdida viraria post duplicado na tentativa seguinte.
  const attemptedAt = new Date(now).toISOString();
  if (!(await savePending(input, { photo_ids: [...photoIds], photos_uploaded_at: uploadedAt, publish_attempted_at: attemptedAt }))) {
    return fail("pending_save_failed", "Não foi possível registrar a tentativa de publicação. Uma nova tentativa será feita.", true);
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
  if (isFailure(res)) {
    // Recusa definitiva da Meta (4xx): o post não foi criado; libera a marca.
    // Rede, 5xx e 429 mantêm a marca: a próxima tentativa confere antes.
    if (!res.retryable && res.externalRequestSent) await savePending(input, { photo_ids: [...photoIds], photos_uploaded_at: uploadedAt, publish_attempted_at: null });
    return fail(`publish_error_${res.status ?? "network"}`, describeFailure(res), res.retryable);
  }
  // 200 sem id: o post pode existir. A marca fica; reprocessar confere a Página.
  if (!res.externalId) return fail("no_post_id", "A Meta respondeu sem o id do post. Confira a Página antes de reprocessar.");
  return { success: true, simulated: false, platformPostId: res.externalId, platformResponse: { id: res.raw?.id ?? null, images: photoIds.length } };
}
