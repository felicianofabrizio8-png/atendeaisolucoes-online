// Analyzer determinístico v1.
// - Sem LLM.
// - Reutiliza `ai-qualifier.server` (objeções, ready-to-close) e
//   `coach/detectors` (dicionários) para não duplicar heurísticas.
// - Só produz sinais que a lógica existente já sabe extrair com segurança.

import { detectObjections, detectReadyToClose } from "@/lib/ai-qualifier.server";
import type { ConversationRaw, SentimentLabel } from "./ConversationIntelligenceTypes";

// Dicionários controlados (locais e curtos — sem LLM)
const INTENT_DICT: { intent: string; re: RegExp }[] = [
  { intent: "orcamento", re: /\b(or[çc]amento|quanto (custa|fica|sai)|preço|valor|cota[çc][ãa]o)\b/i },
  { intent: "informacao_produto", re: /\b(tamanho|dimens[ãa]o|modelo|tipo|voltagem|garantia|especifica)\b/i },
  { intent: "prazo_entrega", re: /\b(quando (chega|entrega|instala)|prazo|entrega)\b/i },
  { intent: "instalacao", re: /\b(instala[çc][ãa]o|instala[rd])\b/i },
  { intent: "financiamento", re: /\b(parcel|financia|cart[ãa]o|boleto|pix)\b/i },
  { intent: "pos_venda", re: /\b(assist[êe]ncia|defeito|manuten[çc][ãa]o|garantia|reclama)\b/i },
  { intent: "agendamento_visita", re: /\b(agendar|visita|passar (a[íi]|na loja)|hor[áa]rio)\b/i },
];

const BUYING_SIGNAL_DICT: { signal: string; re: RegExp }[] = [
  { signal: "urgencia", re: /\b(hoje|agora|urgente|essa semana|nesta semana|asap)\b/i },
  { signal: "confirmacao_pagamento", re: /\b(pix|boleto|pagamento|manda o link|pode enviar)\b/i },
  { signal: "aceite_condicao", re: /\b(fechado|combinado|pode ser|topei|tudo bem)\b/i },
  { signal: "pergunta_final", re: /\b(quando (posso|conseguem)|falta algo|pr[óo]ximo passo)\b/i },
];

const NEGATIVE_SIGNAL_DICT: { signal: string; re: RegExp }[] = [
  { signal: "desistencia", re: /\b(desisti|n[ãa]o (quero|vou) mais|deixa pra l[áa])\b/i },
  { signal: "insatisfacao", re: /\b(p[ée]ssim|horr[íi]vel|revoltad|absurdo)\b/i },
  { signal: "vai_pensar", re: /\b(vou pensar|preciso pensar|te retorno|depois eu falo)\b/i },
];

const POSITIVE_WORDS = /\b(otimo|ótimo|bom|excelente|obrigado|obrigada|maravilha|perfeito)\b/i;
const NEGATIVE_WORDS = /\b(ruim|p[ée]ssimo|horr[íi]vel|nada bom|decepci)\b/i;

const TOPIC_DICT: { topic: string; re: RegExp }[] = [
  { topic: "piscina_fibra", re: /\bfibra\b/i },
  { topic: "piscina_vinil", re: /\bvinil\b/i },
  { topic: "piscina_alvenaria", re: /\balvenaria\b/i },
  { topic: "aquecimento", re: /\b(aquecedor|aquecimento|solar)\b/i },
  { topic: "cobertura", re: /\b(cobertura|capa|deck)\b/i },
  { topic: "manutencao", re: /\b(manuten[çc][ãa]o|limpeza|filtro|bomba|cloro)\b/i },
];

const ABANDON_DAYS = 14; // conservador

export interface DeterministicOutput {
  primary_intent: string | null;
  intents: string[];
  objections: string[];
  buying_signals: string[];
  negative_signals: string[];
  topics: string[];
  sentiment_label: SentimentLabel | null;
  sentiment_score: number | null;
  confidence: number;
  quality_warnings: string[];
  lifecycle_status:
    | "in_progress"
    | "sold"
    | "lost"
    | "abandoned"
    | "completed";
  quote_detected: boolean;
  sale_detected: boolean;
  loss_detected: boolean;
  first_response_minutes: number | null;
  negotiation_duration_minutes: number | null;
  message_count: number;
  lead_message_count: number;
  agent_message_count: number;
  first_message_at: string | null;
  last_message_at: string | null;
}

