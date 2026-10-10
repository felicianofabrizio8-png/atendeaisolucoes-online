// Seletor de imagem do estúdio: o mesmo Acervo da empresa (envio de arquivo,
// mídias de marketing e fotos de produtos), em modo de escolha única.

import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { MarketingLibrary } from "../MarketingLibrary";
import type { MediaSelection } from "@/lib/marketing/media-selection";
import type { PageImageRef } from "@/lib/marketing/studio/document";

interface Props {
  open: boolean;
  companyId: string;
  title: string;
  onClose: () => void;
  onPick: (image: PageImageRef) => void;
}

/** Converte a seleção do Acervo na referência usada pelo documento. */
export function selectionToImage(sel: MediaSelection): PageImageRef | null {
  if (sel.origin === "marketing") return sel.mediaType === "video" ? null : { origin: "marketing", mediaId: sel.id };
  return { origin: "product", productId: sel.productId, imagePath: sel.imagePath };
}

export function StudioMediaPicker({ open, companyId, title, onClose, onPick }: Props) {
  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="flex max-h-[90dvh] w-[96vw] max-w-4xl flex-col overflow-hidden">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>Envie um arquivo ou escolha uma imagem do acervo ou de um produto da empresa.</DialogDescription>
        </DialogHeader>
        <div className="min-h-0 flex-1 overflow-y-auto">
          {open && (
            <MarketingLibrary
              companyId={companyId}
              selectable
              mediaKind="image"
              selected={[]}
              onToggleSelect={(sel) => {
                const image = selectionToImage(sel);
                if (image) onPick(image);
              }}
            />
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
