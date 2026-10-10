// ============================================================================
// Scene Composer — converte uma `SceneDefinition` + `VideoLayout` + conteúdo
// aprovado em um SVG full-frame RGBA.
//
// É o ÚNICO desenho da cena: o worker rasteriza este SVG (resvg) e aplica no
// vídeo; o editor do app injeta o mesmo SVG na prévia e nas miniaturas. Por
// isso tudo aqui é determinístico e independe do motor: a quebra de linha usa
// a largura real das fontes (`font-metrics.ts`), nunca o fluxo de texto do
// navegador.
//
// Regras:
//   - Puro: entrada = dados; saída = string XML. Sem IO.
//   - Texto nunca é cortado: se não cabe na largura ou no máximo de linhas, a
//     fonte encolhe até caber.
//   - Toda string que vira atributo passa por `attr()`; cores são sempre
//     `#RRGGBB` validados.
//   - Também devolve a ÁREA DA IMAGEM do modelo (`imageAreas`), usada para
//     enquadrar a foto sem cortar o produto — na prévia e no vídeo.
// ============================================================================

import { FONT_METRICS, METRIC_CHARS } from "./font-metrics.js";
import type { ImageAreas, Rect } from "./image-fit.js";
import {
  FONTS,
  isHexColor,
  normalizeLayout,
  type Align,
  type Anchor,
  type CutoutLayer,
  type FontId,
  type LogoLayout,
  type SceneColor,
  type SceneDefinition,
  type SceneLayer,
  type ScenePalette,
  type TextStyle,
  type VideoLayout,
} from "./scenes.js";

export interface SceneComposerContent {
  headline: string | null;
  supportingText: string | null;
  ctaText: string | null;
}

export interface SceneComposerLogo {
  /** `href` da imagem: data URI no worker, URL assinada na prévia. */
  dataUri: string;
  /** Layout da logo. Ausente = usa `layout.logo`. */
  layout?: LogoLayout;
}

export interface SceneOverlaySvgInput {
  width: number;
  height: number;
  scene: SceneDefinition;
  /** Layout do editor. Aceita dado cru: é normalizado contra a cena. */
  layout: VideoLayout | unknown;
  content: SceneComposerContent;
  /** Logo do Brand Center — se ausente, nenhum logo é desenhado no overlay. */
  logo?: SceneComposerLogo | null;
  /** Prefixo dos ids de gradiente (vários SVGs inline na mesma página). */
  idPrefix?: string;
}

export type Box = Rect;
export type TextPart = "title" | "subtitle" | "cta";

