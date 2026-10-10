// ============================================================================
// Documento do Estúdio Criativo — o modelo ÚNICO de um conteúdo editável,
// seja Vídeo, Carrossel ou Arte. Persistido (versionado) na coluna
// `marketing_contents.design`.
//
//   - Vídeo     = páginas são as cenas (uma foto cada); texto e modelo valem
//                 para o vídeo todo (o render aplica uma única arte por cima).
//   - Carrossel = cada página tem foto, textos e modelo próprios.
//   - Arte      = um carrossel de uma página só.
//
// Tudo aqui é puro (sem IO) e não confia no que recebe: `normalizeDocument`
// transforma qualquer JSON vindo do banco ou do cliente em um documento
// dentro dos limites — ou devolve null.
// ============================================================================

import { OVERLAY_LIMITS } from "../manual-campaign";
import type { VideoLayout } from "../video-editor/layout.types";
import {
  SCENE_FORMATS,
  getScene,
  normalizeFraming,
  normalizeLayout,
  type ImageFraming,
  type SceneFormat,
} from "../video-editor/scenes/registry";

export const STUDIO_DOC_VERSION = 1 as const;

export type StudioKind = "video" | "carousel" | "art";
export const STUDIO_KINDS: Record<StudioKind, string> = { video: "Vídeo", carousel: "Carrossel", art: "Arte" };

/** Formatos permitidos por tipo (o primeiro é o padrão). */
export const KIND_FORMATS: Record<StudioKind, SceneFormat[]> = {
  video: ["story"],
  carousel: ["portrait", "square"],
  art: ["portrait", "square", "story"],
};

/** Limite de páginas por tipo. */
export const KIND_PAGE_LIMITS: Record<StudioKind, { min: number; max: number }> = {
  video: { min: 1, max: 8 },
  carousel: { min: 2, max: 10 },
  art: { min: 1, max: 1 },
};

/** Papel da página na narrativa comercial de um carrossel. */
export const PAGE_ROLES = {
  impacto: "Impacto inicial",
  apresentacao: "Apresentação",
  beneficio: "Benefício",
  diferencial: "Diferencial",
  cta: "Chamada final",
  livre: "Livre",
} as const;
export type PageRole = keyof typeof PAGE_ROLES;

export type PageImageRef =
  | { origin: "marketing"; mediaId: string }
  | { origin: "product"; productId: string; imagePath: string };

export type PageImage = PageImageRef & {
  /** null = padrão seguro do modelo (imagem inteira). */
  framing: ImageFraming | null;
};

export interface PageText {
  headline: string;
  subheadline: string;
  cta: string;
}

export interface StudioPage {
  id: string;
  role: PageRole;
  image: PageImage | null;
  text: PageText;
  /** Modelo, cores, logo e posições desta página. */
  layout: VideoLayout;
  /** Só vídeo: duração da cena em segundos (ausente = divisão igual). */
  seconds?: number;
}

