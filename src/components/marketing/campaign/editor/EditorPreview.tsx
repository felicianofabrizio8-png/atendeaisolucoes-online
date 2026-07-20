// Preview 9:16 do Editor Visual do Vídeo IA.
// Renderiza fielmente imagem + logo + título + subtítulo + CTA conforme
// `VideoLayout` e template escolhidos. Sem chamada de rede — puramente CSS.

import type { CSSProperties } from "react";
import type { FocalPointInput } from "@/data/marketingRepo";
import type { VideoLayout } from "@/lib/marketing/video-editor/layout.types";
import { getTemplate } from "@/lib/marketing/video-editor/templates";

interface Props {
  imageUrl: string | null;
  logoUrl?: string | null;
  focalPoint?: FocalPointInput | null;
  headline: string;
  subheadline: string | null;
  cta: string | null;
  layout: VideoLayout;
  /** Se true, ocupa 100% do container pai; senão usa largura fixa. */
  fill?: boolean;
}

function alignToJustify(a: "left" | "center" | "right"): CSSProperties["textAlign"] {
  return a;
}

function anchorToFlex(a: "top" | "center" | "bottom"): CSSProperties["justifyContent"] {
  if (a === "top") return "flex-start";
  if (a === "center") return "center";
  return "flex-end";
}

function hAnchorToFlex(a: "left" | "center" | "right"): CSSProperties["alignItems"] {
  if (a === "left") return "flex-start";
  if (a === "center") return "center";
  return "flex-end";
}

export function EditorPreview({
  imageUrl,
  logoUrl,
  focalPoint,
  headline,
  subheadline,
  cta,
  layout,
  fill,
}: Props) {
  const preset = getTemplate(layout.template);
  const objectPos =
    focalPoint && typeof focalPoint.x === "number" && typeof focalPoint.y === "number"
      ? `${Math.round(focalPoint.x * 100)}% ${Math.round(focalPoint.y * 100)}%`
      : "50% 50%";

  // Escala base em cqi (container query inline size). 100cqi = largura do preview.
  const titleSize = 7.2 * layout.title.scale;
  const subSize = 3.6 * layout.subtitle.scale;
  const ctaSize = 2.6 * layout.cta.scale;
  const logoSizePct = 22 * layout.logo.scale; // % da largura

  return (
    <div
      className={
        fill
          ? "relative w-full h-full overflow-hidden rounded-xl border bg-black shadow-md"
          : "relative w-full max-w-[320px] mx-auto overflow-hidden rounded-xl border bg-black shadow-md"
      }
      style={{ aspectRatio: "9 / 16", containerType: "inline-size" }}
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

      {/* Painel escuro extra (por template). */}
      {preset.panelDarkness > 0 && (
        <div
          className="absolute inset-x-0 bottom-0"
          style={{
            height: "55%",
            background: `linear-gradient(180deg, rgba(0,0,0,0) 0%, rgba(0,0,0,${
              preset.panelDarkness
            }) 100%)`,
          }}
        />
      )}

      {/* Gradiente inferior padrão. */}
      <div
        className="absolute inset-x-0 bottom-0 pointer-events-none"
        style={{
          height: "42%",
          background:
            "linear-gradient(180deg, rgba(0,0,0,0) 0%, rgba(0,0,0,0.55) 45%, rgba(0,0,0,0.88) 100%)",
        }}
      />

      {/* Logo */}
      {logoUrl && (
        <div
          className="absolute inset-0 flex pointer-events-none"
          style={{
            justifyContent: hAnchorToFlex(layout.logo.hAnchor),
            alignItems: anchorToFlex(layout.logo.vAnchor),
            padding: `${layout.logo.marginTop}% ${layout.logo.marginRight}% ${layout.logo.marginBottom}% ${layout.logo.marginLeft}%`,
          }}
        >
          <img
            src={logoUrl}
            alt=""
            style={{
              width: `${logoSizePct}cqi`,
              maxHeight: "20%",
              objectFit: "contain",
              filter: "drop-shadow(0 2px 8px rgba(0,0,0,0.4))",
            }}
          />
        </div>
      )}

      {/* Bloco de textos — cada campo posicionado independentemente. */}
      <div
        className="absolute inset-0 flex flex-col text-white pointer-events-none"
        style={{
          padding: "6% 7%",
          justifyContent: anchorToFlex(layout.title.vAnchor),
          gap: `${(layout.title.spacing ?? 2)}cqi`,
        }}
      >
        {cta ? (
          <div
            style={{
              textAlign: alignToJustify(layout.cta.align),
              order: layout.cta.vAnchor === "top" ? -2 : 0,
            }}
          >
            <span
              className="inline-block rounded-full bg-white/95 text-black"
              style={{
                fontFamily: preset.ctaFontFamily,
                fontWeight: 700,
                fontSize: `${ctaSize}cqi`,
                letterSpacing: "0.08em",
                padding: "0.5em 1em",
                textTransform: "uppercase",
              }}
            >
              {cta}
            </span>
          </div>
        ) : null}
        <div
          style={{
            fontFamily: preset.titleFontFamily,
            fontWeight: preset.titleWeight,
            fontSize: `${titleSize}cqi`,
            lineHeight: 1.05,
            textAlign: alignToJustify(layout.title.align),
            textShadow: "0 2px 12px rgba(0,0,0,0.45)",
            order: -1,
          }}
        >
          {headline || <span className="text-white/40">Título do vídeo</span>}
        </div>
        {subheadline ? (
          <div
            className="text-white/95"
            style={{
              fontFamily: preset.subtitleFontFamily,
              fontWeight: preset.subtitleWeight,
              fontSize: `${subSize}cqi`,
              lineHeight: 1.25,
              textAlign: alignToJustify(layout.subtitle.align),
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
