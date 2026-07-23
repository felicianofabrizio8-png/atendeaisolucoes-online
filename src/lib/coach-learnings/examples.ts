// BLOCO 3 — Multiplos exemplos (positivos e negativos).
//
// Estratégia de compatibilidade com o schema atual do banco:
//   O banco armazena `positive_example` e `negative_example` como TEXT
//   único (até 2000 chars) — o Coach lê essas colunas como string simples.
//   Para suportar múltiplos exemplos SEM migration, a UI mantém arrays,
//   valida individualmente e serializa em uma única string separada por
//   um marcador estável (`\n\n---\n\n`). O consumidor continua vendo o
//   valor como texto humanamente legível; pequenos exemplos adicionais
//   apenas enriquecem o contexto passado ao modelo.
//
//   Ao reabrir um aprendizado antigo (que veio como string única sem o
//   separador), `parseExamples` devolve um único item — permanecemos
//   totalmente compatíveis com aprendizados salvos antes do BLOCO 3.
//
// Todas as funções são puras.

import { CoachLearningDraftSchema, type CoachLearningDraft } from "./schema";

export const MAX_EXAMPLES = 5;
export const EXAMPLE_SEPARATOR = "\n\n---\n\n";

// Regex tolerante para reconhecer separadores criados manualmente
// (várias formas de "---" com espaços/quebras). Se nada bater, o texto
// vira UM item único — comportamento seguro para dados antigos.
const SEPARATOR_REGEX = /\n\s*-{3,}\s*\n/g;

// Trunca cada exemplo em 2000 chars para respeitar o limite da coluna
// mesmo depois da junção (o payload inteiro também é validado).
const PER_EXAMPLE_MAX = 2000;

// ---------------------------------------------------------------------------
// Parse / serialize
// ---------------------------------------------------------------------------

/**
 * Converte a string armazenada em uma lista de exemplos. Nunca lança —
 * strings antigas (sem separador) viram um único item; entradas nulas
 * viram lista vazia.
 */
export function parseExamples(raw: string | null | undefined): string[] {
  const s = (raw ?? "").trim();
  if (!s) return [];
  const parts = s.split(SEPARATOR_REGEX).map((p) => p.trim()).filter(Boolean);
  if (parts.length === 0) return [];
  return parts.slice(0, MAX_EXAMPLES);
}

/**
 * Serializa a lista de exemplos em uma única string compatível com o
 * schema. Retorna `null` quando não sobra nenhum exemplo não-vazio, para
 * que a coluna volte a ser NULL no banco.
 */
export function serializeExamples(list: readonly string[]): string | null {
  const cleaned = list
    .map((s) => (s ?? "").trim().slice(0, PER_EXAMPLE_MAX))
    .filter((s) => s.length > 0);
  if (cleaned.length === 0) return null;
  const joined = cleaned.join(EXAMPLE_SEPARATOR);
  // Cap final para o max do schema (2000). Se estourar, cortamos os
  // exemplos do fim para preservar os primeiros (que costumam ser os
  // mais relevantes) sem lançar erro.
  if (joined.length <= 2000) return joined;
  const trimmed: string[] = [];
  let acc = 0;
  for (const item of cleaned) {
    const extra = trimmed.length === 0 ? item.length : item.length + EXAMPLE_SEPARATOR.length;
    if (acc + extra > 2000) break;
    trimmed.push(item);
    acc += extra;
  }
  return trimmed.length > 0 ? trimmed.join(EXAMPLE_SEPARATOR) : cleaned[0].slice(0, 2000);
}

// ---------------------------------------------------------------------------
// Mutações imutáveis da lista (usadas pelos handlers da UI e testadas)
// ---------------------------------------------------------------------------

/** Garante ao menos 1 slot editável (aparente vazio na UI). */
export function ensureAtLeastOne(list: readonly string[]): string[] {
  return list.length === 0 ? [""] : [...list];
}

export function addExample(list: readonly string[], max: number = MAX_EXAMPLES): string[] {
  if (list.length >= max) return [...list];
  return [...list, ""];
}

export function removeExampleAt(list: readonly string[], index: number): string[] {
  if (index < 0 || index >= list.length) return [...list];
  const next = list.slice(0, index).concat(list.slice(index + 1));
  return next.length === 0 ? [""] : next;
}

export function updateExampleAt(
  list: readonly string[],
  index: number,
  value: string,
): string[] {
  if (index < 0 || index >= list.length) return [...list];
  const next = [...list];
  next[index] = value;
  return next;
}

export function moveExample(
  list: readonly string[],
  from: number,
  to: number,
): string[] {
  if (from === to) return [...list];
  if (from < 0 || from >= list.length) return [...list];
  const clampedTo = Math.max(0, Math.min(list.length - 1, to));
  const next = [...list];
  const [item] = next.splice(from, 1);
  next.splice(clampedTo, 0, item);
  return next;
}

