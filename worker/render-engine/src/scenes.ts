// ============================================================================
// Scene contract — FONTE ÚNICA das cenas (templates) do Vídeo IA.
//
// Este arquivo e o `scene-composer.ts` são puros (sem IO) e são consumidos por
// DOIS lados:
//   - o worker, que rasteriza o SVG da cena e aplica no vídeo;
//   - o editor do app (`src/lib/marketing/video-editor`), que importa estes
//     mesmos módulos para desenhar a prévia.
// Como a prévia e o vídeo saem do mesmo código e dos mesmos dados, não existe
// mais espelho de cenas para manter em sincronia.
//
// Todas as medidas são percentuais do quadro: x/w e tamanhos de texto em % da
// LARGURA; y/h em % da ALTURA. Cores são papéis da paleta (`ColorRole`) ou um
// `#RRGGBB` fixo — nunca CSS arbitrário, porque o valor entra em atributo SVG.
// ============================================================================

import type { ImageFill } from "./image-fit.js";

// ------------------------------ Fontes --------------------------------------

/**
 * Fontes empacotadas em `assets/fonts` (worker) e `public/fonts/video` (app).
 * `family`/`weight` são exatamente o que o rasterizador (resvg) resolve: ele
 * NÃO sintetiza negrito nem lê eixos de fonte variável, então cada entrada
 * corresponde a um arquivo com um único peso.
 */
export const FONTS = {
  inter: { label: "Inter", family: "Inter", weight: 400, file: "Inter-Regular.ttf" },
  "poppins-medium": { label: "Poppins", family: "Poppins", weight: 500, file: "Poppins-Medium.ttf" },
  poppins: { label: "Poppins Bold", family: "Poppins", weight: 700, file: "Poppins-Bold.ttf" },
  archivo: { label: "Archivo Black", family: "Archivo Black", weight: 400, file: "ArchivoBlack-Regular.ttf" },
  anton: { label: "Anton", family: "Anton", weight: 400, file: "Anton-Regular.ttf" },
  bebas: { label: "Bebas Neue", family: "Bebas Neue", weight: 400, file: "BebasNeue-Regular.ttf" },
  playfair: { label: "Playfair Display", family: "Playfair Display", weight: 400, file: "PlayfairDisplay-Bold.ttf" },
  dmserif: { label: "DM Serif Display", family: "DM Serif Display", weight: 400, file: "DMSerifDisplay-Regular.ttf" },
  pacifico: { label: "Pacifico", family: "Pacifico", weight: 400, file: "Pacifico-Regular.ttf" },
} as const;

/**
 * Arquivo da licença (SIL OFL 1.1) de uma fonte, em `assets/fonts/licenses`.
 * Todas as fontes são redistribuídas sem modificação, com a licença junto.
 */
export function fontLicenseFile(fontFile: string): string {
  return `OFL-${fontFile.split("-")[0]}.txt`;
}

export type FontId = keyof typeof FONTS;
export const FONT_IDS = Object.keys(FONTS) as FontId[];

export function isFontId(v: unknown): v is FontId {
  return typeof v === "string" && Object.prototype.hasOwnProperty.call(FONTS, v);
}

// ------------------------------ Cores ---------------------------------------

export type ColorRole = "accent" | "background" | "overlay" | "text" | "cta" | "ctaText";
export const COLOR_ROLES: ColorRole[] = ["accent", "background", "overlay", "text", "cta", "ctaText"];

/** Paleta de uma cena. Todos os valores em `#RRGGBB`. */
export type ScenePalette = Record<ColorRole, string>;

/** Papel da paleta ou cor fixa `#RRGGBB`. */
export type SceneColor = ColorRole | `#${string}`;

const HEX_COLOR_RE = /^#[0-9a-fA-F]{6}$/;

export function isHexColor(v: unknown): v is string {
  return typeof v === "string" && HEX_COLOR_RE.test(v);
}

/** Valida uma paleta vinda do editor/banco. Qualquer campo inválido → null. */
export function sanitizePalette(input: unknown): ScenePalette | null {
  if (!input || typeof input !== "object") return null;
  const o = input as Record<string, unknown>;
  const out = {} as ScenePalette;
  for (const role of COLOR_ROLES) {
    const v = o[role];
    if (!isHexColor(v)) return null;
    out[role] = v.toUpperCase();
  }
  return out;
}

// ------------------------------ Layout do usuário ---------------------------

export type Anchor = "top" | "center" | "bottom";
export type Align = "left" | "center" | "right";

export interface LogoLayout {
  /** 1 = 22% da largura do quadro. */
  scale: number;
  vAnchor: Anchor;
  hAnchor: Align;
  /** Margens em % do quadro. */
  marginTop: number;
  marginBottom: number;
  marginLeft: number;
  marginRight: number;
  /** false = este vídeo sai sem a logo sobre a cena. Padrão: true. */
  visible?: boolean;
  /** 0.2..1 — a transparência do próprio arquivo (PNG) é sempre preservada. */
  opacity?: number;
}

export interface TextLayout {
  /** Multiplicador do tamanho base da cena. */
  scale: number;
  /** Âncora vertical do bloco de textos (vale a do título). */
  vAnchor: Anchor;
  align: Align;
  /** Só no título: espaço extra abaixo dele, em % da largura. */
  spacing?: number;
  /** Troca a fonte definida pela cena. */
  font?: FontId;
}

export const TRANSITIONS = {
  fade: "Esmaecer",
  dissolve: "Dissolver",
  fadeblack: "Passar pelo preto",
  slideleft: "Deslizar para o lado",
  slideup: "Deslizar para cima",
  wipeleft: "Cortina",
  circleopen: "Círculo",
} as const;
export type TransitionId = keyof typeof TRANSITIONS;
export const DEFAULT_TRANSITION: TransitionId = "fade";

export function isTransitionId(v: unknown): v is TransitionId {
  return typeof v === "string" && Object.prototype.hasOwnProperty.call(TRANSITIONS, v);
}

export type ColorMode = "brand" | "template" | "theme" | "custom";

export interface VideoLayout {
  template: TemplateId;
  logo: LogoLayout;
  title: TextLayout;
  subtitle: TextLayout;
  cta: TextLayout;
  /** Deslocamento fino do bloco de textos, em % do quadro. */
  offsetX?: number;
  offsetY?: number;
  /** Paleta escolhida no editor. Ausente/null = cores da própria cena. */
  colors?: ScenePalette | null;
  /** De onde veio a paleta (só para o editor reabrir no mesmo modo). */
  colorMode?: ColorMode;
  /** Transição entre as imagens quando o vídeo tem mais de uma. */
  transition?: TransitionId;
  /** Tela final com a marca. Ausente = ligada, com a duração padrão. */
  outro?: OutroLayout;
  /**
   * Peso (em segundos) de cada cena, na ordem das imagens. É proporcional: o
   * total é sempre a duração do vídeo. Ausente ou com tamanho diferente do
   * número de imagens = tempo dividido igualmente.
   */
  sceneSeconds?: number[];
  /** Entrada dos textos. Ausente = sem animação. */
  animation?: TextAnimationId;
}

/** Entrada do bloco de textos no começo do vídeo. */
export const TEXT_ANIMATIONS = {
  none: "Sem animação",
  fade: "Surgir",
  rise: "Subir",
} as const;
export type TextAnimationId = keyof typeof TEXT_ANIMATIONS;
/** Duração da entrada (s) e quanto o texto sobe em "rise" (fração da altura). */
export const TEXT_ANIMATION = { seconds: 0.6, rise: 0.03 } as const;

export function isTextAnimationId(value: unknown): value is TextAnimationId {
  return typeof value === "string" && value in TEXT_ANIMATIONS;
}

/**
 * Estado do bloco de textos no instante `t` (s): opacidade 0..1 e deslocamento
 * vertical em fração da altura do quadro. A prévia aplica isto em CSS e o
 * FFmpeg aplica a mesma curva (linear) no filtro — ver `ffmpeg.ts`.
 */
export function textAnimationAt(animation: TextAnimationId | null | undefined, t: number): { opacity: number; dy: number } {
  if (!animation || animation === "none") return { opacity: 1, dy: 0 };
  const p = Math.max(0, Math.min(1, t / TEXT_ANIMATION.seconds));
  return { opacity: p, dy: animation === "rise" ? TEXT_ANIMATION.rise * (1 - p) : 0 };
}

export interface OutroLayout {
  enabled: boolean;
  seconds: number;
}

/** Limites da tela final (os mesmos que o FFmpeg aceita). */
export const OUTRO_SECONDS = { min: 1, max: 4, default: 2 } as const;
/** Nenhuma cena fica mais curta que isto (se a duração total permitir). */
export const MIN_SCENE_SECONDS = 1;

