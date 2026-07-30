// ============================================================================
// Coach Evolutivo — Normalização de texto pt-BR (SPRINT 4 · FASE 3)
//
// Camada 100% pura e client-safe. Espelha o comportamento de
// `coach_learning_normalize_text` / `normalizeForHashPreview` (lowercase,
// remoção de acentos e pontuação) e ACRESCENTA o que o ranking exige:
// tokenização, stop words, plural leve, preservação de números e valores
// monetários, e preservação de nomes comerciais.
//
// Decisão de projeto: NÃO usar stemming agressivo. Nomes comerciais
// ("Maragogi", "Canyon", "Fibra Plus") seriam destruídos, e é exatamente
// neles que mora o sinal de produto.
// ============================================================================

/**
 * Stop words do português brasileiro no contexto de atendimento comercial.
 * Deliberadamente NÃO inclui termos que carregam intenção comercial
 * ("valor", "preço", "prazo", "garantia") — esses são sinal, não ruído.
 */
export const PT_STOP_WORDS: ReadonlySet<string> = new Set([
  "a", "ao", "aos", "aquela", "aquele", "aquilo", "as", "ate", "com", "como",
  "da", "das", "de", "dela", "dele", "deles", "depois", "do", "dos", "e", "ela",
  "elas", "ele", "eles", "em", "entre", "era", "eram", "essa", "essas", "esse",
  "esses", "esta", "estamos", "estao", "estar", "estas", "este", "esteja",
  "estes", "estou", "eu", "foi", "fomos", "for", "fosse", "ha", "isso", "isto",
  "ja", "la", "lhe", "lhes", "mais", "mas", "me", "mesmo", "meu", "meus", "minha",
  "minhas", "muito", "na", "nao", "nas", "nem", "no", "nos", "nossa", "nosso",
  "num", "numa", "o", "os", "ou", "para", "pela", "pelas", "pelo", "pelos",
  "por", "porque", "pra", "pro", "qual", "quando", "que", "quem", "se", "sem",
  "ser", "seu", "seus", "so", "sua", "suas", "tambem", "te", "tem", "temos",
  "tenho", "ter", "teu", "tu", "tua", "um", "uma", "umas", "uns", "vao", "vc",
  "voce", "voces", "vou", "ai", "aqui", "bem", "boa", "bom", "dia", "ola",
  "oi", "obrigado", "obrigada", "tudo", "sim", "ok", "entao", "agora", "ainda",
  "sobre", "qualquer", "cada", "todo", "toda", "todos", "todas", "coisa",
]);

