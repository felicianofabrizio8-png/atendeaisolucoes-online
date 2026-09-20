export type SalesAgentIntent =
  | "product_images"
  | "product_inquiry"
  | "confirmation"
  | "continuation"
  | "commercial_question"
  | "unknown";

export type SalesAgentSubject =
  "product" | "price" | "dimensions" | "variant" | "commercial" | "installation" | "unknown";

export type SalesAgentProductReferenceKind =
  "explicit" | "pronoun" | "ordinal" | "continuation" | "none";

export type SalesAgentConfirmation = "affirmative" | "negative" | "none";

export interface StructuredSalesAgentInterpretation {
  intent: SalesAgentIntent;
  subject: SalesAgentSubject;
  productReference: {
    kind: SalesAgentProductReferenceKind;
    text: string | null;
    productIds: string[];
  };
  confirmation: SalesAgentConfirmation;
  confidence: number;
}

export function buildCompactSalesContextSummary(args: {
  interpretation: StructuredSalesAgentInterpretation;
  productIds: string[];
  lastValidProductIds: string[];
  lastCatalogQueryStatus?: string | null;
}): string {
  const { interpretation } = args;
  return [
    `intent=${interpretation.intent}`,
    `subject=${interpretation.subject}`,
    `reference=${interpretation.productReference.kind}`,
    `referenced_product_ids=${interpretation.productReference.productIds.join(",") || "none"}`,
    `state_product_ids=${args.productIds.join(",") || "none"}`,
    `last_valid_product_ids=${args.lastValidProductIds.join(",") || "none"}`,
    `confirmation=${interpretation.confirmation}`,
    `confidence=${interpretation.confidence.toFixed(2)}`,
    `catalog_status=${args.lastCatalogQueryStatus ?? "none"}`,
  ]
    .join(" | ")
    .slice(0, 800);
}

type InterpretationMessage = {
  role: "lead" | "agent" | "system";
  text: string;
  productIds?: string[];
};

const AFFIRMATIVE =
  /^(?:sim|pode(?:\s+sim)?|claro|quero|ok(?:ay)?|beleza(?:\s*,?\s*manda)?|isso|esse|essa|pode mandar|manda)[!. ,]*$/i;
const NEGATIVE = /^(?:nao|agora nao|deixa|desisti|sem interesse)[!. ,]*$/i;
const CONTINUATION =
  /^(?:(?:e|tem)\s+)?(?:e\s+o\s+outro|mais(?:\s+(?:algum|alguma|um|uma|produto|modelo))?|outro\s+modelo|outras?\s+(?:opcoes?|alternativas?)|e\s+mais\s+algum)\b/i;
const PRONOUN = /\b(?:esse|essa|este|esta|isso|dele|dela|desse|dessa|deste|desta|ele|ela)\b/i;
const ORDINAL = /\b(?:primeira|primeiro|segunda|segundo|ultima|ultimo|1a|1o|2a|2o)\b/i;

function normalize(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function lastLead(history: InterpretationMessage[]): string {
  return [...history].reverse().find((item) => item.role === "lead")?.text ?? "";
}

function subjectFor(text: string): SalesAgentSubject {
  const value = normalize(text);
  if (/\b(?:preco|valor|custa|quanto)\b/.test(value)) return "price";
  if (/\b(?:medida|tamanho|comprimento|largura|profundidade|litros?|capacidade)\b/.test(value)) {
    return "dimensions";
  }
  if (/\b(?:cor|variante|acabamento)\b/.test(value)) return "variant";
  if (/\b(?:instal|entreg|frete|prazo|visita)\b/.test(value)) return "installation";
  if (/\b(?:pagamento|parcel|pix|cartao|boleto|desconto|negoci|garantia)\b/.test(value)) {
    return "commercial";
  }
  if (/\b(?:produto|catalogo|modelo|piscina|spa|banheira|aquecedor)\b/.test(value))
    return "product";
  return "unknown";
}

export function interpretStructuredSalesTurn(
  history: InterpretationMessage[],
): StructuredSalesAgentInterpretation {
  const text = lastLead(history);
  const normalized = normalize(text);
  const previousAgent = [...history].reverse().find((item) => item.role === "agent")?.text ?? "";
  const referencedIds = [...new Set(history.flatMap((item) => item.productIds ?? []))];
  const confirmation = AFFIRMATIVE.test(normalized)
    ? "affirmative"
    : NEGATIVE.test(normalized)
      ? "negative"
      : "none";
  const isContinuation = CONTINUATION.test(normalized);
  const kind = isContinuation
    ? "continuation"
    : ORDINAL.test(normalized)
      ? "ordinal"
      : PRONOUN.test(normalized) || (confirmation !== "none" && referencedIds.length > 0)
        ? "pronoun"
        : referencedIds.length > 0 &&
            /\b(?:modelo|produto|piscina|spa|banheira|aquecedor)\b/i.test(normalized)
          ? "explicit"
          : "none";
  const intent: SalesAgentIntent =
    confirmation !== "none"
      ? "confirmation"
      : isContinuation
        ? "continuation"
        : subjectFor(text) === "commercial"
          ? "commercial_question"
          : subjectFor(text) === "unknown"
            ? "unknown"
            : "product_inquiry";
  const hasContext = referencedIds.length > 0 || previousAgent.length > 0;
  const confidence =
    intent === "unknown"
      ? 0.35
      : confirmation !== "none" && !hasContext
        ? 0.55
        : kind === "none"
          ? 0.75
          : 0.9;
  return {
    intent,
    subject: subjectFor(text),
    productReference: {
      kind,
      text: text || null,
      productIds: referencedIds,
    },
    confirmation,
    confidence,
  };
}
