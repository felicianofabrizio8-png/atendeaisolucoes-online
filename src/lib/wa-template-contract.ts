// ============================================================================
// wa-template-contract.ts
// Contrato único de renderização de templates WhatsApp aprovados — usado pelo
// Follow-up V2 e pelas Campanhas de Relacionamento (e pela UI). Funções puras,
// sem dependência de servidor.
//
//  - O texto fixo é SEMPRE o body sincronizado da Meta, byte a byte (espaços,
//    vírgulas, quebras de linha). Nada aqui reescreve o texto fixo.
//  - `{{n}}` recebe o parâmetro n; o payload da Meta leva só o conteúdo.
//  - A versão "marcada" envolve cada parâmetro em {{ }} — SOMENTE para exibir
//    qual trecho ocupou a variável. Nunca vai para a Meta/cliente.
// ============================================================================

/** Texto do componente BODY, exatamente como sincronizado. */
export function templateBodyText(components: unknown): string {
  const list = Array.isArray(components) ? (components as Array<Record<string, unknown>>) : [];
  const body = list.find((c) => String(c?.type ?? "").toUpperCase() === "BODY");
  return typeof body?.text === "string" ? body.text : "";
}

/**
 * Substitui {{1}}..{{n}} pelos parâmetros. `marked` = exibição: cada valor
 * entre {{ }}. Substituto por função: `$&`, `$1`… no valor são literais.
 */
export function renderBodyWithParameters(
  body: string,
  parameters: string[],
  opts: { marked?: boolean } = {},
): string {
  let rendered = body;
  parameters.forEach((value, i) => {
    const shown = opts.marked ? `{{${value}}}` : value;
    rendered = rendered.replaceAll(`{{${i + 1}}}`, () => shown);
  });
  return rendered;
}

/**
 * Templates de retomada ({{1}} = frase gerada): exatamente uma variável e o
 * {{1}} presente no body. Fora disso, não envia (nada de variável vazia).
 */
export function resumeTemplateProblem(template: {
  name: string;
  variables?: string[] | null;
  components: unknown;
}): string | null {
  const count = (template.variables ?? []).length;
  if (count !== 1)
    return `template "${template.name}" tem ${count} variáveis; a retomada usa exatamente {{1}}`;
  if (!templateBodyText(template.components).includes("{{1}}"))
    return `template "${template.name}" não tem {{1}} no corpo`;
  return null;
}

/**
 * Encaixa o var1 no texto fixo que vem DEPOIS de {{1}}: se o template
 * continua (", tudo bem?", " tudo bem?"…), o var1 não pode terminar com
 * pontuação — senão sai "atendimento,, tudo bem?" ou "projeto. tudo bem?".
 * Não mexe no texto fixo, só no conteúdo da variável.
 */
export function fitVar1ToTemplate(value: string, body: string): string {
  const text = value.replace(/\s+/g, " ").trim();
  const at = body.indexOf("{{1}}");
  if (at < 0) return text;
  const after = body.slice(at + "{{1}}".length);
  if (!after.trim()) return text;
  return text.replace(/[\s,.;:!?…]+$/u, "").trim();
}
