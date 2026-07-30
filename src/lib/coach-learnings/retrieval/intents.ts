// ============================================================================
// Coach Evolutivo — Léxico de intenções comerciais (SPRINT 4 · FASE 3)
//
// Classificador determinístico e barato. NÃO é um segundo classificador
// concorrente: o Coach só possuía `objection_type`, que é produzido PELA IA
// DEPOIS da resposta — tarde demais para escolher o que entra no prompt.
// Este léxico roda ANTES, sobre a mensagem do cliente, sem chamada externa.
//
// `objection_type` da rota permanece intocado; as duas taxonomias são
// reconciliadas por `intentFromObjectionType`.
// ============================================================================
import { normalizeText, tokenize } from "./text";

export const COACH_INTENTS = [
  "price",
  "payment",
  "deadline",
  "warranty",
  "delivery",
  "availability",
  "complaint",
  "comparison",
  "negotiation",
  "technical",
  "after_sales",
] as const;

export type CoachIntent = (typeof COACH_INTENTS)[number];

/**
 * Termos-gatilho por intenção, já normalizados (minúsculas, sem acento).
 * Multi-palavra é suportado — a detecção também roda sobre o texto contínuo.
 */
const INTENT_LEXICON: Record<CoachIntent, readonly string[]> = {
  price: [
    "preco", "precos", "valor", "valores", "quanto custa", "quanto sai",
    "quanto fica", "orcamento", "custo", "investimento", "tabela", "caro",
    "barato", "quanto e",
  ],
  payment: [
    "parcelar", "parcela", "parcelamento", "pagamento", "pagar", "cartao",
    "credito", "debito", "boleto", "pix", "financiamento", "entrada",
    "vezes", "sinal", "avista", "a vista", "consorcio",
  ],
  deadline: [
    "prazo", "quanto tempo", "demora", "quando fica", "quando chega",
    "urgente", "rapido", "cronograma", "data", "agenda", "semana", "mes",
  ],
  warranty: [
    "garantia", "garantido", "cobertura", "assistencia", "vida util",
    "durabilidade", "dura quanto", "anos de garantia", "certificado",
  ],
  delivery: [
    "entrega", "entregar", "frete", "transporte", "envio", "enviar",
    "instalacao", "instalar", "montagem", "montar", "chega ate", "leva ate",
  ],
  availability: [
    "disponivel", "disponibilidade", "estoque", "tem pronta", "pronta entrega",
    "tem esse", "ainda tem", "esgotado", "reservar",
  ],
  complaint: [
    "reclamacao", "reclamar", "problema", "defeito", "quebrou", "vazando",
    "vazamento", "insatisfeito", "pessimo", "nao funciona", "estragou",
    "procon", "atraso",
  ],
  comparison: [
    "concorrente", "outra empresa", "comparar", "comparacao", "diferenca",
    "melhor que", "versus", "outro orcamento", "cotacao", "pesquisando",
  ],
  negotiation: [
    "desconto", "abatimento", "condicao especial", "melhor preco", "negociar",
    "fechar hoje", "cobre", "consegue fazer por", "brinde", "cortesia",
  ],
  technical: [
    "medida", "medidas", "dimensao", "profundidade", "largura", "comprimento",
    "metros", "litros", "material", "fibra", "espessura", "capacidade",
    "voltagem", "potencia", "especificacao", "ficha tecnica",
  ],
  after_sales: [
    "pos venda", "manutencao", "limpeza", "revisao", "suporte", "conserto",
    "reparo", "peca", "reposicao", "como usar", "como cuidar",
  ],
};

/**
 * Mapeia a taxonomia de objeção já usada pela rota (`objection_type`) para
 * as intenções deste léxico, evitando duas verdades divergentes.
 */
export function intentFromObjectionType(objection: string | null | undefined): CoachIntent | null {
  switch (objection) {
    case "price":
      return "price";
    case "discount":
      return "negotiation";
    case "timing":
      return "deadline";
    case "researching":
      return "comparison";
    default:
      return null;
  }
}

export interface DetectedIntent {
  intent: CoachIntent;
  /** Número de gatilhos distintos encontrados — proxy de confiança. */
  hits: number;
}

/**
 * Detecta intenções presentes em um texto. Determinístico e ordenado por
 * força do sinal (mais gatilhos primeiro; empate resolvido alfabeticamente
 * para garantir estabilidade entre execuções).
 */
export function detectIntents(input: string | null | undefined): DetectedIntent[] {
  const flat = normalizeText(input);
  if (!flat) return [];
  const tokens = new Set(tokenize(input, { applySingular: false }));
  const singular = new Set(tokenize(input));

  const found: DetectedIntent[] = [];
  for (const intent of COACH_INTENTS) {
    let hits = 0;
    for (const term of INTENT_LEXICON[intent]) {
      if (term.includes(" ")) {
        if (flat.includes(term)) hits += 1;
      } else if (tokens.has(term) || singular.has(term)) {
        hits += 1;
      }
    }
    if (hits > 0) found.push({ intent, hits });
  }
  return found.sort((a, b) => (b.hits - a.hits) || a.intent.localeCompare(b.intent));
}

/** Apenas os identificadores, na mesma ordem determinística. */
export function detectIntentSet(input: string | null | undefined): Set<CoachIntent> {
  return new Set(detectIntents(input).map((d) => d.intent));
}

/**
 * Categoria de `coach_learnings` → intenções que ela naturalmente atende.
 * Usado como sinal secundário quando o texto do aprendizado é econômico.
 */
export const CATEGORY_TO_INTENTS: Record<string, readonly CoachIntent[]> = {
  pricing: ["price", "payment", "negotiation"],
  objection: ["price", "negotiation", "comparison", "complaint"],
  product_positioning: ["technical", "comparison", "availability"],
  qualification: ["availability", "technical"],
  closing: ["negotiation", "payment", "deadline"],
  followup: ["deadline"],
  process: ["delivery", "deadline", "after_sales"],
  tone: [],
  other: [],
};
