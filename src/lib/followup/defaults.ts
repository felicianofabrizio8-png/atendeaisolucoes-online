// ============================================================================
// followup/defaults.ts
// Responsabilidade: templates padrão de continuidade de atendimento e helpers
// puros usados por vários sub-módulos (render, primeiro nome, janela comercial).
// Sem I/O, sem dependências de outros arquivos do módulo além de types.
// ============================================================================

import { calendarFor, isBusinessTime } from "./calendar";
import type { FollowupRule, FollowupSettings } from "./types";

// Mensagens padrão de continuidade de atendimento.
// Linguagem neutra, compatível com a categoria Utility do WhatsApp Business
// (sem termos promocionais como "oferta", "desconto", "promoção",
// "condição especial", "oportunidade" ou "últimas unidades").
export const DEFAULT_TEMPLATES: Record<FollowupRule, string> = {
  quote_no_reply:
    "Olá {{nome}}, tudo bem? Estamos entrando em contato para dar continuidade ao atendimento do seu orçamento. Caso ainda tenha alguma dúvida, responda esta mensagem que teremos prazer em ajudar.",
  lead_silent:
    "Olá {{nome}}. Identificamos que sua solicitação permanece em aberto. Se desejar continuar o atendimento ou receber mais informações sobre o projeto solicitado, basta responder esta mensagem.",
  visit_no_return:
    "Olá {{nome}}, tudo bem? Estamos retomando o atendimento referente à visita realizada. Caso precise esclarecer dúvidas ou atualizar informações, responda esta mensagem para dar continuidade.",
  hot_lead_idle:
    "Olá {{nome}}, tudo bem? Seu atendimento continua disponível em nosso sistema. Caso precise esclarecer dúvidas ou atualizar informações, responda esta mensagem para dar continuidade.",
  returning_customer:
    "Olá {{nome}}, tudo bem? Estamos entrando em contato para dar continuidade ao atendimento iniciado anteriormente. Caso queira retomar, basta responder esta mensagem.",
};

/** Retorna o primeiro nome ou um fallback amigável. */
export function firstName(name: string | null | undefined): string {
  if (!name) return "tudo bem";
  return name.trim().split(/\s+/)[0] || "tudo bem";
}

/** Substitui placeholders {{var}} pelas variáveis fornecidas. */
export function renderTemplate(tpl: string, vars: Record<string, string>): string {
  return tpl.replace(/\{\{(\w+)\}\}/g, (_, k) => vars[k] ?? "");
}

/**
 * O momento está no horário comercial da empresa? Usa o fuso e os dias úteis
 * dela (e feriados nacionais) — o servidor roda em UTC.
 */
export function isWithinBusinessHours(
  s: Pick<
    FollowupSettings,
    "timeZone" | "businessDays" | "businessHoursStart" | "businessHoursEnd" | "businessHoursOnly"
  >,
  now = new Date(),
): boolean {
  return isBusinessTime(now, calendarFor(s));
}