/**
 * Duração de cada cena, em segundos, somando exatamente `total`. A MESMA conta
 * vale para a prévia e para o FFmpeg. `weights` inválido = divisão igual.
 */
export function sceneDurations(total: number, count: number, weights?: unknown): number[] {
  if (count <= 0 || !(total > 0)) return [];
  const equal = Array.from({ length: count }, () => total / count);
  if (!Array.isArray(weights) || weights.length !== count) return equal;
  if (!weights.every((w) => typeof w === "number" && Number.isFinite(w) && w > 0)) return equal;
  const min = Math.min(MIN_SCENE_SECONDS, total / count);
  let durations = (weights as number[]).map((w) => w);
  const fixed = new Array<boolean>(count).fill(false);
  // Distribui proporcionalmente; quem ficaria abaixo do mínimo é fixado nele
  // e o restante é redistribuído entre as outras cenas.
  for (let pass = 0; pass < count; pass++) {
    const free = durations.reduce((sum, d, i) => (fixed[i] ? sum : sum + d), 0);
    const room = total - min * fixed.filter(Boolean).length;
    const next = durations.map((d, i) => (fixed[i] ? min : (d / free) * room));
    const low = next.findIndex((d, i) => !fixed[i] && d < min - 1e-9);
    durations = next;
    if (low < 0) break;
    fixed[low] = true;
  }
  return durations;
}

/** Duração do "cross" entre cenas: curta o bastante para a menor cena. */
export function transitionSeconds(durations: number[]): number {
  return durations.length > 1 ? Math.min(0.6, Math.min(...durations) / 3) : 0;
}

/** Segundos da tela final para um layout (0 = desligada pelo usuário). */
export function outroSecondsOf(layout: Pick<VideoLayout, "outro"> | null | undefined): number {
  if (layout?.outro && layout.outro.enabled === false) return 0;
  const s = Number(layout?.outro?.seconds ?? OUTRO_SECONDS.default);
  return Number.isFinite(s) ? Math.max(OUTRO_SECONDS.min, Math.min(OUTRO_SECONDS.max, s)) : OUTRO_SECONDS.default;
}

// ------------------------------ Camadas -------------------------------------

interface LayerBase {
  /**
   * "box" = y/h medidos a partir do topo da caixa de texto e em % da LARGURA
   * do quadro. A camada acompanha o painel quando o usuário muda a posição e
   * mantém a mesma geometria em 9:16, 4:5 e 1:1 (a largura é sempre a mesma).
   * Padrão: coordenadas do quadro (y/h em % da altura).
   */
  space?: "box";
  /** Espelha verticalmente quando o bloco de textos está ancorado no topo. */
  flip?: boolean;
  /** Desenha a camada só nestas âncoras. */
  when?: Anchor[];
  opacity?: number;
}

export interface RectLayer extends LayerBase {
  kind: "rect";
  x: number;
  y: number;
  w: number;
  h: number;
  fill?: SceneColor;
  stroke?: { color: SceneColor; width: number };
  /** Raio em % da largura. */
  radius?: number;
}

export interface GradientLayer extends LayerBase {
  kind: "gradient";
  x: number;
  y: number;
  w: number;
  h: number;
  /** Ângulo no padrão CSS: 180 = de cima para baixo, 90 = para a direita. */
  angle: number;
  stops: Array<{ color: SceneColor; alpha: number; at: number }>;
}

export interface PolyLayer extends LayerBase {
  kind: "poly";
  /** Pontos "x,y x,y …" em % do quadro. */
  points: string;
  fill: SceneColor;
}

export interface CircleLayer extends LayerBase {
  kind: "circle";
  cx: number;
  cy: number;
  /** Raio em % da largura. */
  r: number;
  fill?: SceneColor;
  stroke?: { color: SceneColor; width: number };
}

export interface VignetteLayer extends LayerBase {
  kind: "vignette";
  intensity: number;
}

/** Luz difusa (gradiente radial) — brilho de neon, holofote, calor. */
export interface GlowLayer extends LayerBase {
  kind: "glow";
  cx: number;
  cy: number;
  /** Raio em % da largura. */
  r: number;
  color: SceneColor;
  alpha: number;
}

/** Estrela/selo decorativo (sem texto). */
export interface BurstLayer extends LayerBase {
  kind: "burst";
  cx: number;
  cy: number;
  /** Raio externo em % da largura. */
  r: number;
  points: number;
  /** Raio interno como fração do externo (0..1). */
  inner: number;
  fill?: SceneColor;
  stroke?: { color: SceneColor; width: number };
  rotate?: number;
}

/** Faixa listrada na diagonal (fita de alerta, tarja promocional). */
export interface StripesLayer extends LayerBase {
  kind: "stripes";
  x: number;
  y: number;
  w: number;
  h: number;
  a: SceneColor;
  b: SceneColor;
  /** Largura de cada listra em % da largura. */
  size: number;
}

/** Retícula de pontos (halftone) num retângulo. */
export interface DotsLayer extends LayerBase {
  kind: "dots";
  x: number;
  y: number;
  w: number;
  h: number;
  fill: SceneColor;
  /** Distância entre pontos e raio, em % da largura. */
  gap: number;
  r: number;
}

/**
 * Fundo sólido de quadro inteiro com uma JANELA aberta na área da imagem
 * (`scene.image.area`). Tudo fora da janela fica coberto — por isso, nos
 * modelos com janela, texto e formas nunca passam por cima do produto.
 */
export interface CutoutLayer extends LayerBase {
  kind: "cutout";
  fill: SceneColor;
  shape: "rect" | "circle" | "arch";
  /** Raio dos cantos (só `rect`), em % da largura. */
  radius?: number;
  /** Contorno da janela. */
  stroke?: { color: SceneColor; width: number; gap?: number };
}

/** Cartão que abraça o bloco de textos (medidas em % da largura). */
export interface TextCardLayer extends LayerBase {
  kind: "textCard";
  fill: SceneColor;
  padX: number;
  padY: number;
  radius?: number;
  stroke?: { color: SceneColor; width: number };
  /** Estende o cartão de borda a borda do quadro. */
  fullBleed?: boolean;
}

/** Régua de destaque presa ao bloco de textos. */
export interface TextBarLayer extends LayerBase {
  kind: "textBar";
  side: "left" | "top";
  fill: SceneColor;
  thickness: number;
  gap: number;
  /** Só `side: "top"`: comprimento em % da largura. */
  length?: number;
}

export type SceneLayer =
  | RectLayer
  | GradientLayer
  | PolyLayer
  | CircleLayer
  | VignetteLayer
  | GlowLayer
  | BurstLayer
  | StripesLayer
  | DotsLayer
  | CutoutLayer
  | TextCardLayer
  | TextBarLayer;

// ------------------------------ Tipografia ----------------------------------

export interface TextStyle {
  font: FontId;
  color: SceneColor;
  /** Tamanho base em % da largura (multiplicado pela escala do usuário). */
  size: number;
  uppercase?: boolean;
  /** Em `em`. */
  letterSpacing?: number;
  lineHeight?: number;
  /** Segunda cor: destaca a última palavra ou a última linha. */
  accent?: { color: SceneColor; target: "lastWord" | "lastLine" };
  /** Preenchimento em degradê vertical, de `color` até `to`. */
  gradient?: { to: SceneColor };
  /** Contorno do texto. `width` em fração do tamanho da fonte. */
  outline?: { color: SceneColor; width: number };
  /**
   * Sombra. `blur: 0` = sombra dura deslocada (efeito cartaz/pop); maior que
   * zero = sombra suave para legibilidade sobre foto. Medidas em `em`.
   */
  shadow?: { color: SceneColor; blur: number; dx?: number; dy?: number; opacity?: number };
  /** Tarja atrás de cada linha (marca-texto). Medidas em `em`. */
  plate?: { fill: SceneColor; padX: number; padY: number; radius?: number };
}

export interface CtaStyle extends TextStyle {
  /** pill = botão cheio; outline = só contorno; underline = sublinhado. */
  variant: "pill" | "outline" | "underline";
  /** 0 = cantos retos … 1 = totalmente arredondado. */
  roundness?: number;
}

export interface TextBlockStyle {
  /**
   * Área dos textos. Sem `h`: ocupa de `top` até `bottom` e o bloco se alinha
   * dentro dela conforme a âncora. Com `h`: é um painel de altura fixa que se
   * move com a âncora, e o bloco fica centralizado dentro dele.
   */
  box: { x: number; w: number; top: number; bottom: number; h?: number };
  /** Espaço entre título, subtítulo e CTA, em % da largura. */
  gap: number;
  /** Inclinação do bloco de textos, em graus (cartaz, etiqueta). */
  tilt?: number;
  title: TextStyle;
  subtitle: TextStyle;
  cta: CtaStyle;
}

