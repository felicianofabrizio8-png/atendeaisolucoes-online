import { useEffect, useRef } from "react";
import { cn } from "@/lib/utils";

/**
 * Orbe da IA — malha esférica de pontos desenhada em canvas.
 *
 * É componente e não imagem porque a orbe precisa acompanhar o tamanho do
 * painel, respirar (a deformação é contínua no tempo) e não pesar como um
 * PNG grande no bundle.
 *
 * A malha é PARAMÉTRICA (grade u × v), não aleatória: são as fileiras de
 * pontos ao longo de `v` que produzem as linhas de fluxo e o moiré da
 * referência. Pontos sorteados dariam ruído, não tecido.
 */

/** Divisões polo a polo. */
const RINGS = 130;
/** Divisões ao redor. */
const PER_RING = 200;
const COUNT = RINGS * PER_RING;

/**
 * Amplitudes das duas ondas que dobram a esfera.
 *
 * A onda principal dá duas voltas em `u` e é modulada por |sin(2v)|, que
 * zera nos polos e no equador — daí o vinco escuro atravessando o meio.
 *
 * O módulo é o outro detalhe que importa: sem ele o hemisfério de baixo dobra
 * com o sinal trocado e o lóbulo aponta para a frente da câmera.
 */
const A1 = 0.3;
/** Segunda onda, quatro voltas em `u`: quebra a regularidade da primeira. */
const A2 = 0.1;

/**
 * Quanto da dobra chega ao RAIO. O resto vale só para cor e brilho.
 *
 * Na referência a orbe é uma esfera: as dobras aparecem no sombreado e nas
 * linhas de pontos, não no contorno.
 *
 * O valor é quase zero porque a dobra modula o contorno QUATRO vezes por
 * volta, e modulação periódica o olho pega de longe: medido aqui, 8% de
 * variação no raio já lia como quadrado arredondado, e a amplitude cheia
 * virava uma flor de quatro pétalas. Em 5% da dobra a variação fica em ~2%
 * e o contorno passa por círculo, com o relevo inteiro preservado na cor.
 */
const SHAPE = 0.05;
/** Respiro das ondas. */
const BREATH = 0.1;
const D_MAX = (A1 + A2) * (1 + BREATH);

const TAU = Math.PI * 2;

/** Paradas de cor: violeta no fundo da dobra → âmbar na borda iluminada. */
const STOPS: ReadonlyArray<readonly [number, number, number, number]> = [
  [0.0, 26, 8, 78],
  [0.28, 95, 25, 175],
  [0.5, 186, 36, 190],
  [0.68, 245, 42, 120],
  [0.84, 255, 88, 45],
  [1.0, 255, 198, 64],
];

/** LUT de 256 cores: evita interpolar a paleta ponto a ponto, todo frame. */
function buildPalette(): Uint8Array {
  const lut = new Uint8Array(256 * 3);
  for (let i = 0; i < 256; i++) {
    const t = i / 255;
    let s = 0;
    while (s < STOPS.length - 2 && t > STOPS[s + 1][0]) s++;
    const [t0, r0, g0, b0] = STOPS[s];
    const [t1, r1, g1, b1] = STOPS[s + 1];
    const k = t1 === t0 ? 0 : (t - t0) / (t1 - t0);
    lut[i * 3] = r0 + (r1 - r0) * k;
    lut[i * 3 + 1] = g0 + (g1 - g0) * k;
    lut[i * 3 + 2] = b0 + (b1 - b0) * k;
  }
  return lut;
}

const PALETTE = buildPalette();

/**
 * Curva de tone mapping tabelada.
 *
 * Seriam três `Math.exp` por pixel, ~115 mil por frame num canvas de 196px:
 * medido, era o item mais caro do desenho. A tabela troca isso por uma
 * leitura de array sem diferença visível — a curva é suave e a saída é
 * inteira de 8 bits de qualquer jeito.
 */
const TONE_N = 2048;
/** Acima disso a curva já saturou (1 - e^-12 ≈ 0,999994). */
const TONE_MAX = 12;
const TONE_SCALE = TONE_N / TONE_MAX;

