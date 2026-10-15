import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { AuthForm, type AuthMode } from "@/components/auth/AuthForm";

type AuthDialogProps = {
  open: boolean;
  mode: "signin" | "signup";
  onOpenChange: (open: boolean) => void;
};

export function AuthDialog({ open, mode, onOpenChange }: AuthDialogProps) {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="auth-dialog-overlay fixed inset-0 z-50 bg-[#16091f]/55 backdrop-blur-[8px]" />
        <DialogPrimitive.Content className="auth-dialog-content fixed left-1/2 top-1/2 z-50 max-h-[calc(100dvh-24px)] w-[calc(100vw-24px)] max-w-[510px] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-[30px] border border-violet-200/20 bg-[radial-gradient(circle_at_50%_0%,rgba(175,106,225,0.32),transparent_48%),linear-gradient(155deg,#38204f_0%,#29163b_46%,#170d22_100%)] p-6 text-white shadow-[0_35px_110px_rgba(0,0,0,0.55)] outline-none sm:p-9">
          <DialogPrimitive.Title className="sr-only">Acessar a Lume</DialogPrimitive.Title>
          <DialogPrimitive.Description className="sr-only">
            Entre na sua conta ou crie uma conta para começar.
          </DialogPrimitive.Description>
          <DialogPrimitive.Close
            aria-label="Fechar janela"
            className="absolute right-4 top-4 flex h-9 w-9 items-center justify-center rounded-full border border-white/15 bg-white/5 text-white/70 transition hover:bg-white/15 hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-300"
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