// ------------------------------ Cena ----------------------------------------

/** Finalidade comercial — é assim que a galeria organiza os modelos. */
export const SCENE_PURPOSES = {
  oferta: "Oferta",
  lancamento: "Lançamento",
  produto: "Produto",
  servico: "Serviço",
  institucional: "Institucional",
  luxo: "Luxo",
  evento: "Datas e eventos",
} as const;
export type ScenePurpose = keyof typeof SCENE_PURPOSES;

export const TEMPLATE_IDS = [
  "oferta", "etiqueta", "urgente", "faixa", "impacto", "bloco", "recorte",
  "duotone", "neon", "gradiente", "festivo", "revista",
  "moderno", "split", "lateral", "moldura", "cartao",
  "glass", "arco", "legenda", "institucional", "clean",
  "premium", "luxo", "editorial",
] as const;

/** Inclui os ids antigos, que continuam abrindo a cena equivalente. */
export type TemplateId = (typeof TEMPLATE_IDS)[number] | "elegante" | "minimalista" | "black";

/** Retângulo em % do quadro (x/w da largura, y/h da altura). */
export interface PercentRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface SceneImage {
  /**
   * Área livre do modelo, onde a imagem inteira cabe no modo "conter" —
   * definida para o texto ancorado na base; espelha quando ele vai ao topo.
   */
  area: PercentRect;
  /** A área é uma janela fechada: "preencher" cobre só ela, não o quadro. */
  window?: boolean;
  /** Preenchimento padrão do que a imagem não cobre. */
  fill: ImageFill;
}

export interface SceneDefinition {
  id: TemplateId;
  label: string;
  description: string;
  /** Finalidades comerciais em que o modelo funciona (a primeira é a principal). */
  purposes: ScenePurpose[];
  /** Cores nativas da cena. */
  palette: ScenePalette;
  /** Sobre o que o texto fica: a sombra da foto ou um painel sólido. */
  textSurface: "overlay" | "background";
  /** Posições verticais que fazem sentido para a cena. */
  anchors: Anchor[];
  image: SceneImage;
  layers: SceneLayer[];
  text: TextBlockStyle;
  defaultLayout: VideoLayout;
}

// ------------------------------ Helpers de definição ------------------------

const ALL: Anchor[] = ["top", "center", "bottom"];
const EDGES: Anchor[] = ["bottom", "top"];
const BLACK = "#000000";
const WHITE = "#FFFFFF";

function palette(p: Partial<ScenePalette>): ScenePalette {
  return { accent: WHITE, background: BLACK, overlay: BLACK, text: WHITE, cta: WHITE, ctaText: BLACK, ...p };
}

/** Sombra em degradê atrás do texto: segue a âncora (base/topo). */
function scrim(height: number, alpha: number, color: SceneColor = "overlay"): GradientLayer {
  return {
    kind: "gradient", x: 0, y: 100 - height, w: 100, h: height, angle: 180, flip: true, when: EDGES,
    stops: [
      { color, alpha: 0, at: 0 },
      { color, alpha: alpha * 0.62, at: 48 },
      { color, alpha, at: 100 },
    ],
  };
}

/** Escurecimento uniforme usado quando o texto vai para o meio. */
function dim(alpha: number, when: Anchor[] = ["center"], color: SceneColor = "overlay"): RectLayer {
  return { kind: "rect", x: 0, y: 0, w: 100, h: 100, fill: color, opacity: alpha, when };
}

/** Sombra discreta e fixa no topo para a logo não sumir em foto clara. */
const LOGO_SHADE: GradientLayer = {
  kind: "gradient", x: 0, y: 0, w: 100, h: 22, angle: 180, when: ["bottom", "center"],
  stops: [{ color: BLACK, alpha: 0.34, at: 0 }, { color: BLACK, alpha: 0, at: 100 }],
};

/** Sombra suave padrão para texto sobre foto. */
const SOFT = { color: BLACK as SceneColor, blur: 0.16, dy: 0.04, opacity: 0.55 };

const SAFE = { x: 7, w: 86, top: 8, bottom: 7 };
/** Área de imagem dos modelos com texto sobre a foto, na base. */
const ABOVE_TEXT: PercentRect = { x: 0, y: 4, w: 100, h: 57 };

interface LayoutSpec {
  v?: Anchor;
  align?: Align;
  title?: number;
  sub?: number;
  cta?: number;
  spacing?: number;
  logo?: Partial<LogoLayout>;
}

function layoutOf(template: TemplateId, s: LayoutSpec = {}): VideoLayout {
  const v = s.v ?? "bottom";
  const align = s.align ?? "left";
  return {
    template,
    logo: {
      scale: 1, vAnchor: v === "top" ? "bottom" : "top", hAnchor: "left",
      marginTop: 5, marginBottom: 5, marginLeft: 6, marginRight: 6,
      visible: true, opacity: 1,
      ...s.logo,
    },
    title: { scale: s.title ?? 1, vAnchor: v, align, spacing: s.spacing ?? 0 },
    subtitle: { scale: s.sub ?? 1, vAnchor: v, align },
    cta: { scale: s.cta ?? 1, vAnchor: v, align },
    offsetX: 0,
    offsetY: 0,
    transition: DEFAULT_TRANSITION,
  };
}

// ------------------------------ Oferta e promoção ---------------------------

const OFERTA: SceneDefinition = {
  id: "oferta", label: "Oferta relâmpago", purposes: ["oferta"],
  description: "Produto inteiro em cima, painel de oferta com corte diagonal e selo.",
  palette: palette({ background: "#E11D2E", overlay: "#E11D2E", accent: "#FFD60A", cta: "#FFD60A", ctaText: "#7F1D1D" }),
  textSurface: "background", anchors: EDGES,
  image: { area: { x: 0, y: 0, w: 100, h: 59 }, fill: "blur" },
  layers: [
    { kind: "poly", space: "box", flip: true, points: "0,-10.7 100,-24.9 100,-18.8 0,-4.6", fill: "accent" },
    { kind: "poly", space: "box", flip: true, points: "0,-4.6 100,-18.8 100,240 0,240", fill: "background" },
    { kind: "dots", space: "box", flip: true, x: 58, y: 30, w: 42, h: 30, fill: "accent", gap: 2.6, r: 0.42, opacity: 0.45 },
    { kind: "burst", space: "box", flip: true, cx: 84, cy: -15.1, r: 10.5, points: 16, inner: 0.8, fill: "accent", rotate: 8 },
    { kind: "burst", space: "box", flip: true, cx: 84, cy: -15.1, r: 7.8, points: 16, inner: 0.8, stroke: { color: "background", width: 0.35 }, rotate: 8 },
  ],
  text: {
    box: { x: 7, w: 86, top: 5, bottom: 4, h: 27 }, gap: 2,
    title: { font: "anton", color: "text", size: 10.4, uppercase: true, lineHeight: 1.1, accent: { color: "accent", target: "lastLine" }, shadow: { color: BLACK, blur: 0, dx: 0.05, dy: 0.06, opacity: 0.28 } },
    subtitle: { font: "poppins", color: "text", size: 3.7, lineHeight: 1.25 },
    cta: { font: "poppins", color: "ctaText", size: 3, uppercase: true, letterSpacing: 0.05, variant: "pill", roundness: 0.3 },
  },
  defaultLayout: layoutOf("oferta"),
};

const ETIQUETA: SceneDefinition = {
  id: "etiqueta", label: "Etiqueta", purposes: ["oferta", "produto"],
  description: "Título em tarjas inclinadas, como etiqueta colada sobre a foto.",
  palette: palette({ background: "#FFD60A", overlay: "#0A0A0A", text: "#111111", accent: "#111111", cta: "#111111", ctaText: "#FFD60A" }),
  textSurface: "background", anchors: ALL,
  image: { area: ABOVE_TEXT, fill: "blur" },
  layers: [scrim(46, 0.72), dim(0.3)],
  text: {
    box: { x: 8, w: 84, top: 10, bottom: 8 }, gap: 2.6, tilt: -3,
    title: { font: "archivo", color: "text", size: 7.6, uppercase: true, lineHeight: 1.42, plate: { fill: "background", padX: 0.32, padY: 0.2, radius: 0.08 } },
    subtitle: { font: "poppins", color: "background", size: 3.4, lineHeight: 1.5, plate: { fill: "accent", padX: 0.5, padY: 0.24, radius: 0.1 } },
    cta: { font: "poppins", color: "ctaText", size: 2.9, uppercase: true, letterSpacing: 0.06, variant: "pill", roundness: 0.15 },
  },
  defaultLayout: layoutOf("etiqueta"),
};