const TONE = (() => {
  const lut = new Float32Array(TONE_N);
  for (let i = 0; i < TONE_N; i++) lut[i] = 255 * (1 - Math.exp(-i / TONE_SCALE));
  return lut;
})();

interface Mesh {
  sinU: Float32Array;
  cosU: Float32Array;
  sinV: Float32Array;
  cosV: Float32Array;
  c2u: Float32Array;
  c4u: Float32Array;
  /** |sin(2v)| — a modulação das ondas ao longo do meridiano. */
  fold: Float32Array;
}

/**
 * Pré-computa seno/cosseno de cada ponto uma única vez. Por frame sobram
 * apenas multiplicações: nenhuma chamada trigonométrica por ponto.
 */
function buildMesh(): Mesh {
  const m: Mesh = {
    sinU: new Float32Array(COUNT),
    cosU: new Float32Array(COUNT),
    sinV: new Float32Array(COUNT),
    cosV: new Float32Array(COUNT),
    c2u: new Float32Array(COUNT),
    c4u: new Float32Array(COUNT),
    fold: new Float32Array(COUNT),
  };

  let i = 0;
  for (let ri = 0; ri < RINGS; ri++) {
    // acos espaça os anéis por área igual; v linear amontoaria pontos nos polos.
    const v = Math.acos(1 - 2 * ((ri + 0.5) / RINGS));
    const sv = Math.sin(v);
    const cv = Math.cos(v);
    const fold = Math.abs(Math.sin(2 * v));

    for (let ui = 0; ui < PER_RING; ui++) {
      const u = (ui / PER_RING) * TAU;
      m.sinU[i] = Math.sin(u);
      m.cosU[i] = Math.cos(u);
      m.sinV[i] = sv;
      m.cosV[i] = cv;
      m.c2u[i] = Math.cos(2 * u);
      m.c4u[i] = Math.cos(4 * u);
      m.fold[i] = fold;
      i++;
    }
  }
  return m;
}

let sharedMesh: Mesh | null = null;

