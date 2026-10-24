// ============================================================================
// followup/resume-phrase.ts
// Responsabilidade: trecho de retomada que preenche o {{1}} do template
// `chamar_novamente`. Funções puras — prompt, validação e fallback — para a
// regra ser testável sem rede; a chamada à IA fica em `resume.ts`.
//
// Contrato da frase:
//  - texto livre em português, gerado do histórico real, que se encaixa
//    entre o texto fixo antes e depois do {{1}} ("Olá {{1}} tudo bem?");
//  - NUNCA o nome do cliente (o template decide saudação e tratamento);
//  - sem quebra de linha/tab e sem 4+ espaços seguidos (a Meta rejeita);
//  - sem valores em dinheiro: preço só vem de ferramenta determinística, e
//    uma retomada não é lugar para repetir (ou inventar) um valor.
// ============================================================================

export interface ResumeContext {
  /** Só para garantir que a frase NÃO o contenha. */
  leadName: string | null;
  product: string | null;
  quote: { productName: string | null } | null;
  objection: string | null;
  intent: string | null;
  interest: string | null;
  timing: string | null;
  readyToClose: boolean;
  /** Mais antigas primeiro. */
  recentMessages: Array<{ role: "lead" | "agent" | "system"; text: string }>;
}

export type ResumePhraseSource = "ai" | "context" | "generic";

export const RESUME_PHRASE_MAX = 280;
const RESUME_PHRASE_MIN = 8;
export const GENERIC_RESUME_PHRASE =
  "Você ainda precisa de ajuda com o que conversamos?";

function stripAccents(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "");
}

function clean(value: string | null | undefined): string | null {
  const v = (value ?? "").replace(/\s+/g, " ").trim();
  return v ? v : null;
}

/** Partes do nome (≥ 3 letras) que não podem aparecer na frase. */
function nameTokens(name: string | null): string[] {
  return stripAccents(name ?? "")
    .toLowerCase()
    .split(/[^a-z]+/)
    .filter((t) => t.length >= 3);
}

/** Há contexto real para uma retomada específica? */
export function hasResumeContext(ctx: ResumeContext): boolean {
  return Boolean(
    clean(ctx.quote?.productName) ||
    clean(ctx.product) ||
    clean(ctx.objection) ||
    clean(ctx.intent) ||
    clean(ctx.interest) ||
    ctx.recentMessages.some((m) => m.role !== "system" && clean(m.text)),
  );
}

/**
 * Valida e normaliza a frase gerada. Devolve `null` quando ela não pode ir ao
 * cliente — o chamador cai no fallback.
 */
