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
  /** Tipo aberto, quando quem chama controla a navegação. */
  kind?: LibraryKind;
  onKindChange?: (kind: LibraryKind) => void;
}
export type LibraryKind = "photos" | "videos" | "audio" | "generated";
type Kind = LibraryKind;

const TABS: Array<[Kind, string]> = [
  ["photos", "Fotos"],
  ["videos", "Vídeos"],
  ["audio", "Músicas"],
  ["generated", "Vídeos criados"],
];

export function MarketingLibraryHub({ companyId, onUseMedia, kind: controlled, onKindChange }: Props) {
  const [inner, setInner] = useState<Kind>(controlled ?? "photos");
  const kind = controlled ?? inner;
  const [visitedKinds, setVisitedKinds] = useState<Set<Kind>>(() => new Set([kind]));
  if (!visitedKinds.has(kind)) setVisitedKinds(new Set([...visitedKinds, kind]));
  function selectKind(next: Kind) {
    setInner(next);
    onKindChange?.(next);
  }
  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-2xl font-semibold tracking-tight">Acervo</h2>
        <p className="text-sm text-muted-foreground">Todas as mídias da empresa em um só lugar.</p>
      </div>
      <ChipRow label="Tipo de mídia">
        {TABS.map(([id, label]) => (
          <Chip key={id} active={kind === id} onClick={() => selectKind(id)}>
            {label}
          </Chip>
        ))}
      </ChipRow>
      {visitedKinds.has("photos") && (
        <div hidden={kind !== "photos"}>
          <MarketingLibrary key="photos" companyId={companyId} mediaKind="image" onUse={onUseMedia} />
        </div>
      )}
      {visitedKinds.has("videos") && (
        <div hidden={kind !== "videos"}>
          <MarketingLibrary key="videos" companyId={companyId} mediaKind="video" marketingOnly onUse={onUseMedia} />
        </div>
      )}
      {visitedKinds.has("audio") && (
        <div hidden={kind !== "audio"}>
          <AudioLibrary companyId={companyId} />
        </div>
      )}
      {visitedKinds.has("generated") && (
        <div hidden={kind !== "generated"}>
          <VideoLibraryGrid companyId={companyId} />
        </div>
      )}
    </div>
  );
}
