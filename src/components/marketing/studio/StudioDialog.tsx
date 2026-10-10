// Janela do Estúdio Criativo (carrossel e arte) — mesmas medidas do estúdio
// de vídeo, para a experiência ser uma só.

import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { MarketingContentRow } from "@/lib/marketing/marketing.types";
import { STUDIO_KINDS, type StudioDocument } from "@/lib/marketing/studio/document";
import { CreativeStudio } from "./CreativeStudio";

export interface StudioSession {
  /** Muda a cada abertura: reinicia o editor com o documento novo. */
  key: string;
  document: StudioDocument;
  contentId?: string | null;
  caption?: string;
}

interface Props {
  companyId: string;
  session: StudioSession | null;
  onClose: () => void;
  onSaved?: (row: MarketingContentRow) => void;
}

export function StudioDialog({ companyId, session, onClose, onSaved }: Props) {
  return (
    <Dialog open={!!session} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="flex h-[95dvh] max-h-[95dvh] w-[98vw] max-w-[1600px] flex-col gap-0 overflow-hidden p-2 [&_[data-studio-header]]:pr-10">
        <DialogHeader className="sr-only">
          <DialogTitle>Estúdio criativo{session ? ` — ${STUDIO_KINDS[session.document.kind]}` : ""}</DialogTitle>
          <DialogDescription>Editor de carrossel e arte.</DialogDescription>
        </DialogHeader>
        {session && (
          <div className="min-h-0 flex-1">
            <CreativeStudio
              key={session.key}
              companyId={companyId}
              initial={session.document}
              contentId={session.contentId ?? null}
              initialCaption={session.caption ?? ""}
              onSaved={onSaved}
            />
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
