import { useState } from "react";
import { AudioLibrary } from "./AudioLibrary";
import { MarketingLibrary } from "./MarketingLibrary";
import { VideoLibraryGrid } from "./video-render/VideoLibraryGrid";

interface Props { companyId: string; }
type Kind = "media" | "audio" | "generated";

export function MarketingLibraryHub({ companyId }: Props) {
  const [kind, setKind] = useState<Kind>("media");
  const tabs: Array<[Kind, string]> = [["media", "Imagens e vídeos"], ["audio", "Áudios"], ["generated", "Vídeos gerados"]];
  return (
    <div className="space-y-4">
      <div><h2 className="text-lg font-semibold">Acervo</h2><p className="text-sm text-muted-foreground">Todos os ativos da empresa em um só lugar. O mesmo acervo é usado ao criar campanhas.</p></div>
      <div className="flex gap-1 overflow-x-auto border-b pb-1" role="tablist" aria-label="Acervo">
        {tabs.map(([id, label]) => <button key={id} type="button" role="tab" aria-selected={kind === id} onClick={() => setKind(id)} className={`shrink-0 rounded-t-md px-3 py-2 text-sm ${kind === id ? "border-b-2 border-primary font-medium text-primary" : "text-muted-foreground hover:text-foreground"}`}>{label}</button>)}
      </div>
      {kind === "media" && <MarketingLibrary companyId={companyId} />}
      {kind === "audio" && <AudioLibrary companyId={companyId} />}
      {kind === "generated" && <VideoLibraryGrid companyId={companyId} />}
    </div>
  );
}
