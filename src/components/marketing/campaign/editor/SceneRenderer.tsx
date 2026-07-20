// ============================================================================
// SceneRenderer — desenha uma SceneDefinition + VideoLayout do usuário
// dentro de um container 9:16 (ou qualquer aspect ratio via CSS externo).
//
// Cada tipo de camada em `SceneLayer` tem seu próprio render. Adicionar um
// novo tipo = adicionar um case aqui.
//
// Não faz chamadas de rede. Recebe `imageUrl` e `logoUrl` prontos.
//
// Fase futura (Onda 3 / canvas): esta mesma árvore pode ser envolvida por um
// wrapper com drag/resize sem alterar a cena.
// ============================================================================

import type { CSSProperties, ReactNode } from "react";
import type { FocalPointInput } from "@/data/marketingRepo";
import type { VideoLayout } from "@/lib/marketing/video-editor/layout.types";
import type {
  SceneDefinition,
  SceneLayer,
  TextStyle,
} from "@/lib/marketing/video-editor/scene.types";
import { getScene } from "@/lib/marketing/video-editor/scenes/registry";
import { LogoSlot } from "./LogoSlot";

interface Props {
  imageUrl: string | null;
  logoUrl: string | null;
  onRequestLogoUpload?: (file: File) => void;
  focalPoint?: FocalPointInput | null;
  headline: string;
  subheadline: string | null;
  cta: string | null;
  layout: VideoLayout;
  /** Se true, ocupa 100% do container. */
  fill?: boolean;
  /** Se true, desenha guias de safe area em cima. */
  showSafeArea?: boolean;
}

function alignToCss(a: "left" | "center" | "right"): CSSProperties["textAlign"] {
  return a;
}
function vAnchorToJustify(a: "top" | "center" | "bottom"): CSSProperties["justifyContent"] {
  if (a === "top") return "flex-start";
  if (a === "center") return "center";
  return "flex-end";
}

function LayerNode({ layer, index }: { layer: SceneLayer; index: number }) {
  const zIndex = 1 + index;
  switch (layer.kind) {
    case "gradient": {
      const gradient = `linear-gradient(${layer.direction}, ${layer.stops
        .map((s) => `${s.color}${typeof s.at === "number" ? ` ${s.at}%` : ""}`)
        .join(", ")})`;
      const style: CSSProperties = {
        position: "absolute",
        left: 0,
        right: 0,
        background: gradient,
        opacity: layer.opacity ?? 1,
        pointerEvents: "none",
        zIndex,
      };
      if (layer.y === "top") {
        style.top = 0;
        style.height = `${layer.height ?? 35}%`;
      } else if (layer.y === "bottom") {
        style.bottom = 0;
        style.height = `${layer.height ?? 45}%`;
      } else {
        style.top = 0;
        style.bottom = 0;
      }
      return <div style={style} />;
    }
    case "solid": {
      const style: CSSProperties = {
        position: "absolute",
        left: 0,
        right: 0,
        background: layer.color,
        opacity: layer.opacity ?? 1,
        pointerEvents: "none",
        zIndex,
      };
      if (layer.y === "top") {
        style.top = 0;
        style.height = `${layer.height ?? 30}%`;
      } else if (layer.y === "bottom") {
        style.bottom = 0;
        style.height = `${layer.height ?? 30}%`;
      } else {
        style.top = 0;
        style.bottom = 0;
      }
      return <div style={style} />;
    }
    case "angular": {
      return (
        <svg
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
          style={{
            position: "absolute",
            inset: 0,
            width: "100%",
            height: "100%",
            pointerEvents: "none",
            zIndex,
          }}
        >
          <polygon points={layer.points} fill={layer.color} opacity={layer.opacity ?? 1} />
        </svg>
      );
    }
    case "frame": {
      const inset = layer.inset ?? 2;
      const width = layer.width;
      const radius = layer.radius ?? 0;
      return (
        <div
          style={{
            position: "absolute",
            top: `${inset}%`,
            left: `${inset}%`,
            right: `${inset}%`,
            bottom: `${inset}%`,
            border: `${width}cqi solid ${layer.color}`,
            borderRadius: `${radius}cqi`,
            opacity: layer.opacity ?? 1,
            pointerEvents: "none",
            zIndex,
          }}
        />
      );
    }
    case "vignette": {
      return (
        <div
          style={{
            position: "absolute",
            inset: 0,
            background: `radial-gradient(ellipse at center, rgba(0,0,0,0) 40%, rgba(0,0,0,${layer.intensity}) 100%)`,
            pointerEvents: "none",
            zIndex,
          }}
        />
      );
    }
    case "element": {
      // Placeholder — biblioteca de elementos gráficos (Onda 2+).
      return null;
    }
    default: {
      const _exhaustive: never = layer;
      return _exhaustive;
    }
  }
}

