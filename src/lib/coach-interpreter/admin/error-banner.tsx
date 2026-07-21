// Banner de erro reutilizável — sempre lê o contrato SafeInterpreterError,
// nunca `String(err)` nem `.toString()`.
import { AlertTriangle } from "lucide-react";
import type { SafeInterpreterError } from "@/lib/coach-interpreter/errors";

export function ErrorBanner({
  title,
  error,
  onRetry,
  testId,
}: {
  title: string;
  error: SafeInterpreterError;
  onRetry?: () => void;
  testId?: string;
}) {
  return (
    <div
      role="alert"
      aria-live="polite"
      data-testid={testId}
      className="m-2 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-xs"
    >
      <div className="flex items-start gap-2">
        <AlertTriangle className="h-3.5 w-3.5 text-destructive shrink-0 mt-0.5" />
        <div className="flex-1 min-w-0">
          <div className="font-semibold text-destructive">{title}</div>
          <div className="text-foreground mt-0.5 break-words">{error.message}</div>
          <div className="text-[10px] font-mono text-muted-foreground mt-0.5">
            code: {error.code}
          </div>
        </div>
        {onRetry && (
          <button
            type="button"
            onClick={onRetry}
            className="text-[11px] text-primary hover:underline shrink-0"
          >
            Tentar novamente
          </button>
        )}
      </div>
    </div>
  );
}
