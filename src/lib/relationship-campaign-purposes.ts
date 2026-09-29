// Propósitos das campanhas de relacionamento — compartilhado por servidor e
// UI (sem dependências de servidor). O nome do template tem de bater com
// `PURPOSE_TEMPLATE_MAP` em `wa-templates.server.ts` (há teste garantindo).

export type RelationshipPurpose = "followup_resume" | "reactivation" | "quote_followup";

export interface RelationshipPurposeInfo {
  label: string;
  template: string;
  /** O que vai no {{1}} do template. */
  var1: "resume_phrase" | "first_name";
  description: string;
}

export const RELATIONSHIP_PURPOSES: Record<RelationshipPurpose, RelationshipPurposeInfo> = {
  followup_resume: {
    label: "Retomada",
    template: "chamar_novamente",
    var1: "resume_phrase",
    description:
      "Retoma uma negociação que parou. {{1}} recebe uma frase curta gerada a partir da conversa real (produto, orçamento, objeção) — nunca o nome do cliente.",
  },
  reactivation: {
    label: "Reativação",
    template: "reativacao_cliente",
    var1: "first_name",
    description:
      "Reaproxima um cliente antigo, sem negociação em curso. {{1}} recebe o primeiro nome, como o template foi aprovado.",
  },
  quote_followup: {
    label: "Follow-up de orçamento",
    template: "followup_orcamento",
    var1: "first_name",
    description: "Lembrete de orçamento enviado. {{1}} recebe o primeiro nome.",
  },
};

export function isRelationshipPurpose(value: unknown): value is RelationshipPurpose {
  return typeof value === "string" && value in RELATIONSHIP_PURPOSES;
}

export function relationshipPurposeLabel(value: string | null | undefined): string {
  return isRelationshipPurpose(value) ? RELATIONSHIP_PURPOSES[value].label : (value ?? "—");
}
