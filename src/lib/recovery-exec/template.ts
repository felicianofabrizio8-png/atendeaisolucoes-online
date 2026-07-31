// ============================================================================
// Validação de template e placeholders (Fase 6.3) — puro, sem I/O.
//
// Regra dura: fora da janela de 24h só sai TEMPLATE REAL E APROVADO da própria
// empresa. Nunca convertemos texto livre em "template fictício". Se faltar
// parâmetro, o envio é bloqueado antes de qualquer chamada ao provedor.
// ============================================================================

export interface TemplateCandidate {
  id: string;
  name: string;
  status: string;
  language: string;
  /** Nomes lógicos das variáveis, na ordem em que aparecem no corpo. */
  variables: string[];
  /** Corpo bruto com marcadores `{{1}}`, `{{2}}`… */
  body: string;
}

export type TemplateValidation =
  | { ok: true; missing: [] }
  | { ok: false; code: "not_found" | "not_approved" | "missing_params" | "no_language"; missing: string[]; message: string };

export function validateTemplateSelection(
  template: TemplateCandidate | null | undefined,
  variables: Record<string, string>,
): TemplateValidation {
  if (!template) {
    return {
      ok: false,
      code: "not_found",
      missing: [],
      message: "Template não encontrado para esta empresa.",
    };
  }
  if (template.status !== "approved") {
    return {
      ok: false,
      code: "not_approved",
      missing: [],
      message: "Este template não está aprovado pela Meta.",
    };
  }
  if (!template.language?.trim()) {
    return {
      ok: false,
      code: "no_language",
      missing: [],
      message: "Template sem idioma definido.",
    };
  }
  const missing = (template.variables ?? []).filter((name) => !variables[name]?.trim());
  if (missing.length > 0) {
    return {
      ok: false,
      code: "missing_params",
      missing,
      message: `Preencha os parâmetros: ${missing.join(", ")}.`,
    };
  }
  return { ok: true, missing: [] };
}

/** Preview local do corpo com as variáveis preenchidas. */
export function previewTemplateBody(
  template: TemplateCandidate,
  variables: Record<string, string>,
): string {
  let out = template.body ?? "";
  (template.variables ?? []).forEach((name, i) => {
    out = out.replaceAll(`{{${i + 1}}}`, variables[name]?.trim() || `{{${name}}}`);
  });
  return out;
}

/** Marcadores presentes no corpo — usado para conferir a declaração. */
export function extractPlaceholders(body: string): number[] {
  const found = new Set<number>();
  for (const m of (body ?? "").matchAll(/\{\{\s*(\d+)\s*\}\}/g)) {
    found.add(Number(m[1]));
  }
  return [...found].sort((a, b) => a - b);
}