const URGENTE: SceneDefinition = {
  id: "urgente", label: "Últimas unidades", purposes: ["oferta"],
  description: "Fitas listradas de alerta e painel escuro: urgência sem gritar.",
  palette: palette({ background: "#0A0A0A", overlay: "#0A0A0A", accent: "#FFCC00", cta: "#FFCC00", ctaText: "#0A0A0A" }),
  textSurface: "background", anchors: EDGES,
  image: { area: { x: 0, y: 3, w: 100, h: 58 }, fill: "blur" },
  layers: [
    { kind: "stripes", flip: true, x: 0, y: 0, w: 100, h: 2.6, a: "accent", b: "background", size: 3 },
    { kind: "rect", space: "box", flip: true, x: 0, y: -4.6, w: 100, h: 240, fill: "background" },
    { kind: "stripes", space: "box", flip: true, x: 0, y: -9.2, w: 100, h: 4.6, a: "accent", b: "background", size: 3 },
  ],
  text: {
    box: { x: 8, w: 84, top: 5, bottom: 5, h: 31 }, gap: 2.2,
    title: { font: "archivo", color: "text", size: 7.4, uppercase: true, lineHeight: 1.1, accent: { color: "accent", target: "lastLine" } },
    subtitle: { font: "poppins-medium", color: "text", size: 3.4, lineHeight: 1.3 },
    cta: { font: "poppins", color: "ctaText", size: 2.9, uppercase: true, letterSpacing: 0.06, variant: "pill", roundness: 0.12 },
  },
  defaultLayout: layoutOf("urgente", { logo: { marginTop: 6 } }),
};

const FAIXA: SceneDefinition = {
  id: "faixa", label: "Faixa promocional", purposes: ["oferta", "evento"],
  description: "Faixa de borda a borda com título condensado em destaque.",
  palette: palette({ background: "#DC2626", overlay: "#DC2626", accent: "#FDE047", cta: "#FDE047", ctaText: "#7F1D1D" }),
  textSurface: "background", anchors: ALL,
  image: { area: { x: 0, y: 3, w: 100, h: 60 }, fill: "blur" },
  layers: [
    LOGO_SHADE,
    { kind: "textCard", fullBleed: true, fill: "accent", padX: 0, padY: 5.4 },
    { kind: "textCard", fullBleed: true, fill: "background", padX: 0, padY: 4.3 },
  ],
  text: {
    box: { x: 8, w: 84, top: 12, bottom: 9 }, gap: 1.8,
    title: { font: "bebas", color: "text", size: 12.5, uppercase: true, lineHeight: 1.02, letterSpacing: 0.02, accent: { color: "accent", target: "lastWord" } },
    subtitle: { font: "poppins-medium", color: "text", size: 3.5, lineHeight: 1.25 },
    cta: { font: "poppins", color: "ctaText", size: 2.9, uppercase: true, letterSpacing: 0.06, variant: "pill", roundness: 1 },
  },
  defaultLayout: layoutOf("faixa", { align: "center" }),
};

const IMPACTO: SceneDefinition = {
  id: "impacto", label: "Impacto", purposes: ["oferta", "lancamento"],
  description: "Título gigante em degradê com sombra, para parar o dedo.",
  palette: palette({ overlay: "#09090B", background: "#09090B", accent: "#F97316", cta: "#F97316", ctaText: WHITE }),
  textSurface: "overlay", anchors: ALL,
  image: { area: { x: 0, y: 4, w: 100, h: 52 }, fill: "blur" },
  layers: [
    scrim(66, 0.96), dim(0.55),
    { kind: "glow", flip: true, cx: 50, cy: 96, r: 62, color: "accent", alpha: 0.4 },
    { kind: "textBar", side: "top", fill: "accent", thickness: 1.3, gap: 3.4, length: 18 },
  ],
  text: {
    box: { x: 6, w: 88, top: 10, bottom: 7 }, gap: 2.6,
    title: { font: "anton", color: "text", size: 13.5, uppercase: true, lineHeight: 1.08, gradient: { to: "accent" }, shadow: { color: BLACK, blur: 0.12, dy: 0.05, opacity: 0.6 } },
    subtitle: { font: "poppins-medium", color: "text", size: 3.8, lineHeight: 1.3 },
    cta: { font: "poppins", color: "ctaText", size: 3.1, uppercase: true, letterSpacing: 0.06, variant: "pill", roundness: 0.2 },
  },
  defaultLayout: layoutOf("impacto", { align: "center", logo: { hAnchor: "center" } }),
};

const BLOCO: SceneDefinition = {
  id: "bloco", label: "Bloco diagonal", purposes: ["oferta", "servico"],
  description: "Corte diagonal em cor sólida com retícula; energia de varejo.",
  palette: palette({ background: "#4F46E5", overlay: "#4F46E5", accent: "#A5F3FC", cta: WHITE, ctaText: "#312E81" }),
  textSurface: "background", anchors: EDGES,
  image: { area: { x: 0, y: 0, w: 100, h: 60 }, fill: "blur" },
  layers: [
    { kind: "poly", space: "box", flip: true, points: "0,-19.6 100,-4.4 100,240 0,240", fill: "accent", opacity: 0.92 },
    { kind: "poly", space: "box", flip: true, points: "0,-16 100,-0.9 100,240 0,240", fill: "background" },
    { kind: "dots", space: "box", flip: true, x: 64, y: 3.6, w: 36, h: 17.8, fill: "accent", gap: 2.4, r: 0.4, opacity: 0.5 },
  ],
  text: {
    box: { x: 7, w: 86, top: 5, bottom: 4, h: 25 }, gap: 2,
    title: { font: "anton", color: "text", size: 8.2, uppercase: true, lineHeight: 1.12, letterSpacing: 0.01, accent: { color: "accent", target: "lastWord" } },
    subtitle: { font: "poppins-medium", color: "text", size: 3.4, lineHeight: 1.3 },
    cta: { font: "poppins", color: "ctaText", size: 2.7, uppercase: true, letterSpacing: 0.06, variant: "pill", roundness: 1 },
  },
  defaultLayout: layoutOf("bloco"),
};

const RECORTE: SceneDefinition = {
  id: "recorte", label: "Recorte lateral", purposes: ["produto", "oferta"],
  description: "Painel inclinado entrando pela lateral, com o produto livre ao lado.",
  palette: palette({ background: "#0EA5E9", overlay: "#0EA5E9", accent: "#082F49", cta: "#082F49", ctaText: WHITE }),
  textSurface: "background", anchors: EDGES,
  image: { area: { x: 0, y: 0, w: 100, h: 62 }, fill: "blur" },
  layers: [
    { kind: "poly", space: "box", flip: true, points: "0,-8.9 92,-8.9 43.2,160 0,160", fill: "accent", opacity: 0.9 },
    { kind: "poly", space: "box", flip: true, points: "0,-5.3 87,-5.3 36.5,160 0,160", fill: "background" },
  ],
  text: {
    box: { x: 6, w: 63, top: 5, bottom: 4, h: 28 }, gap: 2,
    title: { font: "poppins", color: "text", size: 6.6, lineHeight: 1.08 },
    subtitle: { font: "inter", color: "text", size: 3.3, lineHeight: 1.3 },
    cta: { font: "poppins", color: "ctaText", size: 2.6, uppercase: true, letterSpacing: 0.06, variant: "pill", roundness: 1 },
  },
  defaultLayout: layoutOf("recorte", { logo: { hAnchor: "right" } }),
};

// ------------------------------ Lançamento e vibrantes ----------------------

const DUOTONE: SceneDefinition = {
  id: "duotone", label: "Pop", purposes: ["lancamento", "produto"],
  description: "Produto numa moldura de cantos arredondados sobre cor chapada, título de cartaz.",
  palette: palette({ background: "#5B21B6", overlay: "#5B21B6", accent: "#FDE047", cta: "#FDE047", ctaText: "#3B0764" }),
  textSurface: "background", anchors: EDGES,
  image: { area: { x: 9, y: 8.5, w: 82, h: 46.125 }, window: true, fill: "blur" },
  layers: [
    { kind: "cutout", flip: true, fill: "background", shape: "rect", radius: 7, stroke: { color: "accent", width: 0.9, gap: 2.2 } },
    { kind: "dots", flip: true, x: 0, y: 0, w: 30, h: 7, fill: "accent", gap: 2.8, r: 0.45, opacity: 0.55 },
    { kind: "burst", space: "box", flip: true, cx: 87, cy: -16.9, r: 8, points: 12, inner: 0.72, fill: "accent", rotate: 10 },
  ],
  text: {
    box: { x: 7, w: 86, top: 4, bottom: 4.5, h: 34 }, gap: 2.4,
    title: { font: "bebas", color: "text", size: 14, uppercase: true, lineHeight: 1, letterSpacing: 0.015, shadow: { color: "accent", blur: 0, dx: 0.045, dy: 0.05, opacity: 1 } },
    subtitle: { font: "poppins-medium", color: "text", size: 3.5, lineHeight: 1.3 },
    cta: { font: "poppins", color: "ctaText", size: 2.9, uppercase: true, letterSpacing: 0.08, variant: "pill", roundness: 1 },
  },
  defaultLayout: layoutOf("duotone", { align: "center", logo: { hAnchor: "right", scale: 0.85 } }),
};

