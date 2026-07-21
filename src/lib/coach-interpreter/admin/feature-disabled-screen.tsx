// Tela exibida quando a feature flag do Coach Interpreter está desligada
// ou o kill-switch está acionado.
import { Link } from "@tanstack/react-router";
import { AlertTriangle } from "lucide-react";

export function FeatureDisabledScreen({ reason }: { reason: string }) {
  return (
    <div className="max-w-2xl mx-auto p-8">
      <div className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-6">
        <div className="flex items-start gap-3">
          <AlertTriangle className="h-5 w-5 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
          <div>
            <h2 className="font-semibold">Recurso desabilitado</h2>
            <p className="text-sm text-muted-foreground mt-1">{reason}</p>
            <p className="text-xs text-muted-foreground mt-3">
              O Console do Coach Interpreter só funciona quando a feature flag{" "}
              <code className="font-mono text-[11px] bg-muted px-1 py-0.5 rounded">
                coach_interpreter_enabled
              </code>{" "}
              está ligada. Ativação é responsabilidade explícita da equipe backend; nenhuma UI
              administrativa pode alterá-la.
            </p>
            <Link to="/configuracoes" className="text-sm text-primary underline mt-3 inline-block">
              Voltar para Configurações
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
