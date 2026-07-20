// ============================================================================
// Brand Composer — Fase 5.B1
//
// Renderiza camadas visuais de identidade (painel inferior com texto + tela
// final de marca) como PNGs RGBA prontos para overlay do FFmpeg.
//
// Estratégia:
//   1. Constrói SVG determinístico por formato (9:16, 4:5, 1:1).
//   2. Rasteriza com @resvg/resvg-js (autocontido, sem fontconfig).
//   3. Fontes OFL (Inter, Playfair Display) empacotadas em ./assets/fonts.
//
// Regras:
//   - Pure-ish: só faz IO para ler as fontes uma vez em process (cache).
//   - Nunca baixa fontes ou assets em runtime.
//   - Retorna paths temporários; caller é responsável por limpar workDir.
//   - Falha silenciosa: qualquer erro de rasterização retorna null nas layers
//     afetadas — o watermark simples continua funcionando.
// ============================================================================

import { access, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Resvg } from "@resvg/resvg-js";
import { log } from "./logger.js";
import { guardOverlayContent, countWords, OVERLAY_LIMITS } from "./overlay-guard.js";
import type { VideoBrandDto } from "./api-client.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
// dist/brand-composer.js → dist/../assets/fonts
const FONTS_DIR = path.resolve(__dirname, "..", "assets", "fonts");

const FONT_FILES = {
  interRegular: "Inter-Regular.ttf",
  playfairBold: "PlayfairDisplay-Bold.ttf",
} as const;

let fontFilesCache: string[] | null = null;

/**
 * Resolve os caminhos absolutos das fontes empacotadas em ./assets/fonts.
 * @resvg/resvg-js aceita `fontFiles` (não `fontBuffers`) — carregamos por path
 * para manter determinismo e evitar dependência de fontes do sistema.
 */
async function loadFontFiles(): Promise<string[]> {
  if (fontFilesCache) return fontFilesCache;
  const paths = Object.values(FONT_FILES).map((f) => path.join(FONTS_DIR, f));
  // Valida existência — falha cedo com mensagem clara se o COPY do Dockerfile falhar.
  await Promise.all(paths.map((p) => access(p)));
  fontFilesCache = paths;
  return paths;
}

export interface BrandLayerPaths {
  /** Painel inferior com headline/CTA. Aplicado no vídeo inteiro (menos outro). */
  bottomPanelPath: string | null;
  /** Tela final full-frame com logo + companyName + CTA. Últimos N segundos. */
  outroCardPath: string | null;
  /** Duração da tela final (segundos). */
  outroDurationSeconds: number;
}

export interface ComposeBrandLayersInput {
  videoBrand: VideoBrandDto;
  /** Path opcional para a logo já baixada (será embutida no outro card). */
  logoLocalPath: string | null;
  logoMimeType: string | null;
  width: number;
  height: number;
  workDir: string;
  jobId?: string;
}

/**
 * Gera as camadas de marca como PNGs. Retorna paths (ou null quando a camada
 * não faz sentido — sem texto, sem logo, ou erro isolado de rasterização).
 */