const NEON: SceneDefinition = {
  id: "neon", label: "Neon", purposes: ["lancamento", "evento"],
  description: "Clima noturno com brilho, moldura luminosa e título em contorno neon.",
  palette: palette({ overlay: "#060814", background: "#060814", accent: "#22D3EE", cta: "#22D3EE", ctaText: "#06121A" }),
  textSurface: "overlay", anchors: ALL,
  image: { area: { x: 7, y: 6, w: 86, h: 54 }, fill: "blur" },
  layers: [
    { kind: "vignette", intensity: 0.7 },
    scrim(56, 0.96), dim(0.5),
    { kind: "glow", cx: 4, cy: 6, r: 46, color: "accent", alpha: 0.42 },
    { kind: "glow", cx: 98, cy: 96, r: 54, color: "accent", alpha: 0.34 },
    { kind: "rect", x: 2.6, y: 1.5, w: 94.8, h: 97, radius: 3.4, stroke: { color: "accent", width: 0.55 }, opacity: 0.95 },
    { kind: "rect", x: 3.7, y: 2.1, w: 92.6, h: 95.8, radius: 2.7, stroke: { color: "accent", width: 0.16 }, opacity: 0.55 },
  ],
  text: {
    box: { x: 9, w: 82, top: 10, bottom: 8 }, gap: 2.6,
    title: { font: "poppins", color: "text", size: 7.6, lineHeight: 1.1, outline: { color: "accent", width: 0.05 }, shadow: { color: "accent", blur: 0.3, opacity: 0.9 } },
    subtitle: { font: "poppins-medium", color: "text", size: 3.5, lineHeight: 1.3 },
    cta: { font: "poppins", color: "ctaText", size: 2.8, uppercase: true, letterSpacing: 0.08, variant: "pill", roundness: 1 },
  },
  defaultLayout: layoutOf("neon", { logo: { marginTop: 6, marginLeft: 8 } }),
};

const GRADIENTE: SceneDefinition = {
  id: "gradiente", label: "Gradiente vivo", purposes: ["lancamento", "servico"],
  description: "Duas cores em degradê diagonal e anéis; moderno e energético.",
  palette: palette({ overlay: "#7C3AED", background: "#7C3AED", accent: "#FBBF24" }),
  textSurface: "overlay", anchors: ALL,
  image: { area: { x: 0, y: 4, w: 100, h: 56 }, fill: "blur" },
  layers: [
    {
      kind: "gradient", x: 0, y: 0, w: 100, h: 100, angle: 28,
      stops: [{ color: "overlay", alpha: 0.96, at: 0 }, { color: "overlay", alpha: 0.5, at: 44 }, { color: "accent", alpha: 0.22, at: 100 }],
    },
    { kind: "circle", cx: 96, cy: 6, r: 26, stroke: { color: "accent", width: 0.5 }, opacity: 0.6 },
    { kind: "circle", cx: 96, cy: 6, r: 36, stroke: { color: "accent", width: 0.25 }, opacity: 0.45 },
    { kind: "circle", cx: 96, cy: 6, r: 46, stroke: { color: "accent", width: 0.12 }, opacity: 0.35 },
  ],
  text: {
    box: SAFE, gap: 2.4,
    title: { font: "poppins", color: "text", size: 7.8, lineHeight: 1.06, accent: { color: "accent", target: "lastWord" }, shadow: SOFT },
    subtitle: { font: "poppins-medium", color: "text", size: 3.6, lineHeight: 1.3 },
    cta: { font: "poppins", color: "ctaText", size: 2.8, variant: "pill", roundness: 1 },
  },
  defaultLayout: layoutOf("gradiente"),
};

const FESTIVO: SceneDefinition = {
  id: "festivo", label: "Festivo", purposes: ["evento"],
  description: "Letra cursiva em degradê e confetes para datas comemorativas.",
  palette: palette({ overlay: "#831843", background: "#831843", accent: "#FBCFE8", cta: "#FBCFE8", ctaText: "#831843" }),
  textSurface: "overlay", anchors: ALL,
  image: { area: { x: 8, y: 8, w: 84, h: 48 }, fill: "blur" },
  layers: [
    scrim(62, 0.94), dim(0.5),
    { kind: "burst", cx: 13, cy: 8, r: 4.6, points: 5, inner: 0.45, fill: "accent", rotate: -12, opacity: 0.9 },
    { kind: "circle", cx: 88, cy: 13, r: 2.2, fill: "accent", opacity: 0.75 },
    { kind: "burst", cx: 82, cy: 6, r: 3, points: 4, inner: 0.3, fill: "accent", opacity: 0.85 },
    { kind: "circle", cx: 7, cy: 60, r: 1.4, fill: "accent", opacity: 0.8 },
    { kind: "burst", cx: 92, cy: 62, r: 3.4, points: 4, inner: 0.3, fill: "accent", rotate: 20, opacity: 0.85 },
    { kind: "circle", cx: 90, cy: 93, r: 5, stroke: { color: "accent", width: 0.4 }, opacity: 0.8 },
    { kind: "burst", cx: 10, cy: 94, r: 3.8, points: 5, inner: 0.45, fill: "accent", rotate: 18, opacity: 0.85 },
  ],
  text: {
    box: { x: 10, w: 80, top: 14, bottom: 9 }, gap: 2.6,
    title: { font: "pacifico", color: "text", size: 9, lineHeight: 1.28, gradient: { to: "accent" }, shadow: SOFT },
    subtitle: { font: "poppins-medium", color: "text", size: 3.5, lineHeight: 1.3 },
    cta: { font: "poppins", color: "ctaText", size: 2.8, variant: "pill", roundness: 1 },
  },
  defaultLayout: layoutOf("festivo", { align: "center", logo: { hAnchor: "center", marginTop: 4 } }),
};

const REVISTA: SceneDefinition = {
  id: "revista", label: "Capa de revista", purposes: ["lancamento", "luxo"],
  description: "Manchete no topo, como capa de revista, com o produto embaixo.",
  palette: palette({ accent: "#F5F5F4" }),
  textSurface: "overlay", anchors: EDGES,
  image: { area: { x: 0, y: 4, w: 100, h: 60 }, fill: "blur" },
  layers: [
    scrim(48, 0.84),
    { kind: "rect", x: 4, y: 2.25, w: 92, h: 95.5, stroke: { color: "accent", width: 0.22 }, opacity: 0.85 },
    { kind: "textBar", side: "top", fill: "accent", thickness: 0.3, gap: 3, length: 86 },
  ],
  text: {
    box: { x: 9, w: 82, top: 8, bottom: 9 }, gap: 2.4,
    title: { font: "dmserif", color: "text", size: 10, lineHeight: 1.04, shadow: SOFT },
    subtitle: { font: "inter", color: "text", size: 3.2, lineHeight: 1.35, uppercase: true, letterSpacing: 0.12 },
    cta: { font: "inter", color: "text", size: 2.8, uppercase: true, letterSpacing: 0.14, variant: "underline" },
  },
  defaultLayout: layoutOf("revista", { v: "top", logo: { vAnchor: "bottom", hAnchor: "center", marginBottom: 6 } }),
};

// ------------------------------ Produto e serviço ---------------------------

const MODERNO: SceneDefinition = {
  id: "moderno", label: "Moderno", purposes: ["produto", "servico", "oferta"],
  description: "Degradê escuro na base, título forte com palavra em destaque.",
  palette: palette({ accent: "#38BDF8" }), textSurface: "overlay", anchors: ALL,
  image: { area: ABOVE_TEXT, fill: "blur" },
  layers: [LOGO_SHADE, scrim(60, 0.94), dim(0.42)],
  text: {
    box: SAFE, gap: 2.4,
    title: { font: "poppins", color: "text", size: 7.6, lineHeight: 1.08, accent: { color: "accent", target: "lastWord" }, shadow: SOFT },
    subtitle: { font: "inter", color: "text", size: 3.7, lineHeight: 1.3 },
    cta: { font: "poppins", color: "ctaText", size: 2.9, uppercase: true, letterSpacing: 0.06, variant: "pill", roundness: 1 },
  },
  defaultLayout: layoutOf("moderno", { logo: { hAnchor: "right" } }),
};