// ---------------------------------------------------------------------------
// Estado inicial da UI (BLOCO 3) — inclui compatibilidade com sugestão
// reprovada como primeiro exemplo negativo.
// ---------------------------------------------------------------------------

export interface BuildInitialExamplesInput {
  draft: CoachLearningDraft | null;
  /** Texto da sugestão que foi reprovada via 👎 (opcional). */
  suggestionText?: string | null;
}

export interface InitialExamplesUi {
  positives: string[];
  negatives: string[];
}

export function buildInitialExamplesUi(
  input: BuildInitialExamplesInput,
): InitialExamplesUi {
  const positives = ensureAtLeastOne(parseExamples(input.draft?.positive_example));
  let negatives = parseExamples(input.draft?.negative_example);
  const suggestion = (input.suggestionText ?? "").trim();
  if (
    suggestion &&
    !negatives.some((n) => n.trim().toLowerCase() === suggestion.toLowerCase())
  ) {
    // Preservar a sugestão reprovada como primeiro negativo — a
    // interpretação já pode ter feito isso, mas cobrimos o caso em que
    // ela veio sem exemplo negativo definido.
    negatives = [suggestion, ...negatives];
  }
  return {
    positives,
    negatives: ensureAtLeastOne(negatives),
  };
}

// ---------------------------------------------------------------------------
// Detecção de mudanças (dirty state)
// ---------------------------------------------------------------------------

export interface SnapshotForDirty {
  draft: CoachLearningDraft | null;
  positives: readonly string[];
  negatives: readonly string[];
}

/**
 * Compara duas fotos do formulário (draft + arrays de exemplos). Ignora
 * espaços em branco extras nos exemplos e trata `null`/`undefined` iguais.
 */
export function hasChanges(a: SnapshotForDirty, b: SnapshotForDirty): boolean {
  if (!a.draft && !b.draft) return false;
  if (!a.draft || !b.draft) return true;
  const draftKeys: Array<keyof CoachLearningDraft> = [
    "title",
    "description",
    "rule_structured",
    "category",
    "priority",
    "product_ref",
  ];
  for (const k of draftKeys) {
    const av = a.draft[k] ?? null;
    const bv = b.draft[k] ?? null;
    if (av !== bv) return true;
  }
  return (
    !examplesEqual(a.positives, b.positives) ||
    !examplesEqual(a.negatives, b.negatives)
  );
}

function examplesEqual(a: readonly string[], b: readonly string[]): boolean {
  const ax = a.map((s) => (s ?? "").trim()).filter(Boolean);
  const bx = b.map((s) => (s ?? "").trim()).filter(Boolean);
  if (ax.length !== bx.length) return false;
  return ax.every((v, i) => v === bx[i]);
}

// ---------------------------------------------------------------------------
// Construção do payload final enviado ao servidor.
// ---------------------------------------------------------------------------

export interface BuildPayloadInput {
  draft: CoachLearningDraft;
  positives: readonly string[];
  negatives: readonly string[];
}

/**
 * Recebe o rascunho + arrays da UI e devolve um `CoachLearningDraft`
 * pronto para enviar ao createCoachLearningFn. Nunca inclui exemplos
 * vazios; nunca duplica valores; sempre respeita o schema (positive/
 * negative_example são `string | null`).
 */
export function buildFinalPayload({
  draft,
  positives,
  negatives,
}: BuildPayloadInput): CoachLearningDraft {
  const dedupedPos = dedupeExamples(positives);
  const dedupedNeg = dedupeExamples(negatives);
  const payload: CoachLearningDraft = {
    ...draft,
    positive_example: serializeExamples(dedupedPos),
    negative_example: serializeExamples(dedupedNeg),
  };
  // Passa novamente pelo schema para garantir contrato — o schema não
  // impõe forma de múltiplos exemplos, apenas string max 2000.
  const parsed = CoachLearningDraftSchema.safeParse(payload);
  if (parsed.success) return parsed.data;
  return payload;
}

function dedupeExamples(list: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of list) {
    const s = (raw ?? "").trim();
    if (!s) continue;
    const key = s.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(s);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Labels em português para o modal de sobrescrita (BLOCO 3).
// ---------------------------------------------------------------------------
export const FIELD_LABELS_PT: Record<string, string> = {
  title: "Título",
  description: "Descrição",
  rule_structured: "Regra estruturada",
  category: "Categoria",
  priority: "Prioridade",
  product_ref: "Produto ou contexto",
  positive_example: "Exemplos positivos",
  negative_example: "Exemplos negativos",
};
