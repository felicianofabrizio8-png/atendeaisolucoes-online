// Foto enquadrada como no vídeo final: a mesma conta (`placeImage`) que o
// worker traduz para o FFmpeg. No modo "conter" a imagem aparece inteira na
// área livre do modelo, e a sobra do quadro recebe o desfoque da própria foto
// ou a cor do modelo — nunca fica preta nem corta o produto.

import { useState, type CSSProperties } from "react";
import { BLUR, placeImage, type ImageAreas, type ImageFraming } from "@/lib/marketing/video-editor/scenes/registry";
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
  onClick?: () => void;
}

// Os mesmos números que o worker usa no FFmpeg (image-prepare-params.ts).
// A unidade cqi é % da largura do quadro: vale igual na miniatura e na prévia.
const BLUR_STYLE: CSSProperties = {
  filter: `blur(${BLUR.sigma * 100}cqi) brightness(${BLUR.brightness}) saturate(${BLUR.saturation})`,
  transform: `scale(${BLUR.zoom})`,
};

export function FramedImage({ src, framing, areas, frame, fillColor, style, onClick }: Props) {
  const size = useImageNaturalSize(src);
  // Imagem que não abre não deixa o ícone de "imagem quebrada" do navegador:
  // o quadro fica neutro e quem usa o componente mostra o aviso.
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const failed = failedSrc === src;
  const rect = size ? placeImage(size, areas, framing) : null;
  const pct = (v: number, total: number) => `${((v / total) * 100).toFixed(4)}%`;

  return (
    <div
      className="absolute inset-0 overflow-hidden"
      style={{ background: framing.fill === "color" ? fillColor : "#000", ...style }}
      data-fit={framing.fit}
      onClick={onClick}
    >
      {failed ? null : (
        <>
      {framing.fill === "blur" && (
        <img
          src={src}
          alt=""
          aria-hidden
          draggable={false}
          className="absolute inset-0 h-full w-full object-cover"
          style={BLUR_STYLE}
        />
      )}
      {rect ? (
        <img
          src={src}
          alt=""
          draggable={false}
          data-testid="framed-image"
          onError={() => setFailedSrc(src)}
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
        <img src={src} alt="" draggable={false} onError={() => setFailedSrc(src)} className="absolute inset-0 h-full w-full object-contain" />
      )}
        </>
      )}
    </div>
  );
}
