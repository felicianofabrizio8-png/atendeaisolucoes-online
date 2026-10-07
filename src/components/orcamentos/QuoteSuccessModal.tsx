import { Pencil } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { quoteGlow } from "@/lib/quote-presentation";
import type { Quote } from "@/data/quotes";

export function QuoteSuccessModal({
  quote,
  onClose,
  onSend,
  canSend,
  onEdit,
  onView,
}: {
  quote: Quote;
  onClose: () => void;
  onSend: () => void;
  canSend: boolean;
  onEdit: () => void;
  onView: () => void;
}) {
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="isolate flex min-h-[390px] w-[calc(100vw-2rem)] max-w-[720px] flex-col overflow-hidden rounded-[36px] border-white/10 bg-black p-8 text-white shadow-2xl sm:min-h-[440px] sm:rounded-[44px] sm:p-14">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -left-20 -bottom-20 -z-10 h-64 w-64 rounded-full opacity-40 blur-[60px]"
          style={{ background: quoteGlow(quote.id) }}
        />
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -right-16 -top-24 -z-10 h-64 w-64 rounded-full bg-teal-700/50 blur-[65px]"
        />
        <DialogTitle className="max-w-[530px] text-4xl font-bold leading-[1.05] tracking-tight sm:text-5xl">
          Orçamento criado
          <br />
          com sucesso!
        </DialogTitle>
        <DialogDescription className="sr-only">
          Escolha como continuar com o orçamento criado.
        </DialogDescription>
        <div className="mt-auto flex flex-wrap items-end justify-between gap-4 pt-12">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={onSend}
              disabled={!canSend}
              title={canSend ? "Enviar pelo WhatsApp" : "Cliente sem telefone válido para WhatsApp"}
              className="min-h-14 rounded-full border border-white/70 px-9 text-xl font-bold transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40 sm:text-2xl"
            >
              Enviar
            </button>
            <button
              type="button"
              onClick={onEdit}
              aria-label="Editar orçamento"
              className="flex h-14 w-14 items-center justify-center rounded-full border border-white/60 transition hover:bg-white/10"
            >
              <Pencil className="h-6 w-6" />
            </button>
          </div>
          <button
            type="button"
            onClick={onView}
            className="min-h-14 rounded-full bg-white px-9 text-xl font-bold text-black transition hover:bg-white/85 sm:text-2xl"
          >
            Visualizar
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
