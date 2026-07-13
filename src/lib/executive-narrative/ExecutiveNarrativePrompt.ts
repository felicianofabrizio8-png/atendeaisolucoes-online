// ============================================================================
// Prompt e sanitizador do snapshot para a Executive Narrative.
// Garante que o LLM NUNCA recebe PII (nomes, telefones, mensagens, IDs).
// ============================================================================

import type { ExecutiveDashboardBundle } from "@/lib/executive-ai/types";

export const NARRATIVE_SYSTEM_PROMPT = `Você é um CEO Executivo sênior, especializado em gestão comercial, atendimento e marketing digital.

Sua função é produzir uma análise executiva do desempenho da operação com base EXCLUSIVAMENTE no snapshot JSON fornecido.

Regras invioláveis:
- Baseie-se APENAS nos números presentes no snapshot. Nunca invente métricas.
- Quando uma métrica estiver marcada como indisponível, sem dados suficientes, ou o valor for zero por ausência de dados, escreva explicitamente: "Não há dados suficientes para concluir...".
- Trate métricas marcadas como "estimated" como estimativas, nunca como fatos absolutos.
- Nunca cite nomes de clientes, telefones, IDs, conteúdo de mensagens ou qualquer dado pessoal — o snapshot já foi sanitizado, mantenha assim.
- Tom: profissional, objetivo, otimista mas realista. Sem hype, sem exageros, sem clichês de marketing.
- Idioma: Português do Brasil.

Formato de saída: retorne EXCLUSIVAMENTE um objeto JSON válido com esta forma exata:
{
  "greeting": "string curta com saudação contextual + primeiro nome do executivo",
  "summary": "resumo executivo de 120 a 220 palavras em um único parágrafo",
  "priorities": ["até 5 itens ordenados por importância"],
  "opportunities": ["lista curta de 2 a 4 itens"],
  "risks": ["lista curta de 1 a 4 itens"],
  "nextAction": "uma única ação recomendada, específica e acionável"
}

Não inclua nada fora do JSON. Não use markdown. Não use blocos de código.`;

// Sanitiza o snapshot removendo qualquer campo que possa conter PII antes de
// enviar ao LLM. O snapshot base já não expõe telefones/nomes, mas removemos
// IDs e mantemos apenas números e labels agregados por precaução.
export function sanitizeSnapshotForLLM(bundle: ExecutiveDashboardBundle): unknown {
  const m = bundle.metrics;
  return {
    period: bundle.period,
    range: { from: bundle.range.from, to: bundle.range.to, days: bundle.range.days, label: bundle.range.label },
    generatedAt: bundle.generatedAt,
    attendance: m.attendance,
    sales: m.sales,
    followups: m.followups,
    coach: m.coach,
    aiUsage: m.aiUsage,
    campaigns: {
      avgCostPerLead: m.campaigns.avgCostPerLead,
      avgCostPerConversation: m.campaigns.avgCostPerConversation,
      best: m.campaigns.best.map((c) => ({
        name: c.name,
        spend: c.spend,
        leads: c.leads,
        costPerLead: c.costPerLead,
        costPerConversation: c.costPerConversation,
        ctr: c.ctr,
        score: c.score,
      })),
      worst: m.campaigns.worst.map((c) => ({
        name: c.name,
        spend: c.spend,
        leads: c.leads,
        costPerLead: c.costPerLead,
        costPerConversation: c.costPerConversation,
        ctr: c.ctr,
        score: c.score,
      })),
    },
    lossReasons: m.lossReasons,
    evolution: {
      daily: m.evolution.daily.slice(-14),
      weekly: m.evolution.weekly.slice(-8),
      monthly: m.evolution.monthly.slice(-6),
    },
    insights: bundle.insights.map((i) => ({
      category: i.category,
      level: i.level,
      title: i.title,
      description: i.description,
      recommendation: i.recommendation,
      confidence: i.confidence,
    })),
    dataQuality: {
      tablesEmpty: bundle.dataQuality.tablesEmpty,
      unavailableMetrics: bundle.dataQuality.unavailableMetrics,
      estimatedMetrics: bundle.dataQuality.estimatedMetrics,
      warnings: bundle.dataQuality.warnings,
    },
  };
}

export interface PreviousKnowledgeContext {
  previousSnapshotAt: string;
  daysBetween: number | null;
  improvements: string[];
  regressions: string[];
  newFacts: string[];
  summary: string;
}

export function buildUserPrompt(
  sanitized: unknown,
  executiveFirstName: string,
  localHour: number,
  previous?: PreviousKnowledgeContext,
): string {
  const timeOfDay = localHour < 12 ? "manhã" : localHour < 18 ? "tarde" : "noite";
  const historyBlock = previous
    ? `

Memória da análise anterior (${previous.daysBetween ?? "?"} dias atrás, snapshot em ${previous.previousSnapshotAt}):
${JSON.stringify({
  summary: previous.summary,
  improvements: previous.improvements,
  regressions: previous.regressions,
  newFacts: previous.newFacts,
})}

Ao redigir o resumo, quando fizer sentido, comece uma frase com "Desde minha última análise..." e cite melhoras ou pioras concretas dessa memória.`
    : "";

  return `Executivo: ${executiveFirstName}
Momento do dia: ${timeOfDay} (hora local ${localHour}h)

Snapshot executivo (JSON — única fonte de verdade):
${JSON.stringify(sanitized)}${historyBlock}`;
}
