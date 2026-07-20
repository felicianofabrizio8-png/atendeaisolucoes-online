// Deterministic measure-based product filter.
//
// Purpose: when the user types just a number (optionally with "m"/"metros"),
// treat it as an EXCLUSIVE filter by the product's principal external length,
// not as a fuzzy substring search. Prevents matches via price, litragem,
// model IDs (e.g. "Sol 500"), etc.

export interface MeasureCandidate {
  name: string | null | undefined;
  description?: string | null;
}

/**
 * Parse the query. Returns the integer length in meters if the user typed
 * something that unambiguously represents a measure ("5", "5m", "5 m",
 * "5 metros"). Otherwise returns null.
 */
export function parseMeasureQuery(rawQuery: string): number | null {
  const q = rawQuery.trim().toLowerCase();
  if (!q) return null;
  // Only digits, optionally followed by " m" / "m" / " metros" / "metros".
  const m = q.match(/^(\d{1,2})\s*(?:m|metros?)?$/);
  if (!m) return null;
  const n = Number(m[1]);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n;
}

/**
 * Extract principal-length candidates (in meters, integer part) from a
 * product's structured-ish text fields. Only counts occurrences where the
 * number is clearly a dimension:
 *   - "6x3", "5x2,5", "5,00x2,40x1,40"  → leading dim
 *   - "5 m", "5m", "6 metros"
 * Ignores standalone numbers such as prices, model codes ("Sol 500"),
 * litragem ("5000 L"), etc.
 */
export function extractPrincipalLengths(p: MeasureCandidate): Set<number> {
  const out = new Set<number>();
  const parts = [p.name ?? "", p.description ?? ""];
  for (const raw of parts) {
    if (!raw) continue;
    const text = raw.toLowerCase();
    // Dimension pattern: <int>[.,<dec>]? x <digit>
    const dimRe = /(?<![\d.,])(\d{1,2})(?:[.,]\d+)?\s*[x×]\s*\d/g;
    for (const m of text.matchAll(dimRe)) {
      const n = Number(m[1]);
      if (Number.isFinite(n) && n > 0 && n <= 99) out.add(n);
    }
    // "5 m" / "5m" / "6 metros" — number followed by meter unit, NOT by
    // another digit (excludes "500", "5000L", etc.).
    const meterRe = /(?<![\d.,])(\d{1,2})\s*m(?:etros?)?\b(?!\w)/g;
    for (const m of text.matchAll(meterRe)) {
      const n = Number(m[1]);
      if (Number.isFinite(n) && n > 0 && n <= 99) out.add(n);
    }
  }
  return out;
}

/** True if the product has `length` (in meters) as one of its principal dims. */
export function productMatchesMeasure(p: MeasureCandidate, length: number): boolean {
  return extractPrincipalLengths(p).has(length);
}