function renderTextNode(
  content: string | null,
  style: TextStyle,
  sizeCqi: number,
  align: "left" | "center" | "right",
  placeholder?: ReactNode,
): ReactNode {
  if (!content && !placeholder) return null;
  const base: CSSProperties = {
    fontFamily: style.fontFamily,
    fontWeight: style.weight,
    color: style.color ?? "#fff",
    fontSize: `${sizeCqi}cqi`,
    lineHeight: style.lineHeight ?? 1.2,
    letterSpacing: style.letterSpacing,
    textTransform: style.transform,
    textShadow: style.textShadow,
    textAlign: alignToCss(align),
  };
  if (style.pill) {
    return (
      <div style={{ textAlign: alignToCss(align) }}>
        <span
          style={{
            ...base,
            display: "inline-block",
            background: style.pill.background,
            color: style.pill.foreground,
            borderRadius: style.pill.radius,
            padding: style.pill.padding,
          }}
        >
          {content ?? placeholder}
        </span>
      </div>
    );
  }
  if (style.underline) {
    return (
      <div
        style={{
          ...base,
          borderBottom: `${style.underline.thickness} solid ${style.underline.color}`,
          paddingBottom: style.underline.offset,
          display: "inline-block",
        }}
      >
        {content ?? placeholder}
      </div>
    );
  }
  return <div style={base}>{content ?? placeholder}</div>;
}

export function SceneRenderer({
  imageUrl,
  logoUrl,
  onRequestLogoUpload,
  focalPoint,
  headline,
  subheadline,
  cta,
  layout,
  fill,
  showSafeArea,
}: Props) {
  const scene: SceneDefinition = getScene(layout.template);
  const objectPos =
    focalPoint && typeof focalPoint.x === "number" && typeof focalPoint.y === "number"
      ? `${Math.round(focalPoint.x * 100)}% ${Math.round(focalPoint.y * 100)}%`
      : "50% 50%";

  // Escala tipográfica base (cqi = % da largura do container).
  const titleSize = 7.2 * layout.title.scale;
  const subSize = 3.6 * layout.subtitle.scale;
  const ctaSize = 2.6 * layout.cta.scale;

  return (
    <div
      className={
        fill
          ? "relative w-full h-full overflow-hidden rounded-xl border bg-black shadow-md"
          : "relative w-full max-w-[420px] mx-auto overflow-hidden rounded-xl border bg-black shadow-md"
      }
      style={{ aspectRatio: "9 / 16", containerType: "inline-size" }}
    >
      {/* Imagem base */}
      {imageUrl ? (
        <img
          src={imageUrl}
          alt=""
          className="absolute inset-0 h-full w-full object-cover"
          style={{ objectPosition: objectPos, zIndex: 0 }}
          draggable={false}
        />
      ) : (
        <div className="absolute inset-0 grid place-items-center text-xs text-white/60 z-0">
          sem imagem
        </div>
      )}

      {/* Camadas da cena — ordem de pintura preservada */}
      {scene.layers.map((layer, i) => (
        <LayerNode key={i} layer={layer} index={i} />
      ))}

      {/* Logo (Brand Center) */}
      <LogoSlot
        logoUrl={logoUrl}
        layout={layout.logo}
        onUpload={onRequestLogoUpload}
      />

      {/* Bloco de textos — ordem visual: título → subtítulo → CTA.
          A ordem é sequencial (sem flexbox `order`) para bater 1:1 com o
          worker (`scene-composer.ts`). */}
      <div
        className="absolute inset-0 flex flex-col text-white pointer-events-none"
        style={{
          padding: scene.text.padding,
          justifyContent: vAnchorToJustify(layout.title.vAnchor),
          gap: `${scene.text.gap}cqi`,
          zIndex: 20,
        }}
      >
        <div>
          {renderTextNode(
            headline || null,
            scene.text.title,
            titleSize,
            layout.title.align,
            <span className="text-white/40">Título do vídeo</span>,
          )}
        </div>
        {subheadline
          ? renderTextNode(subheadline, scene.text.subtitle, subSize, layout.subtitle.align)
          : null}
        {cta ? renderTextNode(cta, scene.text.cta, ctaSize, layout.cta.align) : null}
      </div>

      {/* Guias de safe area (opcional) */}
      {showSafeArea && (
        <div
          className="absolute inset-0 pointer-events-none"
          style={{ zIndex: 30 }}
        >
          <div
            className="absolute"
            style={{
              top: "10%",
              bottom: "10%",
              left: "6%",
              right: "6%",
              border: "1px dashed rgba(255,255,255,0.4)",
              borderRadius: 8,
            }}
          />
        </div>
      )}
    </div>
  );
}
