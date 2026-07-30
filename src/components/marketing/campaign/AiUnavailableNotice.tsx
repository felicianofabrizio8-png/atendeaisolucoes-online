// Aviso de indisponibilidade da IA + oferta do Modo Manual.
// Nunca bloqueia o usuário: sempre há um caminho para continuar.

import { Button } from "@/components/ui/button";
import { AlertTriangle, RefreshCw, PencilRuler } from "lucide-react";
import { aiFailureMessage, type AiFailureKind } from "@/lib/marketing/ai-failure";

interface Props {
  kind: AiFailureKind;
  retrying?: boolean;
  onRetry: () => void;
  onContinueManually: () => void;
}

export function AiUnavailableNotice({ kind, retrying, onRetry, onContinueManually }: Props) {
  return (
    <div
      role="alert"
      className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-4 space-y-3"
    >
      <div className="flex items-start gap-2">
        <AlertTriangle className="h-4 w-4 mt-0.5 text-amber-600 shrink-0" />
        <div className="text-sm">
          <p className="font-semibold">{aiFailureMessage(kind)}</p>
          <p className="text-muted-foreground">
            Você pode continuar criando sua campanha manualmente.
          </p>
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" onClick={onContinueManually}>
          <PencilRuler className="h-4 w-4 mr-1" />
          Continuar manualmente
        </Button>
        <Button size="sm" variant="outline" onClick={onRetry} disabled={retrying}>
          <RefreshCw className="h-4 w-4 mr-1" />
          Tentar novamente
        </Button>
      </div>
    </div>
  );
}