const SPLIT: SceneDefinition = {
  id: "split", label: "Vitrine", purposes: ["produto", "oferta"],
  description: "Foto em cima, painel sólido embaixo: o produto nunca fica sob o texto.",
  palette: palette({ background: "#0F172A", overlay: "#0F172A", accent: "#F97316", cta: "#F97316", ctaText: "#0F172A" }),
  textSurface: "background", anchors: EDGES,
  image: { area: { x: 0, y: 0, w: 100, h: 61 }, fill: "blur" },
  layers: [
    { kind: "rect", space: "box", flip: true, x: 0, y: -5.3, w: 100, h: 240, fill: "background" },
    { kind: "rect", space: "box", flip: true, x: 0, y: -6.9, w: 100, h: 1.6, fill: "accent" },
    { kind: "rect", space: "box", flip: true, x: 7, y: -6.9, w: 22, h: 1.6, fill: "text" },
  ],
  text: {
    box: { x: 7, w: 86, top: 0, bottom: 4, h: 34 }, gap: 2.2,
    title: { font: "poppins", color: "text", size: 7, lineHeight: 1.08, accent: { color: "accent", target: "lastWord" } },
    subtitle: { font: "inter", color: "text", size: 3.6, lineHeight: 1.3 },
    cta: { font: "poppins", color: "ctaText", size: 2.8, uppercase: true, letterSpacing: 0.06, variant: "pill", roundness: 0.2 },
  },
  defaultLayout: layoutOf("split"),
};

const LATERAL: SceneDefinition = {
  id: "lateral", label: "Régua lateral", purposes: ["servico", "produto"],
  description: "Barra de destaque ao lado do texto e botão em contorno.",
  palette: palette({ accent: "#FACC15", cta: "#FACC15", ctaText: "#111111" }),
  textSurface: "overlay", anchors: ALL,
  image: { area: ABOVE_TEXT, fill: "blur" },
  layers: [LOGO_SHADE, scrim(60, 0.92), dim(0.45), { kind: "textBar", side: "left", fill: "accent", thickness: 1.2, gap: 3.2 }],
  text: {
    box: { x: 12, w: 80, top: 9, bottom: 8 }, gap: 2.2,
    title: { font: "archivo", color: "text", size: 6.6, lineHeight: 1.1, shadow: SOFT },
    subtitle: { font: "inter", color: "text", size: 3.6, lineHeight: 1.3 },
    cta: { font: "poppins", color: "cta", size: 2.7, uppercase: true, letterSpacing: 0.08, variant: "outline", roundness: 0.15 },
  },
  defaultLayout: layoutOf("lateral", { logo: { hAnchor: "right" } }),
};

const MOLDURA: SceneDefinition = {
  id: "moldura", label: "Retrato", purposes: ["produto", "evento"],
  description: "Foto emoldurada como retrato instantâneo, com legenda embaixo.",
  palette: palette({ background: "#FAFAF9", overlay: "#FAFAF9", text: "#18181B", accent: "#DC2626", cta: "#18181B", ctaText: "#FAFAF9" }),
  textSurface: "background", anchors: EDGES,
  image: { area: { x: 6, y: 3.4, w: 88, h: 64 }, window: true, fill: "blur" },
  layers: [
    { kind: "cutout", flip: true, fill: "background", shape: "rect", radius: 1.2 },
    { kind: "textBar", side: "top", fill: "accent", thickness: 0.5, gap: 2.4, length: 9 },
  ],
  text: {
    box: { x: 9, w: 82, top: 3, bottom: 3.4, h: 25 }, gap: 1.8,
    title: { font: "dmserif", color: "text", size: 6.4, lineHeight: 1.1 },
    subtitle: { font: "inter", color: "text", size: 3.1, lineHeight: 1.35 },
    cta: { font: "poppins-medium", color: "ctaText", size: 2.6, variant: "pill", roundness: 1 },
  },
  defaultLayout: layoutOf("moldura", { align: "center", logo: { hAnchor: "left", marginTop: 5.2, marginLeft: 9, scale: 0.8 } }),
};

const CARTAO: SceneDefinition = {
  id: "cartao", label: "Cartão", purposes: ["servico", "produto"],
  description: "Cartão claro arredondado flutuando sobre a foto.",
  palette: palette({ background: "#FAF7F2", overlay: "#FAF7F2", text: "#1C1917", accent: "#B45309", cta: "#1C1917", ctaText: "#FAF7F2" }),
  textSurface: "background", anchors: ALL,
  image: { area: { x: 0, y: 3, w: 100, h: 58 }, fill: "blur" },
  layers: [
    LOGO_SHADE,
    { kind: "textCard", fill: BLACK, opacity: 0.2, padX: 6.5, padY: 6.5, radius: 5.2 },
    { kind: "textCard", fill: "background", padX: 6, padY: 6, radius: 4.6 },
    { kind: "textBar", side: "top", fill: "accent", thickness: 0.6, gap: 2.6, length: 9 },
  ],
  text: {
    box: { x: 13, w: 74, top: 14, bottom: 10 }, gap: 2.2,
    title: { font: "dmserif", color: "text", size: 6.8, lineHeight: 1.1 },
    subtitle: { font: "inter", color: "text", size: 3.4, lineHeight: 1.35 },
    cta: { font: "poppins-medium", color: "ctaText", size: 2.6, variant: "pill", roundness: 1 },
  },
  defaultLayout: layoutOf("cartao"),
};

// ------------------------------ Institucional e limpos ----------------------

const GLASS: SceneDefinition = {
  id: "glass", label: "Vidro", purposes: ["servico", "institucional"],
  description: "Cartão translúcido com borda fina; tecnologia e leveza.",
  palette: palette({ overlay: "#0B1220", background: "#0B1220", accent: "#7DD3FC" }),
  textSurface: "overlay", anchors: ALL,
  image: { area: { x: 0, y: 3, w: 100, h: 60 }, fill: "blur" },
  layers: [
    LOGO_SHADE,
    { kind: "textCard", fill: "overlay", opacity: 0.66, padX: 5, padY: 5, radius: 4.5 },
    { kind: "textCard", fill: "overlay", opacity: 0.2, padX: 5, padY: 5, radius: 4.5, stroke: { color: WHITE, width: 0.22 } },
    { kind: "textBar", side: "top", fill: "accent", thickness: 0.5, gap: 2, length: 8 },
  ],
  text: {
    box: { x: 11, w: 78, top: 12, bottom: 9 }, gap: 2.2,
    title: { font: "poppins", color: "text", size: 6.6, lineHeight: 1.1 },
    subtitle: { font: "poppins-medium", color: "text", size: 3.4, lineHeight: 1.3 },
    cta: { font: "poppins", color: "ctaText", size: 2.7, variant: "pill", roundness: 1 },
  },
  defaultLayout: layoutOf("glass", { align: "center", logo: { hAnchor: "center" } }),
};

const ARCO: SceneDefinition = {
  id: "arco", label: "Arco", purposes: ["servico", "institucional"],
  description: "Grande arco claro subindo da base; acolhedor e humano.",
  palette: palette({ background: "#F5EFE6", overlay: "#F5EFE6", text: "#2B2118", accent: "#C2410C", cta: "#2B2118", ctaText: "#F5EFE6" }),
  textSurface: "background", anchors: EDGES,
  image: { area: { x: 0, y: 0, w: 100, h: 63 }, fill: "blur" },
  layers: [
    { kind: "circle", space: "box", flip: true, cx: 50, cy: 71.1, r: 81, fill: "accent", opacity: 0.92 },
    { kind: "circle", space: "box", flip: true, cx: 50, cy: 72.9, r: 80, fill: "background" },
  ],
  text: {
    box: { x: 14, w: 72, top: 6, bottom: 5, h: 26 }, gap: 2.2,
    title: { font: "dmserif", color: "text", size: 6.8, lineHeight: 1.1, accent: { color: "accent", target: "lastWord" } },
    subtitle: { font: "inter", color: "text", size: 3.3, lineHeight: 1.35 },
    cta: { font: "poppins-medium", color: "ctaText", size: 2.6, uppercase: true, letterSpacing: 0.1, variant: "pill", roundness: 1 },
  },
  defaultLayout: layoutOf("arco", { align: "center", logo: { hAnchor: "center" } }),
};

