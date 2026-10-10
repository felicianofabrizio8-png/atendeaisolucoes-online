// ============================================================================
// Exportação de uma página do estúdio (arte ou página de carrossel) em imagem.
//
// A imagem final é montada no navegador com AS MESMAS peças da prévia:
//   - a cena (formas, logo e textos) é o SVG do compositor compartilhado;
//   - a foto é posicionada por `placeImage`;
//   - o preenchimento desfocado usa os mesmos números (`BLUR`).
// O que muda é só o destino: um <canvas> no tamanho real (1080 px de largura).
//
// Um SVG desenhado como imagem não enxerga as fontes nem as imagens da página,
// então as fontes usadas e a logo são embutidas no próprio SVG (data URI).
// ============================================================================

import { sceneWithPalette } from "../video-editor/palette";
import { BLUR, SCENE_FORMATS, buildSceneOverlaySvgWithMeta, getScene, normalizeFraming, placeImage, type SceneFormat } from "../video-editor/scenes/registry";
import type { StudioPage } from "./document";

/** As mesmas faces de `video-fonts.css` (e do worker). */
export const FONT_FACES = [
  { family: "Inter", weight: 400, file: "Inter-Regular.ttf" },
  { family: "Poppins", weight: 500, file: "Poppins-Medium.ttf" },
  { family: "Poppins", weight: 700, file: "Poppins-Bold.ttf" },
  { family: "Archivo Black", weight: 400, file: "ArchivoBlack-Regular.ttf" },
  { family: "Anton", weight: 400, file: "Anton-Regular.ttf" },
  { family: "Bebas Neue", weight: 400, file: "BebasNeue-Regular.ttf" },
  { family: "Playfair Display", weight: 400, file: "PlayfairDisplay-Bold.ttf" },
  { family: "DM Serif Display", weight: 400, file: "DMSerifDisplay-Regular.ttf" },
  { family: "Pacifico", weight: 400, file: "Pacifico-Regular.ttf" },
] as const;
export type FontFace = (typeof FONT_FACES)[number];

/** Faces de fonte que o SVG realmente usa. */
export function fontFacesInSvg(svg: string): FontFace[] {
  const families = new Set<string>();
  for (const match of svg.matchAll(/font-family="([^"]+)"/g)) {
    // O atributo pode trazer alternativas ("Anton, sans-serif").
    for (const name of match[1].split(",")) families.add(name.trim().replace(/^['"]|['"]$/g, "").replace(/&quot;/g, ""));
  }
  return FONT_FACES.filter((face) => families.has(face.family));
}

/** Embute as fontes no SVG, logo depois da tag de abertura. */
export function svgWithFonts(svg: string, faces: Array<{ family: string; weight: number; dataUri: string }>): string {
  if (faces.length === 0) return svg;
  const css = faces
    .map((f) => `@font-face{font-family:"${f.family}";src:url(${f.dataUri}) format("truetype");font-weight:${f.weight};font-style:normal;}`)
    .join("");
  const end = svg.indexOf(">");
  return `${svg.slice(0, end + 1)}<defs><style>${css}svg{font-synthesis:none;}</style></defs>${svg.slice(end + 1)}`;
}

export const EXPORT_MIME = { png: "image/png", jpeg: "image/jpeg" } as const;
export type ExportType = keyof typeof EXPORT_MIME;

/** Nome de arquivo previsível: "carrossel-pagina-2.png". */
export function exportFileName(kind: "carousel" | "art" | "video", index: number, total: number, type: ExportType = "png"): string {
  const ext = type === "jpeg" ? "jpg" : "png";
  return kind === "carousel" || total > 1 ? `carrossel-pagina-${index + 1}.${ext}` : `arte.${ext}`;
}

// ------------------------------ Navegador -----------------------------------

/**
 * Falha de exportação. `message` é o código estável (mapeado para o texto que
 * o usuário lê); `detail` diz o que aconteceu de fato — "http_400" (link
 * expirado ou sem permissão), "network" (rede ou CORS) ou "decode" (o
 * navegador não conseguiu abrir o arquivo) — para diagnóstico.
 */
export class ExportError extends Error {
  constructor(
    code: string,
    readonly detail: string,
  ) {
    super(code);
    this.name = "ExportError";
  }
}

const dataUriCache = new Map<string, Promise<string>>();

function blobToDataUri(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("export_read_failed"));
    reader.readAsDataURL(blob);
  });
}

