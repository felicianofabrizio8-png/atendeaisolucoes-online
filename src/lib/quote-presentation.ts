import type { Quote } from "@/data/quotes";

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
    [lead?.name, lead?.phone, lead?.handle, quote.productName, quote.id].join(" "),
  );
  return normalizeQuoteSearch(query)
    .split(/\s+/)
    .every(
      (term) =>
        text.includes(term) ||
        (/^[\d()+.-]+$/.test(term) &&
          (lead?.phone ?? "").replace(/\D/g, "").includes(term.replace(/\D/g, ""))),
    );
}

export function quoteGlow(id: string): string {
  let hash = 0;
  for (const char of id) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  const hue = 210 + (hash % 150);
  return `linear-gradient(125deg, hsl(${hue + 45} 75% 55% / .36), hsl(${hue} 85% 60% / .48))`;
}
