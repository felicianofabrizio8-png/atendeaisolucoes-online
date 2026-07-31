import type { ReactNode } from "react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  /**
   * Chamado quando o sheet fecha, no momento em que o Radix devolveria o foco.
   * Deve devolver `true` quando já cuidou do foco — nesse caso o comportamento
   * padrão é suprimido. Necessário porque o gatilho aqui é um botão comum
   * (estado controlado), não um `SheetTrigger`, então o Radix não tem para
   * onde restaurar e o foco cairia no `<body>`.
   */
  onCloseFocus?: () => boolean | void;
  /** Conteúdo do painel lateral, reaproveitado do desktop sem duplicação. */
  children: ReactNode;
}

/**
 * Nível 3 da navegação mobile da Inbox: Coach IA + dados do lead + ações,
 * exibidos em sheet de tela cheia sobre a conversa.
 *
 * Renderiza exatamente o mesmo conteúdo do `<aside>` de desktop — o objetivo é
 * dar acesso, não criar uma segunda versão da informação que possa divergir.
 */
export function ConversationDetailsSheet({ open, onOpenChange, title, onCloseFocus, children }: Props) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        mobileFullscreen
        data-testid="conversation-details-sheet"
        onCloseAutoFocus={(event) => {
          if (onCloseFocus?.()) event.preventDefault();
        }}
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
