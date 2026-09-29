import { CheckCircle2, X, XCircle } from "lucide-react";
import { MarkedTemplateText } from "@/components/templates/MarkedTemplateText";
import type { ManualFollowupResult } from "@/lib/manual-followup.functions";

/** Resultado de "Executar Follow-up Agora": elegibilidade, regra e envio. */
export function ManualFollowupResultDialog({
  result,
  error,
  onClose,
}: {
  result: ManualFollowupResult | null;
  error: string | null;
  onClose: () => void;
}) {
  if (!result && !error) return null;
  return (
    <div
      className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-background border border-border rounded-lg shadow-xl max-w-md w-full p-5 space-y-3"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h3 className="font-semibold text-sm">Execução manual de Follow-up</h3>
          <button
            type="button"
            onClick={onClose}
            className="h-7 w-7 inline-flex items-center justify-center rounded hover:bg-accent"
            aria-label="Fechar"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        {error ? (
          <div className="text-sm text-destructive">{error}</div>
        ) : result ? (
          <div className="space-y-2 text-sm">
            <div className="flex items-center gap-2">
              <span className="text-muted-foreground">Elegibilidade:</span>
              {result.eligible ? (
                <span className="inline-flex items-center gap-1 text-emerald-600 dark:text-emerald-400 font-semibold">
                  <CheckCircle2 className="h-3.5 w-3.5" /> Elegível
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 text-amber-600 dark:text-amber-400 font-semibold">
                  <XCircle className="h-3.5 w-3.5" /> Não elegível
                </span>
              )}
            </div>
            {result.blockedReason && (
              <div>
                <span className="text-muted-foreground">Motivo do bloqueio: </span>
                <span className="font-medium">{result.blockedReason}</span>
              </div>
            )}
            {result.rule && (
              <div>
                <span className="text-muted-foreground">Regra: </span>
                <span className="font-mono text-xs">{result.rule}</span>
              </div>
            )}
            {result.generatedMessage && (
              <div>
                <div className="text-muted-foreground mb-1">
                  Mensagem gerada
                  {result.templateName ? (
                    <span className="font-mono text-xs"> · template {result.templateName}</span>
                  ) : null}
                  :
                </div>
                <div
                  className="rounded border border-border bg-muted/40 p-2 text-xs whitespace-pre-wrap"
                  aria-label="Mensagem gerada"
                >
                  {result.generatedMessagePreview ? (
                    <MarkedTemplateText text={result.generatedMessagePreview} />
                  ) : (
                    result.generatedMessage
                  )}
                </div>
                {result.generatedMessagePreview && (
                  <div className="mt-1 text-[11px] text-muted-foreground">
                    As chaves {"{{ }}"} só marcam o trecho da variável ({"{{1}}"}
                    {result.resumePhraseSource ? `, origem: ${result.resumePhraseSource}` : ""}); o
                    cliente recebe apenas o conteúdo interno.
                  </div>
                )}
              </div>
            )}
            {result.sendStatus && (
              <div className="flex items-center gap-2">
                <span className="text-muted-foreground">Status WhatsApp:</span>
                {result.sendStatus === "sent" && (
                  <span className="inline-flex items-center gap-1 text-emerald-600 dark:text-emerald-400 font-semibold">
                    <CheckCircle2 className="h-3.5 w-3.5" /> Enviado
                    {result.via ? ` (${result.via})` : ""}
                  </span>
                )}
                {result.sendStatus === "failed" && (
                  <span className="inline-flex items-center gap-1 text-destructive font-semibold">
                    <XCircle className="h-3.5 w-3.5" /> Falhou
                  </span>
                )}
                {result.sendStatus === "blocked" && (
                  <span className="inline-flex items-center gap-1 text-amber-600 dark:text-amber-400 font-semibold">
                    <XCircle className="h-3.5 w-3.5" /> Bloqueado
                  </span>
                )}
              </div>
            )}
            {result.sendError && <div className="text-xs text-destructive">{result.sendError}</div>}
            {result.attempt ? (
              <div>
                <span className="text-muted-foreground">Tentativa da negociação: </span>
                <span className="font-medium">{result.attempt}</span>
              </div>
            ) : null}
            {result.nextFollowupAt ? (
              <div>
                <span className="text-muted-foreground">Próxima tentativa: </span>
                <span className="font-medium">
                  {new Date(result.nextFollowupAt).toLocaleString("pt-BR")}
                </span>
              </div>
            ) : result.cycleClosedReason ? (
              <div className="text-muted-foreground">
                Negociação encerrada no follow-up ({result.cycleClosedReason}).
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}
