import { Fragment } from "react";

/**
 * Mensagem de template com o trecho variável destacado. Os {{ }} vêm da
 * versão de exibição do servidor e são SÓ visuais — nunca vão para a Meta.
 * O texto fixo (espaços, vírgulas, quebras de linha) é mostrado como está.
 */
export function MarkedTemplateText({ text }: { text: string }) {
  return (
    <>
      {text.split(/(\{\{[\s\S]*?\}\})/).map((part, i) =>
        i % 2 === 1 ? (
          <mark key={i} className="rounded bg-sky-500/15 px-0.5 text-foreground">
            {part}
          </mark>
        ) : (
          <Fragment key={i}>{part}</Fragment>
        ),
      )}
    </>
  );
}