export function AiOrb({ size = 208, className }: { size?: number; className?: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // A malha não depende do tamanho, então vale entre instâncias e remontagens.
    if (!sharedMesh) sharedMesh = buildMesh();
    const m = sharedMesh;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.max(1, Math.round(size * dpr));
    const h = w;
    canvas.width = w;
    canvas.height = h;

    const dots = document.createElement("canvas");
    dots.width = w;
    dots.height = h;
    const dctx = dots.getContext("2d");
    if (!dctx) return;
    const image = dctx.createImageData(w, h);
    const pix = image.data;

    // Bloom barato: a mesma camada reduzida e reampliada vira o halo.
    const gw = Math.max(1, w >> 2);
    const glow = document.createElement("canvas");
    glow.width = gw;
    glow.height = gw;
    const gctx = glow.getContext("2d");
    if (!gctx) return;

    // Acumulador linear: pontos sobrepostos somam luz antes do tone mapping,
    // que é o que cria os núcleos saturados nas dobras.
    const acc = new Float32Array(w * h * 3);

    const cx = w / 2;
    const cy = h / 2;
    const R = w * 0.44;
    const tiltS = Math.sin(0.1);
    const tiltC = Math.cos(0.1);
    const K = 1 / 4600;

    const draw = (t: number) => {
      acc.fill(0);

      // Respiro + balanço de ~±8°, não rotação livre: girar a orbe inteira
      // levaria um lóbulo para a frente da câmera e a silhueta deixaria de
      // ser a da referência em metade dos frames.
      const breath = 1 + BREATH * Math.sin(t * 0.55);
      const a1 = A1 * breath;
      const a2 = A2 * (2 - breath);

      const swing = 0.14 * Math.sin(t * 0.25);
      const spinC = Math.cos(swing);
      const spinS = Math.sin(swing);

      for (let i = 0; i < COUNT; i++) {
        const d = m.fold[i] * (a1 * m.c2u[i] + a2 * m.c4u[i]);
        const r = 1 + d * SHAPE;

        const sv = m.sinV[i];
        const x0 = sv * m.cosU[i];
        const y0 = m.cosV[i];
        const z0 = sv * m.sinU[i];

        const xr = x0 * spinC + z0 * spinS;
        const zs = z0 * spinC - x0 * spinS;
        const yr = y0 * tiltC - zs * tiltS;
        const zr = y0 * tiltS + zs * tiltC;

        const px = (cx + xr * r * R) | 0;
        const py = (cy - yr * r * R) | 0;
        if (px < 0 || px >= w || py < 0 || py >= h) continue;

        // Silhueta acesa: pontos de perfil (|zr| baixo) formam a borda quente.
        const az = zr < 0 ? -zr : zr;
        const rim = (1 - az) * (1 - az);
        const depth = 0.34 + 0.66 * (zr * 0.5 + 0.5);
        const inten = (0.26 + 0.74 * rim * rim) * depth * 30;

        // A borda converge para a mesma cor em toda a volta. Isso não é
        // enfeite: a dobra é quatro vezes por volta, então deixá-la mandar na
        // cor da borda fazia o halo do bloom crescer nas diagonais e o
        // contorno — redondo na geometria, medido — lia como quadrado
        // arredondado. O relevo da dobra fica no miolo, onde `rim` é baixo.
        const fold01 = (d + D_MAX) / (2 * D_MAX);
        let ci = fold01 * (1 - rim) + 0.9 * rim;
        ci = ci < 0 ? 0 : ci > 1 ? 1 : ci;
        const p = ((ci * 255) | 0) * 3;

        const o = (py * w + px) * 3;
        acc[o] += PALETTE[p] * inten;
        acc[o + 1] += PALETTE[p + 1] * inten;
        acc[o + 2] += PALETTE[p + 2] * inten;
      }

      // Tone mapping + alfa pela luminância: a orbe compõe sobre qualquer
      // fundo do tema em vez de carregar um quadrado preto junto.
      const total = w * h;
      const last = TONE_N - 1;
      for (let p = 0, o = 0, q = 0; p < total; p++, o += 3, q += 4) {
        let ir = (acc[o] * K * TONE_SCALE) | 0;
        let ig = (acc[o + 1] * K * TONE_SCALE) | 0;
        let ib = (acc[o + 2] * K * TONE_SCALE) | 0;
        if (ir > last) ir = last;
        if (ig > last) ig = last;
        if (ib > last) ib = last;
        const r = TONE[ir];
        const g = TONE[ig];
        const b = TONE[ib];
        const lum = r > g ? (r > b ? r : b) : g > b ? g : b;
        if (lum < 1) {
          pix[q + 3] = 0;
          continue;
        }
        const k = 255 / lum;
        pix[q] = r * k;
        pix[q + 1] = g * k;
        pix[q + 2] = b * k;
        pix[q + 3] = lum;
      }
      dctx.putImageData(image, 0, 0);

      ctx.clearRect(0, 0, w, h);
      ctx.globalCompositeOperation = "source-over";
      ctx.globalAlpha = 1;
      ctx.drawImage(dots, 0, 0);

      gctx.clearRect(0, 0, gw, gw);
      gctx.drawImage(dots, 0, 0, gw, gw);
      ctx.globalCompositeOperation = "lighter";
      ctx.globalAlpha = 0.5;
      ctx.drawImage(glow, 0, 0, w, h);
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = "source-over";
    };

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduced) {
      draw(0);
      return;
    }

    let raf = 0;
    let start = 0;
    let running = true;

    const loop = (now: number) => {
      if (!running) return;
      if (!start) start = now;
      draw((now - start) / 1000);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);

    // Fora da tela (outra aba do painel, gaveta fechada) a orbe não gasta frame.
    const io = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting && !running) {
        running = true;
        raf = requestAnimationFrame(loop);
      } else if (!entry.isIntersecting && running) {
        running = false;
        cancelAnimationFrame(raf);
      }
    });
    io.observe(canvas);

    return () => {
      running = false;
      cancelAnimationFrame(raf);
      io.disconnect();
    };
  }, [size]);

  return (
    <canvas
      ref={canvasRef}
      role="img"
      aria-label="Assistente de IA"
      className={cn("block", className)}
      style={{ width: size, height: size }}
    />
  );
}