/** Remove acentos preservando as letras (NFD + descarte de diacríticos). */
export function stripAccents(input: string): string {
  return input.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

/**
 * Normalização base: minúsculas, sem acentos, pontuação virando espaço.
 * Vírgulas e pontos ENTRE dígitos são preservados como ponto decimal para
 * não fragmentar valores monetários ("R$ 1.250,00" → "1250.00").
 */
export function normalizeText(input: string | null | undefined): string {
  if (!input) return "";
  let t = stripAccents(String(input)).toLowerCase();
  // Preserva decimais/milhares antes de destruir a pontuação.
  t = t.replace(/(\d)[.,](\d)/g, "$1\u0000$2");
  t = t.replace(/[^\p{L}\p{N}\s\u0000]+/gu, " ");
  t = t.replace(/\u0000/g, ".");
  return t.replace(/\s+/g, " ").trim();
}

/**
 * Plural leve e conservador. Só remove o "s" final quando a palavra continua
 * plausível (>= 4 caracteres) e não termina em padrões que quebrariam o termo.
 * "piscinas" → "piscina"; "meses" → "mes"; "gres" fica intacto.
 */
export function singularize(token: string): string {
  if (token.length < 4) return token;
  if (token.endsWith("oes")) return `${token.slice(0, -3)}ao`; // condicoes → condicao
  if (token.endsWith("aes")) return `${token.slice(0, -3)}ao`;
  if (token.endsWith("ais")) return `${token.slice(0, -3)}al`; // materiais → material
  if (token.endsWith("eis")) return `${token.slice(0, -3)}el`; // possiveis → possivel
  if (token.endsWith("ses")) return token.slice(0, -2); // meses → mes
  if (token.endsWith("ns")) return `${token.slice(0, -2)}m`; // homens → homem
  if (token.endsWith("s") && !token.endsWith("ss")) return token.slice(0, -1);
  return token;
}

export interface TokenizeOptions {
  /** Remove stop words. Padrão: true. */
  removeStopWords?: boolean;
  /** Aplica plural leve. Padrão: true. */
  applySingular?: boolean;
  /** Descarta tokens com menos que N caracteres (números escapam). Padrão: 3. */
  minLength?: number;
}

/**
 * Quebra em tokens úteis para o ranking. Números e valores sobrevivem mesmo
 * abaixo do `minLength` — "8x3", "2024", "12" são sinal forte em vendas.
 */
export function tokenize(input: string | null | undefined, opts: TokenizeOptions = {}): string[] {
  const { removeStopWords = true, applySingular = true, minLength = 3 } = opts;
  const normalized = normalizeText(input);
  if (!normalized) return [];

  const out: string[] = [];
  for (const rawToken of normalized.split(" ")) {
    if (!rawToken) continue;
    const hasDigit = /\d/.test(rawToken);
    if (removeStopWords && !hasDigit && PT_STOP_WORDS.has(rawToken)) continue;
    if (!hasDigit && rawToken.length < minLength) continue;
    out.push(applySingular && !hasDigit ? singularize(rawToken) : rawToken);
  }
  return out;
}

/** Conjunto de tokens únicos — atalho usado em todo o ranking. */
export function tokenSet(input: string | null | undefined, opts?: TokenizeOptions): Set<string> {
  return new Set(tokenize(input, opts));
}

/**
 * Bigramas de tokens adjacentes. Capturam palavras compostas
 * ("piscina fibra", "cartao credito") que isoladas perderiam sentido.
 */
export function bigrams(tokens: string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < tokens.length - 1; i += 1) out.push(`${tokens[i]} ${tokens[i + 1]}`);
  return out;
}

/**
 * Sobreposição ponderada por raridade: termos raros no corpus valem mais que
 * termos que aparecem em todos os aprendizados (IDF simplificado).
 *
 * @param queryTokens tokens da mensagem do cliente
 * @param docTokens   tokens do aprendizado
 * @param idf         raridade por token (1 = comum, maior = mais raro)
 * @returns 0..1 — fração do peso da consulta coberta pelo documento
 */
export function weightedOverlap(
  queryTokens: Set<string>,
  docTokens: Set<string>,
  idf: Map<string, number>,
): number {
  if (queryTokens.size === 0 || docTokens.size === 0) return 0;
  let matched = 0;
  let total = 0;
  for (const token of queryTokens) {
    const weight = idf.get(token) ?? 1;
    total += weight;
    if (docTokens.has(token)) matched += weight;
  }
  return total > 0 ? matched / total : 0;
}

/**
 * IDF simplificado sobre os candidatos. Um termo presente em quase todos os
 * aprendizados (ex.: "cliente") tende a 1; um termo presente em poucos
 * (ex.: "maragogi") recebe peso alto.
 */
export function buildIdf(documents: string[][]): Map<string, number> {
  const df = new Map<string, number>();
  for (const doc of documents) {
    for (const token of new Set(doc)) df.set(token, (df.get(token) ?? 0) + 1);
  }
  const total = Math.max(1, documents.length);
  const idf = new Map<string, number>();
  for (const [token, count] of df) {
    // log(1 + N/df) — sempre >= 1 para termos vistos, cresce com a raridade.
    idf.set(token, 1 + Math.log(total / count));
  }
  return idf;
}

/** Jaccard sobre conjuntos de tokens — usado na detecção de quase-duplicados. */
export function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter += 1;
  const union = a.size + b.size - inter;
  return union > 0 ? inter / union : 0;
}