function xmlEscape(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/**
 * Escapa QUALQUER string usada como valor de atributo SVG. Sem isso, um
 * `font-family` com aspas fecha o atributo antes da hora e o resvg falha com
 * "SVG data parsing failed: invalid attribute".
 */
function attr(s: string | number | undefined | null): string {
  if (s === undefined || s === null) return "";
  return xmlEscape(String(s));
}

function n(v: number): string {
  return Number.isFinite(v) ? String(Math.round(v * 100) / 100) : "0";
}

// ------------------------------ Medição de texto ----------------------------

const CHAR_INDEX = new Map<string, number>(Array.from(METRIC_CHARS).map((c, i) => [c, i]));

/** Largura do texto em px, pela tabela de avanços da fonte (sem kerning). */
export function measureText(text: string, font: FontId, sizePx: number, letterSpacingEm = 0): number {
  const metric = FONT_METRICS[font];
  let units = 0;
  let count = 0;
  for (const ch of text) {
    const i = CHAR_INDEX.get(ch);
    units += i === undefined ? metric.avg : metric.w[i];
    count += 1;
  }
  return (units / 1000) * sizePx + letterSpacingEm * sizePx * count;
}

function wrapWords(text: string, font: FontId, sizePx: number, ls: number, maxWidth: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = "";
  for (const w of words) {
    const candidate = current ? `${current} ${w}` : w;
    if (!current || measureText(candidate, font, sizePx, ls) <= maxWidth) current = candidate;
    else {
      lines.push(current);
      current = w;
    }
  }
  if (current) lines.push(current);
  return lines;
}

interface FittedText {
  lines: string[];
  sizePx: number;
  widthPx: number;
}

/** Quebra em até `maxLines`; se não couber, encolhe a fonte (nunca corta). */
function fitText(text: string, font: FontId, sizePx: number, ls: number, maxWidth: number, maxLines: number): FittedText {
  let size = sizePx;
  let lines: string[] = [];
  let widest = 0;
  for (let i = 0; i < 24; i++) {
    lines = wrapWords(text, font, size, ls, maxWidth);
    widest = lines.reduce((m, l) => Math.max(m, measureText(l, font, size, ls)), 0);
    if (lines.length <= maxLines && widest <= maxWidth) break;
    size *= 0.93;
  }
  return { lines, sizePx: size, widthPx: widest };
}

// ------------------------------ Helpers geométricos -------------------------

function colorOf(c: SceneColor, palette: ScenePalette): string {
  const v = c.startsWith("#") ? c : palette[c as keyof ScenePalette];
  return isHexColor(v) ? v : "#000000";
}

function textAnchor(a: Align): "start" | "middle" | "end" {
  return a === "left" ? "start" : a === "right" ? "end" : "middle";
}

function alignX(a: Align, left: number, width: number, itemWidth: number): number {
  if (a === "left") return left;
  if (a === "right") return left + width - itemWidth;
  return left + (width - itemWidth) / 2;
}

interface Ctx {
  W: number;
  H: number;
  palette: ScenePalette;
  anchor: Anchor;
  /** Topo e altura da caixa de texto (px), já com o deslocamento do usuário. */
  boxTop: number;
  boxHeight: number;
  /** Retângulo real ocupado pelos textos (px) ou null se não há texto. */
  block: Box | null;
  /** Alinhamento do título, seguido pelas réguas presas ao texto. */
  blockAlign: Align;
  /** Janela/área da imagem do modelo (px). */
  imageArea: Rect;
  idPrefix: string;
}

/** Converte y/h (% da altura) da camada para px, aplicando espaço e espelho. */
function spanY(layer: SceneLayer, y: number, h: number, ctx: Ctx): { y: number; h: number } {
  const hp = (h / 100) * ctx.H;
  const flipped = !!layer.flip && ctx.anchor === "top";
  if (layer.space === "box") {
    const rel = (y / 100) * ctx.H;
    return { y: flipped ? ctx.boxTop + ctx.boxHeight - rel - hp : ctx.boxTop + rel, h: hp };
  }
  const abs = (y / 100) * ctx.H;
  return { y: flipped ? ctx.H - abs - hp : abs, h: hp };
}

function strokeAttrs(stroke: { color: SceneColor; width: number } | undefined, ctx: Ctx): string {
  if (!stroke) return "";
  return ` stroke="${colorOf(stroke.color, ctx.palette)}" stroke-width="${n((stroke.width / 100) * ctx.W)}"`;
}

/** Caminho SVG da janela de imagem, no formato pedido pelo modelo. */
function windowPath(area: Rect, shape: CutoutLayer["shape"], radiusPx: number, grow = 0): string {
  const x = area.x - grow;
  const y = area.y - grow;
  const w = area.width + grow * 2;
  const h = area.height + grow * 2;
  if (shape === "circle") {
    const r = Math.min(w, h) / 2;
    const cx = x + w / 2;
    const cy = y + h / 2;
    return `M${n(cx - r)},${n(cy)} a${n(r)},${n(r)} 0 1,0 ${n(r * 2)},0 a${n(r)},${n(r)} 0 1,0 ${n(-r * 2)},0 Z`;
  }
  if (shape === "arch") {
    const r = Math.min(w / 2, h);
    return `M${n(x)},${n(y + h)} V${n(y + r)} a${n(r)},${n(r)} 0 0,1 ${n(r * 2)},0 V${n(y + h)} Z`;
  }
  const r = Math.min(radiusPx + grow, w / 2, h / 2);
  return (
    `M${n(x + r)},${n(y)} H${n(x + w - r)} a${n(r)},${n(r)} 0 0,1 ${n(r)},${n(r)} V${n(y + h - r)} ` +
    `a${n(r)},${n(r)} 0 0,1 ${n(-r)},${n(r)} H${n(x + r)} a${n(r)},${n(r)} 0 0,1 ${n(-r)},${n(-r)} V${n(y + r)} ` +
    `a${n(r)},${n(r)} 0 0,1 ${n(r)},${n(-r)} Z`
  );
}

const ATTACHED = new Set<SceneLayer["kind"]>(["textCard", "textBar"]);

function renderLayer(layer: SceneLayer, index: number, ctx: Ctx): string {
  if (layer.when && !layer.when.includes(ctx.anchor)) return "";
  const { W, H, palette } = ctx;
  const opacity = typeof layer.opacity === "number" ? Math.min(1, Math.max(0, layer.opacity)) : 1;
  const op = opacity < 1 ? ` opacity="${n(opacity)}"` : "";
  const flipped = !!layer.flip && ctx.anchor === "top";
  switch (layer.kind) {
    case "rect": {
      const s = spanY(layer, layer.y, layer.h, ctx);
      const r = ((layer.radius ?? 0) / 100) * W;
      const fill = layer.fill ? colorOf(layer.fill, palette) : "none";
      return `<rect x="${n((layer.x / 100) * W)}" y="${n(s.y)}" width="${n((layer.w / 100) * W)}" height="${n(s.h)}" rx="${n(r)}" ry="${n(r)}" fill="${fill}"${strokeAttrs(layer.stroke, ctx)}${op}/>`;
    }
    case "gradient": {
      const s = spanY(layer, layer.y, layer.h, ctx);
      const x = (layer.x / 100) * W;
      const w = (layer.w / 100) * W;
      // Mesma geometria do `linear-gradient(<ângulo>)` do CSS.
      const rad = ((flipped ? 180 - layer.angle : layer.angle) * Math.PI) / 180;
      const dx = Math.sin(rad);
      const dy = -Math.cos(rad);
      const len = Math.abs(w * dx) + Math.abs(s.h * dy);
      const cx = x + w / 2;
      const cy = s.y + s.h / 2;
      const id = `${ctx.idPrefix}g${index}`;
      const stops = layer.stops
        .map((st) => `<stop offset="${n(st.at)}%" stop-color="${colorOf(st.color, palette)}" stop-opacity="${n(st.alpha)}"/>`)
        .join("");
      return (
        `<defs><linearGradient id="${attr(id)}" gradientUnits="userSpaceOnUse" x1="${n(cx - (dx * len) / 2)}" y1="${n(cy - (dy * len) / 2)}" x2="${n(cx + (dx * len) / 2)}" y2="${n(cy + (dy * len) / 2)}">${stops}</linearGradient></defs>` +
        `<rect x="${n(x)}" y="${n(s.y)}" width="${n(w)}" height="${n(s.h)}" fill="url(#${attr(id)})"${op}/>`
      );
    }
    case "poly": {
      const pts = layer.points
        .trim()
        .split(/\s+/)
        .map((p) => {
          const [px, py] = p.split(",").map(Number);
          const s = spanY(layer, py, 0, ctx);
          return `${n((px / 100) * W)},${n(s.y)}`;
        })
        .join(" ");
      return `<polygon points="${pts}" fill="${colorOf(layer.fill, palette)}"${op}/>`;
    }
    case "circle": {
      const s = spanY(layer, layer.cy, 0, ctx);
      const fill = layer.fill ? colorOf(layer.fill, palette) : "none";
      return `<circle cx="${n((layer.cx / 100) * W)}" cy="${n(s.y)}" r="${n((layer.r / 100) * W)}" fill="${fill}"${strokeAttrs(layer.stroke, ctx)}${op}/>`;
    }
    case "vignette": {
      const id = `${ctx.idPrefix}v${index}`;
      const alpha = Math.min(1, Math.max(0, layer.intensity));
      return (
        `<defs><radialGradient id="${attr(id)}" cx="50%" cy="50%" r="72%"><stop offset="45%" stop-color="#000000" stop-opacity="0"/><stop offset="100%" stop-color="#000000" stop-opacity="${n(alpha)}"/></radialGradient></defs>` +
        `<rect x="0" y="0" width="${W}" height="${H}" fill="url(#${attr(id)})"${op}/>`
      );
    }
    case "glow": {
      const id = `${ctx.idPrefix}w${index}`;
      const s = spanY(layer, layer.cy, 0, ctx);
      const cx = (layer.cx / 100) * W;
      const r = (layer.r / 100) * W;
      const c = colorOf(layer.color, palette);
      return (
        `<defs><radialGradient id="${attr(id)}" gradientUnits="userSpaceOnUse" cx="${n(cx)}" cy="${n(s.y)}" r="${n(r)}"><stop offset="0%" stop-color="${c}" stop-opacity="${n(layer.alpha)}"/><stop offset="100%" stop-color="${c}" stop-opacity="0"/></radialGradient></defs>` +
        `<circle cx="${n(cx)}" cy="${n(s.y)}" r="${n(r)}" fill="url(#${attr(id)})"${op}/>`
      );
    }
    case "burst": {
      const s = spanY(layer, layer.cy, 0, ctx);
      const cx = (layer.cx / 100) * W;
      const outer = (layer.r / 100) * W;
      const count = Math.max(3, Math.round(layer.points));
      const base = (((flipped ? -1 : 1) * (layer.rotate ?? 0) - 90) * Math.PI) / 180;
      const pts: string[] = [];
      for (let i = 0; i < count * 2; i++) {
        const radius = i % 2 === 0 ? outer : outer * layer.inner;
        const a = base + (i * Math.PI) / count;
        pts.push(`${n(cx + Math.cos(a) * radius)},${n(s.y + Math.sin(a) * radius)}`);
      }
      const fill = layer.fill ? colorOf(layer.fill, palette) : "none";
      return `<polygon points="${pts.join(" ")}" fill="${fill}"${strokeAttrs(layer.stroke, ctx)} stroke-linejoin="round"${op}/>`;
    }
    case "stripes": {
      const s = spanY(layer, layer.y, layer.h, ctx);
      const x = (layer.x / 100) * W;
      const w = (layer.w / 100) * W;
      const size = Math.max(2, (layer.size / 100) * W);
      const id = `${ctx.idPrefix}s${index}`;
      return (
        `<defs><pattern id="${attr(id)}" patternUnits="userSpaceOnUse" width="${n(size * 2)}" height="${n(size * 2)}" patternTransform="rotate(-45)">` +
        `<rect x="0" y="0" width="${n(size * 2)}" height="${n(size * 2)}" fill="${colorOf(layer.b, palette)}"/>` +
        `<rect x="0" y="0" width="${n(size)}" height="${n(size * 2)}" fill="${colorOf(layer.a, palette)}"/></pattern></defs>` +
        `<rect x="${n(x)}" y="${n(s.y)}" width="${n(w)}" height="${n(s.h)}" fill="url(#${attr(id)})"${op}/>`
      );
    }
    case "dots": {
      const s = spanY(layer, layer.y, layer.h, ctx);
      const x = (layer.x / 100) * W;
      const w = (layer.w / 100) * W;
      const gap = Math.max(4, (layer.gap / 100) * W);
      const r = (layer.r / 100) * W;
      const id = `${ctx.idPrefix}d${index}`;
      return (
        `<defs><pattern id="${attr(id)}" patternUnits="userSpaceOnUse" x="${n(x)}" y="${n(s.y)}" width="${n(gap)}" height="${n(gap)}">` +
        `<circle cx="${n(gap / 2)}" cy="${n(gap / 2)}" r="${n(r)}" fill="${colorOf(layer.fill, palette)}"/></pattern></defs>` +
        `<rect x="${n(x)}" y="${n(s.y)}" width="${n(w)}" height="${n(s.h)}" fill="url(#${attr(id)})"${op}/>`
      );
    }
    case "cutout": {
      const radius = ((layer.radius ?? 0) / 100) * W;
      const hole = windowPath(ctx.imageArea, layer.shape, radius);
      const fill = colorOf(layer.fill, palette);
      // Quadro inteiro com um furo (regra par-ímpar): a foto aparece só na janela.
      let out = `<path d="M0,0 H${W} V${H} H0 Z ${hole}" fill="${fill}" fill-rule="evenodd"${op}/>`;
      if (layer.stroke) {
        const grow = ((layer.stroke.gap ?? 0) / 100) * W;
        out += `<path d="${windowPath(ctx.imageArea, layer.shape, radius, grow)}" fill="none"${strokeAttrs(layer.stroke, ctx)}/>`;
      }
      return out;
    }
    case "textCard": {
      if (!ctx.block) return "";
      const padX = (layer.padX / 100) * W;
      const padY = (layer.padY / 100) * W;
      // De borda a borda: sobra para os lados, para a inclinação não revelar a foto.
      const x = layer.fullBleed ? -W * 0.25 : ctx.block.x - padX;
      const w = layer.fullBleed ? W * 1.5 : ctx.block.width + padX * 2;
      const r = ((layer.radius ?? 0) / 100) * W;
      return `<rect x="${n(x)}" y="${n(ctx.block.y - padY)}" width="${n(w)}" height="${n(ctx.block.height + padY * 2)}" rx="${n(r)}" ry="${n(r)}" fill="${colorOf(layer.fill, palette)}"${strokeAttrs(layer.stroke, ctx)}${op}/>`;
    }
    case "textBar": {
      if (!ctx.block) return "";
      const t = (layer.thickness / 100) * W;
      const gap = (layer.gap / 100) * W;
      const fill = colorOf(layer.fill, palette);
      if (layer.side === "left") {
        return `<rect x="${n(ctx.block.x - gap - t)}" y="${n(ctx.block.y)}" width="${n(t)}" height="${n(ctx.block.height)}" fill="${fill}"${op}/>`;
      }
      const len = Math.min(((layer.length ?? 12) / 100) * W, W);
      // A régua segue o alinhamento do bloco (esquerda/centro/direita).
      const x = alignX(ctx.blockAlign, ctx.block.x, ctx.block.width, len);
      return `<rect x="${n(x)}" y="${n(ctx.block.y - gap - t)}" width="${n(len)}" height="${n(t)}" fill="${fill}"${op}/>`;
    }
    default:
      return "";
  }
}

// ------------------------------ Blocos de texto -----------------------------

interface Piece {
  part: TextPart;
  width: number;
  height: number;
  /** Desenha o bloco com o canto superior esquerdo em (x, y). */
  draw: (x: number, y: number) => string;
  align: Align;
}

/**
 * Monta um bloco de linhas com os efeitos do estilo: tarja por linha, sombra
 * (suave por filtro ou dura por cópia deslocada), contorno, degradê e segunda
 * cor. Tudo em SVG básico, igual no navegador e no rasterizador do worker.
 */
function textPiece(
  part: TextPart,
  fitted: FittedText,
  style: TextStyle,
  font: FontId,
  palette: ScenePalette,
  align: Align,
  idBase: string,
): Piece {
  const size = fitted.sizePx;
  const lineH = size * (style.lineHeight ?? 1.2);
  const cap = (FONT_METRICS[font].cap / 1000) * size;
  const lsEm = style.letterSpacing ?? 0;
  const ls = lsEm * size;
  const f = FONTS[font];
  const lsAttr = ls ? ` letter-spacing="${n(ls)}"` : "";
  const base = colorOf(style.color, palette);
  const padX = (style.plate?.padX ?? 0) * size;
  const width = fitted.widthPx + padX * 2;
  const height = fitted.lines.length * lineH;
  // O espaçamento entre letras sobra depois do último caractere; compensa
  // para o texto centralizado/à direita não ficar deslocado.
  const nudge = align === "center" ? ls / 2 : align === "right" ? ls : 0;
  const common = `font-family="${attr(f.family)}" font-weight="${f.weight}" font-size="${n(size)}" text-anchor="${textAnchor(align)}"${lsAttr}`;
  const accent = style.accent ? colorOf(style.accent.color, palette) : null;
  const lastLine = fitted.lines.length - 1;

  const draw = (x: number, y: number) => {
    const inner = fitted.widthPx;
    const ax = (align === "left" ? x + padX : align === "right" ? x + padX + inner : x + padX + inner / 2) + nudge;
    const baseline = (i: number) => y + i * lineH + (lineH + cap) / 2;
    let defs = "";
    let out = "";

    if (style.plate) {
      const fill = colorOf(style.plate.fill, palette);
      const padY = style.plate.padY * size;
      const r = (style.plate.radius ?? 0) * size;
      fitted.lines.forEach((line, i) => {
        const lw = measureText(line, font, size, lsEm) + padX * 2;
        const lx = alignX(align, x, width, lw);
        const ph = cap + padY * 2;
        out += `<rect x="${n(lx)}" y="${n(baseline(i) - cap - padY)}" width="${n(lw)}" height="${n(ph)}" rx="${n(r)}" ry="${n(r)}" fill="${fill}"/>`;
      });
    }

    let fillAttr = `fill="${base}"`;
    if (style.gradient) {
      const id = `${idBase}t`;
      defs += `<linearGradient id="${attr(id)}" gradientUnits="userSpaceOnUse" x1="0" y1="${n(y)}" x2="0" y2="${n(y + height)}"><stop offset="15%" stop-color="${base}"/><stop offset="100%" stop-color="${colorOf(style.gradient.to, palette)}"/></linearGradient>`;
      fillAttr = `fill="url(#${attr(id)})"`;
    }

    const lineText = (line: string, i: number, extra: string, colored: boolean) => {
      let body = xmlEscape(line);
      let fill = extra;
      if (colored && accent && !style.gradient) {
        const whole = style.accent!.target === "lastLine" && lastLine > 0;
        if (whole) {
          if (i === lastLine) fill = `fill="${accent}"`;
        } else if (i === lastLine) {
          // Uma linha só (ou alvo "última palavra"): destaca a última palavra.
          const cut = line.lastIndexOf(" ");
          body = cut < 0
            ? `<tspan fill="${accent}">${xmlEscape(line)}</tspan>`
            : `${xmlEscape(line.slice(0, cut + 1))}<tspan fill="${accent}">${xmlEscape(line.slice(cut + 1))}</tspan>`;
        }
      }
      return `<text x="${n(ax)}" y="${n(baseline(i))}" ${common} ${fill}>${body}</text>`;
    };

    let filterAttr = "";
    if (style.shadow) {
      const sh = style.shadow;
      const color = colorOf(sh.color, palette);
      const dx = (sh.dx ?? 0) * size;
      const dy = (sh.dy ?? 0) * size;
      const alpha = sh.opacity ?? 1;
      if (sh.blur > 0) {
        const id = `${idBase}f`;
        defs += `<filter id="${attr(id)}" x="-30%" y="-40%" width="160%" height="190%"><feDropShadow dx="${n(dx)}" dy="${n(dy)}" stdDeviation="${n(sh.blur * size)}" flood-color="${color}" flood-opacity="${n(alpha)}"/></filter>`;
        filterAttr = ` filter="url(#${attr(id)})"`;
      } else {
        // Sombra dura: cópia sólida deslocada, atrás do texto.
        out += `<g transform="translate(${n(dx)},${n(dy)})" opacity="${n(alpha)}">${fitted.lines.map((l, i) => lineText(l, i, `fill="${color}"`, false)).join("")}</g>`;
      }
    }

    let glyphs = "";
    if (style.outline) {
      const stroke = `fill="none" stroke="${colorOf(style.outline.color, palette)}" stroke-width="${n(style.outline.width * size * 2)}" stroke-linejoin="round"`;
      glyphs += fitted.lines.map((l, i) => lineText(l, i, stroke, false)).join("");
    }
    glyphs += fitted.lines.map((l, i) => lineText(l, i, fillAttr, true)).join("");
    out += filterAttr ? `<g${filterAttr}>${glyphs}</g>` : glyphs;
    return (defs ? `<defs>${defs}</defs>` : "") + out;
  };

  return { part, align, width, height, draw };
}

// ------------------------------ Resultado -----------------------------------

/**
 * Resultado com metadados determinísticos da composição da cena.
 * `logoRendered` só é `true` quando um elemento `<image>` de logo foi de fato
 * emitido no SVG com caixa positiva e coordenadas finitas — nunca por
 * declaração de intenção.
 */
export interface SceneOverlaySvgResult {
  svg: string;
  /** Prova objetiva: a logo foi desenhada no SVG. */
  logoRendered: boolean;
  /** Motivo sanitizado quando a logo não foi desenhada. */
  logoSkipReason: null | "no_logo_input" | "empty_data_uri" | "invalid_layout" | "degenerate_box" | "hidden_by_user";
  /** Caixa efetiva da logo (para observabilidade/validação). */
  logoBox: Box | null;
  /** Caixa reservada para a logo, mesmo quando não há imagem (prévia). */
  logoSlot: Box;
  /** Caixas dos textos desenhados (px), para seleção direta na prévia. */
  textBoxes: Partial<Record<TextPart, Box>>;
  /** União das caixas de texto. */
  blockBox: Box | null;
  /** Onde a foto deve caber/cobrir neste modelo, com a âncora atual (px). */
  imageAreas: ImageAreas;
  /** Layout efetivamente usado (normalizado). */
  layout: VideoLayout;
}

export function buildSceneOverlaySvg(input: SceneOverlaySvgInput): string {
  return buildSceneOverlaySvgWithMeta(input).svg;
}

const MAX_LINES: Record<TextPart, number> = { title: 3, subtitle: 3, cta: 1 };

/** Área da imagem do modelo em px, espelhada quando o texto vai para o topo. */
export function sceneImageAreas(scene: SceneDefinition, anchor: Anchor, W: number, H: number): ImageAreas {
  const a = scene.image.area;
  const y = anchor === "top" ? 100 - a.y - a.h : a.y;
  const area: Rect = { x: (a.x / 100) * W, y: (y / 100) * H, width: (a.w / 100) * W, height: (a.h / 100) * H };
  const cutout = scene.layers.find((l): l is CutoutLayer => l.kind === "cutout");
  let contain = area;
  if (cutout?.shape === "circle") {
    // Dentro do círculo cabe inteiro o quadrado inscrito.
    const d = Math.min(area.width, area.height);
    const side = d / Math.SQRT2;
    contain = { x: area.x + (area.width - side) / 2, y: area.y + (area.height - side) / 2, width: side, height: side };
  } else if (cutout?.shape === "arch") {
    // Abaixo da curva do arco a janela tem a largura toda; deixa uma folga no topo.
    const r = Math.min(area.width / 2, area.height);
    const inset = area.width * 0.06;
    contain = { x: area.x + inset, y: area.y + r * 0.3, width: area.width - inset * 2, height: area.height - r * 0.3 - inset };
  }
  return { contain, cover: scene.image.window ? area : { x: 0, y: 0, width: W, height: H } };
}

export function buildSceneOverlaySvgWithMeta(input: SceneOverlaySvgInput): SceneOverlaySvgResult {
  const { width: W, height: H, scene, content, logo } = input;
  const rawLayout = (input.layout && typeof input.layout === "object" ? input.layout : {}) as Record<string, unknown>;
  const layout = normalizeLayout(logo?.layout ? { ...rawLayout, logo: logo.layout } : rawLayout, scene);
  const palette = scene.palette;
  const anchor = layout.title.vAnchor;
  const tb = scene.text;
  const idPrefix = (input.idPrefix ?? "").replace(/[^A-Za-z0-9_-]/g, "");

  // 1. Caixa de texto (px).
  const offX = ((layout.offsetX ?? 0) / 100) * W;
  const offY = ((layout.offsetY ?? 0) / 100) * H;
  const boxX = (tb.box.x / 100) * W + offX;
  const boxW = (tb.box.w / 100) * W;
  const safeTop = (tb.box.top / 100) * H;
  const safeBottom = H - (tb.box.bottom / 100) * H;
  const isPanel = typeof tb.box.h === "number";
  const boxHeight = isPanel ? (tb.box.h! / 100) * H : safeBottom - safeTop;
  let boxTop = safeTop;
  if (isPanel) {
    if (anchor === "bottom") boxTop = safeBottom - boxHeight;
    else if (anchor === "center") boxTop = (H - boxHeight) / 2;
  }
  boxTop += offY;

  // 2. Mede e monta cada texto presente.
  const pieces: Piece[] = [];
  const texts: Array<[TextPart, string | null]> = [
    ["title", content.headline],
    ["subtitle", content.supportingText],
    ["cta", content.ctaText],
  ];
  for (const [part, raw] of texts) {
    const value = (raw ?? "").replace(/\s+/g, " ").trim();
    if (!value) continue;
    const style = tb[part];
    const font = layout[part].font ?? style.font;
    const shown = style.uppercase ? value.toUpperCase() : value;
    const baseSize = (style.size / 100) * W * layout[part].scale;
    const ls = style.letterSpacing ?? 0;
    const align = layout[part].align;

    if (part !== "cta" || tb.cta.variant === "underline") {
      // A tarja ocupa espaço lateral: desconta da largura disponível.
      const plateRoom = (style.plate?.padX ?? 0) * baseSize * 2;
      const fitted = fitText(shown, font, baseSize, ls, boxW - plateRoom, MAX_LINES[part]);
      const piece = textPiece(part, fitted, style, font, palette, align, `${idPrefix}${part}`);
      if (part !== "cta") {
        pieces.push(piece);
        continue;
      }
      const ruleGap = fitted.sizePx * 0.28;
      const ruleT = Math.max(2, fitted.sizePx * 0.07);
      pieces.push({
        ...piece,
        height: piece.height + ruleGap + ruleT,
        draw: (x, y) =>
          piece.draw(x, y) +
          `<rect x="${n(x)}" y="${n(y + piece.height + ruleGap)}" width="${n(piece.width)}" height="${n(ruleT)}" fill="${colorOf("accent", palette)}"/>`,
      });
      continue;
    }

    // CTA em botão (cheio ou contorno).
    const cta = tb.cta;
    let size = baseSize;
    let textW = measureText(shown, font, size, ls);
    for (let i = 0; i < 24 && textW + size * 2.4 > boxW; i++) {
      size *= 0.93;
      textW = measureText(shown, font, size, ls);
    }
    const padH = size * 1.2;
    const pillW = textW + padH * 2;
    const pillH = size * 2.3;
    const radius = (pillH / 2) * Math.min(1, Math.max(0, cta.roundness ?? 1));
    const f = FONTS[font];
    const cap = (FONT_METRICS[font].cap / 1000) * size;
    const lsPx = ls * size;
    const outline = cta.variant === "outline";
    const ctaColor = colorOf("cta", palette);
    const labelColor = outline ? ctaColor : colorOf("ctaText", palette);
    const strokeW = Math.max(2, size * 0.09);
    pieces.push({
      part,
      align,
      width: pillW,
      height: pillH,
      draw: (x, y) =>
        (outline
          ? `<rect x="${n(x + strokeW / 2)}" y="${n(y + strokeW / 2)}" width="${n(pillW - strokeW)}" height="${n(pillH - strokeW)}" rx="${n(radius)}" ry="${n(radius)}" fill="none" stroke="${ctaColor}" stroke-width="${n(strokeW)}"/>`
          : `<rect x="${n(x)}" y="${n(y)}" width="${n(pillW)}" height="${n(pillH)}" rx="${n(radius)}" ry="${n(radius)}" fill="${ctaColor}"/>`) +
        `<text x="${n(x + pillW / 2 + lsPx / 2)}" y="${n(y + (pillH + cap) / 2)}" font-family="${attr(f.family)}" font-weight="${f.weight}" font-size="${n(size)}" fill="${labelColor}" text-anchor="middle"${lsPx ? ` letter-spacing="${n(lsPx)}"` : ""}>${xmlEscape(shown)}</text>`,
    });
  }

  // 3. Empilha título → subtítulo → CTA e posiciona pela âncora.
  const gap = (tb.gap / 100) * W;
  const titleExtra = ((layout.title.spacing ?? 0) / 100) * W;
  const gapAfter = (i: number) => (i < pieces.length - 1 ? gap + (pieces[i].part === "title" ? titleExtra : 0) : 0);
  const totalH = pieces.reduce((sum, p, i) => sum + p.height + gapAfter(i), 0);
  let cursor: number;
  if (isPanel || anchor === "center") cursor = boxTop + (boxHeight - totalH) / 2;
  else if (anchor === "top") cursor = boxTop;
  else cursor = boxTop + boxHeight - totalH;

  const textBoxes: Partial<Record<TextPart, Box>> = {};
  const drawn: string[] = [];
  let blockBox: Box | null = null;
  pieces.forEach((p, i) => {
    const x = alignX(p.align, boxX, boxW, p.width);
    const box: Box = { x, y: cursor, width: p.width, height: p.height };
    textBoxes[p.part] = box;
    drawn.push(p.draw(x, cursor));
    if (!blockBox) blockBox = { ...box };
    else {
      const right = Math.max(blockBox.x + blockBox.width, box.x + box.width);
      const bottom = Math.max(blockBox.y + blockBox.height, box.y + box.height);
      blockBox.x = Math.min(blockBox.x, box.x);
      blockBox.y = Math.min(blockBox.y, box.y);
      blockBox.width = right - blockBox.x;
      blockBox.height = bottom - blockBox.y;
    }
    cursor += p.height + gapAfter(i);
  });

  // 4. Camadas. As presas ao texto (cartão, régua) já conhecem o bloco e
  //    entram no mesmo grupo dos textos — assim inclinam junto com ele.
  const imageAreas = sceneImageAreas(scene, anchor, W, H);
  const ctx: Ctx = {
    W, H, palette, anchor, boxTop, boxHeight, block: blockBox,
    blockAlign: layout.title.align,
    imageArea: scene.image.window ? imageAreas.cover : imageAreas.contain,
    idPrefix,
  };
  let layersSvg = "";
  let attachedSvg = "";
  scene.layers.forEach((l, i) => {
    const svg = renderLayer(l, i, ctx);
    if (ATTACHED.has(l.kind)) attachedSvg += svg;
    else layersSvg += svg;
  });
  const block = blockBox as Box | null;
  const tilt = tb.tilt && block ? ` transform="rotate(${n(tb.tilt)} ${n(block.x + block.width / 2)} ${n(block.y + block.height / 2)})"` : "";
  const textSvg = `<g${tilt}>${attachedSvg}${drawn.join("")}</g>`;

  // 5. Logo — caixa definida por `LogoLayout` (âncoras + margens em % do
  // quadro). A imagem encosta no canto ancorado em vez de centralizar na caixa.
  const ll = layout.logo;
  const innerLeft = (ll.marginLeft / 100) * W;
  const innerRight = W - (ll.marginRight / 100) * W;
  const innerTop = (ll.marginTop / 100) * H;
  const innerBottom = H - (ll.marginBottom / 100) * H;
  const logoW = Math.min(0.22 * ll.scale * W, innerRight - innerLeft);
  const logoH = Math.min(logoW, 0.2 * H, innerBottom - innerTop);
  const lx = ll.hAnchor === "left" ? innerLeft : ll.hAnchor === "right" ? innerRight - logoW : (W - logoW) / 2;
  const ly = ll.vAnchor === "top" ? innerTop : ll.vAnchor === "bottom" ? innerBottom - logoH : (H - logoH) / 2;
  const logoSlot: Box = { x: lx, y: ly, width: logoW, height: logoH };

  let logoSvg = "";
  let logoRendered = false;
  let logoSkipReason: SceneOverlaySvgResult["logoSkipReason"] = null;
  let logoBox: Box | null = null;
  if (ll.visible === false) {
    logoSkipReason = "hidden_by_user";
  } else if (!logo) {
    logoSkipReason = "no_logo_input";
  } else if (!logo.dataUri || logo.dataUri.trim().length === 0) {
    logoSkipReason = "empty_data_uri";
  } else {
    // Prova objetiva: caixa positiva, finita e dentro do quadro (ao menos
    // parcialmente). Sem isso o `<image>` sairia invisível e a marca d'água
    // externa seria suprimida indevidamente.
    const finite = [lx, ly, logoW, logoH].every((v) => Number.isFinite(v));
    const MIN_PX = 4;
    const visible = finite && logoW >= MIN_PX && logoH >= MIN_PX && lx + logoW > 0 && ly + logoH > 0 && lx < W && ly < H;
    if (visible) {
      const par =
        `x${ll.hAnchor === "left" ? "Min" : ll.hAnchor === "right" ? "Max" : "Mid"}` +
        `Y${ll.vAnchor === "top" ? "Min" : ll.vAnchor === "bottom" ? "Max" : "Mid"} meet`;
      const alpha = ll.opacity !== undefined && ll.opacity < 1 ? ` opacity="${n(ll.opacity)}"` : "";
      logoSvg = `<image href="${attr(logo.dataUri)}" x="${n(lx)}" y="${n(ly)}" width="${n(logoW)}" height="${n(logoH)}" preserveAspectRatio="${par}"${alpha}/>`;
      logoRendered = true;
      logoBox = logoSlot;
    } else {
      logoSkipReason = "degenerate_box";
    }
  }

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${layersSvg}${logoSvg}${textSvg}</svg>`;
  return { svg, logoRendered, logoSkipReason, logoBox, logoSlot, textBoxes, blockBox, imageAreas, layout };
}
