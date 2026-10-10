// ============================================================================
// SceneRenderer — prévia 9:16 de uma cena (também usada nas miniaturas).
//
// Tudo que aparece aqui sai do MESMO código que o worker usa no vídeo:
//   - a cena (camadas, logo e textos) é o SVG do `scene-composer`;
//   - a foto é posicionada por `placeImage`, a conta que o worker traduz para
//     o FFmpeg — incluindo o modo "conter", que mostra o produto inteiro na
//     área livre do modelo.
// Não existe uma segunda implementação em CSS do layout.
//
// Não faz chamadas de rede. Recebe `imageUrl` e `logoUrl` prontos.
// ============================================================================

import { memo, useId, useMemo, useRef, type CSSProperties, type PointerEvent as ReactPointerEvent } from "react";
import type { FocalPointInput } from "@/data/marketingRepo";
import type { VideoLayout } from "@/lib/marketing/video-editor/layout.types";
import {
  SCENE_FORMATS,
  buildSceneOverlaySvgWithMeta,
  getScene,
  normalizeFraming,
  type SceneFormat,
  type Box,
  type TextPart,
} from "@/lib/marketing/video-editor/scenes/registry";
import { sceneWithPalette } from "@/lib/marketing/video-editor/palette";
import { LogoSlot } from "./LogoSlot";
import { FramedImage } from "../FramedImage";
import "./video-fonts.css";

export type ScenePart = TextPart | "logo" | "image";

/** Uma foto na pilha de fundo (a reprodução usa duas durante a transição). */
export interface SceneImageLayer {
  key: string;
  url: string | null;
  focalPoint: FocalPointInput | null;
  style?: CSSProperties;
}

interface Props {
  imageUrl: string | null;
  logoUrl: string | null;
  onRequestLogoUpload?: (file: File) => void;
  /** Enquadramento salvo; null = padrão seguro do modelo ("conter"). */
  focalPoint?: FocalPointInput | null;
  headline: string;
  subheadline: string | null;
  cta: string | null;
  layout: VideoLayout;
  /** Formato do quadro. Padrão: Story/Reels 9:16 (o do vídeo). */
  format?: SceneFormat;
  /** Se true, ocupa 100% do container (que define o tamanho). */
  fill?: boolean;
  /** Se true, desenha guias de safe area em cima. */
  showSafeArea?: boolean;
  /** Miniatura: cantos e sombra discretos. */
  compact?: boolean;
  /** Substitui a foto única por uma pilha (animação entre cenas). */
  imageLayers?: SceneImageLayer[];
  /** Elemento selecionado no editor (ganha contorno). */
  selected?: ScenePart | null;
  /** Torna textos e logo clicáveis na prévia. */
  onSelect?: (part: ScenePart) => void;
  /**
   * Estado da entrada animada dos textos durante a reprodução (opacidade e
   * deslocamento em fração da altura). Ausente = textos no lugar.
   */
  textMotion?: { opacity: number; dy: number } | null;
  /** Página sem texto vira "só a foto" (carrossel e arte). */
  photoWhenEmpty?: boolean;
  /** Aviso no quadro sem foto. null = só o fundo na cor do modelo (como na exportação). */
  emptyLabel?: string | null;
  /** Arrastar o bloco de textos: deslocamento total do gesto, em % do quadro. */
  onDragText?: (dxPct: number, dyPct: number, phase: "move" | "end") => void;
}