export interface StudioDocument {
  version: typeof STUDIO_DOC_VERSION;
  kind: StudioKind;
  format: SceneFormat;
  pages: StudioPage[];
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function newPageId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `p-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/** Chave estável da imagem — a mesma usada para resolver a prévia. */
export function imageKey(image: PageImageRef): string {
  return image.origin === "marketing" ? `marketing:${image.mediaId}` : `product:${image.productId}:${image.imagePath}`;
}

function clampText(value: unknown, max: number): string {
  // eslint-disable-next-line no-control-regex
  return typeof value === "string" ? value.replace(/[\u0000-\u001F\u007F]+/g, " ").slice(0, max) : "";
}

function normalizeImage(raw: unknown): PageImage | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  // `framing` sem `fit` seria lido como corte antigo; aqui só existe formato novo.
  const framing = o.framing && typeof o.framing === "object" ? normalizeFraming({ fit: "contain", ...(o.framing as object) }, { fit: "contain", fill: "blur" }) : null;
  if (o.origin === "marketing" && typeof o.mediaId === "string" && UUID.test(o.mediaId)) {
    return { origin: "marketing", mediaId: o.mediaId, framing };
  }
  if (o.origin === "product" && typeof o.productId === "string" && UUID.test(o.productId) && typeof o.imagePath === "string" && o.imagePath.length > 0 && o.imagePath.length <= 500) {
    return { origin: "product", productId: o.productId, imagePath: o.imagePath, framing };
  }
  return null;
}

function normalizePage(raw: unknown): StudioPage | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const layoutRaw = (o.layout && typeof o.layout === "object" ? o.layout : {}) as { template?: string };
  const scene = getScene(layoutRaw.template);
  const text = (o.text && typeof o.text === "object" ? o.text : {}) as Record<string, unknown>;
  const seconds = typeof o.seconds === "number" && Number.isFinite(o.seconds) ? Math.min(30, Math.max(1, o.seconds)) : undefined;
  return {
    id: typeof o.id === "string" && o.id.length > 0 && o.id.length <= 64 ? o.id : newPageId(),
    role: typeof o.role === "string" && o.role in PAGE_ROLES ? (o.role as PageRole) : "livre",
    image: normalizeImage(o.image),
    text: {
      headline: clampText(text.headline, OVERLAY_LIMITS.headline),
      subheadline: clampText(text.subheadline, OVERLAY_LIMITS.subheadline),
      cta: clampText(text.cta, OVERLAY_LIMITS.cta),
    },
    layout: normalizeLayout(layoutRaw, scene),
    ...(seconds !== undefined ? { seconds } : {}),
  };
}

/** Valida e normaliza um documento vindo do banco ou do cliente. */
export function normalizeDocument(raw: unknown): StudioDocument | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  if (o.version !== STUDIO_DOC_VERSION) return null;
  if (o.kind !== "video" && o.kind !== "carousel" && o.kind !== "art") return null;
  const kind = o.kind;
  const format = KIND_FORMATS[kind].includes(o.format as SceneFormat) ? (o.format as SceneFormat) : KIND_FORMATS[kind][0];
  const limits = KIND_PAGE_LIMITS[kind];
  const pages = (Array.isArray(o.pages) ? o.pages : []).map(normalizePage).filter((p): p is StudioPage => !!p).slice(0, limits.max);
  if (pages.length < 1) return null;
  // Ids únicos (uma duplicata mal feita não pode quebrar o editor).
  const seen = new Set<string>();
  for (const p of pages) {
    if (seen.has(p.id)) p.id = newPageId();
    seen.add(p.id);
  }
  return { version: STUDIO_DOC_VERSION, kind, format, pages };
}

// ------------------------------ Criação -------------------------------------

export function blankPage(template: string | null | undefined, role: PageRole = "livre", base?: VideoLayout): StudioPage {
  const scene = getScene(template);
  // Página nova herda cores e logo das existentes, para o conjunto ficar coeso.
  const layout = base
    ? { ...scene.defaultLayout, colors: base.colors ?? null, colorMode: base.colorMode, logo: { ...scene.defaultLayout.logo, visible: base.logo.visible, opacity: base.logo.opacity } }
    : scene.defaultLayout;
  return { id: newPageId(), role, image: null, text: { headline: "", subheadline: "", cta: "" }, layout: normalizeLayout(layout, scene) };
}

export function newDocument(kind: StudioKind, template: string | null = null, format?: SceneFormat): StudioDocument {
  const pages = Array.from({ length: KIND_PAGE_LIMITS[kind].min }, () => blankPage(template));
  return { version: STUDIO_DOC_VERSION, kind, format: format && KIND_FORMATS[kind].includes(format) ? format : KIND_FORMATS[kind][0], pages };
}

// ------------------------------ Operações (puras) ---------------------------

export function canAddPage(doc: StudioDocument): boolean {
  return doc.pages.length < KIND_PAGE_LIMITS[doc.kind].max;
}
export function canRemovePage(doc: StudioDocument): boolean {
  return doc.pages.length > KIND_PAGE_LIMITS[doc.kind].min;
}

export function updatePage(doc: StudioDocument, id: string, patch: (page: StudioPage) => StudioPage): StudioDocument {
  return { ...doc, pages: doc.pages.map((p) => (p.id === id ? patch(p) : p)) };
}

/** Aplica a mesma mudança a todas as páginas (cores, logo, texto do vídeo). */
export function updateAllPages(doc: StudioDocument, patch: (page: StudioPage) => StudioPage): StudioDocument {
  return { ...doc, pages: doc.pages.map(patch) };
}

export function addPage(doc: StudioDocument, afterId?: string | null, page?: StudioPage): StudioDocument {
  if (!canAddPage(doc)) return doc;
  const anchor = doc.pages.find((p) => p.id === afterId) ?? doc.pages[doc.pages.length - 1];
  const next = page ?? blankPage(anchor?.layout.template, "livre", anchor?.layout);
  const index = anchor ? doc.pages.indexOf(anchor) + 1 : doc.pages.length;
  return { ...doc, pages: [...doc.pages.slice(0, index), next, ...doc.pages.slice(index)] };
}

export function duplicatePage(doc: StudioDocument, id: string): StudioDocument {
  const source = doc.pages.find((p) => p.id === id);
  if (!source || !canAddPage(doc)) return doc;
  const copy: StudioPage = { ...source, id: newPageId(), text: { ...source.text }, image: source.image ? { ...source.image } : null };
  return addPage(doc, id, copy);
}

export function removePage(doc: StudioDocument, id: string): StudioDocument {
  if (!canRemovePage(doc)) return doc;
  return { ...doc, pages: doc.pages.filter((p) => p.id !== id) };
}

export function movePage(doc: StudioDocument, id: string, delta: -1 | 1): StudioDocument {
  const from = doc.pages.findIndex((p) => p.id === id);
  const to = from + delta;
  if (from < 0 || to < 0 || to >= doc.pages.length) return doc;
  const pages = [...doc.pages];
  [pages[from], pages[to]] = [pages[to], pages[from]];
  return { ...doc, pages };
}

export function setFormat(doc: StudioDocument, format: SceneFormat): StudioDocument {
  return KIND_FORMATS[doc.kind].includes(format) ? { ...doc, format } : doc;
}

/** Tamanho em px do quadro do documento. */
export function documentSize(doc: Pick<StudioDocument, "format">): { width: number; height: number } {
  const f = SCENE_FORMATS[doc.format];
  return { width: f.width, height: f.height };
}

// ------------------------------ Conversões ----------------------------------

export interface VideoSceneInput {
  image: PageImageRef;
  framing: ImageFraming | null;
}

/** Documento de vídeo a partir do conteúdo existente (texto e layout únicos). */
export function documentFromVideo(input: { layout: VideoLayout; text: PageText; scenes: VideoSceneInput[] }): StudioDocument {
  const scenes = input.scenes.slice(0, KIND_PAGE_LIMITS.video.max);
  const layout = normalizeLayout(input.layout, getScene(input.layout.template));
  const pages: StudioPage[] = (scenes.length > 0 ? scenes : [null]).map((scene) => ({
    id: newPageId(),
    role: "livre",
    image: scene ? { ...scene.image, framing: scene.framing } : null,
    text: { ...input.text },
    layout,
  }));
  return { version: STUDIO_DOC_VERSION, kind: "video", format: "story", pages };
}

/**
 * Converte um documento em carrossel reaproveitando fotos, textos, cores e
 * marca. Do vídeo (texto único), a 1ª página fica com título e subtítulo, a
 * última com a chamada, e as do meio só com a foto — nada é inventado.
 */
export function toCarousel(doc: StudioDocument, format: SceneFormat = "portrait"): StudioDocument {
  const limits = KIND_PAGE_LIMITS.carousel;
  let pages: StudioPage[] = doc.pages.slice(0, limits.max).map(({ seconds: _seconds, ...p }) => ({
    ...p,
    id: newPageId(),
    text: { ...p.text },
    image: p.image ? { ...p.image } : null,
  }));
  if (doc.kind === "video") {
    const last = pages.length - 1;
    pages = pages.map((p, i) => ({
      ...p,
      role: i === 0 ? "impacto" : i === last ? "cta" : "apresentacao",
      text: {
        headline: i === 0 || last === 0 ? p.text.headline : "",
        subheadline: i === 0 ? p.text.subheadline : "",
        cta: i === last ? p.text.cta : "",
      },
    }));
  }
  while (pages.length < limits.min) {
    const base = pages[pages.length - 1];
    pages.push({ ...blankPage(base.layout.template, "cta", base.layout), text: { headline: "", subheadline: "", cta: doc.pages[0]?.text.cta ?? "" } });
  }
  return { version: STUDIO_DOC_VERSION, kind: "carousel", format: KIND_FORMATS.carousel.includes(format) ? format : "portrait", pages };
}

/** Referências de imagem do documento, sem repetição, na ordem das páginas. */
export function documentImages(doc: StudioDocument): PageImageRef[] {
  const seen = new Set<string>();
  const out: PageImageRef[] = [];
  for (const p of doc.pages) {
    if (!p.image) continue;
    const key = imageKey(p.image);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(p.image.origin === "marketing" ? { origin: "marketing", mediaId: p.image.mediaId } : { origin: "product", productId: p.image.productId, imagePath: p.image.imagePath });
  }
  return out;
}
