import { useState } from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import type { Goal } from "@/lib/goals/model";
import "@/components/orcamentos/quotes.css";
import "@/components/auth/auth-dialog.css";

export function GoalEntryDialog({
  goal,
  onClose,
  onSubmit,
}: {
  goal: Goal;
  onClose: () => void;
  onSubmit: (amount: number, note: string) => Promise<void>;
}) {
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const value = Number(amount.replace(",", "."));
  return (
    <DialogPrimitive.Root open onOpenChange={(open) => !open && onClose()}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="auth-dialog-overlay fixed inset-0 z-50 bg-black/70 backdrop-blur-[6px]" />
        <DialogPrimitive.Content
          aria-describedby={undefined}
          className="auth-dialog-content lq-black lq-panel lq-form fixed left-1/2 top-1/2 z-50 w-[calc(100vw-24px)] max-w-[420px] -translate-x-1/2 -translate-y-1/2 p-6 text-white"
        >
          <DialogPrimitive.Close aria-label="Fechar" className="lq-close absolute right-4 top-4">
            <X className="h-4 w-4" aria-hidden />
          </DialogPrimitive.Close>
          <DialogPrimitive.Title className="text-xl font-semibold">
            Lançar progresso
          </DialogPrimitive.Title>
          <p className="mt-1 text-sm text-white/60">{goal.name}</p>
          <form
            className="mt-5 space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              if (value) void onSubmit(value, note);
            }}
          >
            <label className="lq-field-label block">
              Quantidade ({goal.unit})
              <input
                className="quote-form-input auth-lume-field"
                inputMode="decimal"
                autoFocus
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
              />
            </label>
            <label className="lq-field-label block">
              Observação (opcional)
              <input
                className="quote-form-input auth-lume-field"
                maxLength={280}
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
            </label>
            <button type="submit" className="lq-primary w-full" disabled={!value}>
              Lançar
            </button>
          </form>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
