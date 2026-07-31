import type { ReactNode } from "react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  /** Conteúdo do painel lateral, reaproveitado do desktop sem duplicação. */
  children: ReactNode;
}

/**
 * Nível 3 da navegação mobile da Inbox: Coach IA + dados do lead + ações,
 * exibidos em sheet de tela cheia sobre a conversa.
 *
 * Renderiza exatamente o mesmo conteúdo do `<aside>` de desktop — o objetivo é
 * dar acesso, não criar uma segunda versão da informação que possa divergir.
 * O Radix cuida do focus trap e da restauração de foco ao fechar, então voltar
 * para a conversa devolve o cursor ao gatilho.
 */
export function ConversationDetailsSheet({ open, onOpenChange, title, children }: Props) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        mobileFullscreen
        data-testid="conversation-details-sheet"
        className="w-full p-0 flex flex-col gap-0 sm:max-w-md lg:hidden"
      >
        <SheetHeader className="border-b border-border px-4 py-3 text-left shrink-0">
          <SheetTitle className="text-sm font-semibold">{title}</SheetTitle>
        </SheetHeader>
        <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain">{children}</div>
      </SheetContent>
    </Sheet>
  );
}
