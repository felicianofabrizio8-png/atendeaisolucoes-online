import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { AuthForm, type AuthMode } from "@/components/auth/AuthForm";
import "@/components/orcamentos/quotes.css";
import "./auth-dialog.css";

type AuthDialogProps = {
  open: boolean;
  mode: "signin" | "signup";
  onOpenChange: (open: boolean) => void;
};

export function AuthDialog({ open, mode, onOpenChange }: AuthDialogProps) {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="auth-dialog-overlay fixed inset-0 z-50 bg-black/70 backdrop-blur-[6px]" />
        <DialogPrimitive.Content className="auth-dialog-content auth-lume lq-black lq-panel fixed left-1/2 top-1/2 z-50 max-h-[calc(100dvh-24px)] w-[calc(100vw-24px)] max-w-[480px] -translate-x-1/2 -translate-y-1/2 overflow-y-auto p-6 text-white outline-none sm:p-9">
          <span className="lq-panel-glow" aria-hidden="true" />
          <DialogPrimitive.Title className="sr-only">Acessar a Lume</DialogPrimitive.Title>
          <DialogPrimitive.Description className="sr-only">
            Entre na sua conta ou crie uma conta para começar.
          </DialogPrimitive.Description>
          <DialogPrimitive.Close
            aria-label="Fechar janela"
            className="lq-close absolute right-4 top-4"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </DialogPrimitive.Close>
          <AuthForm
            key={mode}
            initialMode={mode as AuthMode}
            onAuthenticated={() => onOpenChange(false)}
          />
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
