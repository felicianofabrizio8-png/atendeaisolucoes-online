import type { Quote, QuoteStatus } from "@/data/quotes";

export function quoteDate(value: string): string {
  if (!value) return "—";
  const date = new Date(value.length === 10 ? value + "T12:00:00" : value);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleDateString("pt-BR");
}

export function normalizeQuoteSearch(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

export function matchesQuote(
  quote: Quote,
  lead: { name: string; phone?: string; handle?: string } | undefined,
  query: string,
): boolean {
  const text = normalizeQuoteSearch(
    [
      lead?.name,
      lead?.phone,
      lead?.handle,
      quote.customerDetails?.firstName,
      quote.customerDetails?.lastName,
      quote.customerDetails?.phone1,
      quote.customerDetails?.phone2,
      quote.productName,
      quote.id,
    ].join(" "),
  );
  return normalizeQuoteSearch(query)
    .split(/\s+/)
    .every(
      (term) =>
        text.includes(term) ||
        (/^[\d()+.-]+$/.test(term) &&
          [lead?.phone, quote.customerDetails?.phone1, quote.customerDetails?.phone2].some(
            (phone) => (phone ?? "").replace(/\D/g, "").includes(term.replace(/\D/g, "")),
          )),
    );
}

export function quoteGlow(id: string): string {
  let hash = 0;
  for (const char of id) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  const hue = 210 + (hash % 150);
  return `linear-gradient(125deg, hsl(${hue + 45} 75% 55% / .36), hsl(${hue} 85% 60% / .48))`;
}

/** Stable hue (0–360) per quote, used for the avatar and the card light. */
export function quoteHue(id: string): number {
  let hash = 0;
  for (const char of id) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return 230 + (hash % 80);
}

export function quoteInitials(name: string | undefined): string {
  const parts = (name ?? "").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  const first = parts[0][0] ?? "";
  const last = parts.length > 1 ? (parts[parts.length - 1][0] ?? "") : "";
  return (first + last).toLocaleUpperCase("pt-BR");
}

/** Whole days from today until `validUntil` (YYYY-MM-DD); negative when past. */
export function daysUntil(validUntil: string, now = new Date()): number | null {
  if (!validUntil) return null;
  const target = new Date(validUntil.length === 10 ? validUntil + "T12:00:00" : validUntil);
  if (Number.isNaN(target.getTime())) return null;
  const today = new Date(now);
  today.setHours(12, 0, 0, 0);
  target.setHours(12, 0, 0, 0);
  return Math.round((target.getTime() - today.getTime()) / 86_400_000);
}

export type ValidityTone = "ok" | "soon" | "late" | "done";

/** Human validity line for a quote card, e.g. "Vence amanhã" or "Venceu em 02/10". */
export function quoteValidity(
  validUntil: string,
  status: QuoteStatus,
  now = new Date(),
): { label: string; tone: ValidityTone } {
  const short = quoteDate(validUntil).slice(0, 5);
  if (status === "aprovado") return { label: "Proposta aprovada", tone: "done" };
  const days = daysUntil(validUntil, now);
  if (days === null) return { label: "Sem validade definida", tone: "ok" };
  if (status === "vencido" || days < 0) return { label: `Venceu em ${short}`, tone: "late" };
  if (days === 0) return { label: "Vence hoje", tone: "soon" };
  if (days === 1) return { label: "Vence amanhã", tone: "soon" };
  if (days <= 3) return { label: `Vence em ${days} dias`, tone: "soon" };
  return { label: `Válido até ${short}`, tone: "ok" };
}

export function formatQuoteMoney(value: number): string {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
    minimumFractionDigits: value % 1 ? 2 : 0,
    maximumFractionDigits: 2,
  })
    .format(value)
    .replace(/\s/g, " ");
}
