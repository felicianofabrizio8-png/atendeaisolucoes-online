// Preview estático 9:16 — replica o layout do brand-composer do worker
// (imagem de fundo + painel inferior com gradiente + headline/subheadline + CTA
// pill). Sem chamada de rede: puramente CSS. O objetivo é permitir validação
// visual antes da renderização real.

import type { FocalPointInput } from "@/data/marketingRepo";

interface Props {
  imageUrl: string | null;
  focalPoint?: FocalPointInput | null;
  headline: string;
  subheadline: string | null;
  cta: string | null;
}

export function CampaignTextPreview({
  imageUrl,
  focalPoint,
  headline,
  subheadline,
  cta,
}: Props) {
  const objectPos =
    focalPoint && typeof focalPoint.x === "number" && typeof focalPoint.y === "number"
      ? `${Math.round(focalPoint.x * 100)}% ${Math.round(focalPoint.y * 100)}%`
      : "50% 50%";

  return (
    <div
      className="relative w-full max-w-[280px] mx-auto overflow-hidden rounded-xl border bg-black shadow-md"
      style={{ aspectRatio: "9 / 16" }}
    >
      {imageUrl ? (
        <img
          src={imageUrl}
          alt=""
          className="absolute inset-0 h-full w-full object-cover"
          style={{ objectPosition: objectPos }}
          draggable={false}
        />
      ) : (
        <div className="absolute inset-0 grid place-items-center text-xs text-white/60">
          sem imagem
        </div>
      )}

      {/* Gradiente inferior — ~40% da altura. Espelha safe-area do worker. */}
      <div
        className="absolute inset-x-0 bottom-0"
        style={{
          height: "42%",
          background:
            "linear-gradient(180deg, rgba(0,0,0,0) 0%, rgba(0,0,0,0.55) 45%, rgba(0,0,0,0.88) 100%)",
        }}
      />

      {/* Bloco de textos — safe-area 6%/8% do worker. */}
      <div
        className="absolute inset-x-0 bottom-0 flex flex-col gap-[2%] text-white"
        style={{ padding: "8% 7% 9%" }}
      >
        {cta ? (
          <div className="mb-1">
            <span
              className="inline-block rounded-full bg-white/95 px-3 py-1 text-[10px] font-semibold uppercase tracking-wide text-black"
              style={{ letterSpacing: "0.08em" }}
            >
              {cta}
            </span>
          </div>
        ) : null}
        <div
          className="font-serif leading-[1.05]"
          style={{
            fontFamily: '"Playfair Display", Georgia, serif',
            fontWeight: 700,
            fontSize: "clamp(18px, 6.4vw, 30px)",
            textShadow: "0 2px 12px rgba(0,0,0,0.35)",
          }}
        >
          {headline || <span className="text-white/40">Título do vídeo</span>}
        </div>
        {subheadline ? (
          <div
            className="text-white/90"
            style={{
              fontFamily: 'Inter, "Helvetica Neue", Arial, sans-serif',
              fontWeight: 500,
              fontSize: "clamp(11px, 3.2vw, 15px)",
              lineHeight: 1.25,
              textShadow: "0 1px 8px rgba(0,0,0,0.35)",
            }}
          >
            {subheadline}
          </div>
        ) : null}
      </div>
    </div>
  );
}
