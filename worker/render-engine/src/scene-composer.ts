// ============================================================================
// Scene Composer — converte uma `SceneDefinition` + `VideoLayout` + conteúdo
// aprovado do editor em um SVG full-frame RGBA. O SVG é rasterizado pelo
// `brand-composer.ts` e aplicado como overlay do FFmpeg no lugar do painel
// legado.
//
// O contrato aqui é intencionalmente idêntico ao `SceneRenderer.tsx` (do
// frontend) — as unidades `cqi` do preview traduzem para `% * width` aqui,
// já que o container do preview é sempre `aspect-ratio: 9/16` e inline size
// == width. Assim o vídeo final reflete o preview 1:1.
//
// Regras:
//   - Puro: entrada = dados; saída = string XML. Sem IO.
//   - Ignora layers `element` (biblioteca não portada para o worker).
//   - Nunca cortar palavras: reaproveita a mesma heurística de wrap.
// ============================================================================

import type {
  Align,
  Anchor,
  LogoLayout,
  SceneDefinition,
  SceneLayer,
  TextStyle,
  VideoLayout,
} from "./scenes.js";

export interface SceneComposerContent {
  headline: string | null;
  supportingText: string | null;
  ctaText: string | null;
}

export interface SceneComposerLogo {
  /** data URI (data:image/png;base64,...) — embutido no SVG. */
  dataUri: string;
  /** Layout do editor (mesmo do LogoSlot). */
  layout: LogoLayout;
}

export interface SceneOverlaySvgInput {
  width: number;
  height: number;
  scene: SceneDefinition;
  layout: VideoLayout;
  content: SceneComposerContent;
  /** Logo do Brand Center — se ausente, nenhum logo é desenhado no overlay. */
  logo?: SceneComposerLogo | null;
}

function xmlEscape(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/**
 * Escapa QUALQUER string usada como valor de atributo SVG.
 *
 * Causa raiz do bug "expected space not 'P'": valores como
 * `fontFamily = '"Playfair Display", Georgia, serif'` contêm aspas duplas
 * que fecham o atributo prematuramente. O parser do resvg encontra `P`
 * (de Playfair) onde esperava um espaço/atributo, e falha com
 * `SVG data parsing failed: invalid attribute`.
 */
function attr(s: string | number | undefined | null): string {
  if (s === undefined || s === null) return "";
  return xmlEscape(String(s));
}


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
      if (lines.length >= maxLines) break;
      current = w;
    }
  }
  if (current && lines.length < maxLines) lines.push(current);
  return lines;
}

function parsePaddingCss(css: string, width: number, height: number): {
  top: number; right: number; bottom: number; left: number;
} {
  // Formatos suportados: "V% H%", "V% H% V2% H2%".
  const parts = css.trim().split(/\s+/).map((p) => Number(p.replace("%", "")));
  const [a, b, c, d] = parts;
  if (parts.length === 2) {
    return { top: (a / 100) * height, right: (b / 100) * width, bottom: (a / 100) * height, left: (b / 100) * width };
  }
  if (parts.length === 4) {
    return { top: (a / 100) * height, right: (b / 100) * width, bottom: (c / 100) * height, left: (d / 100) * width };
  }
  const v = (a / 100) * height, h = (a / 100) * width;
  return { top: v, right: h, bottom: v, left: h };
}

function textAnchor(a: Align): "start" | "middle" | "end" {
  if (a === "left") return "start";
  if (a === "right") return "end";
  return "middle";
}
function xForAlign(a: Align, padL: number, padR: number, width: number): number {
  if (a === "left") return padL;
  if (a === "right") return width - padR;
  return width / 2;
}

