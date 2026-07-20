// ============================================================================
// Overlay Guard — Fase M2 (worker)
//
// Validação defensiva de textos visuais antes da rasterização SVG. Espelha as
// regras do resolver server-side (`src/lib/marketing/overlay-content-resolver.ts`)
// para garantir que valores legados persistidos em `video_render_jobs.video_brand`
// nunca ultrapassem a área segura visual.
//
// Regras invioláveis:
//  - Nunca cortar palavras (reduzimos por palavras inteiras).
//  - Nunca terminar em conectivo (removemos a última palavra).
//  - Nunca produzir reticências.
//  - Nunca truncar silenciosamente sem retornar telemetria.
// ============================================================================

export const OVERLAY_LIMITS = {
  headline: { maxWords: 5, maxChars: 28 },
  supportingText: { maxWords: 8, maxChars: 45 },
  ctaText: { maxWords: 4, maxChars: 40 },
} as const;

const DANGLING = new Set([
  "e","ou","o","a","os","as","um","uma","uns","umas",
  "de","do","da","dos","das","em","no","na","nos","nas",
  "para","pra","por","pelo","pela","pelos","pelas",
  "com","sem","que","se","ao","aos","à","às",
]);

function norm(w: string): string {
  return w
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, "");
}

export function fitOverlay(
  raw: string | null | undefined,
  maxWords: number,
  maxChars: number,
): string {
  if (typeof raw !== "string") return "";
  const cleaned = raw.replace(/\s+/g, " ").trim();
  if (!cleaned) return "";
  const words = cleaned.split(" ");
  const picked: string[] = [];
  for (const w of words) {
    if (picked.length >= maxWords) break;
    const cand = picked.length ? `${picked.join(" ")} ${w}` : w;
    if (cand.length > maxChars) break;
    picked.push(w);
  }
  let out = picked.join(" ").replace(/[,;:\-–—/.]+$/g, "").trim();
  while (out && DANGLING.has(norm(out.split(" ").pop() ?? ""))) {
    const p = out.split(" ");
    p.pop();
    out = p.join(" ").replace(/[,;:\-–—/.]+$/g, "").trim();
  }
  return out;
}

export interface GuardedOverlayContent {
  headline: string | null;
  supportingText: string | null;
  ctaText: string | null;
  companyName: string | null;
}

export interface GuardResult {
  content: GuardedOverlayContent;
  reasons: string[];
}

export function guardOverlayContent(input: {
  headline: string | null;
  supportingText: string | null;
  ctaText: string | null;
  companyName: string | null;
}): GuardResult {
  const reasons: string[] = [];
  const guard = (
    field: keyof typeof OVERLAY_LIMITS,
    raw: string | null,
  ): string | null => {
    if (!raw) return null;
    const { maxWords, maxChars } = OVERLAY_LIMITS[field];
    const fitted = fitOverlay(raw, maxWords, maxChars);
    if (!fitted) {
      reasons.push(`${field}_dropped`);
      return null;
    }
    if (fitted !== raw.trim()) {
      reasons.push(`${field}_refitted`);
    }
    return fitted;
  };
  return {
    content: {
      headline: guard("headline", input.headline),
      supportingText: guard("supportingText", input.supportingText),
      ctaText: guard("ctaText", input.ctaText),
      // Nome da empresa é apenas normalizado (sem limite duro de palavras).
      companyName: input.companyName
        ? input.companyName.replace(/\s+/g, " ").trim().slice(0, 60) || null
        : null,
    },
    reasons,
  };
}

export function countWords(s: string): number {
  const t = s.trim();
  if (!t) return 0;
  return t.split(/\s+/).filter(Boolean).length;
}
