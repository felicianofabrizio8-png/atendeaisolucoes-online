// BLOCO 2 — Interpretação da IA (funções puras testáveis).
//
// Responsabilidades:
//  1. Normalizar respostas do modelo em CoachLearningDraft consistente.
//  2. Produzir títulos conceituais (nunca copiar literalmente a frase do cliente).
//  3. Estruturar a regra em Gatilho / Ação obrigatória / Objetivo / Evitar.
//  4. Escolher categoria e prioridade com heurísticas conservadoras
//     (a IA continua decidindo; a função só corrige derivas óbvias).
//  5. Gerar o resumo "O Coach entendeu que deve …" a partir do conteúdo
//     estruturado — não a partir de frases fixas.
//  6. Oferecer fallback seguro quando a resposta do modelo é malformada.
//
// Todas as funções são puras: recebem entrada, devolvem saída, sem I/O.

import {
  CoachLearningDraftSchema,
  COACH_LEARNING_CATEGORIES,
  type CoachLearningCategory,
  type CoachLearningDraft,
} from "./schema";

// ---------------------------------------------------------------------------
// Labels em português para categorias — usadas no resumo e na UI.
// ---------------------------------------------------------------------------
export const CATEGORY_LABELS_PT: Record<CoachLearningCategory, string> = {
  objection: "Objeção",
  product_positioning: "Posicionamento de produto",
  pricing: "Preço",
  qualification: "Qualificação",
  closing: "Fechamento",
  followup: "Follow-up",
  tone: "Comunicação e tom",
  process: "Processo interno",
  other: "Outros",
};

// ---------------------------------------------------------------------------
// Título — remover citações literais da frase do cliente.
// ---------------------------------------------------------------------------
const TITLE_MAX = 120;

/**
 * Remove aspas envolventes, prefixos como "Lidar com …", trailing punctuation
 * e recortes literais entre aspas. Se sobrar apenas a frase do cliente entre
 * aspas ("Já tenho outros orçamentos."), degrada para uma versão descritiva.
 */
