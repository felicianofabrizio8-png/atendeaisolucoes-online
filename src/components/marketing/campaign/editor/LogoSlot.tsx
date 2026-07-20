// ============================================================================
// LogoSlot — renderiza a logo do Brand Center dentro do preview.
// - Se `logoUrl` estiver presente: renderiza a imagem com posicionamento
//   determinado por `LogoLayout`.
// - Se ausente: renderiza um placeholder clicável com upload local. O upload
//   NÃO é persistido no Brand Center nesta onda — serve apenas para o preview
//   da sessão. A persistência acontecerá na Onda 2/3 via `brand-editor`.
// ============================================================================

import { useRef } from "react";
import { ImagePlus } from "lucide-react";
import type { CSSProperties } from "react";
import type { LogoLayout } from "@/lib/marketing/video-editor/layout.types";

interface Props {
  logoUrl: string | null;
  layout: LogoLayout;
  onUpload?: (file: File) => void;
}

function vAnchorToJustify(a: "top" | "center" | "bottom"): CSSProperties["alignItems"] {
  if (a === "top") return "flex-start";
  if (a === "center") return "center";
  return "flex-end";
}
function hAnchorToJustify(a: "left" | "center" | "right"): CSSProperties["justifyContent"] {
  if (a === "left") return "flex-start";
  if (a === "center") return "center";
  return "flex-end";
}

export function LogoSlot({ logoUrl, layout, onUpload }: Props) {
  const fileRef = useRef<HTMLInputElement>(null);
  const sizePct = 22 * layout.scale;

  const wrapperStyle: CSSProperties = {
    position: "absolute",
    inset: 0,
    display: "flex",
    justifyContent: hAnchorToJustify(layout.hAnchor),
    alignItems: vAnchorToJustify(layout.vAnchor),
    padding: `${layout.marginTop}% ${layout.marginRight}% ${layout.marginBottom}% ${layout.marginLeft}%`,
    pointerEvents: "none",
    zIndex: 15,
  };

  if (logoUrl) {
    return (
      <div style={wrapperStyle}>
        <img
          src={logoUrl}
          alt=""
          style={{
            width: `${sizePct}cqi`,
            maxHeight: "20%",
            objectFit: "contain",
            filter: "drop-shadow(0 2px 8px rgba(0,0,0,0.4))",
          }}
        />
      </div>
    );
  }

  // Placeholder — clicável para upload local (session-only).
  return (
    <div style={wrapperStyle}>
      <button
        type="button"
        onClick={() => fileRef.current?.click()}
        title="Sem logo cadastrada — clique para adicionar"
        style={{
          pointerEvents: "auto",
          width: `${sizePct}cqi`,
          aspectRatio: "3 / 1",
          background: "rgba(255,255,255,0.85)",
          color: "#111",
          border: "1.5px dashed rgba(0,0,0,0.35)",
          borderRadius: "6px",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: "0.4em",
          fontSize: "2.4cqi",
          fontWeight: 600,
          letterSpacing: "0.04em",
          textTransform: "uppercase",
          cursor: "pointer",
        }}
      >
        <ImagePlus size={12} />
        Logo
      </button>
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        style={{ display: "none" }}
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file && onUpload) onUpload(file);
          e.target.value = "";
        }}
      />
    </div>
  );
}
