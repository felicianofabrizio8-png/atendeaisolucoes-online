// Marketing IA — Fase M1
// Helpers PUROS (sem I/O) para o novo contrato visual `image_texts`.
//
// Escopo desta etapa:
//  - Validar e reescrever headline/subheadline/cta seguindo limites da spec.
//  - Nunca truncar no meio de palavras — reduzimos por palavras inteiras.
//  - Detectar frases incompletas (terminando em conectivos ou pontuação solta).
//  - Detectar repetição contra assinaturas das últimas campanhas.
//  - Aplicar fallback determinístico a partir de title/body/cta_text.
//
// Estes helpers não conectam ao Render Engine; apenas produzem os textos que
// serão persistidos em `overlay_headline/subheadline/cta` para validação.

// --------------------------- Normalização e utilitários

/** Normalização para comparação (case, acentos, pontuação e espaços). */
export function normalizeForComparison(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, "");
}

export function countWords(s: string): number {
  const t = s.trim();
  if (!t) return 0;
  return t.split(/\s+/).filter(Boolean).length;
}

/** Palavras conectivas soltas que indicam frase cortada. */
const DANGLING_WORDS = new Set([
  "e", "ou", "o", "a", "os", "as", "um", "uma", "uns", "umas",
  "de", "do", "da", "dos", "das", "em", "no", "na", "nos", "nas",
  "para", "pra", "por", "pelo", "pela", "pelos", "pelas",
  "com", "sem", "que", "se", "ao", "aos", "à", "às",
]);

export function isIncomplete(s: string): boolean {
  const t = s.trim();
  if (!t) return true;
  if (/[,;:\-–—/]$/.test(t)) return true;
  const parts = t.split(/\s+/);
  const last = parts[parts.length - 1]
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\p{L}\p{N}]+/g, "");
  return DANGLING_WORDS.has(last);
}

/**
 * Reduz uma string mantendo apenas palavras inteiras que caibam nos limites.
 * Nunca corta uma palavra ao meio. Se o resultado terminar em conectivo,
 * remove a última palavra para evitar frase incompleta.
 */
export function fitWords(raw: string, maxWords: number, maxChars: number): string {
  const words = raw
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean);
  const picked: string[] = [];
  for (const w of words) {
    if (picked.length >= maxWords) break;
    const cand = picked.length ? `${picked.join(" ")} ${w}` : w;
    if (cand.length > maxChars) break;
    picked.push(w);
  }
  let out = picked.join(" ").replace(/[,;:\-–—/.]+$/g, "").trim();
  // Remove palavras conectivas soltas ao final até virar completo (ou vazio).
  while (out && isIncomplete(out)) {
    const p = out.split(" ");
    p.pop();
    out = p.join(" ").replace(/[,;:\-–—/.]+$/g, "").trim();
  }
  return out;
}

/** Extrai a primeira frase do body e reduz para caber no subheadline. */
export function summarizeBodyForSubheadline(body: string): string {
  if (!body) return "";
  const firstSentence = (body.split(/(?<=[.!?])\s+/)[0] ?? body).trim();
  return fitWords(firstSentence, 8, 45);
}

// --------------------------- Fallback determinístico

export interface OverlayFallbackInput {
  title: string;
  body: string;
  cta_text: string | null;
}

export interface OverlayFallbackResult {
  headline: string;
  subheadline: string | null;
  cta: string | null;
}

export function buildOverlayFromFallback(fb: OverlayFallbackInput): OverlayFallbackResult {
  const headlineRaw = fitWords(fb.title || "", 5, 28);
  const headline =
    countWords(headlineRaw) >= 2 ? headlineRaw : "Novidade exclusiva";
  const sub = summarizeBodyForSubheadline(fb.body);
  const subheadline =
    sub && normalizeForComparison(sub) !== normalizeForComparison(headline)
      ? sub
      : null;
  const ctaRaw = fb.cta_text ? fitWords(fb.cta_text, 4, 40) : "";
  const cta = ctaRaw || null;
  return { headline, subheadline, cta };
}

// --------------------------- Repetição

export function buildRecentSignaturesSet(
  rows: Array<{ overlay_headline: string | null; overlay_subheadline: string | null }>,
): Set<string> {
  const set = new Set<string>();
  for (const r of rows) {
    if (!r.overlay_headline) continue;
    const h = normalizeForComparison(r.overlay_headline);
    if (h) set.add(h);
    const combo = normalizeForComparison(
      `${r.overlay_headline}|${r.overlay_subheadline ?? ""}`,
    );
    if (combo) set.add(combo);
  }
  return set;
}

