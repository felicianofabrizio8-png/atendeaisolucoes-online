// ============================================================================
// RECOVERY ENGINE — Contratos de dados (SPRINT 6 · FASE 6.1)
//
// O motor é PURO: recebe um snapshot já lido do banco e devolve a avaliação.
// Nenhum módulo daqui importa Supabase, React ou `Date.now()` implícito — o
// `now` é sempre injetado. Isso torna o comportamento reprodutível em teste e
// impossível de vazar dados entre empresas (o isolamento acontece na camada
// de leitura, que só entrega linhas de UMA company_id).
//
// REGRA DE OURO DESTA FASE: o motor NUNCA envia mensagem, NUNCA muda estado
// de lead/conversa e NUNCA reescreve regra do Coach. Ele apenas classifica,
// pontua, explica e ordena.
// ============================================================================

/** Canal da conversa — só WhatsApp tem janela de 24h. */
export type RecoveryChannel = "whatsapp" | "instagram" | "facebook" | string;

/**
 * Classificação COMPLEMENTAR do momento da negociação.
 * Não substitui nem grava `leads.status`; é uma leitura derivada.
 */
export type RecoveryState =
  | "ativo" // conversa viva, nada a recuperar
  | "aguardando_cliente" // vendedor respondeu, cliente sumiu
  | "aguardando_vendedor" // cliente falou por último — bola com a equipe
  | "aguardando_orcamento" // prometido/pendente, orçamento não enviado
  | "aguardando_retorno_orcamento" // orçamento enviado, sem resposta
  | "aguardando_visita" // visita agendada no futuro
  | "aguardando_retorno_visita" // visita ocorreu, sem desfecho
  | "lead_parado" // parado além do razoável, sem etapa clara
  | "abandonado" // silêncio prolongado
  | "encerrado" // ganho/fechado
  | "perdido"; // marcado como perdido

export type RecoveryTier =
  | "muito_alta"
  | "alta"
  | "media"
  | "baixa"
  | "muito_baixa";

export type RecoveryActionKind =
  | "ligar"
  | "whatsapp_livre"
  | "whatsapp_template"
  | "audio"
  | "novo_orcamento"
  | "agendar_visita"
  | "aguardar"
  | "nao_insistir";

export type WindowState =
  | "open"
  | "closing_soon"
  | "closed"
  | "never_opened"
  | "not_applicable";

export interface RecoveryWindow {
  state: WindowState;
  /** Última mensagem do cliente (abre a janela). */
  openedAt: string | null;
  /** Quando a janela fecha/fechou. */
  closesAt: string | null;
  /** ms restantes (0 quando já fechada). */
  remainingMs: number;
  /** ms desde o fechamento (0 quando ainda aberta). */
  sinceClosedMs: number;
  /** Se true, só template aprovado pode iniciar contato pelo WhatsApp. */
  requiresTemplate: boolean;
}

/** Snapshot de UM lead/conversa, montado pela camada de leitura. */
export interface RecoverySnapshot {
  conversationId: string;
  leadId: string;
  leadName: string;
  product: string | null;
  channel: RecoveryChannel;
  /** Status do lead (enum `lead_status`), apenas lido. */
  leadStatus: string;
  /** Temperatura em cache do lead ou da conversa. */
  temperature: string | null;
  estimatedValue: number | null;
  source: string | null;
  tags: string[];
  assignedTo: string | null;
  assignedToName: string | null;

  /** ISO da última mensagem do cliente. */
  lastInboundAt: string | null;
  /** ISO da última mensagem do vendedor/sistema. */
  lastOutboundAt: string | null;
  /** ISO da última mensagem de qualquer origem. */
  lastMessageAt: string | null;
  /** ISO da primeira mensagem — mede o tempo de negociação. */
  firstMessageAt: string | null;
  messageCount: number;

  quote: {
    sentAt: string | null;
    viewedAt: string | null;
    status: string | null;
    total: number | null;
  } | null;
  visit: { scheduledAt: string | null; status: string | null } | null;

  /** Último follow-up automático já executado (somente leitura). */
  lastFollowUpAt: string | null;
  followUpResponded: boolean;

  /** Sinais do Coach — auxiliam, nunca decidem sozinhos. */
  coachRiskScore: number | null;
  coachUrgency: "low" | "medium" | "high" | "critical" | null;

  lostAt: string | null;
  closedAt: string | null;
  reactivatedAt: string | null;
}

/** Um fator que empurrou o score para cima ou para baixo. */
export interface RecoveryFactor {
  key: string;
  /** Texto pronto para o vendedor ler — é a explainability. */
  label: string;
  /** Contribuição em pontos (pode ser negativa). */
  points: number;
}

export interface RecoveryAction {
  kind: RecoveryActionKind;
  label: string;
  reason: string;
  /** Verdadeiro quando a janela fechou e só template aprovado inicia contato. */
  requiresTemplate: boolean;
  /** Nome sugerido de template aprovado, quando aplicável. */
  suggestedTemplate: string | null;
}

export interface RecoveryAssessment {
  conversationId: string;
  leadId: string;
  leadName: string;
  product: string | null;
  channel: RecoveryChannel;
  leadStatus: string;
  assignedTo: string | null;
  assignedToName: string | null;
  estimatedValue: number | null;

  state: RecoveryState;
  window: RecoveryWindow;

  /** 0–100. */
  score: number;
  tier: RecoveryTier;
  /** 0–100, heurístico. */
  chancePercent: number;

  factors: RecoveryFactor[];
  /** Resumo em uma frase de por que este lead está nesta prioridade. */
  explanation: string;

  action: RecoveryAction;

  /** Horas desde a última mensagem de qualquer origem. */
  stalledHours: number;
  lastInteractionAt: string | null;
  /** Impressão digital dos sinais — permite recalcular só o que mudou. */
  fingerprint: string;
}

/** Item da fila: avaliação + posição justificada. */
export interface RecoveryQueueItem extends RecoveryAssessment {
  position: number;
  positionReason: string;
}

export const HOUR_MS = 60 * 60 * 1000;
export const DAY_MS = 24 * HOUR_MS;