export async function composeBrandLayers(
  input: ComposeBrandLayersInput,
): Promise<BrandLayerPaths> {
  const { videoBrand, logoLocalPath, logoMimeType, width, height, workDir, jobId } = input;

  // Fase M2 — o snapshot já traz overlay_* validados (28/45/40 chars); ainda
  // assim aplicamos um guard defensivo para snapshots legados (v1) que caíram
  // no outro.headline/callToAction do contrato antigo.
  const rawContent = videoBrand.content ?? {
    headline: videoBrand.outro?.headline ?? null,
    supportingText: null,
    ctaText: videoBrand.outro?.callToAction ?? null,
    companyName: null,
  };
  const guarded = guardOverlayContent(rawContent);
  const content = guarded.content;
  if (guarded.reasons.length > 0) {
    log.warn("overlay_content_fallback_applied", {
      job_id: jobId,
      reasons: guarded.reasons,
      schema_version: videoBrand.schemaVersion ?? null,
    });
  }
  log.info("overlay_content_validated", {
    job_id: jobId,
    schema_version: videoBrand.schemaVersion ?? null,
    headline_length: content.headline?.length ?? 0,
    headline_words: content.headline ? countWords(content.headline) : 0,
    subheadline_length: content.supportingText?.length ?? 0,
    subheadline_words: content.supportingText ? countWords(content.supportingText) : 0,
    cta_length: content.ctaText?.length ?? 0,
    limits: OVERLAY_LIMITS,
  });

  const hasBottomPanel = !!(content.headline || content.supportingText || content.ctaText);
  const outroEnabled = !!videoBrand.outro?.enabled;
  const outroDurationSeconds = clamp(Number(videoBrand.outro?.durationSeconds ?? 2), 1, 4);

  let fontFiles: string[] = [];
  try {
    fontFiles = await loadFontFiles();
  } catch (err) {
    log.warn("brand_composer_fonts_missing", {
      job_id: jobId,
      fonts_dir: FONTS_DIR,
      message: (err instanceof Error ? err.message : String(err)).slice(0, 200),
    });
    // Sem fontes, ainda desenhamos formas mas o texto vira placeholder.
  }

  let bottomPanelPath: string | null = null;
  if (hasBottomPanel) {
    try {
      const svg = buildBottomPanelSvg({
        width,
        height,
        colors: videoBrand.colors,
        content,
      });
      bottomPanelPath = await rasterizeSvg({
        svg,
        width,
        height,
        fontFiles,
        outPath: path.join(workDir, "brand-bottom-panel.png"),
      });
    } catch (err) {
      log.warn("brand_composer_bottom_panel_failed", {
        job_id: jobId,
        message: (err instanceof Error ? err.message : String(err)).slice(0, 200),
      });
    }
  }

  let outroCardPath: string | null = null;
  if (outroEnabled) {
    try {
      let logoDataUri: string | null = null;
      if (logoLocalPath && logoMimeType) {
        try {
          const buf = await readFile(logoLocalPath);
          logoDataUri = `data:${logoMimeType};base64,${buf.toString("base64")}`;
        } catch { /* logo opcional na tela final */ }
      }
      const svg = buildOutroCardSvg({
        width,
        height,
        colors: videoBrand.colors,
        content,
        logoDataUri,
      });
      outroCardPath = await rasterizeSvg({
        svg,
        width,
        height,
        fontFiles,
        outPath: path.join(workDir, "brand-outro-card.png"),
      });
    } catch (err) {
      log.warn("brand_composer_outro_failed", {
        job_id: jobId,
        message: (err instanceof Error ? err.message : String(err)).slice(0, 200),
      });
    }
  }

  log.info("brand_composer_layers_built", {
    job_id: jobId,
    has_bottom_panel: !!bottomPanelPath,
    has_outro: !!outroCardPath,
    outro_duration_seconds: outroDurationSeconds,
    width,
    height,
  });

  return { bottomPanelPath, outroCardPath, outroDurationSeconds };
}

// ---------------------------------------------------------------------------
// SVG builders (puros — retornam string XML)
// ---------------------------------------------------------------------------

interface ColorsIn {
  primary: string;
  secondary: string;
  accent: string;
  text: string;
  textInverse: string;
  background: string;
}
interface ContentIn {
  headline: string | null;
  supportingText: string | null;
  ctaText: string | null;
  companyName: string | null;
}