export function sanitizeTitle(raw: string, clientMessage?: string | null): string {
  let t = (raw ?? "").trim();
  // Remove aspas envolventes.
  t = t.replace(/^[\s"“”'`]+|[\s"“”'`]+$/g, "").trim();
  // Remove prefixos frequentes.
  t = t.replace(
    /^(lidar com|responder a?o?|como (responder|lidar)( com)?|quando o cliente (diz(er)?|fala|informa))\s*[:\-–]?\s*/i,
    "",
  );
  // Se o título ainda é essencialmente a mensagem do cliente entre aspas, cai
  // para um placeholder — a IA nunca deve ecoar a fala do cliente.
  if (clientMessage) {
    const cm = clientMessage.trim().toLowerCase().replace(/[.!?…]+$/g, "");
    const tl = t.trim().toLowerCase().replace(/[.!?…]+$/g, "");
    if (cm && (tl === cm || tl.includes(`"${cm}"`) || tl.includes(`“${cm}”`))) {
      t = "";
    }
  }
  if (!t) return "Aprendizado do Coach";
  // Capitaliza primeira letra.
  t = t.charAt(0).toUpperCase() + t.slice(1);
  if (t.length > TITLE_MAX) t = t.slice(0, TITLE_MAX - 1).trimEnd() + "…";
  return t;
}

// ---------------------------------------------------------------------------
// Regra estruturada — garantir gatilho, ação, objetivo, evitar.
// ---------------------------------------------------------------------------
export interface StructuredRule {
  trigger: string;
  action: string;
  objective: string;
  avoid: string[];
}

const RULE_SECTIONS = ["gatilho", "ação", "acao", "objetivo", "evitar"] as const;

/**
 * Extrai as 4 seções da regra a partir de um texto livre. Aceita tanto o
 * texto já estruturado (`Gatilho: … Ação obrigatória: … Objetivo: … Evitar:`)
 * quanto texto solto — nesse caso trata tudo como "ação" e deixa as demais
 * seções vazias para o autor completar.
 */
export function parseStructuredRule(text: string): StructuredRule {
  const empty: StructuredRule = { trigger: "", action: "", objective: "", avoid: [] };
  const src = (text ?? "").trim();
  if (!src) return empty;

  const lower = src.toLowerCase();
  const hasSections = RULE_SECTIONS.some((s) => lower.includes(`${s}:`));

  if (!hasSections) {
    return { ...empty, action: src };
  }

  const pick = (label: RegExp): string => {
    const match = src.match(label);
    return match ? match[1].trim() : "";
  };

  const trigger = pick(/gatilho\s*:\s*([\s\S]*?)(?=\n\s*(a[cç][aã]o|objetivo|evitar)\s*:|$)/i);
  const action = pick(
    /a[cç][aã]o(?:\s+obrigat[óo]ria)?\s*:\s*([\s\S]*?)(?=\n\s*(objetivo|evitar|gatilho)\s*:|$)/i,
  );
  const objective = pick(/objetivo\s*:\s*([\s\S]*?)(?=\n\s*(evitar|gatilho|a[cç][aã]o)\s*:|$)/i);
  const avoidBlock = pick(/evitar\s*:\s*([\s\S]*?)(?=\n\s*(gatilho|a[cç][aã]o|objetivo)\s*:|$)/i);
  const avoid = avoidBlock
    .split(/\n+/)
    .map((l) => l.replace(/^[\s\-•*]+/, "").trim())
    .filter((l) => l.length > 0);

  return { trigger, action, objective, avoid };
}

/** Serializa uma StructuredRule de volta ao formato "Gatilho: … Ação: …". */
export function serializeStructuredRule(rule: StructuredRule): string {
  const parts: string[] = [];
  if (rule.trigger) parts.push(`Gatilho:\n${rule.trigger}`);
  if (rule.action) parts.push(`Ação obrigatória:\n${rule.action}`);
  if (rule.objective) parts.push(`Objetivo:\n${rule.objective}`);
  if (rule.avoid.length > 0) {
    parts.push(`Evitar:\n${rule.avoid.map((a) => `• ${a}`).join("\n")}`);
  }
  return parts.join("\n\n");
}

// ---------------------------------------------------------------------------
// Prioridade — clamp e leve heurística de coerência.
// ---------------------------------------------------------------------------
const HIGH_RISK_TERMS = [
  "compliance",
  "legal",
  "juridic",
  "seguran",
  "garantia inv",
  "promessa",
  "financeir",
  "risco",
];

const LOW_STAKES_TERMS = ["estilo", "prefer", "refin", "cosm"];

/**
 * Normaliza a prioridade dentro de [0,100] e evita o viés de "tudo 90+".
 * Se a IA marcou >=90 sem sinal claro de risco, rebaixa para 70. Se marcou
 * baixo mas o texto claramente indica risco alto, sobe para 85.
 */
export function normalizePriority(
  raw: number | undefined | null,
  contextText: string,
): number {
  const base = Math.round(Number(raw ?? 50));
  const clamped = Math.max(0, Math.min(100, Number.isFinite(base) ? base : 50));
  const t = (contextText ?? "").toLowerCase();
  const highRisk = HIGH_RISK_TERMS.some((k) => t.includes(k));
  const lowStakes = LOW_STAKES_TERMS.some((k) => t.includes(k));
  if (clamped >= 90 && !highRisk) return 78;
  if (clamped <= 40 && highRisk) return 85;
  if (lowStakes && clamped > 60) return 45;
  return clamped;
}

// ---------------------------------------------------------------------------
// Categoria — validar e sugerir fallback quando a IA devolve algo fora do
// enum. Não sobrescreve escolha válida da IA.
// ---------------------------------------------------------------------------
const CATEGORY_HINTS: Array<{ cat: CoachLearningCategory; keywords: RegExp }> = [
  { cat: "objection", keywords: /(objeç|caro|desconto|comparar|outros or[çc]amentos|pensar)/i },
  { cat: "pricing", keywords: /(pre[çc]o|desconto|parcel|valor)/i },
  { cat: "product_positioning", keywords: /(t[eé]cnic|especifica[cç]|produto errad|modelo|informa[cç][ãa]o incorreta)/i },
  { cat: "closing", keywords: /(fechar|assinatura|fechamento|contrato)/i },
  { cat: "followup", keywords: /(retorno|follow[- ]?up|voltar a falar|amanh[ãa]|esposa|marido|fam[ií]lia|conversar em casa)/i },
  { cat: "qualification", keywords: /(qualifica|descobrir|entender necessidade|perguntar)/i },
  { cat: "tone", keywords: /(tom|educaç|linguagem|insistente|agressiv|formal|informal)/i },
  { cat: "process", keywords: /(processo|pol[ií]tica interna|fluxo|procedimento)/i },
];

export function normalizeCategory(
  raw: unknown,
  contextText: string,
): CoachLearningCategory {
  const asStr = typeof raw === "string" ? raw.toLowerCase().trim() : "";
  if ((COACH_LEARNING_CATEGORIES as readonly string[]).includes(asStr)) {
    return asStr as CoachLearningCategory;
  }
  const t = contextText ?? "";
  for (const h of CATEGORY_HINTS) {
    if (h.keywords.test(t)) return h.cat;
  }
  return "other";
}

// ---------------------------------------------------------------------------
// Resumo "O Coach entendeu que deve …"
// ---------------------------------------------------------------------------
export interface LearningSummary {
  intro: string;
  bullets: string[];
}

/**
 * Deriva bullets a partir da regra estruturada + descrição. NÃO usa texto
 * fixo — se não houver conteúdo, retorna bullets vazios (a UI decide como
 * lidar). Bullets começam por verbos no infinitivo/imperativo, minusculizados.
 */
export function buildLearningSummary(draft: CoachLearningDraft): LearningSummary {
  const rule = parseStructuredRule(draft.rule_structured);
  const bullets: string[] = [];

  const push = (s: string) => {
    const cleaned = s
      .replace(/^\s*[-•*]\s*/, "")
      .replace(/[.\s]+$/g, "")
      .trim();
    if (!cleaned) return;
    // Minusculiza a primeira letra para caber em "deve …".
    const normalized = cleaned.charAt(0).toLowerCase() + cleaned.slice(1);
    if (!bullets.includes(normalized)) bullets.push(normalized);
  };

  if (rule.trigger) push(`reconhecer quando ${lowerFirst(rule.trigger)}`);
  if (rule.action) {
    // Se a ação já vem em várias frases, quebra em bullets.
    for (const s of rule.action.split(/[.\n;]+/)) push(s);
  }
  if (rule.objective) push(rule.objective);
  for (const a of rule.avoid) push(`não ${lowerFirst(a)}`);

  // Sem regra estruturada — usa a descrição, mas apenas frases curtas.
  if (bullets.length === 0 && draft.description) {
    for (const s of draft.description.split(/[.\n;]+/).slice(0, 4)) push(s);
  }

  return {
    intro: "O Coach entendeu que deve:",
    bullets: bullets.slice(0, 8),
  };
}

function lowerFirst(s: string): string {
  const t = s.trim();
  if (!t) return "";
  return t.charAt(0).toLowerCase() + t.slice(1);
}

// ---------------------------------------------------------------------------
// Normalização completa da resposta da IA.
// ---------------------------------------------------------------------------
export interface NormalizeContext {
  clientMessage?: string | null;
  suggestionText?: string | null;
  userExplanation: string;
}

/**
 * Recebe o objeto bruto devolvido pela IA (após parseJson) e devolve um
 * CoachLearningDraft validado + normalizado. Nunca lança para respostas
 * malformadas — usa `buildFallbackDraft` como último recurso.
 */
export function normalizeAiDraft(
  raw: unknown,
  ctx: NormalizeContext,
): { draft: CoachLearningDraft; usedFallback: boolean } {
  const source = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const contextText = [
    ctx.userExplanation,
    ctx.clientMessage ?? "",
    typeof source.description === "string" ? source.description : "",
    typeof source.rule_structured === "string" ? source.rule_structured : "",
  ].join(" ");

  const title = sanitizeTitle(
    typeof source.title === "string" ? source.title : "",
    ctx.clientMessage,
  );

  const description =
    typeof source.description === "string" && source.description.trim().length >= 3
      ? source.description.trim()
      : ctx.userExplanation.trim().slice(0, 2000) || "Aprendizado registrado pelo vendedor.";

  const ruleRaw =
    typeof source.rule_structured === "string" && source.rule_structured.trim().length >= 3
      ? source.rule_structured.trim()
      : description;
  const structured = parseStructuredRule(ruleRaw);
  // Se a IA não estruturou, mantemos texto original — sem inventar seções.
  const rule_structured = ruleRaw;

  const category = normalizeCategory(source.category, contextText);
  const priority = normalizePriority(
    typeof source.priority === "number" ? source.priority : Number(source.priority),
    contextText,
  );

  const positive_example =
    typeof source.positive_example === "string" && source.positive_example.trim()
      ? source.positive_example.trim().slice(0, 2000)
      : null;

  // Se veio contexto de sugestão reprovada e a IA não devolveu exemplo
  // negativo, usa a própria sugestão original — é literalmente o "erro" a
  // ser evitado, sem inventar nada.
  const negFromAi =
    typeof source.negative_example === "string" && source.negative_example.trim()
      ? source.negative_example.trim().slice(0, 2000)
      : null;
  const negative_example = negFromAi ?? (ctx.suggestionText ? ctx.suggestionText.slice(0, 2000) : null);

  const product_ref =
    typeof source.product_ref === "string" && source.product_ref.trim()
      ? source.product_ref.trim().slice(0, 120)
      : null;

  const confidenceRaw = Number(source.confidence);
  const confidence = Number.isFinite(confidenceRaw)
    ? Math.max(0, Math.min(1, confidenceRaw))
    : 0.6;

  const candidate = {
    category,
    product_ref,
    title,
    description,
    rule_structured,
    positive_example,
    negative_example,
    priority,
    confidence,
  };

  const parsed = CoachLearningDraftSchema.safeParse(candidate);
  if (parsed.success) {
    void structured; // ficará disponível em versões futuras da UI
    return { draft: parsed.data, usedFallback: false };
  }
  return { draft: buildFallbackDraft(ctx), usedFallback: true };
}

/**
 * Fallback seguro quando a resposta da IA é totalmente inválida. Preserva a
 * explicação do vendedor e não inventa conteúdo — cabe ao usuário revisar
 * antes de salvar.
 */
export function buildFallbackDraft(ctx: NormalizeContext): CoachLearningDraft {
  const description = (ctx.userExplanation ?? "").trim().slice(0, 2000) ||
    "Aprendizado registrado pelo vendedor.";
  return {
    category: "other",
    product_ref: null,
    title: "Aprendizado a revisar",
    description,
    rule_structured: description,
    positive_example: null,
    negative_example: ctx.suggestionText ? ctx.suggestionText.slice(0, 2000) : null,
    priority: 50,
    confidence: 0.3,
  };
}

// ---------------------------------------------------------------------------
// Diff entre duas versões do rascunho — usado para avisar o usuário quando
// uma nova extração está prestes a sobrescrever campos editados manualmente.
// ---------------------------------------------------------------------------
const DIFF_FIELDS = [
  "title",
  "description",
  "rule_structured",
  "category",
  "priority",
  "product_ref",
  "positive_example",
  "negative_example",
] as const;

export function diffDrafts(
  a: CoachLearningDraft | null,
  b: CoachLearningDraft | null,
): Array<(typeof DIFF_FIELDS)[number]> {
  if (!a || !b) return [];
  const changed: Array<(typeof DIFF_FIELDS)[number]> = [];
  for (const k of DIFF_FIELDS) {
    const av = (a as unknown as Record<string, unknown>)[k] ?? null;
    const bv = (b as unknown as Record<string, unknown>)[k] ?? null;
    if (av !== bv) changed.push(k);
  }
  return changed;
}
