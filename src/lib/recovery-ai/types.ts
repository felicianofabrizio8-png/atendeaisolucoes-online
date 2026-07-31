// ============================================================================
// RECOVERY AI ASSISTANT — Contratos (SPRINT 6 · FASE 6.2)
//
// Esta fase NÃO altera nada da Fase 6.1: consome exclusivamente a saída do
// Recovery Engine (`RecoveryAssessment`) e um resumo seguro do histórico.
//
// Princípios:
//  · O contexto enviado ao modelo é FECHADO e pequeno — nunca o histórico
//    completo, nunca dados sensíveis crus.
//  · O plano devolvido é hipótese, nunca certeza.
//  · Nenhum módulo daqui envia mensagem.
// ============================================================================

import type { RecoveryAssessment } from "@/lib/recovery";

/** Quem falou por último na conversa. */
export type LastSpeaker = "cliente" | "vendedor" | "ninguem";

/** Nível de insistência recomendado — limitado a um enum fechado. */
export type InsistenceLevel = "baixa" | "media" | "alta";

/** Mensagem já resumida e mascarada, pronta para o prompt. */
export interface SafeMessage {
  role: "cliente" | "vendedor" | "sistema";
  at: string;
  text: string;
}

/** Template real da empresa (apenas aprovados chegam aqui). */
export interface RecoveryTemplateRef {
  name: string;
  status: string;
}

/**
 * Contexto seguro entregue à IA. Tudo aqui é derivado — nenhum campo é texto
 * livre vindo do cliente sem passar pela mascaração.
 */
export interface RecoveryContext {
  conversationId: string;
  leadId: string;
  leadName: string;
  product: string | null;
  source: string | null;
  leadStatus: string;
  state: string;
  stateLabel: string;
  channel: string;

  score: number;
  tier: string;
  chancePercent: number;

  stalledHours: number;
  stalledLabel: string;
  lastInteractionAt: string | null;
  lastSpeaker: LastSpeaker;

  tags: string[];
  estimatedValue: number | null;

  window: {
    state: string;
    label: string;
    requiresTemplate: boolean;
  };
  /** Template obrigatório quando a janela está fechada; `null` caso contrário. */
  requiredTemplate: string | null;
  /** Templates reais aprovados — a IA só pode escolher entre estes. */
  availableTemplates: string[];

  /** Resumo determinístico e mascarado do histórico. */
  summary: string;
  /** Fatores de explainability já calculados na Fase 6.1. */
  factors: string[];
  /** Ação sugerida pelo motor (não pela IA). */
  engineAction: { kind: string; label: string; reason: string };
}

/** Plano de recuperação produzido pela IA e validado pelo parser. */
export interface RecoveryPlan {
  /** Hipótese do motivo da perda — nunca afirmação categórica. */
  probableReason: string;
  strategy: string;
  tone: string;
  insistence: InsistenceLevel;
  bestMoment: string;
  cta: string;
  primaryMessage: string;
  /** No máximo 2. */
  alternatives: string[];
  explanation: string;
  /** Nome de template REAL; `null` quando a janela permite mensagem livre. */
  templateName: string | null;
  requiresTemplate: boolean;
}

/** Resposta do endpoint `/api/recovery/assist`. */
export interface RecoveryAssistResponse {
  plan: RecoveryPlan;
  context: RecoveryContext;
  fingerprint: string;
  cached: boolean;
  generatedAt: string;
}

/** Entrada do construtor de contexto. */
export interface RecoveryContextInput {
  assessment: RecoveryAssessment;
  messages: SafeMessage[];
  tags: string[];
  source: string | null;
  templates: RecoveryTemplateRef[];
  now: number;
}

export const MAX_ALTERNATIVES = 2;
export const MAX_SUMMARY_CHARS = 1200;
export const MAX_MESSAGE_CHARS = 220;
export const MAX_CONTEXT_MESSAGES = 12;
