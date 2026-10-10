// Folha de contato dos modelos, renderizada pelo MESMO rasterizador do vídeo.
// Uso: npm run sheet -- saida.png [colunas] [de] [até] [âncora|-] [car|phone] [contain|cover]
// A foto é sintética (carro em paisagem ou celular em pé) só para conferir o
// enquadramento; nenhum dado real é lido.
import { Resvg } from "@resvg/resvg-js";
import { readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { SCENE_LIST } from "../src/scenes.js";
import { buildSceneOverlaySvgWithMeta } from "../src/scene-composer.js";
import { normalizeFraming, placeImage } from "../src/image-fit.js";

const dir = path.resolve("assets/fonts");
const fontFiles = readdirSync(dir).filter((f) => f.endsWith(".ttf")).map((f) => path.join(dir, f));
const W = 1080, H = 1920, tw = 324, th = 576, pad = 14;
const [out, colsArg, fromArg, toArg, anchorArg, shapeArg, fitArg] = process.argv.slice(2);
const cols = Number(colsArg ?? 5), from = Number(fromArg ?? 0), to = Number(toArg ?? 99);

// "Foto de produto" sintética: paisagem (carro) ou retrato (celular).
const PHOTOS: Record<string, { w: number; h: number; body: string }> = {
  car: { w: 1600, h: 1000, body: `<rect width="1600" height="1000" fill="#cfe3f2"/><rect y="640" width="1600" height="360" fill="#8d99a6"/><path d="M180 640 q40 -150 260 -170 l170 -150 q40 -30 100 -30 h330 q70 0 120 50 l150 150 q170 20 190 150 v70 h-1320z" fill="#c1121f"/><path d="M640 330 h300 q50 0 90 40 l110 110 h-640z" fill="#1d3557"/><circle cx="470" cy="720" r="105" fill="#111"/><circle cx="470" cy="720" r="50" fill="#bbb"/><circle cx="1170" cy="720" r="105" fill="#111"/><circle cx="1170" cy="720" r="50" fill="#bbb"/><rect x="60" y="60" width="1480" height="880" fill="none" stroke="#000" stroke-opacity="0.25" stroke-width="6" stroke-dasharray="24 16"/>` },
  phone: { w: 900, h: 1500, body: `<rect width="900" height="1500" fill="#f1ede4"/><rect x="230" y="110" width="440" height="1280" rx="70" fill="#111827"/><rect x="255" y="140" width="390" height="1220" rx="48" fill="#3b82f6"/><circle cx="450" cy="190" r="16" fill="#111827"/><rect x="300" y="520" width="300" height="60" rx="14" fill="#fff" fill-opacity="0.9"/><rect x="300" y="620" width="220" height="40" rx="12" fill="#fff" fill-opacity="0.6"/><rect x="40" y="40" width="820" height="1420" fill="none" stroke="#000" stroke-opacity="0.25" stroke-width="6" stroke-dasharray="24 16"/>` },
};
const photo = PHOTOS[shapeArg || "car"];
const logo = "data:image/svg+xml;base64," + Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="300" height="100"><circle cx="50" cy="50" r="34" fill="#fff"/><circle cx="50" cy="50" r="20" fill="#0ea5e9"/><rect x="100" y="30" width="180" height="40" rx="8" fill="#fff"/></svg>').toString("base64");

const scenes = SCENE_LIST.slice(from, to);
const rows = Math.ceil(scenes.length / cols);
let body = "";
scenes.forEach((scene, i) => {
  const x = pad + (i % cols) * (tw + pad), y = pad + Math.floor(i / cols) * (th + pad + 26);
  const layout: any = JSON.parse(JSON.stringify(scene.defaultLayout));
  if (anchorArg && anchorArg !== "-" && scene.anchors.includes(anchorArg as any)) {
    layout.title.vAnchor = anchorArg;
    if (layout.logo.vAnchor === anchorArg) layout.logo.vAnchor = anchorArg === "top" ? "bottom" : "top";
  }
  const built = buildSceneOverlaySvgWithMeta({ width: W, height: H, scene, layout, idPrefix: `s${i}`, logo: { dataUri: logo },
    content: { headline: "Semana do cliente com 40% off", supportingText: "Condições especiais e entrega rápida para todo o Brasil", ctaText: "Peça pelo WhatsApp" } });
  const framing = normalizeFraming(fitArg === "cover" ? { x: 0.5, y: 0.5, zoom: 1, fit: "cover" } : null, { fit: "contain", fill: scene.image.fill });
  const r = placeImage({ width: photo.w, height: photo.h }, built.imageAreas, framing);
  const cov = Math.max(W / photo.w, H / photo.h) * 1.12;
  const bg = framing.fill === "color"
    ? `<rect width="${W}" height="${H}" fill="${scene.palette.background}"/>`
    : `<defs><filter id="b${i}" x="-10%" y="-10%" width="120%" height="120%"><feGaussianBlur stdDeviation="38"/></filter></defs><g filter="url(#b${i})"><svg x="${(W - photo.w * cov) / 2}" y="${(H - photo.h * cov) / 2}" width="${photo.w * cov}" height="${photo.h * cov}" viewBox="0 0 ${photo.w} ${photo.h}">${photo.body}</svg></g><rect width="${W}" height="${H}" fill="#000" opacity="0.14"/>`;
  const fg = `<svg x="${r.x}" y="${r.y}" width="${r.width}" height="${r.height}" viewBox="0 0 ${photo.w} ${photo.h}" preserveAspectRatio="none">${photo.body}</svg>`;
  body += `<svg x="${x}" y="${y}" width="${tw}" height="${th}" viewBox="0 0 ${W} ${H}"><rect width="${W}" height="${H}" fill="#000"/>${bg}${fg}${built.svg}</svg><text x="${x}" y="${y + th + 20}" font-family="Inter" font-size="18" fill="#111">${i + from + 1}. ${scene.id} — ${scene.label}</text>`;
});
const SW = pad + cols * (tw + pad), SH = pad + rows * (th + pad + 26);
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${SW}" height="${SH}"><rect width="100%" height="100%" fill="#e5e7eb"/>${body}</svg>`;
writeFileSync(out, new Resvg(svg, { font: { fontFiles, loadSystemFonts: false, defaultFontFamily: "Inter" } }).render().asPng());
