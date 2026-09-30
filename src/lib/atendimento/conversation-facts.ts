// ============================================================================
// atendimento/conversation-facts.ts
// Dados comerciais do painel "Informações" do Atendimento 2.0.
//
// Os campos detected_* da conversa só são gravados quando o agente de IA
// responde; em conversa atendida por humano ficavam vazios, e o "Resumo" caía
// no rótulo de intenção ("informação"). Aqui os fatos saem do que já está
// registrado (lead/conversa) e, na falta, do histórico da própria conversa.
//
// Regras:
//  - nada é inventado: só entra o que aparece explicitamente numa mensagem
//    (padrões conservadores) ou no cadastro; o resto fica vazio;
//  - cadastro primeiro; na conversa, a menção mais recente vence;
//  - cada fato guarda a origem e o trecho de onde saiu (evidência);
//  - puro, sem I/O — roda no cliente, sobre as mensagens já carregadas.
// ============================================================================

import type { Conversation, Lead, Message } from "@/data/mock";

export type FactSource = "registro" | "conversa" | "sugerida";

export interface Fact {
  value: string;
  source: FactSource;
  /** Trecho da mensagem de onde o valor saiu (fonte "conversa"). */
  evidence?: string;
}

export interface ConversationFacts {
  location: Fact | null;
  interest: Fact | null;
  model: Fact | null;
  presentedValue: Fact | null;
  payment: Fact | null;
  timing: Fact | null;
  summary: string | null;
  nextAction: Fact | null;
}

export interface CatalogItem {
  name: string;
  model?: string | null;
}

export interface ConversationFactsInput {
  lead: Lead;
  conversation: Conversation;
  messages: Message[];
  catalog?: CatalogItem[];
  /** Próximo contato do ciclo de follow-up ativo, se houver. */
  followupNextAt?: string | null;
}

// ---------------------------------------------------------------------------
// Utilidades
// ---------------------------------------------------------------------------

const UFS = [
  "AC",
  "AL",
  "AP",
  "AM",
  "BA",
  "CE",
  "DF",
  "ES",
  "GO",
  "MA",
  "MT",
  "MS",
  "MG",
  "PA",
  "PB",
  "PR",
  "PE",
  "PI",
  "RJ",
  "RN",
  "RS",
  "RO",
  "RR",
  "SC",
  "SP",
  "SE",
  "TO",
];
const UF_RE = UFS.join("|");

function fold(s: string): string {
  return s
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();
}

function clean(s: string | null | undefined): string | null {
  const v = (s ?? "").replace(/\s+/g, " ").trim();
  return v ? v : null;
}

