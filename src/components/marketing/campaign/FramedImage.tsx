// Foto enquadrada como no vídeo final: a mesma conta (`placeImage`) que o
// worker traduz para o FFmpeg. No modo "conter" a imagem aparece inteira na
// área livre do modelo, e a sobra do quadro recebe o desfoque da própria foto
// ou a cor do modelo — nunca fica preta nem corta o produto.

import type { CSSProperties } from "react";
import { placeImage, type ImageAreas, type ImageFraming } from "@/lib/marketing/video-editor/scenes/registry";
import { useImageNaturalSize } from "./FocalImage";

interface Props {
  src: string;
  framing: ImageFraming;
  /** Áreas do modelo em px do quadro de referência. */
  areas: ImageAreas;
  frame: { width: number; height: number };
  /** Cor usada no preenchimento "cor do modelo". */
  fillColor: string;
  style?: CSSProperties;
}

export function FramedImage({ src, framing, areas, frame, fillColor, style }: Props) {
  const size = useImageNaturalSize(src);
  const rect = size ? placeImage(size, areas, framing) : null;
  const pct = (v: number, total: number) => `${((v / total) * 100).toFixed(4)}%`;

  return (
    <div className="absolute inset-0 overflow-hidden" style={{ background: framing.fill === "color" ? fillColor : "#000", ...style }} data-fit={framing.fit}>
      {framing.fill === "blur" && (
        <img
          src={src}
          alt=""
          aria-hidden
          draggable={false}
          className="absolute inset-0 h-full w-full object-cover"
          // Desfoque proporcional ao quadro (cqi), para miniatura e prévia ficarem iguais.
          style={{ filter: "blur(3.2cqi) brightness(0.94) saturate(1.08)", transform: "scale(1.14)" }}
        />
      )}
      {rect ? (
        <img
          src={src}
          alt=""
          draggable={false}
          data-testid="framed-image"
          className="absolute"
          style={{
            left: pct(rect.x, frame.width),
            top: pct(rect.y, frame.height),
            width: pct(rect.width, frame.width),
            height: pct(rect.height, frame.height),
            maxWidth: "none",
            maxHeight: "none",
          }}
        />
      ) : (
        // Enquanto as dimensões reais não chegam: inteira e centralizada.
        <img src={src} alt="" draggable={false} className="absolute inset-0 h-full w-full object-contain" />
      )}
    </div>
  );
}
