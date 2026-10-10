// ============================================================================
// Quadro preparado da imagem — monta, com UMA chamada rápida do FFmpeg, um PNG
// do tamanho do vídeo com a foto já enquadrada (conter/preencher na área do
// modelo) sobre o preenchimento escolhido (desfoque da própria foto ou cor).
//
// O render principal recebe esse PNG no lugar da foto original e segue pelo
// caminho de sempre (cobrir o quadro, sem corte, pois já tem o tamanho exato).
// Assim o grafo de filtros do vídeo não muda — e não pesa mais na memória.
//
// As expressões abaixo são a tradução direta de `placeImage` (image-fit.ts),
// a mesma conta que a prévia do app usa.
// ============================================================================

import { spawn } from "node:child_process";
import type { ImageAreas, ImageFraming } from "./image-fit.js";

export interface PreparedFrameInput {
  inputPath: string;
  outputPath: string;
  width: number;
  height: number;
  areas: ImageAreas;
  framing: ImageFraming;
  /** Cor do preenchimento "color" (#RRGGBB, já validada pelo tema). */
  fillColor: string;
}

const f = (v: number) => (Number.isFinite(v) ? v.toFixed(3) : "0");

/** Argumentos do FFmpeg para gerar o quadro preparado. Puro (testável). */
export function buildPreparedFrameArgs(input: PreparedFrameInput): string[] {
  const { width: W, height: H, areas, framing } = input;
  const zoom = f(framing.zoom);
  let scale: string;
  let overlay: string;
  if (framing.fit === "contain") {
    const a = areas.contain;
    // Cabe inteira na área; depois posiciona por alinhamento.
    const s = `min(${f(a.width)}/iw\\,${f(a.height)}/ih)*${zoom}`;
    scale = `scale=w='iw*${s}':h='ih*${s}':flags=lanczos`;
    overlay = `overlay=x='${f(a.x)}+(${f(a.width)}-w)*${f(framing.x)}':y='${f(a.y)}+(${f(a.height)}-h)*${f(framing.y)}'`;
  } else {
    const a = areas.cover;
    // Cobre a área; mantém o ponto de foco no centro, limitado às bordas.
    const s = `max(${f(a.width)}/iw\\,${f(a.height)}/ih)*${zoom}`;
    scale = `scale=w='iw*${s}':h='ih*${s}':flags=lanczos`;
    overlay =
      `overlay=x='${f(a.x)}-clip(${f(framing.x)}*w-${f(a.width)}/2\\,0\\,max(w-${f(a.width)}\\,0))'` +
      `:y='${f(a.y)}-clip(${f(framing.y)}*h-${f(a.height)}/2\\,0\\,max(h-${f(a.height)}\\,0))'`;
  }

  const hex = /^#[0-9a-fA-F]{6}$/.test(input.fillColor) ? input.fillColor.slice(1) : "000000";
  const graph =
    framing.fill === "color"
      ? `color=c=0x${hex}:s=${W}x${H},format=rgb24[bg];[0:v]format=rgba,${scale}[fg];[bg][fg]${overlay}:shortest=1,format=rgb24[out]`
      : // Desfoque barato e forte: reduz, borra e amplia de volta.
        `[0:v]split=2[a][b];[a]scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},` +
        `scale=${Math.round(W / 12)}:${Math.round(H / 12)},boxblur=4:2,scale=${W}:${H}:flags=bicubic,eq=brightness=-0.06:saturation=1.08,format=rgb24[bg];` +
        `[b]format=rgba,${scale}[fg];[bg][fg]${overlay},format=rgb24[out]`;

  return ["-y", "-i", input.inputPath, "-filter_complex", graph, "-map", "[out]", "-frames:v", "1", input.outputPath];
}

/** Gera o quadro preparado. Rejeita com código curto em falha ou timeout. */
export function prepareImageFrame(input: PreparedFrameInput, timeoutMs = 60_000): Promise<string> {
  return new Promise((resolve, reject) => {
    const p = spawn("ffmpeg", buildPreparedFrameArgs(input), { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    p.stderr.on("data", (d) => {
      stderr = (stderr + String(d)).slice(-600);
    });
    const timer = setTimeout(() => {
      p.kill("SIGKILL");
      reject(new Error("image_prepare_timeout"));
    }, timeoutMs);
    p.on("error", () => {
      clearTimeout(timer);
      reject(new Error("image_prepare_spawn_error"));
    });
    p.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(input.outputPath);
      else reject(new Error(`image_prepare_failed:${code}:${stderr.replace(/\s+/g, " ").slice(-200)}`));
    });
  });
}