function snippet(text: string, max = 140): string {
  const t = text.replace(/\s+/g, " ").trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function titleCase(s: string): string {
  return s
    .split(" ")
    .map((w, i) =>
      i > 0 && /^(de|do|da|dos|das|e)$/i.test(w) ? w.toLowerCase() : capitalize(w.toLowerCase()),
    )
    .join(" ");
}

function formatBRL(n: number): string {
  // Espaço comum (o Intl usa NBSP): o valor é copiado para mensagens.
  return n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" }).replace(/\s/g, " ");
}

/** Mensagens com texto, mais novas primeiro, sem as apagadas. */
function newestFirst(messages: Message[], roles?: Message["role"][]): Message[] {
  return messages
    .filter((m) => !m.deletedAt && clean(m.text) && (!roles || roles.includes(m.role)))
    .slice()
    .sort((a, b) => +new Date(b.at) - +new Date(a.at));
}

/** Rótulos de classificação que não servem como resumo nem como fato. */
const GENERIC_LABELS = new Set([
  "informacao",
  "informação",
  "outro",
  "outros",
  "duvida",
  "geral",
  "nenhum",
]);

function meaningful(value: string | null | undefined): string | null {
  const v = clean(value);
  if (!v) return null;
  return GENERIC_LABELS.has(fold(v)) ? null : v;
}

// ---------------------------------------------------------------------------
// Cidade / UF
// ---------------------------------------------------------------------------

/** Palavras que seguem "sou de", "aqui em"… sem serem cidade. */
const NOT_A_CITY = new Set(
  [
    "casa",
    "confianca",
    "duvida",
    "acordo",
    "ferias",
    "viagem",
    "trabalho",
    "contato",
    "atendimento",
    "horario",
    "familia",
    "novo",
    "nova",
    "manha",
    "tarde",
    "noite",
    "hoje",
    "amanha",
    "semana",
    "loja",
    "empresa",
    "obra",
    "reuniao",
    "vendas",
    "voces",
    "voce",
    "fora",
    "lado",
    "perto",
    "baixo",
    "cima",
    "frente",
    "tempo",
    "boa",
    "bom",
    "sim",
    "nao",
    "whatsapp",
    "instagram",
    "aguardo",
    "interior",
    "la",
    "ai",
    "capital",
    "centro",
    "bairro",
    "zona",
    "duvidas",
    "espera",
  ].map(fold),
);

const CITY_WORDS =
  "[A-Za-zÀ-ÿ][A-Za-zÀ-ÿ'-]+(?:\\s(?:de|do|da|dos|das)?\\s?[A-Za-zÀ-ÿ][A-Za-zÀ-ÿ'-]+){0,3}";
const CITY_INTRO_RE = new RegExp(
  `\\b(?:moro|resido|sou|estou|fico)\\s+(?:em|no|na|de|do|da)\\s+(${CITY_WORDS})(?:\\s*[-/,]\\s*(${UF_RE})\\b)?`,
  "i",
);
const CITY_HERE_RE = new RegExp(
  `\\b(?:aqui|cidade)\\s+(?:em|no|na|de|é)\\s+(${CITY_WORDS})(?:\\s*[-/,]\\s*(${UF_RE})\\b)?`,
  "i",
);
const CITY_UF_RE = new RegExp(
  `\\b([A-ZÀ-Ý][A-Za-zÀ-ÿ'-]+(?:\\s(?:de|do|da|dos|das)?\\s?[A-ZÀ-Ý][A-Za-zÀ-ÿ'-]+){0,3})\\s*[/-]\\s*(${UF_RE})\\b`,
);

/** Palavras que encerram o nome da cidade (ex.: "Campinas mesmo", "Sorocaba e"). */
const CITY_STOP = new Set(
  [
    "mesmo",
    "e",
    "mas",
    "ok",
    "tambem",
    "aqui",
    "agora",
    "ha",
    "faz",
    "perto",
    "no",
    "na",
    "com",
    "que",
    "pra",
    "para",
    "por",
    "porque",
    "entao",
    "so",
    "sim",
    "nao",
    "bairro",
    "zona",
    "centro",
    "regiao",
    "estado",
    "interior",
    "capital",
    "tudo",
    "bem",
    "obrigado",
    "obrigada",
  ].map(fold),
);

/** Corta a captura no fim do nome da cidade; descarta o que não é cidade. */
function trimCity(raw: string): string | null {
  const words = raw.trim().split(/\s+/);
  const capitalized = /^[A-ZÀ-Ý]/.test(words[0] ?? "");
  const kept: string[] = [];
  for (const [i, w] of words.entries()) {
    const f = fold(w);
    const connector = /^(de|do|da|dos|das)$/.test(f);
    if (i > 0 && CITY_STOP.has(f)) break;
    // Texto com maiúsculas: palavra minúscula que não é conector encerra o nome.
    if (i > 0 && capitalized && !connector && /^[a-zà-ÿ]/.test(w)) break;
    kept.push(w);
  }
  while (kept.length > 0 && /^(de|do|da|dos|das)$/i.test(kept[kept.length - 1])) kept.pop();
  const first = fold(kept[0] ?? "");
  if (!first || NOT_A_CITY.has(first) || CITY_STOP.has(first)) return null;
  return titleCase(kept.join(" "));
}

function extractLocation(messages: Message[]): Fact | null {
  for (const m of newestFirst(messages, ["lead"])) {
    for (const re of [CITY_INTRO_RE, CITY_HERE_RE, CITY_UF_RE]) {
      const hit = m.text.match(re);
      if (!hit) continue;
      const city = trimCity(hit[1]);
      if (!city) continue;
      const uf = hit[2] ? hit[2].toUpperCase() : null;
      return { value: uf ? `${city}/${uf}` : city, source: "conversa", evidence: snippet(m.text) };
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Produto, modelo e medida
// ---------------------------------------------------------------------------

function mentionsTerm(text: string, term: string): boolean {
  const t = fold(term).trim();
  if (t.length < 3) return false;
  const escaped = t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^a-z0-9])${escaped}($|[^a-z0-9])`).test(fold(text));
}

function catalogHit(messages: Message[], catalog: CatalogItem[]) {
  for (const m of newestFirst(messages, ["lead", "agent"])) {
    for (const item of catalog) {
      const byModel = item.model && mentionsTerm(m.text, item.model);
      if (byModel || mentionsTerm(m.text, item.name))
        return { item, message: m, byModel: !!byModel };
    }
  }
  return null;
}

const INTEREST_RE =
  /\b(?:interesse|interessad[oa])\s+(?:em|no|na|nos|nas|pel[oa]s?)\s+(?:um[a]?\s+)?([^.,;!?\n]{3,50})|\bor[çc]amento\s+(?:de|do|da|para|pra)\s+(?:um[a]?\s+)?([^.,;!?\n]{3,50})/i;

function extractInterestFromText(messages: Message[]): Fact | null {
  for (const m of newestFirst(messages, ["lead"])) {
    const hit = m.text.match(INTEREST_RE);
    const raw = clean(hit?.[1] ?? hit?.[2])
      ?.replace(
        /^(?:comprar|adquirir|instalar|fazer|ver|conhecer|saber(?: mais)?(?: sobre)?)\s+(?:(?:um|uma|o|a|os|as)\s+)?/i,
        "",
      )
      .trim();
    // Valor não é interesse ("orçamento de R$ 5.000").
    if (!raw || /^(r\$|\d)/i.test(raw)) continue;
    // Até 6 palavras: o objeto, não a frase inteira.
    const value = raw.split(" ").slice(0, 6).join(" ");
    return { value: capitalize(value), source: "conversa", evidence: snippet(m.text) };
  }
  return null;
}

const NUM = "\\d+(?:[.,]\\d+)?";
const MEASURE_RE = new RegExp(
  `(?<![\\d$])(${NUM})\\s?(?:m|metros?)?\\s?[x×]\\s?(${NUM})(?:\\s?[x×]\\s?(${NUM}))?(?:\\s?(?:m|metros?)\\b)?`,
  "i",
);
const BTU_RE = /\b(\d{1,3}(?:\.\d{3})?)\s?btus?\b/i;
const MODEL_RE = /\bmodelo\s+([A-ZÀ-Ý0-9][\w\-/.]*(?:\s+[A-ZÀ-Ý0-9][\w\-/.]*){0,2})/;

function extractMeasure(messages: Message[]): Fact | null {
  for (const m of newestFirst(messages, ["lead", "agent"])) {
    const model = m.text.match(MODEL_RE);
    if (model) return { value: model[1].trim(), source: "conversa", evidence: snippet(m.text) };
    const btu = m.text.match(BTU_RE);
    if (btu) return { value: `${btu[1]} BTUs`, source: "conversa", evidence: snippet(m.text) };
    const measure = m.text.match(MEASURE_RE);
    if (measure) {
      const dims = [measure[1], measure[2], measure[3]].filter(Boolean).join(" x ");
      return { value: `${dims} m`, source: "conversa", evidence: snippet(m.text) };
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Valor apresentado
// ---------------------------------------------------------------------------

const MONEY_RE = /R\$\s?(\d{1,3}(?:\.\d{3})+|\d+)(?:,(\d{2}))?/g;

function parseMoney(intPart: string, cents?: string): number {
  return Number(intPart.replace(/\./g, "")) + (cents ? Number(cents) / 100 : 0);
}

/**
 * Último valor que NÓS apresentamos (mensagens do atendimento). Numa mensagem
 * com total e parcela ("R$ 25.900 ou 10x de R$ 2.590"), o total é o maior.
 */
function extractPresentedValue(messages: Message[]): Fact | null {
  for (const m of newestFirst(messages, ["agent"])) {
    const values = [...m.text.matchAll(MONEY_RE)].map((hit) => parseMoney(hit[1], hit[2]));
    const total = Math.max(0, ...values);
    if (total > 0)
      return { value: formatBRL(total), source: "conversa", evidence: snippet(m.text) };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Forma de pagamento
// ---------------------------------------------------------------------------

function paymentTerms(text: string): string[] {
  const t = fold(text);
  const out: string[] = [];
  if (/\bpix\b/.test(t)) out.push("Pix");
  if (/\ba vista\b/.test(t)) out.push("À vista");
  if (/\bboletos?\b/.test(t)) out.push("Boleto");
  if (/\bcart(ao|oes)\b/.test(t)) out.push(/credito/.test(t) ? "Cartão de crédito" : "Cartão");
  const parcels = t.match(/\b(\d{1,2})\s?(?:x|vezes)\b(?!\s?\d)|\b(\d{1,2})\s?parcelas\b/);
  const n = parcels ? Number(parcels[1] ?? parcels[2]) : 0;
  if (n >= 2 && n <= 36) out.push(`Parcelado em ${n}x`);
  else if (/\bparcel/.test(t)) out.push("Parcelado");
  if (/\bfinanci/.test(t)) out.push("Financiamento");
  if (/\bentrada\b/.test(t)) out.push("Com entrada");
  return out;
}

/** O que o cliente disse vale mais que o que oferecemos. */
function extractPayment(messages: Message[]): Fact | null {
  for (const roles of [["lead"], ["agent"]] as Message["role"][][]) {
    for (const m of newestFirst(messages, roles)) {
      const terms = paymentTerms(m.text);
      if (terms.length > 0) {
        const value = roles[0] === "agent" ? `Oferecido: ${terms.join(" · ")}` : terms.join(" · ");
        return { value, source: "conversa", evidence: snippet(m.text) };
      }
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Prazo / intenção
// ---------------------------------------------------------------------------

const TIMING_LABELS: Record<string, string> = {
  imediato: "Imediato",
  "30d": "Em até 30 dias",
  "60d": "Em até 60 dias",
  "90d+": "Em 90 dias ou mais",
  indefinido: "Sem prazo definido",
};

const MONTHS =
  "janeiro|fevereiro|mar[çc]o|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro";
const TIMING_RE = new RegExp(
  [
    "o quanto antes",
    "urgente",
    "(?:ainda )?(?:essa|esta) semana",
    "semana que vem",
    "pr[óo]xima semana",
    "(?:ainda )?(?:esse|este) m[êe]s",
    "m[êe]s que vem",
    "pr[óo]ximo m[êe]s",
    "ano que vem",
    "pr[óo]ximo ano",
    "at[ée] o fim d[oe] (?:m[êe]s|ano)",
    "(?:em|daqui a|dentro de) \\d+ (?:dias?|semanas?|m[êe]s(?:es)?)",
    `(?:at[ée]|em|para) (?:${MONTHS})`,
    "para o (?:ver[ãa]o|natal|fim do ano|carnaval)",
    "(?:s[óo]|ainda (?:estou )?)pesquisando",
    "sem pressa",
    "vou pensar",
  ].join("|"),
  "i",
);

function extractTiming(messages: Message[]): Fact | null {
  for (const m of newestFirst(messages, ["lead"])) {
    const hit = m.text.match(TIMING_RE);
    if (hit)
      return {
        value: capitalize(hit[0].toLowerCase()),
        source: "conversa",
        evidence: snippet(m.text),
      };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Próxima ação e resumo
// ---------------------------------------------------------------------------

function formatWhen(iso: string): string {
  return new Date(iso).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
}

function suggestNextAction(input: ConversationFactsInput, presented: Fact | null): Fact | null {
  const { lead, conversation, messages, followupNextAt } = input;
  if (lead.nextAction) {
    return {
      value: `${lead.nextAction.label} · ${formatWhen(lead.nextAction.dueAt)}`,
      source: "registro",
    };
  }
  if (lead.status === "perdido" || lead.lostAt) return null;
  const [last] = newestFirst(messages, ["lead", "agent"]);
  if (conversation.awaitingReply || last?.role === "lead") {
    const question =
      last?.role === "lead" && /\?\s*$/.test(last.text.trim())
        ? ` — “${snippet(last.text, 80)}”`
        : "";
    return { value: `Responder o cliente${question}`, source: "sugerida" };
  }
  if (followupNextAt)
    return { value: `Follow-up · ${formatWhen(followupNextAt)}`, source: "registro" };
  if (lead.status === "fechado" || lead.closedAt) return null;
  if (last?.role === "agent" && presented) {
    return { value: `Aguardar retorno sobre a proposta de ${presented.value}`, source: "sugerida" };
  }
  if (last?.role === "agent")
    return { value: "Aguardar a resposta do cliente", source: "sugerida" };
  return null;
}

function buildSummary(
  input: ConversationFactsInput,
  f: Omit<ConversationFacts, "summary" | "nextAction">,
): string | null {
  const parts: string[] = [];
  const subject = [
    f.interest?.value,
    f.model && f.model.value !== f.interest?.value ? `(${f.model.value})` : null,
  ]
    .filter(Boolean)
    .join(" ");
  if (subject)
    parts.push(`Interesse em ${subject}${f.location ? `, de ${f.location.value}` : ""}.`);
  else if (f.location) parts.push(`Cliente de ${f.location.value}.`);
  if (f.presentedValue) parts.push(`Valor apresentado: ${f.presentedValue.value}.`);
  const budget = meaningful(input.conversation.detectedBudget);
  if (budget) parts.push(`Orçamento do cliente: ${budget}.`);
  if (f.payment) parts.push(`Pagamento: ${f.payment.value}.`);
  if (f.timing) parts.push(`Prazo/intenção: ${f.timing.value}.`);
  const objections = (input.conversation.detectedObjections ?? []).filter(Boolean);
  if (objections.length > 0) parts.push(`Objeções: ${objections.join(", ")}.`);
  const [lastLead] = newestFirst(input.messages, ["lead"]);
  if (lastLead) parts.push(`Última mensagem do cliente: “${snippet(lastLead.text, 120)}”`);
  return parts.length > 0 ? parts.join(" ") : null;
}

// ---------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------

function registered(value: string | null | undefined): Fact | null {
  const v = meaningful(value);
  return v ? { value: v, source: "registro" } : null;
}

export function extractConversationFacts(input: ConversationFactsInput): ConversationFacts {
  const { lead, conversation, messages, catalog = [] } = input;

  const city = meaningful(conversation.detectedCity);
  const uf = clean(conversation.detectedState)?.toUpperCase() ?? null;
  const location: Fact | null =
    city || uf
      ? { value: [city ? titleCase(city) : null, uf].filter(Boolean).join("/"), source: "registro" }
      : extractLocation(messages);

  const hit = catalog.length > 0 ? catalogHit(messages, catalog) : null;
  const interest =
    registered(lead.product) ??
    registered(conversation.detectedInterest) ??
    (hit
      ? { value: hit.item.name, source: "conversa" as const, evidence: snippet(hit.message.text) }
      : null) ??
    extractInterestFromText(messages);

  const model =
    registered(conversation.detectedPoolSize) ??
    (hit?.byModel && hit.item.model
      ? { value: hit.item.model, source: "conversa" as const, evidence: snippet(hit.message.text) }
      : null) ??
    extractMeasure(messages);

  const presentedValue =
    extractPresentedValue(messages) ??
    (lead.estimatedValue
      ? { value: `${formatBRL(lead.estimatedValue)} (estimado)`, source: "registro" as const }
      : null);

  const payment = extractPayment(messages);

  const timingLabel = conversation.purchaseTiming
    ? TIMING_LABELS[conversation.purchaseTiming]
    : null;
  const timing =
    extractTiming(messages) ??
    (timingLabel ? { value: timingLabel, source: "registro" as const } : null);

  const base = { location, interest, model, presentedValue, payment, timing };
  return {
    ...base,
    summary: buildSummary(input, base),
    nextAction: suggestNextAction(input, presentedValue),
  };
}
