// Recomendação de template Meta para conversas fora da janela de 24h.
// Mapeia contexto da conversa/lead → nome de template provável.
// É apenas uma sugestão — o atendente pode trocar antes de enviar.

export interface RecommendContext {
  leadStatus?: string | null;
  hasQuote?: boolean;
  hasVisit?: boolean;
  daysSinceLastInbound?: number;
  product?: string | null;
}

export interface TemplateLike {
  id: string;
  name: string;
  status: string;
  category?: string;
}

const CANDIDATE_BY_CONTEXT: Array<{
  test: (ctx: RecommendContext) => boolean;
  candidates: string[];
}> = [
  {
    test: (c) => !!c.hasVisit,
    candidates: ["confirmacao_visita", "visita_agendada", "lembrete_visita"],
  },
  {
    test: (c) => (c.daysSinceLastInbound ?? 0) >= 7,
    candidates: ["reativacao_cliente", "reativacao", "cliente_sumiu"],
  },
  {
    test: (c) => !!c.hasQuote,
    candidates: ["followup_orcamento", "orcamento_followup", "pos_orcamento"],
  },
  {
    test: (c) =>
      c.leadStatus === "qualificado" ||
      c.leadStatus === "novo" ||
      c.leadStatus === "quente",
    candidates: ["cliente_pesquisando", "retomar_atendimento", "ola_novamente"],
  },
];

export function recommendTemplate(
  ctx: RecommendContext,
  templates: TemplateLike[],
): TemplateLike | null {
  const approved = templates.filter((t) => (t.status ?? "").toLowerCase() === "approved");
  if (approved.length === 0) return null;

  for (const rule of CANDIDATE_BY_CONTEXT) {
    if (!rule.test(ctx)) continue;
    for (const name of rule.candidates) {
      const found = approved.find(
        (t) => t.name.toLowerCase() === name.toLowerCase(),
      );
      if (found) return found;
    }
  }
  // fallback: primeiro UTILITY aprovado, ou qualquer aprovado
  const utility = approved.find(
    (t) => (t.category ?? "").toLowerCase() === "utility",
  );
  return utility ?? approved[0];
}