const LEGENDA: SceneDefinition = {
  id: "legenda", label: "Legenda", purposes: ["servico", "institucional"],
  description: "Caixa de legenda compacta, como em vídeo narrado.",
  palette: palette({ overlay: "#111111", background: "#111111", accent: "#FDE047", cta: "#FDE047", ctaText: "#111111" }),
  textSurface: "overlay", anchors: ALL,
  image: { area: { x: 0, y: 3, w: 100, h: 62 }, fill: "blur" },
  layers: [
    LOGO_SHADE,
    { kind: "textCard", fill: "overlay", opacity: 0.88, padX: 4, padY: 3.6, radius: 2.2 },
    { kind: "textBar", side: "left", fill: "accent", thickness: 0.9, gap: 4 },
  ],
  text: {
    box: { x: 13, w: 74, top: 12, bottom: 13 }, gap: 1.8,
    title: { font: "poppins", color: "text", size: 5.6, lineHeight: 1.14 },
    subtitle: { font: "inter", color: "text", size: 3.2, lineHeight: 1.35 },
    cta: { font: "poppins", color: "cta", size: 2.6, uppercase: true, letterSpacing: 0.08, variant: "underline" },
  },
  defaultLayout: layoutOf("legenda"),
};

const INSTITUCIONAL: SceneDefinition = {
  id: "institucional", label: "Institucional", purposes: ["institucional", "servico"],
  description: "Marca em destaque no topo e mensagem sóbria centralizada.",
  palette: palette({}), textSurface: "overlay", anchors: ALL,
  image: { area: { x: 0, y: 18, w: 100, h: 44 }, fill: "blur" },
  layers: [
    { kind: "gradient", x: 0, y: 0, w: 100, h: 30, angle: 180, stops: [{ color: BLACK, alpha: 0.55, at: 0 }, { color: BLACK, alpha: 0, at: 100 }] },
    scrim(50, 0.9), dim(0.4),
    { kind: "textBar", side: "top", fill: "accent", thickness: 0.3, gap: 3, length: 10 },
  ],
  text: {
    box: { x: 9, w: 82, top: 9, bottom: 8 }, gap: 2.2,
    title: { font: "poppins-medium", color: "text", size: 6.4, lineHeight: 1.14, shadow: SOFT },
    subtitle: { font: "inter", color: "text", size: 3.4, lineHeight: 1.35 },
    cta: { font: "poppins-medium", color: "ctaText", size: 2.7, uppercase: true, letterSpacing: 0.08, variant: "pill", roundness: 1 },
  },
  defaultLayout: layoutOf("institucional", { align: "center", logo: { hAnchor: "center", scale: 1.4, marginTop: 6 } }),
};

const CLEAN: SceneDefinition = {
  id: "clean", label: "Minimalista", purposes: ["institucional", "produto"],
  description: "Quase nada além da foto: texto fino, sublinhado e respiro.",
  palette: palette({}), textSurface: "overlay", anchors: ALL,
  image: { area: { x: 0, y: 4, w: 100, h: 62 }, fill: "blur" },
  layers: [LOGO_SHADE, scrim(44, 0.66), dim(0.3)],
  text: {
    box: { x: 8, w: 84, top: 9, bottom: 8 }, gap: 2,
    title: { font: "inter", color: "text", size: 6.4, lineHeight: 1.16, shadow: SOFT },
    subtitle: { font: "inter", color: "text", size: 3.2, lineHeight: 1.4 },
    cta: { font: "inter", color: "text", size: 2.5, uppercase: true, letterSpacing: 0.14, variant: "underline" },
  },
  defaultLayout: layoutOf("clean", { logo: { hAnchor: "center", scale: 0.85, marginTop: 6 } }),
};

// ------------------------------ Luxo e sofisticados -------------------------

const PREMIUM: SceneDefinition = {
  id: "premium", label: "Premium", purposes: ["luxo", "produto"],
  description: "Moldura fina dourada e serifa clássica em degradê.",
  palette: palette({ accent: "#D4AF37", cta: "#D4AF37", ctaText: "#1A1206" }),
  textSurface: "overlay", anchors: ALL,
  image: { area: { x: 7, y: 5, w: 86, h: 55 }, fill: "blur" },
  layers: [
    { kind: "vignette", intensity: 0.5 },
    scrim(58, 0.92), dim(0.5),
    { kind: "rect", x: 3.4, y: 1.9, w: 93.2, h: 96.2, radius: 0.6, stroke: { color: "accent", width: 0.4 }, opacity: 0.9 },
    { kind: "textBar", side: "top", fill: "accent", thickness: 0.25, gap: 3.6, length: 12 },
  ],
  text: {
    box: { x: 11, w: 78, top: 12, bottom: 8 }, gap: 2.8,
    title: { font: "playfair", color: "text", size: 8.2, lineHeight: 1.12, gradient: { to: "accent" }, shadow: SOFT },
    subtitle: { font: "inter", color: "text", size: 3.4, lineHeight: 1.4, letterSpacing: 0.02 },
    cta: { font: "poppins-medium", color: "ctaText", size: 2.6, uppercase: true, letterSpacing: 0.16, variant: "pill", roundness: 0.08 },
  },
  defaultLayout: layoutOf("premium", { align: "center", spacing: 1, logo: { hAnchor: "center", marginTop: 6, scale: 1.1 } }),
};

const LUXO: SceneDefinition = {
  id: "luxo", label: "Galeria", purposes: ["luxo"],
  description: "Produto numa janela em arco sobre fundo escuro, com fios dourados.",
  palette: palette({ overlay: "#0C0A09", background: "#0C0A09", accent: "#E7C873", cta: "#E7C873", ctaText: "#0C0A09" }),
  textSurface: "background", anchors: EDGES,
  image: { area: { x: 13, y: 9, w: 74, h: 50 }, window: true, fill: "blur" },
  layers: [
    { kind: "cutout", flip: true, fill: "background", shape: "arch", stroke: { color: "accent", width: 0.28, gap: 1.6 } },
    { kind: "rect", x: 4.5, y: 2.5, w: 91, h: 95, stroke: { color: "accent", width: 0.14 }, opacity: 0.6 },
    { kind: "textBar", side: "top", fill: "accent", thickness: 0.25, gap: 3.4, length: 10 },
  ],
  text: {
    box: { x: 12, w: 76, top: 5, bottom: 6, h: 28 }, gap: 2.8,
    title: { font: "playfair", color: "text", size: 7.4, lineHeight: 1.14, gradient: { to: "accent" } },
    subtitle: { font: "inter", color: "accent", size: 2.8, lineHeight: 1.4, uppercase: true, letterSpacing: 0.2 },
    cta: { font: "inter", color: "cta", size: 2.6, uppercase: true, letterSpacing: 0.2, variant: "outline", roundness: 0 },
  },
  defaultLayout: layoutOf("luxo", { align: "center", logo: { hAnchor: "center", marginTop: 3.4, scale: 0.8 } }),
};

const EDITORIAL: SceneDefinition = {
  id: "editorial", label: "Editorial", purposes: ["luxo", "produto", "institucional"],
  description: "Painel claro de revista com serifa escura e fio de destaque.",
  palette: palette({ background: WHITE, overlay: WHITE, text: "#111111", accent: "#B91C1C", cta: "#111111", ctaText: WHITE }),
  textSurface: "background", anchors: EDGES,
  image: { area: { x: 0, y: 0, w: 100, h: 65 }, fill: "blur" },
  layers: [
    { kind: "rect", space: "box", flip: true, x: 0, y: -5.3, w: 100, h: 240, fill: "background" },
    { kind: "rect", space: "box", flip: true, x: 8, y: -0.7, w: 12, h: 0.7, fill: "accent" },
  ],
  text: {
    box: { x: 8, w: 84, top: 0, bottom: 4, h: 30 }, gap: 2,
    title: { font: "dmserif", color: "text", size: 7.4, lineHeight: 1.08, accent: { color: "accent", target: "lastWord" } },
    subtitle: { font: "inter", color: "text", size: 3.1, lineHeight: 1.35, uppercase: true, letterSpacing: 0.06 },
    cta: { font: "poppins-medium", color: "ctaText", size: 2.6, uppercase: true, letterSpacing: 0.12, variant: "pill", roundness: 0 },
  },
  defaultLayout: layoutOf("editorial"),
};

// ------------------------------ Registro ------------------------------------

export const SCENE_LIST: SceneDefinition[] = [
  OFERTA, ETIQUETA, URGENTE, FAIXA, IMPACTO, BLOCO, RECORTE,
  DUOTONE, NEON, GRADIENTE, FESTIVO, REVISTA,
  MODERNO, SPLIT, LATERAL, MOLDURA, CARTAO,
  GLASS, ARCO, LEGENDA, INSTITUCIONAL, CLEAN,
  PREMIUM, LUXO, EDITORIAL,
];

