// Sugestão de ação — o que o vendedor deveria fazer AGORA com este lead.
//
// Regra desta fase: nada é enviado. A função apenas recomenda o canal, a
// abordagem e, quando a janela do WhatsApp estiver fechada, aponta que um
// template aprovado é obrigatório e sugere qual.

import {
  type RecoveryAction,
  type RecoverySnapshot,
  type RecoveryState,
  type RecoveryWindow,
} from "./types";
import { formatSpan } from "./window";
import { stalledDays } from "./classify";

/** Candidatos de template por contexto — casados depois com os aprovados. */
export interface ApprovedTemplate {
  id: string;
  name: string;
  status: string;
}

const TEMPLATE_CANDIDATES: Array<{
  test: (s: RecoverySnapshot, state: RecoveryState, days: number) => boolean;
  names: string[];
}> = [
  {
    test: (_s, state) => state === "aguardando_visita" || state === "aguardando_retorno_visita",
    names: ["confirmacao_visita", "visita_agendada", "lembrete_visita"],
  },
  {
    test: (_s, _state, days) => days >= 14,
    names: ["reativacao_cliente", "reativacao", "cliente_sumiu"],
  },
  {
    test: (s) => !!s.quote?.sentAt,
    names: ["followup_orcamento", "orcamento_followup", "pos_orcamento"],
  },
  {
    test: () => true,
    names: ["retomar_atendimento", "ola_novamente", "cliente_pesquisando"],
  },
];

/**
 * Escolhe um template APROVADO compatível com o contexto.
 * Devolve `null` quando a empresa ainda não tem template aprovado — nesse
 * caso a UI orienta a cadastrar, nunca tenta enviar.
 */
export function suggestTemplate(
  snap: RecoverySnapshot,
  state: RecoveryState,
  stalledHours: number,
  templates: ApprovedTemplate[],
): string | null {
  const approved = templates.filter((t) => (t.status ?? "").toLowerCase() === "approved");
  if (approved.length === 0) return null;
  const days = stalledDays(stalledHours);
  const byName = new Map(approved.map((t) => [t.name.toLowerCase(), t.name]));

  for (const group of TEMPLATE_CANDIDATES) {
    if (!group.test(snap, state, days)) continue;
    for (const candidate of group.names) {
      const hit = byName.get(candidate);
      if (hit) return hit;
      // Correspondência parcial: nomes reais costumam ter sufixo de idioma.
      const partial = approved.find((t) => t.name.toLowerCase().includes(candidate));
      if (partial) return partial.name;
    }
  }
  return approved[0].name;
}

/**
 * Deriva a ação sugerida a partir do estado, da janela e do potencial.
 * `chancePercent` e `score` entram para separar "insistir" de "não insistir".
 */
export function suggestAction(
  snap: RecoverySnapshot,
  state: RecoveryState,
  window: RecoveryWindow,
  stalledHours: number,
  score: number,
  chancePercent: number,
  templates: ApprovedTemplate[],
): RecoveryAction {
  const requiresTemplate = window.requiresTemplate && snap.channel === "whatsapp";
  const template = requiresTemplate
    ? suggestTemplate(snap, state, stalledHours, templates)
    : null;

  const templateNote = requiresTemplate
    ? template
      ? ` Janela de 24h fechada há ${formatSpan(window.sinceClosedMs)} — use o template aprovado "${template}".`
      : ` Janela de 24h fechada há ${formatSpan(window.sinceClosedMs)} — nenhum template aprovado disponível; cadastre um antes de contatar.`
    : "";

  // Desfechos que pedem recuo explícito.
  if (state === "encerrado") {
    return {
      kind: "nao_insistir",
      label: "Não insistir",
      reason: "Atendimento já concluído — recuperação não se aplica.",
      requiresTemplate: false,
      suggestedTemplate: null,
    };
  }
  if (state === "perdido" && chancePercent < 25) {
    return {
      kind: "nao_insistir",
      label: "Não insistir",
      reason: "Lead marcado como perdido e com baixa chance de retorno; priorize outros contatos.",
      requiresTemplate: false,
      suggestedTemplate: null,
    };
  }
  if (state === "ativo") {
    return {
      kind: "aguardar",
      label: "Aguardar",
      reason: "Conversa ainda em andamento; nada a recuperar no momento.",
      requiresTemplate: false,
      suggestedTemplate: null,
    };
  }
  if (state === "aguardando_visita") {
    return {
      kind: "aguardar",
      label: "Aguardar a visita",
      reason: "Visita agendada — mantenha o combinado e confirme perto da data.",
      requiresTemplate,
      suggestedTemplate: template,
    };
  }

  // Etapa concreta pendente com a equipe: produzir o orçamento vale mais que
  // qualquer mensagem de retomada.
  if (state === "aguardando_orcamento") {
    return {
      kind: "novo_orcamento",
      label: "Enviar o orçamento",
      reason: `O cliente está esperando a proposta há ${formatSpan(stalledHours * 60 * 60 * 1000)}.${templateNote}`,
      requiresTemplate,
      suggestedTemplate: template,
    };
  }
  if (state === "aguardando_retorno_visita") {
    return {
      kind: "ligar",
      label: "Ligar para fechar",
      reason: `A visita já aconteceu e falta desfecho; uma ligação resolve mais rápido que mensagem.${templateNote}`,
      requiresTemplate,
      suggestedTemplate: template,
    };
  }

  // Alto valor + boa chance justificam ligação; caso contrário, WhatsApp.
  const highValue = (snap.estimatedValue ?? 0) >= 20000;
  if (score >= 70 && (highValue || chancePercent >= 55)) {
    return {
      kind: "ligar",
      label: "Ligar agora",
      reason: `Prioridade alta e chance de ${chancePercent}% — contato por voz tem melhor conversão neste perfil.${templateNote}`,
      requiresTemplate,
      suggestedTemplate: template,
    };
  }

  if (state === "abandonado" && chancePercent < 25) {
    return {
      kind: "aguardar",
      label: "Aguardar / campanha futura",
      reason: `Silêncio de ${stalledDays(stalledHours)} dias com baixa chance; melhor destino é uma ação de marketing, não contato individual.${templateNote}`,
      requiresTemplate,
      suggestedTemplate: template,
    };
  }

  if (requiresTemplate) {
    return {
      kind: "whatsapp_template",
      label: "WhatsApp com template aprovado",
      reason: `Retomar o contato pelo WhatsApp.${templateNote}`,
      requiresTemplate: true,
      suggestedTemplate: template,
    };
  }

  if (snap.quote?.sentAt && !snap.quote.viewedAt) {
    return {
      kind: "audio",
      label: "Mandar um áudio curto",
      reason: "Orçamento enviado e não visualizado — um áudio pessoal costuma reabrir a conversa.",
      requiresTemplate: false,
      suggestedTemplate: null,
    };
  }

  return {
    kind: "whatsapp_livre",
    label: "WhatsApp (mensagem livre)",
    reason: `Janela de 24h aberta (restam ${formatSpan(window.remainingMs)}) — aproveite para escrever uma mensagem personalizada.`,
    requiresTemplate: false,
    suggestedTemplate: null,
  };
}

export const ACTION_LABEL: Record<RecoveryAction["kind"], string> = {
  ligar: "Ligar",
  whatsapp_livre: "WhatsApp livre",
  whatsapp_template: "WhatsApp com template",
  audio: "Áudio",
  novo_orcamento: "Novo orçamento",
  agendar_visita: "Agendar visita",
  aguardar: "Aguardar",
  nao_insistir: "Não insistir",
};