async function fetchBlob(url: string, what: "image" | "font" | "logo"): Promise<Blob> {
  let res: Response;
  try {
    // Foto e logo vêm do armazenamento com link assinado: sempre da rede,
    // nunca de uma resposta em cache guardada pela prévia (<img>, sem CORS).
    res = await fetch(url, what === "font" ? undefined : { cache: "no-store" });
  } catch {
    throw new ExportError(`export_${what}_failed`, "network");
  }
  if (!res.ok) throw new ExportError(`export_${what}_failed`, `http_${res.status}`);
  return res.blob();
}

function fetchDataUri(url: string, what: "font" | "logo"): Promise<string> {
  if (url.startsWith("data:")) return Promise.resolve(url);
  let hit = dataUriCache.get(url);
  if (!hit) {
    hit = fetchBlob(url, what).then(blobToDataUri);
    hit.catch(() => dataUriCache.delete(url));
    dataUriCache.set(url, hit);
  }
  return hit;
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.decoding = "sync";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new ExportError("export_image_failed", "decode"));
    img.src = src;
  });
}

/** Baixa a imagem como blob (não "suja" o canvas) e devolve pronta para desenhar. */
async function loadRemoteImage(url: string): Promise<{ img: HTMLImageElement; release: () => void }> {
  if (url.startsWith("data:") || url.startsWith("blob:")) return { img: await loadImage(url), release: () => {} };
  const objectUrl = URL.createObjectURL(await fetchBlob(url, "image"));
  try {
    return { img: await loadImage(objectUrl), release: () => URL.revokeObjectURL(objectUrl) };
  } catch (e) {
    URL.revokeObjectURL(objectUrl);
    throw e;
  }
}

export interface RenderPageInput {
  page: StudioPage;
  format: SceneFormat;
  /** Link da foto da página (null = página sem foto: fundo na cor do modelo). */
  imageUrl: string | null;
  logoUrl: string | null;
  type?: ExportType;
  /** Onde estão os arquivos de fonte. */
  fontBaseUrl?: string;
}

export interface RenderedPage {
  blob: Blob;
  width: number;
  height: number;
  mimeType: string;
}

/** Desenha o fundo desfocado da própria foto (mesmos números da prévia e do FFmpeg). */
function drawBlurFill(ctx: CanvasRenderingContext2D, img: HTMLImageElement, W: number, H: number) {
  const scale = Math.max(W / img.naturalWidth, H / img.naturalHeight) * BLUR.zoom;
  const w = img.naturalWidth * scale;
  const h = img.naturalHeight * scale;
  const x = (W - w) / 2;
  const y = (H - h) / 2;
  ctx.save();
  if (typeof ctx.filter === "string") {
    ctx.filter = `blur(${BLUR.sigma * W}px) brightness(${BLUR.brightness}) saturate(${BLUR.saturation})`;
    ctx.drawImage(img, x, y, w, h);
  } else {
    // Navegador sem filtro no canvas (Safari): desfoque por redução e ampliação.
    const small = document.createElement("canvas");
    small.width = Math.max(8, Math.round(W / 48));
    small.height = Math.max(8, Math.round(H / 48));
    const sctx = small.getContext("2d")!;
    sctx.imageSmoothingQuality = "high";
    sctx.drawImage(img, (x / W) * small.width, (y / H) * small.height, (w / W) * small.width, (h / H) * small.height);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(small, 0, 0, W, H);
    ctx.fillStyle = `rgba(0,0,0,${1 - BLUR.brightness})`;
    ctx.fillRect(0, 0, W, H);
  }
  ctx.restore();
}