function renderLayer(layer: SceneLayer, width: number, height: number, index: number): string {
  const opacity = "opacity" in layer && typeof layer.opacity === "number" ? layer.opacity : 1;
  switch (layer.kind) {
    case "gradient": {
      const gradId = `g${index}`;
      const y1 = 0, y2 = 1; // vertical direction assumed (matches all scenes)
      const stopsXml = layer.stops
        .map((s, i) => {
          const at = typeof s.at === "number" ? s.at : (i / Math.max(1, layer.stops.length - 1)) * 100;
          return `<stop offset="${at}%" stop-color="${attr(s.color)}"/>`;
        })
        .join("");
      let rectY = 0, rectH = height;
      if (layer.y === "top") {
        rectY = 0;
        rectH = ((layer.height ?? 35) / 100) * height;
      } else if (layer.y === "bottom") {
        rectH = ((layer.height ?? 45) / 100) * height;
        rectY = height - rectH;
      }
      return `<defs><linearGradient id="${gradId}" x1="0" y1="${y1}" x2="0" y2="${y2}">${stopsXml}</linearGradient></defs>` +
        `<rect x="0" y="${rectY}" width="${width}" height="${rectH}" fill="url(#${gradId})" opacity="${opacity}"/>`;
    }
    case "solid": {
      let rectY = 0, rectH = height;
      if (layer.y === "top") { rectY = 0; rectH = ((layer.height ?? 30) / 100) * height; }
      else if (layer.y === "bottom") { rectH = ((layer.height ?? 30) / 100) * height; rectY = height - rectH; }
      return `<rect x="0" y="${rectY}" width="${width}" height="${rectH}" fill="${layer.color}" opacity="${opacity}"/>`;
    }
    case "angular": {
      // Pontos em coord 0..100. Escala para width/height mantendo aspect.
      const pts = layer.points
        .split(/\s+/)
        .map((p) => {
          const [x, y] = p.split(",").map(Number);
          return `${(x / 100) * width},${(y / 100) * height}`;
        })
        .join(" ");
      return `<polygon points="${pts}" fill="${layer.color}" opacity="${opacity}"/>`;
    }
    case "frame": {
      const inset = ((layer.inset ?? 2) / 100) * width;
      const strokeW = (layer.width / 100) * width;
      const radius = ((layer.radius ?? 0) / 100) * width;
      return `<rect x="${inset}" y="${inset}" width="${width - inset * 2}" height="${height - inset * 2}" fill="none" stroke="${layer.color}" stroke-width="${strokeW}" rx="${radius}" ry="${radius}" opacity="${opacity}"/>`;
    }
    case "vignette": {
      const id = `v${index}`;
      const alpha = Math.min(1, Math.max(0, layer.intensity));
      return `<defs><radialGradient id="${id}" cx="50%" cy="50%" r="60%"><stop offset="40%" stop-color="rgba(0,0,0,0)"/><stop offset="100%" stop-color="rgba(0,0,0,${alpha})"/></radialGradient></defs>` +
        `<rect x="0" y="0" width="${width}" height="${height}" fill="url(#${id})"/>`;
    }
    default: {
      return "";
    }
  }
}

interface RenderedTextBlock {
  svg: string;
  heightPx: number;
}

function renderTextBlock(
  content: string,
  style: TextStyle,
  sizePx: number,
  align: Align,
  cursorY: number,
  padL: number,
  padR: number,
  width: number,
  maxCharsPerLine: number,
  maxLines: number,
): RenderedTextBlock {
  const displayed = style.transform === "uppercase" ? content.toUpperCase() : content;
  const lines = wrapText(displayed, maxCharsPerLine, maxLines);
  if (lines.length === 0) return { svg: "", heightPx: 0 };
  const lineH = sizePx * (style.lineHeight ?? 1.2);
  const anchor = textAnchor(align);
  const x = xForAlign(align, padL, padR, width);
  const color = style.color ?? "#ffffff";
  const ls = style.letterSpacing ? ` letter-spacing="${style.letterSpacing}"` : "";
  const tspans = lines
    .map((line, i) => {
      const y = cursorY + sizePx + i * lineH;
      return `<tspan x="${x}" y="${y}">${xmlEscape(line)}</tspan>`;
    })
    .join("");
  const svg = `<text font-family="${style.fontFamily}" font-weight="${style.weight}" font-size="${sizePx}" fill="${color}" text-anchor="${anchor}"${ls}>${tspans}</text>`;
  const totalH = sizePx + (lines.length - 1) * lineH + sizePx * 0.15;
  return { svg, heightPx: totalH };
}

function renderPillCta(
  content: string,
  style: TextStyle,
  sizePx: number,
  align: Align,
  cursorY: number,
  padL: number,
  padR: number,
  width: number,
): RenderedTextBlock {
  if (!style.pill) {
    return renderTextBlock(content, style, sizePx, align, cursorY, padL, padR, width, 40, 1);
  }
  const label = style.transform === "uppercase" ? content.toUpperCase() : content;
  // Approx text width for sans-serif at 800 weight: ~0.6 * fontSize per char.
  const textW = label.length * sizePx * 0.62;
  const padH = sizePx * 1.0;
  const padV = sizePx * 0.55;
  const pillW = textW + padH * 2;
  const pillH = sizePx + padV * 2;
  let px: number;
  if (align === "left") px = padL;
  else if (align === "right") px = width - padR - pillW;
  else px = (width - pillW) / 2;
  const py = cursorY;
  // Radius: aceita "999px" (redonda) ou "Xpx" — mapeia para px.
  const raw = style.pill.radius;
  const radius = /^\d+/.test(raw) ? Math.min(parseFloat(raw), pillH / 2) : pillH / 2;
  const rect = `<rect x="${px}" y="${py}" width="${pillW}" height="${pillH}" rx="${radius}" ry="${radius}" fill="${style.pill.background}"/>`;
  const ls = style.letterSpacing ? ` letter-spacing="${style.letterSpacing}"` : "";
  const textY = py + padV + sizePx * 0.85;
  const textX = px + pillW / 2;
  const text = `<text x="${textX}" y="${textY}" font-family="${style.fontFamily}" font-weight="${style.weight}" font-size="${sizePx}" fill="${style.pill.foreground}" text-anchor="middle"${ls}>${xmlEscape(label)}</text>`;
  return { svg: rect + text, heightPx: pillH + sizePx * 0.2 };
}

