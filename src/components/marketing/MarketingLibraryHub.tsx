import { useState } from "react";
import { AudioLibrary } from "./AudioLibrary";
import { MarketingLibrary } from "./MarketingLibrary";
import { VideoLibraryGrid } from "./video-render/VideoLibraryGrid";
import { Chip, ChipRow } from "./ui/MarketingUi";
import type { MediaSelection } from "@/lib/marketing/media-selection";

interface Props {
  companyId: string;
  /** Começa uma publicação com a mídia tocada. */
  onUseMedia?: (selection: MediaSelection) => void;
}
type Kind = "photos" | "videos" | "audio" | "generated";

const TABS: Array<[Kind, string]> = [
  ["photos", "Fotos"],
  ["videos", "Vídeos"],
  ["audio", "Músicas"],
  ["generated", "Vídeos criados"],
];

export function MarketingLibraryHub({ companyId, onUseMedia }: Props) {
  const [kind, setKind] = useState<Kind>("photos");
  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-2xl font-semibold tracking-tight">Acervo</h2>
        <p className="text-sm text-muted-foreground">Todas as mídias da empresa em um só lugar.</p>
      </div>
      <ChipRow label="Tipo de mídia">
        {TABS.map(([id, label]) => (
          <Chip key={id} active={kind === id} onClick={() => setKind(id)}>
            {label}
          </Chip>
        ))}
      </ChipRow>
      {kind === "photos" && <MarketingLibrary key="photos" companyId={companyId} mediaKind="image" onUse={onUseMedia} />}
      {kind === "videos" && <MarketingLibrary key="videos" companyId={companyId} mediaKind="video" marketingOnly onUse={onUseMedia} />}
      {kind === "audio" && <AudioLibrary companyId={companyId} />}
      {kind === "generated" && <VideoLibraryGrid companyId={companyId} />}
    </div>
  );
}
