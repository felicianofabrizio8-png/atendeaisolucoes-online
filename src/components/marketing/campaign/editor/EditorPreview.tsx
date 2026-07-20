// ============================================================================
// EditorPreview — thin wrapper que delega ao SceneRenderer.
// Mantido para não quebrar callers existentes; novos consumidores podem
// importar `SceneRenderer` diretamente.
// ============================================================================

import type { FocalPointInput } from "@/data/marketingRepo";
import type { VideoLayout } from "@/lib/marketing/video-editor/layout.types";
import { SceneRenderer } from "./SceneRenderer";

interface Props {
  imageUrl: string | null;
  logoUrl?: string | null;
  onRequestLogoUpload?: (file: File) => void;
  focalPoint?: FocalPointInput | null;
  headline: string;
  subheadline: string | null;
  cta: string | null;
  layout: VideoLayout;
  fill?: boolean;
  showSafeArea?: boolean;
}

export function EditorPreview(props: Props) {
  return (
    <SceneRenderer
      imageUrl={props.imageUrl}
      logoUrl={props.logoUrl ?? null}
      onRequestLogoUpload={props.onRequestLogoUpload}
      focalPoint={props.focalPoint ?? null}
      headline={props.headline}
      subheadline={props.subheadline}
      cta={props.cta}
      layout={props.layout}
      fill={props.fill}
      showSafeArea={props.showSafeArea}
    />
  );
}