export function buildSceneOverlaySvg(input: SceneOverlaySvgInput): string {
  const { width, height, scene, layout, content, logo } = input;

  // 1. Camadas de fundo (background → foreground).
  const layersSvg = scene.layers.map((l, i) => renderLayer(l, width, height, i)).join("");

  // 2. Bloco de textos.
  const padding = parsePaddingCss(scene.text.padding, width, height);
  const titleSize = 0.072 * layout.title.scale * width;
  const subSize = 0.036 * layout.subtitle.scale * width;
  const ctaSize = 0.026 * layout.cta.scale * width;
  const gapPx = (scene.text.gap / 100) * width;

  // Renderiza cada bloco separadamente para calcular alturas e depois posicionar.
  // Ordem visual = a mesma do SceneRenderer.tsx (preview): título → subtítulo → CTA.
  const blocks: RenderedTextBlock[] = [];
  const anchor: Anchor = layout.title.vAnchor;

  if (content.headline) {
    blocks.push(
      renderTextBlock(content.headline, scene.text.title, titleSize, layout.title.align, 0, padding.left, padding.right, width, 22, 3),
    );
  }
  if (content.supportingText) {
    blocks.push(
      renderTextBlock(content.supportingText, scene.text.subtitle, subSize, layout.subtitle.align, 0, padding.left, padding.right, width, 34, 2),
    );
  }
  if (content.ctaText) {
    blocks.push(renderPillCta(content.ctaText, scene.text.cta, ctaSize, layout.cta.align, 0, padding.left, padding.right, width));
  }

  const totalTextH = blocks.reduce((s, b, i) => s + b.heightPx + (i > 0 ? gapPx : 0), 0);
  let cursorY: number;
  if (anchor === "top") cursorY = padding.top;
  else if (anchor === "center") cursorY = (height - totalTextH) / 2;
  else cursorY = height - padding.bottom - totalTextH;

  const positioned: string[] = [];
  let y = cursorY;
  for (let i = 0; i < blocks.length; i++) {
    positioned.push(`<g transform="translate(0, ${y})">${blocks[i].svg}</g>`);
    y += blocks[i].heightPx + gapPx;
  }

  // 3. Logo (opcional) — desenhada em cima das camadas, mas independente do
  // bloco de textos. Espelha `LogoSlot.tsx`: bounding box definido por
  // `LogoLayout` (âncoras + margens em % do frame) e `objectFit: contain`.
  let logoSvg = "";
  if (logo && logo.dataUri) {
    const ll = logo.layout;
    const innerLeft = (Math.max(0, ll.marginLeft) / 100) * width;
    const innerRight = width - (Math.max(0, ll.marginRight) / 100) * width;
    const innerTop = (Math.max(0, ll.marginTop) / 100) * height;
    const innerBottom = height - (Math.max(0, ll.marginBottom) / 100) * height;
    const boxW = Math.min(0.22 * Math.max(0.1, ll.scale) * width, innerRight - innerLeft);
    const boxH = Math.min(0.20 * height, innerBottom - innerTop);

    let lx: number;
    if (ll.hAnchor === "left") lx = innerLeft;
    else if (ll.hAnchor === "right") lx = innerRight - boxW;
    else lx = (width - boxW) / 2;

    let ly: number;
    if (ll.vAnchor === "top") ly = innerTop;
    else if (ll.vAnchor === "bottom") ly = innerBottom - boxH;
    else ly = (height - boxH) / 2;

    logoSvg = `<image href="${logo.dataUri}" x="${lx}" y="${ly}" width="${boxW}" height="${boxH}" preserveAspectRatio="xMidYMid meet"/>`;
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${layersSvg}${logoSvg}${positioned.join("")}</svg>`;
}