// --------------------------- Contrato principal

export interface RawImageTextsCandidate {
  headline?: string | null;
  subheadline?: string | null;
  cta?: string | null;
}

export interface OverlayNormalizedResult {
  overlay_headline: string;
  overlay_subheadline: string | null;
  overlay_cta: string | null;
  telemetry: {
    source: "ai" | "ai_rewritten" | "fallback";
    reasons: string[];
    repeated_recent: boolean;
  };
}

/**
 * Ponto único de validação/reescrita para os textos visuais da campanha.
 * NUNCA trunca no meio de palavras. Se não conseguir sanear, cai no fallback.
 */
export function normalizeOverlayCandidate(
  raw: RawImageTextsCandidate | null | undefined,
  fallback: OverlayFallbackInput,
  recentSignatures: Set<string>,
): OverlayNormalizedResult {
  const reasons: string[] = [];
  let source: "ai" | "ai_rewritten" | "fallback" = raw ? "ai" : "fallback";

  let headline = (raw?.headline ?? "").trim();
  let subheadline: string | null = (raw?.subheadline ?? "").trim() || null;
  let cta: string | null = (raw?.cta ?? "").trim() || null;

  // -------- headline --------
  const headlineOk = (v: string) =>
    !!v &&
    countWords(v) >= 2 &&
    countWords(v) <= 5 &&
    v.length <= 28 &&
    !isIncomplete(v);

  if (!headlineOk(headline)) {
    const fitted = fitWords(headline, 5, 28);
    if (headlineOk(fitted)) {
      headline = fitted;
      source = source === "fallback" ? "fallback" : "ai_rewritten";
      reasons.push("headline_rewritten");
    } else {
      const fb = buildOverlayFromFallback(fallback);
      headline = fb.headline;
      subheadline = subheadline ?? fb.subheadline;
      cta = cta ?? fb.cta;
      source = "fallback";
      reasons.push("headline_fallback");
    }
  }

  // -------- subheadline --------
  const subOk = (v: string) =>
    !!v &&
    countWords(v) >= 3 &&
    countWords(v) <= 8 &&
    v.length <= 45 &&
    !isIncomplete(v) &&
    normalizeForComparison(v) !== normalizeForComparison(headline);

  if (subheadline) {
    if (!subOk(subheadline)) {
      const fitted = fitWords(subheadline, 8, 45);
      if (subOk(fitted)) {
        subheadline = fitted;
        if (source === "ai") source = "ai_rewritten";
        reasons.push("subheadline_rewritten");
      } else {
        const fromBody = summarizeBodyForSubheadline(fallback.body);
        subheadline = subOk(fromBody) ? fromBody : null;
        if (source === "ai") source = "ai_rewritten";
        reasons.push("subheadline_fallback");
      }
    }
  } else {
    const fromBody = summarizeBodyForSubheadline(fallback.body);
    if (subOk(fromBody)) {
      subheadline = fromBody;
      reasons.push("subheadline_from_body");
    }
  }

  // -------- cta --------
  const ctaOk = (v: string) => !!v && countWords(v) <= 4 && v.length <= 40;
  if (cta) {
    if (!ctaOk(cta)) {
      const fitted = fitWords(cta, 4, 40);
      cta = fitted || null;
      if (cta) reasons.push("cta_rewritten");
      else reasons.push("cta_dropped");
      if (source === "ai") source = "ai_rewritten";
    }
  } else if (fallback.cta_text) {
    const fitted = fitWords(fallback.cta_text, 4, 40);
    if (fitted) {
      cta = fitted;
      reasons.push("cta_from_fallback");
    }
  }

  // -------- repetição --------
  const headSig = normalizeForComparison(headline);
  const comboSig = normalizeForComparison(`${headline}|${subheadline ?? ""}`);
  const repeated =
    recentSignatures.has(headSig) || recentSignatures.has(comboSig);

  if (repeated) {
    reasons.push("repeated_recent");
    const fb = buildOverlayFromFallback(fallback);
    if (normalizeForComparison(fb.headline) !== headSig) {
      headline = fb.headline;
      // Só substitui subtítulo se o fallback trouxer algo válido e diferente.
      if (fb.subheadline && subOk(fb.subheadline)) subheadline = fb.subheadline;
      if (source !== "fallback") source = "ai_rewritten";
      reasons.push("headline_switched_to_fallback");
    }
  }

  return {
    overlay_headline: headline,
    overlay_subheadline: subheadline,
    overlay_cta: cta,
    telemetry: { source, reasons, repeated_recent: repeated },
  };
}