export const SceneRenderer = memo(function SceneRenderer({
  imageUrl,
  logoUrl,
  onRequestLogoUpload,
  focalPoint,
  headline,
  subheadline,
  cta,
  layout,
  format = "story",
  fill,
  showSafeArea,
  compact,
  imageLayers,
  selected,
  onSelect,
  onDragText,
  emptyLabel = "sem imagem",
  photoWhenEmpty,
  textMotion,
}: Props) {
  const idPrefix = useId();
  const { width: W, height: H } = SCENE_FORMATS[format];
  const pct = (box: Box) => ({
    left: `${(box.x / W) * 100}%`,
    top: `${(box.y / H) * 100}%`,
    width: `${(box.width / W) * 100}%`,
    height: `${(box.height / H) * 100}%`,
  });
  const frameRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; y: number; moved: boolean } | null>(null);

  const scene = useMemo(() => sceneWithPalette(getScene(layout.template), layout.colors), [layout.template, layout.colors]);
  const built = useMemo(
    () =>
      buildSceneOverlaySvgWithMeta({
        width: W,
        height: H,
        scene,
        layout,
        content: { headline: headline || null, supportingText: subheadline, ctaText: cta },
        logo: logoUrl ? { dataUri: logoUrl } : null,
        idPrefix,
        photoWhenEmpty,
      }),
    [scene, layout, headline, subheadline, cta, logoUrl, idPrefix, W, H, photoWhenEmpty],
  );

  const interactive = !!onSelect;
  const layers: SceneImageLayer[] = imageLayers ?? [{ key: "single", url: imageUrl, focalPoint: focalPoint ?? null }];

  function dragDelta(e: ReactPointerEvent) {
    const rect = frameRef.current?.getBoundingClientRect();
    if (!rect || !drag.current) return null;
    return {
      dx: ((e.clientX - drag.current.x) / rect.width) * 100,
      dy: ((e.clientY - drag.current.y) / rect.height) * 100,
    };
  }

  const hit = (part: ScenePart, box: Box, label: string) => {
    const isText = part !== "logo";
    return (
      <button
        key={part}
        type="button"
        aria-label={label}
        aria-pressed={selected === part}
        onClick={() => onSelect?.(part)}
        onPointerDown={
          isText && onDragText
            ? (e) => {
                drag.current = { x: e.clientX, y: e.clientY, moved: false };
                e.currentTarget.setPointerCapture(e.pointerId);
              }
            : undefined
        }
        onPointerMove={
          isText && onDragText
            ? (e) => {
                const d = dragDelta(e);
                if (!d || (!drag.current!.moved && Math.abs(d.dx) + Math.abs(d.dy) < 0.6)) return;
                drag.current!.moved = true;
                onDragText(d.dx, d.dy, "move");
              }
            : undefined
        }
        onPointerUp={
          isText && onDragText
            ? (e) => {
                const d = dragDelta(e);
                if (d && drag.current?.moved) onDragText(d.dx, d.dy, "end");
                drag.current = null;
              }
            : undefined
        }
        className={`absolute rounded-[3px] outline-offset-2 transition-[outline-color] ${
          selected === part
            ? "outline outline-2 outline-sky-400"
            : "outline outline-1 outline-transparent hover:outline-white/70"
        } ${isText && onDragText ? "cursor-move touch-none" : "cursor-pointer"}`}
        style={{ ...pct(box), zIndex: 25 }}
      />
    );
  };

  return (
    <div
      ref={frameRef}
      className={
        compact
          ? "relative w-full overflow-hidden rounded-[5px] bg-black"
          : fill
            ? "relative h-full w-full overflow-hidden rounded-xl border bg-black shadow-md"
            : "relative mx-auto w-full max-w-[420px] overflow-hidden rounded-xl border bg-black shadow-md"
      }
      style={{ aspectRatio: `${W} / ${H}`, containerType: "inline-size" }}
      data-format={format}
    >
      {/* Foto(s) de fundo, enquadradas como no vídeo */}
      {layers.map((layer) =>
        layer.url ? (
          <FramedImage
            key={layer.key}
            src={layer.url}
            framing={normalizeFraming(layer.focalPoint, { fit: "contain", fill: scene.image.fill })}
            areas={built.imageAreas}
            frame={{ width: W, height: H }}
            fillColor={scene.palette.background}
            style={{ zIndex: 0, ...layer.style }}
            onClick={onSelect ? () => onSelect("image") : undefined}
          />
        ) : (
          <div
            key={layer.key}
            className="absolute inset-0 z-0 grid place-items-center text-xs text-white/60"
            style={emptyLabel === null ? { background: scene.palette.background, ...layer.style } : layer.style}
          >
            {emptyLabel}
          </div>
        ),
      )}

      {/* Cena: o mesmo SVG que o worker aplica no vídeo */}
      {textMotion && (textMotion.opacity < 1 || textMotion.dy !== 0) ? (
        // Entrada animada: formas e logo fixas, textos em camada própria —
        // as mesmas duas camadas que o worker entrega ao FFmpeg.
        <>
          <div className="scene-overlay pointer-events-none absolute inset-0" style={{ zIndex: 10 }} dangerouslySetInnerHTML={{ __html: built.baseSvg }} />
          <div
            className="scene-overlay pointer-events-none absolute inset-0"
            data-text-layer
            style={{ zIndex: 11, opacity: textMotion.opacity, transform: `translateY(${(textMotion.dy * 100).toFixed(3)}%)` }}
            dangerouslySetInnerHTML={{ __html: built.textSvg }}
          />
        </>
      ) : (
        <div
          className="scene-overlay pointer-events-none absolute inset-0"
          style={{ zIndex: 10 }}
          dangerouslySetInnerHTML={{ __html: built.svg }}
        />
      )}

      {/* Sem logo cadastrada (e não ocultada): marcador / envio */}
      {/* Nas miniaturas o marcador só poluiria a galeria. */}
      {!logoUrl && !compact && built.layout.logo.visible !== false && (
        <LogoSlot logoUrl={null} layout={built.layout.logo} onUpload={onRequestLogoUpload} />
      )}

      {interactive && (
        <>
          {built.textBoxes.title && hit("title", built.textBoxes.title, "Selecionar título")}
          {built.textBoxes.subtitle && hit("subtitle", built.textBoxes.subtitle, "Selecionar subtítulo")}
          {built.textBoxes.cta && hit("cta", built.textBoxes.cta, "Selecionar chamada")}
          {logoUrl && built.logoRendered && hit("logo", built.logoSlot, "Selecionar logo")}
        </>
      )}

      {/* Guias de safe area (opcional) */}
      {showSafeArea && (
        <div className="pointer-events-none absolute inset-0" style={{ zIndex: 30 }}>
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
});
