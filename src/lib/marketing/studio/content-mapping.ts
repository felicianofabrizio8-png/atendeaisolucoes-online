// Ponte entre o documento do estúdio e a linha `marketing_contents`.
// Puro (sem IO): o que o servidor grava e como um conteúdo antigo é lido.

import type { MarketingContentFormat, MarketingContentRow } from "../marketing.types";
import { DEFAULT_TEMPLATE } from "../video-editor/layout.types";
import { getScene, normalizeFraming, normalizeLayout } from "../video-editor/scenes/registry";
import {
  documentFromVideo,
  normalizeDocument,
  type PageImageRef,
  type StudioDocument,
  type VideoSceneInput,
} from "./document";

/** Formato da linha de conteúdo para um documento. */
export function contentFormatFor(doc: Pick<StudioDocument, "kind" | "format">): MarketingContentFormat {
  if (doc.kind === "carousel") return "carousel";
  if (doc.kind === "video") return "story";
  return doc.format === "story" ? "story" : "feed";
}

/** Título de lista: o informado, ou o primeiro título escrito nas páginas. */
export function contentTitleFor(doc: StudioDocument, title?: string | null): string {
  const given = title?.trim();
  if (given) return given.slice(0, 200);
  const first = doc.pages.map((p) => p.text.headline.trim()).find(Boolean);
  return first ?? (doc.kind === "carousel" ? "Carrossel" : doc.kind === "art" ? "Arte" : "Vídeo");
}

/** Mídias do acervo citadas no documento (para validar a posse). */
export function documentMediaIds(doc: StudioDocument): string[] {
  return [...new Set(doc.pages.flatMap((p) => (p.image?.origin === "marketing" ? [p.image.mediaId] : [])))];
}

/** Fotos de produto citadas no documento, agrupadas por produto. */
export function documentProductImages(doc: StudioDocument): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  for (const p of doc.pages) {
    if (p.image?.origin !== "product") continue;
    if (!out.has(p.image.productId)) out.set(p.image.productId, new Set());
    out.get(p.image.productId)!.add(p.image.imagePath);
  }
  return out;
}

interface StoredSequenceItem {
  source?: string;
  image_id?: string;
  product_id?: string;
  product_image_path?: string;
  focal_point?: unknown;
}

function legacyScenes(row: MarketingContentRow): VideoSceneInput[] {
  const prompt = row.ai_prompt && typeof row.ai_prompt === "object" ? (row.ai_prompt as { image_sequence?: unknown }) : null;
  const sequence = Array.isArray(prompt?.image_sequence) ? (prompt!.image_sequence as StoredSequenceItem[]) : [];
  const scenes: VideoSceneInput[] = [];
  for (const item of sequence) {
    const image: PageImageRef | null =
      item?.source === "marketing_media" && typeof item.image_id === "string"
        ? { origin: "marketing", mediaId: item.image_id }
        : item?.source === "product_image" && typeof item.product_id === "string" && typeof item.product_image_path === "string"
          ? { origin: "product", productId: item.product_id, imagePath: item.product_image_path }
          : null;
    if (!image) continue;
    const focal = item.focal_point && typeof item.focal_point === "object" ? (item.focal_point as { fit?: unknown }) : null;
    // Enquadramento antigo (só x/y/zoom) era um corte: continua sendo "preencher".
    scenes.push({ image, framing: focal ? normalizeFraming(focal, { fit: focal.fit ? "contain" : "cover", fill: "blur" }) : null });
  }
  if (scenes.length > 0) return scenes;
  if (row.primary_image_media_id) return [{ image: { origin: "marketing", mediaId: row.primary_image_media_id }, framing: null }];
  const ref = row.primary_image_product_ref;
  if (ref?.product_id && ref.image_path) return [{ image: { origin: "product", productId: ref.product_id, imagePath: ref.image_path }, framing: null }];
  return [];
}

/**
 * Documento de um conteúdo: o salvo em `design`, ou — para vídeos anteriores
 * ao estúdio — um documento equivalente montado a partir das colunas atuais.
 * Nada é gravado aqui; conteúdos antigos continuam intactos.
 */
export function documentFromContentRow(row: MarketingContentRow): StudioDocument | null {
  const saved = normalizeDocument(row.design);
  if (saved) return saved;
  // Só campanhas de vídeo têm um equivalente; post de texto/foto não vira documento.
  if (!row.campaign_id || row.format === "whatsapp_cta") return null;
  const scene = getScene(row.video_template ?? DEFAULT_TEMPLATE);
  return documentFromVideo({
    layout: normalizeLayout(row.video_layout ?? scene.defaultLayout, scene),
    text: {
      headline: row.overlay_headline ?? "",
      subheadline: row.overlay_subheadline ?? "",
      cta: row.overlay_cta ?? "",
    },
    scenes: legacyScenes(row),
  });
}

/** O conteúdo é editado pelo estúdio como carrossel ou arte? */
export function studioKindOf(row: Pick<MarketingContentRow, "design">): "carousel" | "art" | null {
  const design = row.design && typeof row.design === "object" ? (row.design as { kind?: unknown }) : null;
  return design?.kind === "carousel" || design?.kind === "art" ? design.kind : null;
}
