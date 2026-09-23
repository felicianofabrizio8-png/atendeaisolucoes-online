import { Fragment } from "react";

/**
 * Formatador mínimo para as respostas do copiloto: `**negrito**`, `_itálico_`
 * e quebras de linha. Não é um parser de Markdown — é só o suficiente para as
 * respostas não aparecerem com asteriscos crus na tela. Nada de HTML vindo de
 * string, então também não abre porta para injeção.
 */
export function RichText({ text }: { text: string }) {
  return (
    <>
      {text.split("\n").map((line, li) => (
        <Fragment key={li}>
          {li > 0 && <br />}
          {tokenize(line).map((token, ti) => {
            if (token.kind === "bold") return <strong key={ti}>{token.value}</strong>;
            if (token.kind === "italic") return <em key={ti}>{token.value}</em>;
            return <Fragment key={ti}>{token.value}</Fragment>;
          })}
        </Fragment>
      ))}
    </>
  );
}

type Token = { kind: "text" | "bold" | "italic"; value: string };

const PATTERN = /\*\*([^*]+)\*\*|_([^_]+)_/g;

function tokenize(line: string): Token[] {
  const tokens: Token[] = [];
  let cursor = 0;

  for (const match of line.matchAll(PATTERN)) {
    const at = match.index ?? 0;
    if (at > cursor) tokens.push({ kind: "text", value: line.slice(cursor, at) });
    if (match[1] != null) tokens.push({ kind: "bold", value: match[1] });
    else if (match[2] != null) tokens.push({ kind: "italic", value: match[2] });
    cursor = at + match[0].length;
  }

  if (cursor < line.length) tokens.push({ kind: "text", value: line.slice(cursor) });
  return tokens;
}