/** Escapa caracteres inválidos em conteúdo XML. */
function xmlEscape(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/**
 * Quebra manual de linha por número máximo de caracteres. Preserva palavras.
 * Não usamos foreignObject/CSS wrap porque resvg-js não os suporta bem.
 */
function wrapText(text: string, maxCharsPerLine: number, maxLines: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = "";
  for (const w of words) {
    if (lines.length >= maxLines) break;
    const candidate = current ? `${current} ${w}` : w;
    if (candidate.length <= maxCharsPerLine) {
      current = candidate;
    } else {
      if (current) lines.push(current);
      current = w;
      if (lines.length >= maxLines - 1 && w.length > maxCharsPerLine) {
        // Fase M2 — nunca cortar palavra nem aplicar reticências. Se a última
        // palavra não cabe, descartamos silenciosamente (guard já garantiu
        // que o texto cabe; este caminho só ocorre para snapshots v1 legados).
        current = "";
        break;
      }
    }
  }
  if (current && lines.length < maxLines) lines.push(current);
  return lines;
}

export function buildBottomPanelSvg(params: {
  width: number;
  height: number;
  colors: ColorsIn;
  content: ContentIn;
}): string {
  const { width, height, colors, content } = params;
  const isVertical = height > width;
  const panelH = Math.round(height * (isVertical ? 0.30 : 0.24));
  const panelY = height - panelH;
  const padX = Math.round(width * 0.06);
  const primary = colors.primary || "#111111";
  const textInverse = colors.textInverse || "#FFFFFF";
  const accent = colors.accent || primary;

  // Fase 5.B1.1 — refinamento tipográfico: título +20%, subtítulo +15%,
  // espaçamento entre título e subtítulo ampliado (leading premium).
  const headlineSize = Math.round(width * (isVertical ? 0.055 : 0.048) * 1.2);
  const supportingSize = Math.round(width * 0.032 * 1.15);
  const ctaSize = Math.round(width * 0.028);
  const ctaPadX = Math.round(width * 0.035);
  const ctaPadY = Math.round(width * 0.018);

  const headlineLines = content.headline
    ? wrapText(content.headline, isVertical ? 22 : 26, 2)
    : [];
  // Fase M2 — subtítulo pode ocupar até 2 linhas (guard já limitou a 45 chars
  // e 8 palavras); wrapText nunca oculta palavras — em último caso apenas
  // remove a última se não couber, o guard garante que caiba.
  const supportingLines = content.supportingText
    ? wrapText(content.supportingText, isVertical ? 32 : 40, 2)
    : [];

  let cursorY = panelY + Math.round(panelH * 0.32);
  const headlineTspans = headlineLines
    .map((line, i) => {
      const y = i === 0 ? cursorY : cursorY + i * Math.round(headlineSize * 1.15);
      return `<tspan x="${padX}" y="${y}">${xmlEscape(line)}</tspan>`;
    })
    .join("");
  // Gap ampliado (~0.55x tamanho do headline) entre título e subtítulo.
  cursorY += headlineLines.length * Math.round(headlineSize * 1.15) + Math.round(headlineSize * 0.55);

  const supportingTspans = supportingLines
    .map((line, i) => {
      const y = i === 0 ? cursorY : cursorY + i * Math.round(supportingSize * 1.2);
      return `<tspan x="${padX}" y="${y}">${xmlEscape(line)}</tspan>`;
    })
    .join("");
  const supportingText = supportingLines.length
    ? `<text font-family="Inter" font-size="${supportingSize}" fill="${textInverse}" opacity="0.9">${supportingTspans}</text>`
    : "";

  cursorY += supportingLines.length
    ? supportingLines.length * Math.round(supportingSize * 1.2) + Math.round(width * 0.02)
    : 0;

  const ctaWidthEstimate = content.ctaText
    ? Math.round(content.ctaText.length * ctaSize * 0.62) + ctaPadX * 2
    : 0;
  const ctaHeight = ctaSize + ctaPadY * 2;
  const ctaY = panelY + panelH - Math.round(width * 0.06) - ctaHeight;
  const ctaButton = content.ctaText
    ? `
      <rect x="${padX}" y="${ctaY}" width="${ctaWidthEstimate}" height="${ctaHeight}" rx="${Math.round(ctaHeight / 2)}" fill="${accent}"/>
      <text x="${padX + ctaWidthEstimate / 2}" y="${ctaY + ctaHeight / 2 + Math.round(ctaSize * 0.35)}" font-family="Inter" font-size="${ctaSize}" font-weight="700" fill="${textInverse}" text-anchor="middle">${xmlEscape(content.ctaText)}</text>
    `
    : "";

  // Gradiente do painel: 0 = transparente no topo, opaco no bottom (usa primary).
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
    <defs>
      <linearGradient id="panelGrad" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="${primary}" stop-opacity="0"/>
        <stop offset="30%" stop-color="${primary}" stop-opacity="0.55"/>
        <stop offset="65%" stop-color="${primary}" stop-opacity="0.85"/>
        <stop offset="100%" stop-color="${primary}" stop-opacity="0.98"/>
      </linearGradient>
    </defs>
    <rect x="0" y="${panelY - Math.round(panelH * 0.5)}" width="${width}" height="${panelH + Math.round(panelH * 0.5)}" fill="url(#panelGrad)"/>
    <text font-family="Playfair Display" font-size="${headlineSize}" font-weight="700" fill="${textInverse}">${headlineTspans}</text>
    ${supportingText}
    ${ctaButton}
  </svg>`;
}

export function buildOutroCardSvg(params: {
  width: number;
  height: number;
  colors: ColorsIn;
  content: ContentIn;
  logoDataUri: string | null;
}): string {
  const { width, height, colors, content, logoDataUri } = params;
  const primary = colors.primary || "#111111";
  const secondary = colors.secondary || colors.accent || "#333333";
  const textInverse = colors.textInverse || "#FFFFFF";
  const accent = colors.accent || textInverse;

  const cx = width / 2;
  const cy = height / 2;

  const logoBoxW = Math.round(width * 0.36);
  const logoY = Math.round(cy - width * 0.28);
  const logoImg = logoDataUri
    ? `<image href="${logoDataUri}" x="${cx - logoBoxW / 2}" y="${logoY}" width="${logoBoxW}" height="${logoBoxW}" preserveAspectRatio="xMidYMid meet"/>`
    : "";

  const nameSize = Math.round(width * 0.048);
  const nameY = logoY + logoBoxW + Math.round(width * 0.07);
  const nameText = content.companyName
    ? `<text x="${cx}" y="${nameY}" font-family="Playfair Display" font-weight="700" font-size="${nameSize}" fill="${textInverse}" text-anchor="middle">${xmlEscape(content.companyName)}</text>`
    : "";

  const ctaSize = Math.round(width * 0.032);
  const ctaText = content.ctaText;
  const ctaWidth = ctaText ? Math.round(ctaText.length * ctaSize * 0.62) + Math.round(width * 0.08) : 0;
  const ctaHeight = ctaSize + Math.round(width * 0.03);
  const ctaX = cx - ctaWidth / 2;
  const ctaY = nameY + Math.round(width * 0.06);
  const ctaBlock = ctaText
    ? `
      <rect x="${ctaX}" y="${ctaY}" width="${ctaWidth}" height="${ctaHeight}" rx="${Math.round(ctaHeight / 2)}" fill="${accent}"/>
      <text x="${cx}" y="${ctaY + ctaHeight / 2 + Math.round(ctaSize * 0.35)}" font-family="Inter" font-weight="700" font-size="${ctaSize}" fill="${primary}" text-anchor="middle">${xmlEscape(ctaText)}</text>
    `
    : "";

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
    <defs>
      <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stop-color="${primary}"/>
        <stop offset="100%" stop-color="${secondary}"/>
      </linearGradient>
    </defs>
    <rect width="${width}" height="${height}" fill="url(#bg)"/>
    ${logoImg}
    ${nameText}
    ${ctaBlock}
  </svg>`;
}

// ---------------------------------------------------------------------------
// Rasterization
// ---------------------------------------------------------------------------

async function rasterizeSvg(params: {
  svg: string;
  width: number;
  height: number;
  fontFiles: string[];
  outPath: string;
}): Promise<string> {
  const { svg, width, height, fontFiles, outPath } = params;
  const resvg = new Resvg(svg, {
    background: "rgba(0,0,0,0)",
    fitTo: { mode: "width", value: width },
    font: {
      fontFiles,
      loadSystemFonts: false,
      defaultFontFamily: "Inter",
    },
  });
  const pngData = resvg.render();
  const pngBuffer = pngData.asPng();
  await writeFile(outPath, pngBuffer);
  // Sanidade: sinaliza se altura renderizada diverge da esperada.
  if (pngData.height !== height) {
    log.warn("brand_composer_dimension_mismatch", {
      expected_height: height,
      actual_height: pngData.height,
      actual_width: pngData.width,
    });
  }
  return outPath;
}

function clamp(v: number, min: number, max: number): number {
  if (!Number.isFinite(v)) return min;
  return Math.max(min, Math.min(max, v));
}