/** Renderiza uma página no tamanho real do formato. Só no navegador. */
export async function renderPageImage(input: RenderPageInput): Promise<RenderedPage> {
  const { page, format } = input;
  const type = input.type ?? "png";
  const { width: W, height: H } = SCENE_FORMATS[format];
  const scene = sceneWithPalette(getScene(page.layout.template), page.layout.colors);

  const logoDataUri = input.logoUrl ? await fetchDataUri(input.logoUrl, "logo") : null;
  const built = buildSceneOverlaySvgWithMeta({
    width: W,
    height: H,
    scene,
    layout: page.layout,
    content: { headline: page.text.headline || null, supportingText: page.text.subheadline || null, ctaText: page.text.cta || null },
    logo: logoDataUri ? { dataUri: logoDataUri } : null,
    idPrefix: "exp",
    // Mesma regra da prévia do estúdio: página sem texto é só a foto.
    photoWhenEmpty: true,
  });

  const base = (input.fontBaseUrl ?? "/fonts/video/").replace(/\/?$/, "/");
  const faces = await Promise.all(
    fontFacesInSvg(built.svg).map(async (face) => ({ family: face.family, weight: face.weight, dataUri: await fetchDataUri(base + face.file, "font") })),
  );
  const svg = svgWithFonts(built.svg, faces);

  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("export_canvas_unavailable");
  ctx.imageSmoothingQuality = "high";

  const framing = normalizeFraming(page.image?.framing ?? null, { fit: "contain", fill: scene.image.fill });
  ctx.fillStyle = input.imageUrl && framing.fill === "blur" ? "#000" : scene.palette.background;
  ctx.fillRect(0, 0, W, H);

  if (input.imageUrl) {
    const photo = await loadRemoteImage(input.imageUrl);
    try {
      if (framing.fill === "blur") drawBlurFill(ctx, photo.img, W, H);
      const rect = placeImage({ width: photo.img.naturalWidth, height: photo.img.naturalHeight }, built.imageAreas, framing);
      ctx.drawImage(photo.img, rect.x, rect.y, rect.width, rect.height);
    } finally {
      photo.release();
    }
  }

  const overlayUrl = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml;charset=utf-8" }));
  try {
    const overlay = await loadImage(overlayUrl);
    // Garante que as fontes embutidas já foram aplicadas antes de desenhar.
    if (typeof overlay.decode === "function") await overlay.decode().catch(() => undefined);
    ctx.drawImage(overlay, 0, 0, W, H);
  } catch {
    throw new Error("export_overlay_failed");
  } finally {
    URL.revokeObjectURL(overlayUrl);
  }

  const mimeType = EXPORT_MIME[type];
  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("export_encode_failed"))), mimeType, type === "jpeg" ? 0.92 : undefined);
  });
  return { blob, width: W, height: H, mimeType };
}

/** Entrega o arquivo ao usuário (download do navegador). */
export function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Texto para o usuário, com o detalhe técnico ao final quando existe. */
export function exportErrorMessage(e: unknown): string {
  const code = e instanceof Error ? e.message : "";
  const base = EXPORT_ERROR_MESSAGE[code] ?? "Não foi possível exportar. Tente novamente.";
  const detail = e instanceof ExportError ? e.detail : "";
  if (!detail) return base;
  const why = /^http_(400|401|403)$/.test(detail)
    ? "o link de acesso ao arquivo expirou ou foi recusado"
    : /^http_/.test(detail)
      ? "o armazenamento respondeu com erro"
      : detail === "network"
        ? "falha de rede ou bloqueio do navegador ao baixar o arquivo"
        : "o arquivo não pôde ser lido como imagem";
  return `${base} Motivo: ${why} (${detail}).`;
}

export const EXPORT_ERROR_MESSAGE: Record<string, string> = {
  export_image_failed: "Não foi possível abrir uma das imagens para exportar. Tente novamente ou troque a imagem.",
  export_logo_failed: "Não foi possível carregar a logo da empresa para exportar.",
  export_font_failed: "Não foi possível carregar as fontes para exportar. Verifique a conexão e tente de novo.",
  export_overlay_failed: "Não foi possível desenhar a arte. Tente novamente.",
  export_encode_failed: "O navegador não conseguiu gerar o arquivo de imagem.",
  export_canvas_unavailable: "Este navegador não permite exportar imagens.",
};