export function normalizeResumePhrase(
  raw: string,
  ctx: Pick<ResumeContext, "leadName">,
): string | null {
  let text = (raw ?? "").trim();
  // Modelo às vezes devolve JSON, rótulo ou aspas em volta.
  const jsonMatch = text.match(/"(?:frase|phrase|text)"\s*:\s*"([^"]+)"/i);
  if (jsonMatch) text = jsonMatch[1];
  text = text.split(/\r?\n/).find((l) => l.trim()) ?? "";
  text = text
    .replace(/^(frase|resposta|retomada)\s*:\s*/i, "")
    .replace(/^["'“”‘’`*_\s]+|["'“”‘’`*_\s]+$/g, "")
    .replace(/[\t\s]+/g, " ")
    .trim();

  if (text.length < RESUME_PHRASE_MIN || text.length > RESUME_PHRASE_MAX) return null;
  if (/\{\{|\}\}/.test(text)) return null;
  if (/R\$|\d+[.,]\d{2}\b|reais\b/i.test(text)) return null;

  const words = new Set(
    stripAccents(text)
      .toLowerCase()
      .split(/[^a-z]+/),
  );
  if (nameTokens(ctx.leadName).some((t) => words.has(t))) return null;
  return text;
}

/** Normaliza o trecho contextual para uma pergunta pronta para o cliente. */
export function normalizeResumeQuestion(
  raw: string,
  ctx: Pick<ResumeContext, "leadName">,
): string | null {
  let text = normalizeResumePhrase(raw, ctx);
  if (!text) return null;
  text = text.charAt(0).toUpperCase() + text.slice(1);
  if (/^(?:retomando|passando|estou passando|ver se|saber se|entender se)\b/i.test(text)) return null;
  if (!text.endsWith("?")) text = `${text.replace(/[.]$/, "")}?`;
  return text;
}

/**
 * Retomada determinística a partir dos dados já estruturados. Só usa o que
 * existe; sem nada específico, a frase genérica.
 */
export function fallbackResumePhrase(ctx: ResumeContext): {
  text: string;
  source: ResumePhraseSource;
} {
  const candidates: string[] = [];
  const quoted = clean(ctx.quote?.productName);
  const product = clean(ctx.product) ?? clean(ctx.interest);
  const objection = clean(ctx.objection);

  if (quoted) candidates.push(`Você conseguiu avaliar o orçamento de ${quoted} e ficou com alguma dúvida?`);
  if (objection && product)
    candidates.push(
      `Você conseguiu avaliar ${product} e ficou com alguma dúvida sobre ${objection.toLowerCase()}?`,
    );
  if (product && ctx.readyToClose)
    candidates.push(`Podemos seguir com o pedido de ${product}?`);
  if (product) candidates.push(`Você ainda quer conversar sobre ${product}?`);

  for (const c of candidates) {
    const ok = normalizeResumeQuestion(c, ctx);
    if (ok) return { text: ok, source: "context" };
  }
  return { text: GENERIC_RESUME_PHRASE, source: "generic" };
}

export const RESUME_PROMPT_VERSION = "2026-09-29.a";
export const RESUME_AVAILABILITY_PHRASE = "Estou à disposição para o que precisarem";

function firstName(name: string | null): string {
  return clean(name)?.split(/\s+/)[0] ?? "";
}

/** Monta somente {{1}}; prefixo, sufixo e corpo aprovado permanecem intactos. */
export function buildResumeTemplateVariable(args: {
  leadName: string | null;
  contextualPhrase: string;
  templateBody: string;
}): string | null {
  const marker = "{{1}}";
  const at = args.templateBody.indexOf(marker);
  if (at < 0 || args.templateBody.indexOf(marker, at + marker.length) >= 0) return null;
  const suffix = args.templateBody.slice(at + marker.length);
  const context = normalizeResumeQuestion(args.contextualPhrase, { leadName: args.leadName });
  if (!context) return null;
  const greeting = firstName(args.leadName)
    ? `${firstName(args.leadName)}, tudo bem?`
    : "Tudo bem?";
  const value = `${greeting} ${context} ${RESUME_AVAILABILITY_PHRASE}`
    .replace(/[\t\r\n]+/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
  const fitted = suffix.trim() ? value.replace(/[\s,.;:!?…]+$/u, "").trim() : value;
  const rendered = `${args.templateBody.slice(0, at)}${fitted}${suffix}`;
  if (!rendered.trim() || /\{\{|\}\}|[\t\r\n]/.test(fitted)) return null;
  if (/[,.!?]{2,}/.test(rendered) || rendered.length > 1024) return null;
  return fitted;
}

/** A IA recebe o contexto, mas devolve exclusivamente o trecho contextual. */
export function buildResumeContextPrompt(
  ctx: ResumeContext,
  templateBody: string,
): Array<{ role: "system" | "user"; content: string }> {
  const [system, user] = buildResumePrompt(ctx, templateBody);
  return [
    {
      role: "system",
      content: `${system.content}
Retorne SOMENTE uma pergunta contextual completa, natural e persuasiva, iniciada com letra maiúscula e terminada com "?". Não escreva nome, saudação, disponibilidade, valores ou o texto fixo do template. Evite gerúndios e construções como "retomando...", "ver se...", "saber se..." ou "entender se...".`,
    },
    user,
  ];
}

/** Mensagens para a IA gerar a frase. `templateBody` é o corpo com {{1}}. */
export function buildResumePrompt(
  ctx: ResumeContext,
  templateBody: string,
): Array<{ role: "system" | "user"; content: string }> {
  const facts = [
    ["Produto/modelo de interesse", clean(ctx.product) ?? clean(ctx.interest)],
    ["Orçamento enviado", clean(ctx.quote?.productName)],
    ["Objeção detectada", clean(ctx.objection)],
    ["Intenção detectada", clean(ctx.intent)],
    ["Prazo de compra", clean(ctx.timing)],
    ["Pronto para fechar", ctx.readyToClose ? "sim" : null],
  ]
    .filter(([, v]) => v)
    .map(([k, v]) => `- ${k}: ${v}`)
    .join("\n");

  const transcript = ctx.recentMessages
    .filter((m) => m.role !== "system" && clean(m.text))
    .slice(-12)
    .map((m) => `${m.role === "lead" ? "Cliente" : "Atendente"}: ${clean(m.text)!.slice(0, 280)}`)
    .join("\n");

  const system = `Você escreve o trecho de retomada de um follow-up de WhatsApp.
O trecho vai substituir {{1}} dentro deste template aprovado pela Meta, cujo texto fixo não muda:
"""${templateBody}"""

Regras obrigatórias:
- Texto em português do Brasil (até ${RESUME_PHRASE_MAX} caracteres) que se encaixe gramaticalmente entre o texto antes e depois de {{1}}: pode começar em minúscula e não precisa terminar com pontuação se o template continua logo depois.
- Use o histórico real da conversa: retome o ponto concreto em que ela parou (produto/modelo, orçamento, objeção, decisão pendente ou próximo passo).
- NÃO use o nome do cliente. NÃO repita a saudação do template.
- NÃO cite preços, valores, descontos, prazos ou condições que não estejam nos fatos abaixo. Nunca invente.
- Sem emojis, sem aspas, sem quebra de linha.
- Responda APENAS com a frase.`;

  const user = `Fatos da conversa:
${facts || "- (nenhum fato estruturado)"}

Últimas mensagens:
${transcript || "(sem mensagens)"}`;

  return [
    { role: "system", content: system },
    { role: "user", content: user },
  ];
}