export const SCENES = {
  ...(Object.fromEntries(SCENE_LIST.map((s) => [s.id, s])) as Record<(typeof TEMPLATE_IDS)[number], SceneDefinition>),
  // Ids antigos gravados em conteúdos existentes.
  elegante: PREMIUM,
  minimalista: CLEAN,
  black: NEON,
} as Record<TemplateId, SceneDefinition>;

export function getSceneById(id: string | null | undefined): SceneDefinition | null {
  if (!id) return null;
  return Object.prototype.hasOwnProperty.call(SCENES, id) ? SCENES[id as TemplateId] : null;
}

// ------------------------------ Formatos -----------------------------------

/** Formatos de saída do estúdio. A largura é sempre 1080. */
export const SCENE_FORMATS = {
  story: { label: "Story / Reels (9:16)", width: 1080, height: 1920 },
  portrait: { label: "Feed (4:5)", width: 1080, height: 1350 },
  square: { label: "Quadrado (1:1)", width: 1080, height: 1080 },
} as const;
export type SceneFormat = keyof typeof SCENE_FORMATS;

/** Formato mais próximo de um quadro W×H. */
export function formatOf(width: number, height: number): SceneFormat {
  const ratio = height / width;
  if (ratio >= 1.6) return "story";
  if (ratio >= 1.12) return "portrait";
  return "square";
}

/** Texto um pouco menor e painel proporcionalmente mais alto nos quadros curtos. */
const FORMAT_RULES: Record<SceneFormat, { textScale: number; panelScale: number; maxPanel: number; marginScale: number }> = {
  story: { textScale: 1, panelScale: 1, maxPanel: 100, marginScale: 1 },
  // Nos quadros curtos o painel fica mais justo ao texto (que encolhe para
  // caber, se preciso): sobra mais quadro para a imagem e menos área vazia.
  portrait: { textScale: 0.94, panelScale: 0.8, maxPanel: 38, marginScale: 1.15 },
  square: { textScale: 0.86, panelScale: 0.76, maxPanel: 40, marginScale: 1.3 },
};

const adapted = new Map<string, SceneDefinition>();

/**
 * Versão do modelo para o formato pedido. Os modelos são desenhados em 9:16;
 * aqui o painel de texto mantém seu tamanho real (em px), as formas presas a
 * ele acompanham, e a área/janela da imagem ocupa o espaço que sobra — sem
 * esticar nem cortar. Para "story" devolve o próprio modelo.
 */
export function sceneForFormat(scene: SceneDefinition, format: SceneFormat): SceneDefinition {
  if (format === "story") return scene;
  const key = `${scene.id}:${format}:${JSON.stringify(scene.palette)}`;
  const hit = adapted.get(key);
  if (hit) return hit;

  const story = SCENE_FORMATS.story;
  const target = SCENE_FORMATS[format];
  const rule = FORMAT_RULES[format];
  const k = story.height / target.height;
  const scaleText = <T extends TextStyle>(t: T): T => ({ ...t, size: t.size * rule.textScale });
  const box = { ...scene.text.box };
  let area = { ...scene.image.area };

  if (typeof box.h === "number") {
    // Painel: mesma altura em px (ajustada à escala do texto), limitada a uma
    // fração do quadro para a imagem continuar protagonista.
    const storyTop = 100 - box.bottom - box.h;
    const gap = storyTop - (area.y + area.h); // distância imagem → painel, em % da altura 9:16
    box.h = Math.min(box.h * k * rule.textScale * rule.panelScale, rule.maxPanel);
    box.bottom = box.bottom * rule.marginScale;
    box.top = box.top * rule.marginScale;
    const top = 100 - box.bottom - box.h;
    const bottom = top - gap * k;
    area = { ...area, y: area.y * rule.marginScale, h: Math.max(18, bottom - area.y * rule.marginScale) };
  } else {
    box.top = box.top * rule.marginScale;
    box.bottom = box.bottom * rule.marginScale;
  }

  // Janela em arco precisa de altura; em janela baixa vira cantos arredondados,
  // senão a imagem inteira ficaria minúscula sob a curva.
  const flat = (area.h / 100) * target.height < (area.w / 100) * target.width * 0.8;
  const layers = scene.layers.map((l) => (l.kind === "cutout" && l.shape === "arch" && flat ? { ...l, shape: "rect" as const, radius: 6 } : l));

  const out: SceneDefinition = {
    ...scene,
    layers,
    image: { ...scene.image, area },
    text: { ...scene.text, box, title: scaleText(scene.text.title), subtitle: scaleText(scene.text.subtitle), cta: scaleText(scene.text.cta) },
  };
  adapted.set(key, out);
  return out;
}

// ------------------------------ Normalização do layout ----------------------

function num(v: unknown, min: number, max: number, fallback: number): number {
  return typeof v === "number" && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : fallback;
}
function oneOf<T extends string>(v: unknown, options: readonly T[], fallback: T): T {
  return typeof v === "string" && (options as readonly string[]).includes(v) ? (v as T) : fallback;
}
const ANCHORS: Anchor[] = ["top", "center", "bottom"];
const ALIGNS: Align[] = ["left", "center", "right"];

/**
 * Transforma qualquer layout recebido (do editor, do banco ou de um job
 * antigo) em um `VideoLayout` completo e dentro dos limites. Campos ausentes
 * ou inválidos caem no padrão da cena — o composer nunca recebe lixo.
 */
export function normalizeLayout(raw: unknown, scene: SceneDefinition): VideoLayout {
  const d = scene.defaultLayout;
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const part = (key: string) => ((o[key] && typeof o[key] === "object" ? o[key] : {}) as Record<string, unknown>);

  const rawTitle = part("title");
  const vAnchor = oneOf(rawTitle.vAnchor, scene.anchors, scene.anchors.includes(d.title.vAnchor) ? d.title.vAnchor : scene.anchors[0]);
  const text = (key: "title" | "subtitle" | "cta"): TextLayout => {
    const t = part(key);
    return {
      scale: num(t.scale, 0.4, 2.5, d[key].scale),
      vAnchor,
      align: oneOf(t.align, ALIGNS, d[key].align),
      ...(key === "title" ? { spacing: num(t.spacing, 0, 20, d.title.spacing ?? 0) } : {}),
      ...(isFontId(t.font) ? { font: t.font } : {}),
    };
  };
  const l = part("logo");
  return {
    template: scene.id,
    logo: {
      scale: num(l.scale, 0.2, 3, d.logo.scale),
      vAnchor: oneOf(l.vAnchor, ANCHORS, d.logo.vAnchor),
      hAnchor: oneOf(l.hAnchor, ALIGNS, d.logo.hAnchor),
      marginTop: num(l.marginTop, 0, 50, d.logo.marginTop),
      marginBottom: num(l.marginBottom, 0, 50, d.logo.marginBottom),
      marginLeft: num(l.marginLeft, 0, 50, d.logo.marginLeft),
      marginRight: num(l.marginRight, 0, 50, d.logo.marginRight),
      visible: l.visible !== false,
      opacity: num(l.opacity, 0.2, 1, 1),
    },
    title: text("title"),
    subtitle: text("subtitle"),
    cta: text("cta"),
    offsetX: num(o.offsetX, -50, 50, 0),
    offsetY: num(o.offsetY, -50, 50, 0),
    colors: sanitizePalette(o.colors),
    colorMode: oneOf(o.colorMode, ["brand", "template", "theme", "custom"] as const, "template"),
    transition: isTransitionId(o.transition) ? o.transition : DEFAULT_TRANSITION,
    // Só aparecem quando o editor os definiu: layouts antigos ficam iguais.
    ...(isTextAnimationId(o.animation) && o.animation !== "none" ? { animation: o.animation } : {}),
    ...(o.outro && typeof o.outro === "object"
      ? {
          outro: {
            enabled: (o.outro as { enabled?: unknown }).enabled !== false,
            seconds: num((o.outro as { seconds?: unknown }).seconds, OUTRO_SECONDS.min, OUTRO_SECONDS.max, OUTRO_SECONDS.default),
          },
        }
      : {}),
    ...(Array.isArray(o.sceneSeconds) &&
    o.sceneSeconds.length > 0 &&
    o.sceneSeconds.length <= 8 &&
    o.sceneSeconds.every((v) => typeof v === "number" && Number.isFinite(v) && v > 0)
      ? { sceneSeconds: (o.sceneSeconds as number[]).map((v) => Math.round(Math.max(0.5, Math.min(60, v)) * 10) / 10) }
      : {}),
  };
}