export function analyzeDeterministic(
  raw: ConversationRaw,
  sanitizedMessages: { id: string; role: string; text: string; at: string }[]
): DeterministicOutput {
  const leadMsgs = sanitizedMessages.filter((m) => m.role === "lead");
  const agentMsgs = sanitizedMessages.filter((m) => m.role === "agent");
  const first = sanitizedMessages[0] ?? null;
  const last = sanitizedMessages[sanitizedMessages.length - 1] ?? null;

  // primeira resposta do agente após primeira msg do lead
  let firstResponseMin: number | null = null;
  const firstLead = leadMsgs[0];
  if (firstLead) {
    const firstAgentAfter = agentMsgs.find(
      (a) => new Date(a.at).getTime() >= new Date(firstLead.at).getTime()
    );
    if (firstAgentAfter) {
      firstResponseMin =
        (new Date(firstAgentAfter.at).getTime() - new Date(firstLead.at).getTime()) / 60000;
      firstResponseMin = Math.round(firstResponseMin * 10) / 10;
    }
  }

  let negotiationMin: number | null = null;
  if (first && last && first.at !== last.at) {
    negotiationMin = (new Date(last.at).getTime() - new Date(first.at).getTime()) / 60000;
    negotiationMin = Math.round(negotiationMin);
  }

  // dicionários — só sobre textos do LEAD (menos ruído)
  const leadCorpus = leadMsgs.map((m) => m.text).join("\n");
  const objections = detectObjections(leadCorpus);
  const readyToClose = detectReadyToClose(leadCorpus);

  const intents = new Set<string>();
  for (const { intent, re } of INTENT_DICT) if (re.test(leadCorpus)) intents.add(intent);

  const buying = new Set<string>();
  for (const { signal, re } of BUYING_SIGNAL_DICT) if (re.test(leadCorpus)) buying.add(signal);
  if (readyToClose) buying.add("ready_to_close");

  const negative = new Set<string>();
  for (const { signal, re } of NEGATIVE_SIGNAL_DICT) if (re.test(leadCorpus)) negative.add(signal);

  const topics = new Set<string>();
  const fullCorpus = sanitizedMessages.map((m) => m.text).join("\n");
  for (const { topic, re } of TOPIC_DICT) if (re.test(fullCorpus)) topics.add(topic);

  // Sentimento determinístico simples
  const pos = (leadCorpus.match(POSITIVE_WORDS) ?? []).length;
  const neg = (leadCorpus.match(NEGATIVE_WORDS) ?? []).length;
  let sentimentLabel: SentimentLabel | null = null;
  let sentimentScore: number | null = null;
  if (pos + neg > 0) {
    sentimentScore = (pos - neg) / (pos + neg);
    if (sentimentScore > 0.3) sentimentLabel = "positive";
    else if (sentimentScore < -0.3) sentimentLabel = "negative";
    else if (pos > 0 && neg > 0) sentimentLabel = "mixed";
    else sentimentLabel = "neutral";
    sentimentScore = Math.round(sentimentScore * 100) / 100;
  }

  // Lifecycle — só usa dados estruturados
  const isSold = raw.lead_status === "fechado" && Boolean(raw.lead_closed_at);
  const isLost = raw.lead_status === "perdido";
  let lifecycle: DeterministicOutput["lifecycle_status"];
  if (isSold) lifecycle = "sold";
  else if (isLost) lifecycle = "lost";
  else {
    const lastAtMs = last ? new Date(last.at).getTime() : 0;
    const inactiveDays = lastAtMs ? (Date.now() - lastAtMs) / 86400_000 : 0;
    if (inactiveDays >= ABANDON_DAYS) lifecycle = "abandoned";
    else lifecycle = "in_progress";
  }

  const quoteDetected = raw.quote_count > 0;
  const saleDetected = isSold; // NUNCA infere venda de texto
  const lossDetected = isLost;

  // primary_intent = a mais forte (ordem do dicionário)
  const primary = INTENT_DICT.find((d) => intents.has(d.intent))?.intent ?? null;

  // Confiança — heurística conservadora
  let confidence = 0.4;
  if (sanitizedMessages.length >= 4) confidence += 0.1;
  if (intents.size > 0) confidence += 0.1;
  if (lifecycle === "sold" || lifecycle === "lost") confidence += 0.2;
  if (firstResponseMin !== null) confidence += 0.1;
  confidence = Math.min(1, Math.round(confidence * 100) / 100);

  const warnings: string[] = [];
  if (sanitizedMessages.length < 2) warnings.push("very_short_conversation");
  if (!raw.channel) warnings.push("missing_channel");
  if (intents.size === 0 && !isSold && !isLost) warnings.push("no_intent_detected");

  return {
    primary_intent: primary,
    intents: [...intents],
    objections,
    buying_signals: [...buying],
    negative_signals: [...negative],
    topics: [...topics],
    sentiment_label: sentimentLabel,
    sentiment_score: sentimentScore,
    confidence,
    quality_warnings: warnings,
    lifecycle_status: lifecycle,
    quote_detected: quoteDetected,
    sale_detected: saleDetected,
    loss_detected: lossDetected,
    first_response_minutes: firstResponseMin,
    negotiation_duration_minutes: negotiationMin,
    message_count: sanitizedMessages.length,
    lead_message_count: leadMsgs.length,
    agent_message_count: agentMsgs.length,
    first_message_at: first?.at ?? null,
    last_message_at: last?.at ?? null,
  };
}
