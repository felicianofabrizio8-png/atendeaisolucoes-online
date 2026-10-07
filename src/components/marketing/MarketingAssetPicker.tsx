import { useState } from "react";
import { ImagePlus, Check, Music2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { MarketingLibrary } from "./MarketingLibrary";
import { CampaignAudioPicker } from "./campaign/CampaignAudioPicker";
import { toast } from "sonner";
import { sameSelection, type MediaSelection } from "@/lib/marketing/media-selection";
import type { AudioLibraryRow } from "@/lib/audio-library/audio-library.types";

interface Props {
  companyId: string;
  selectedMedia: MediaSelection[];
  onMediaChange: (next: MediaSelection[]) => void;
  selectedAudio: AudioLibraryRow | null;
  onAudioChange: (audio: AudioLibraryRow | null) => void;
  showAudio?: boolean;
  /** Tipo de mídia aceito nesta criação. */
  mediaKind?: "image" | "video";
  /** Só mídias do acervo (sem imagens de produtos). */
  marketingOnly?: boolean;
  /** Limite de itens; com 1, escolher outro item substitui o atual. */
  maxItems?: number;
}

export function MarketingAssetPicker({
  companyId,
  selectedMedia,
  onMediaChange,
  selectedAudio,
  onAudioChange,
  showAudio = true,
  mediaKind,
  marketingOnly = false,
  maxItems,
}: Props) {
  const [open, setOpen] = useState<"media" | "audio" | null>(null);

  return (
    <div className="flex flex-wrap gap-2">
      <Button type="button" variant="outline" size="sm" onClick={() => setOpen("media")}>
        <ImagePlus className="mr-2 h-4 w-4" />
        {selectedMedia.length ? selectedMedia.length + " mídia(s)" : "Escolher mídia"}
      </Button>
      {showAudio && <Button type="button" variant="outline" size="sm" onClick={() => setOpen("audio")}>
        <Music2 className="mr-2 h-4 w-4" />
        {selectedAudio ? selectedAudio.name : "Escolher música"}
      </Button>}

      <Dialog open={open === "media"} onOpenChange={(next) => !next && setOpen(null)}>
        {open === "media" && (
          <DialogContent mobileFullscreen className="sm:max-w-5xl">
            <DialogHeader>
              <DialogTitle>Escolher mídia</DialogTitle>
              <DialogDescription>
                {mediaKind === "video"
                  ? "Busque no Acervo e selecione um vídeo. Nada é duplicado."
                  : marketingOnly
                    ? "Busque no Acervo e selecione uma foto. Nada é duplicado."
                    : "Busque no Acervo e selecione fotos ou imagens de produtos. Nada é duplicado."}
              </DialogDescription>
            </DialogHeader>
            <MarketingLibrary
              companyId={companyId}
              selectable
              selected={selectedMedia}
              mediaKind={mediaKind}
              marketingOnly={marketingOnly}
              onToggleSelect={(selection) => {
                if (selectedMedia.some((item) => sameSelection(item, selection))) {
                  onMediaChange(selectedMedia.filter((item) => !sameSelection(item, selection)));
                  return;
                }
                if (maxItems === 1) {
                  onMediaChange([selection]);
                  return;
                }
                if (maxItems && selectedMedia.length >= maxItems) {
                  toast.error(`Você pode adicionar até ${maxItems} imagens por campanha.`);
                  return;
                }
                onMediaChange([...selectedMedia, selection]);
              }}
            />
            <div className="flex justify-end">
              <Button type="button" onClick={() => setOpen(null)}>
                <Check className="mr-2 h-4 w-4" /> Concluir seleção
              </Button>
            </div>
          </DialogContent>
        )}
      </Dialog>

      {showAudio && <Dialog open={open === "audio"} onOpenChange={(next) => !next && setOpen(null)}>
        {open === "audio" && (
          <DialogContent mobileFullscreen className="sm:max-w-3xl">
            <DialogHeader>
              <DialogTitle>Escolher música</DialogTitle>
              <DialogDescription>
                Ouça e selecione um áudio já autorizado no acervo da empresa.
              </DialogDescription>
            </DialogHeader>
            <CampaignAudioPicker selectedId={selectedAudio?.id ?? null} onSelect={onAudioChange} />
            <div className="flex justify-end">
              <Button type="button" onClick={() => setOpen(null)}>Concluir seleção</Button>
            </div>
          </DialogContent>
        )}
      </Dialog>}
    </div>
  );
}