// Copiloto da tela de atendimento.
//
// Em produção o painel de IA chama `/api/ai/suggest`, que exige sessão do
// Supabase. Na branch de design (sem login / sem clientes reais) esse endpoint
// não responde, e um painel de IA que só mostra erro não dá para avaliar.
// Por isso o copiloto tem um motor local determinístico: mesmas entradas,
// mesma resposta, sem rede. Ele lê o que a qualificação já detectou
// (intenção, orçamento, prazo, objeções, temperatura) e o histórico do
// contato, então as respostas acompanham a conversa de verdade.

import type { Conversation, Lead, Message } from "@/data/mock";
import {
  classifyCustomer,
  describeHistory,
  type CustomerHistory,
} from "@/lib/customer-loyalty";

export interface CopilotContext {
  lead: Lead;
  conversation: Conversation;
  messages: Message[];
  history: CustomerHistory;
  summary?: string;
}

export interface CopilotSuggestion {
  /** Mensagem pronta para enviar ao cliente. */
  text: string;
  /** Por que a IA sugeriu isso — mostrado abaixo do balão. */
  rationale: string;
  /** Rótulo curto da jogada ("Fechamento", "Quebra de objeção"…). */
  play: string;
  /** 0–100: confiança da sugestão, alimenta a barrinha do painel. */
  confidence: number;
}

const BRL = (v: number) =>
  v.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });

function firstName(full: string): string {
  return full.split(/\s+/)[0] ?? full;
}

function lastLeadMessage(messages: Message[]): Message | undefined {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === "lead") return messages[i];
  }
  return undefined;
}

function hoursSinceLastLeadMessage(messages: Message[], now: number): number {
  const last = lastLeadMessage(messages);
  if (!last) return 0;
  return (now - new Date(last.at).getTime()) / 3_600_000;
}

/**
 * Próxima mensagem sugerida. A ordem das regras é a prioridade comercial:
 * objeção aberta > pronto para fechar > silêncio longo > cliente fiel >
 * lead novo > continuidade.
 */
export function suggestNextMessage(
  ctx: CopilotContext,
  now = Date.now(),
): CopilotSuggestion {
  const { lead, conversation, messages, history } = ctx;
  const nome = firstName(lead.name);
  const tier = classifyCustomer(history, now).tier;
  const objection = conversation.detectedObjections?.[0];
  const silentHours = hoursSinceLastLeadMessage(messages, now);
  const valor = lead.estimatedValue ? BRL(lead.estimatedValue) : "o valor combinado";

  if (lead.status === "perdido") {
    return {
      play: "Reabertura",
      confidence: 46,
      rationale:
        "Lead marcado como perdido. A jogada aqui não é insistir no preço, é deixar a porta aberta e pedir permissão para voltar mais pra frente.",
      text: `${nome}, sem problema nenhum — obrigado por ter considerado a gente! Se a instalação não sair como esperado ou você precisar de manutenção depois, me chama que eu resolvo. Posso te mandar uma condição especial quando abrirmos a agenda de ${lead.product ?? "obras"}?`,
    };
  }

  if (objection) {
    return {
      play: "Quebra de objeção",
      confidence: 78,
      rationale: `A qualificação detectou a objeção "${objection}". Reconhecer antes de contra-argumentar reduz a chance de o cliente sumir.`,
      text: `${nome}, entendi sua preocupação. Deixa eu te mostrar o que está dentro dos ${valor}: material, instalação, garantia de 5 anos e o kit de limpeza. Se o que pesou foi o valor de entrada, eu consigo dividir em 10x ou montar uma versão enxuta. Qual das duas te ajuda mais?`,
    };
  }

  if (conversation.leadReadyToClose) {
    return {
      play: "Fechamento",
      confidence: 92,
      rationale: `Lead marcado como pronto para fechar (score ${conversation.leadScore ?? "alto"}). ${conversation.purchaseTiming ? `Prazo declarado: ${conversation.purchaseTiming}.` : ""} Peça a decisão de forma direta.`,
      text: `${nome}, está tudo certo do meu lado! Te mando o contrato agora por aqui mesmo — é só conferir e assinar digital. Confirma pra mim se o nome e o endereço da nota são os mesmos do cadastro que eu já disparo?`,
    };
  }

  if (silentHours >= 24) {
    const dias = Math.floor(silentHours / 24);
    return {
      play: "Reativação",
      confidence: 64,
      rationale: `Sem resposta do cliente há ${dias} dia${dias === 1 ? "" : "s"}. Follow-up com novidade converte melhor do que "tudo bem?".`,
      text: `${nome}, passando aqui rapidinho 👋 Consegui segurar a condição de ${valor} até o fim da semana e ainda tenho uma vaga na agenda de instalação deste mês. Quer que eu reserve no seu nome?`,
    };
  }

  if (tier === "fiel" || tier === "cliente") {
    return {
      play: "Relacionamento",
      confidence: 81,
      rationale: `Cliente ${tier === "fiel" ? "fiel" : "que já comprou"} — ${describeHistory(history, now)}. Reconhecer o histórico costuma encurtar a negociação.`,
      text: `${nome}, que bom te ver por aqui de novo! Como você já é cliente da casa, eu consigo aplicar a condição de recompra em ${lead.product ?? "esse serviço"} e priorizar sua agenda de instalação. Quer que eu já monte o orçamento nesse formato?`,
    };
  }

  if (tier === "novo" && messages.length <= 4) {
    return {
      play: "Qualificação",
      confidence: 70,
      rationale:
        "Primeiro contato e ainda faltam dados para orçar (espaço disponível, prazo e cidade). Uma pergunta por vez mantém a resposta alta.",
      text: `Oi ${nome}! Que bom que você chamou 😊 Pra eu te passar um valor certeiro em vez de uma faixa, me conta uma coisa: qual o espaço que você tem disponível${conversation.detectedCity ? ` aí em ${conversation.detectedCity}` : ""}? Com essa medida eu já te mando o orçamento fechado hoje.`,
    };
  }

  return {
    play: "Continuidade",
    confidence: 66,
    rationale: `Conversa em andamento sobre ${lead.product ?? "o pedido"}. ${conversation.detectedIntent ? `Intenção detectada: ${conversation.detectedIntent}.` : ""} Avançar para o próximo passo concreto evita que ela esfrie.`,
    text: `${nome}, da minha parte está tudo pronto pra seguir com ${lead.product ?? "o seu pedido"}. Te mando o orçamento detalhado agora e, se fizer sentido, já agendo a visita técnica sem compromisso. Qual dia da semana fica melhor pra você?`,
  };
}

export interface CopilotAnswer {
  text: string;
  /** Sugestões de perguntas seguintes, mostradas como chips. */
  followUps: string[];
}

const QUICK_PROMPTS = [
  "Resuma essa conversa",
  "Esse cliente está pronto pra fechar?",
  "Qual a melhor próxima mensagem?",
  "Quebra a objeção dele",
  "Ele já comprou com a gente?",
] as const;

export function quickPrompts(): readonly string[] {
  return QUICK_PROMPTS;
}

function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
}

/** Motor local de perguntas e respostas sobre a conversa aberta. */
export function answerQuestion(
  question: string,
  ctx: CopilotContext,
  now = Date.now(),
): CopilotAnswer {
  const q = normalize(question);
  const { lead, conversation, messages, history, summary } = ctx;
  const nome = firstName(lead.name);
  const tierInfo = classifyCustomer(history, now);
  const leadMsgs = messages.filter((m) => m.role === "lead").length;
  const agentMsgs = messages.filter((m) => m.role === "agent").length;

  if (/resum|sobre o que|contexto|historia da conversa/.test(q)) {
    return {
      text:
        `${summary ?? `Conversa sobre ${lead.product ?? "atendimento"} com ${nome}.`}\n\n` +
        `• Canal: ${lead.channel} · ${conversation.detectedCity ?? "cidade não informada"}/${conversation.detectedState ?? "--"}\n` +
        `• Intenção: ${conversation.detectedIntent ?? "ainda não detectada"}\n` +
        `• Orçamento: ${conversation.detectedBudget ?? (lead.estimatedValue ? `estimado em ${BRL(lead.estimatedValue)}` : "não informado")}\n` +
        `• Prazo: ${conversation.purchaseTiming ?? "não informado"}\n` +
        `• Troca: ${leadMsgs} mensagens do cliente e ${agentMsgs} suas.`,
      followUps: ["Esse cliente está pronto pra fechar?", "Qual a melhor próxima mensagem?"],
    };
  }

  if (/pronto|fechar|fechamento|comprar agora|quente/.test(q)) {
    const pronto = conversation.leadReadyToClose || conversation.leadTemperature === "quente";
    return {
      text: pronto
        ? `Sim — ${nome} está no ponto. Score ${conversation.leadScore ?? "alto"}, temperatura ${conversation.leadTemperature ?? "quente"}${conversation.purchaseTiming ? ` e prazo declarado: ${conversation.purchaseTiming}` : ""}. Peça a decisão nesta mensagem: mande o contrato e confirme os dados da nota. Esperar mais uma rodada de perguntas só esfria.`
        : `Ainda não. ${nome} está ${conversation.leadTemperature ?? "morno"} (score ${conversation.leadScore ?? "baixo"})${conversation.detectedObjections?.length ? ` e tem objeção aberta: ${conversation.detectedObjections.join(", ")}` : ""}. Antes de falar em contrato, resolva ${conversation.detectedBudget ? "o valor" : "o que falta de informação"} e confirme o prazo da obra.`,
      followUps: ["Qual a melhor próxima mensagem?", "Quebra a objeção dele"],
    };
  }

  if (/objec|caro|desconto|preco|preço|valor/.test(q)) {
    const obj = conversation.detectedObjections?.[0];
    return {
      text: obj
        ? `A objeção registrada é: "${obj}". Não baixe o preço de cara — primeiro recomponha o valor. Liste o que está incluso (material, instalação, garantia, kit), depois ofereça duas saídas: parcelamento maior OU escopo enxuto. Quem escolhe entre duas opções decide; quem recebe desconto pede mais desconto.`
        : `Nenhuma objeção explícita foi detectada nessa conversa até agora. ${lead.estimatedValue ? `O ticket em jogo é ${BRL(lead.estimatedValue)}.` : ""} Se quiser antecipar, ancore o valor antes do preço: mostre a garantia e o prazo de instalação na mesma mensagem em que envia o orçamento.`,
      followUps: ["Qual a melhor próxima mensagem?", "Resuma essa conversa"],
    };
  }

  if (/ja comprou|historico|fiel|novo|cliente antigo|recompra/.test(q)) {
    return {
      text: `${nome} é **${tierInfo.label}** — ${tierInfo.reason}.\n${describeHistory(history, now)}.\n\n${
        tierInfo.tier === "fiel" || tierInfo.tier === "cliente"
          ? "Use isso na abertura: citar a compra anterior encurta a negociação e justifica condição de recompra."
          : "Como ainda não há compra fechada, foque em reduzir risco: garantia, portfólio de obras entregues e visita técnica sem compromisso."
      }`,
      followUps: ["Qual a melhor próxima mensagem?", "Esse cliente está pronto pra fechar?"],
    };
  }

  if (/proxima mensagem|o que respondo|o que eu mando|sugest/.test(q)) {
    const s = suggestNextMessage(ctx, now);
    return {
      text: `**${s.play}** (${s.confidence}% de confiança)\n\n"${s.text}"\n\n_${s.rationale}_`,
      followUps: ["Deixa mais curto", "Resuma essa conversa"],
    };
  }

  if (/curto|resumid|menor|direto/.test(q)) {
    const s = suggestNextMessage(ctx, now);
    const short = s.text.split(/(?<=[.!?])\s+/).slice(0, 2).join(" ");
    return {
      text: `Versão curta:\n\n"${short}"`,
      followUps: ["Qual a melhor próxima mensagem?"],
    };
  }

  if (/quando|prazo|entrega|agenda/.test(q)) {
    return {
      text: conversation.purchaseTiming
        ? `O prazo que ${nome} declarou é: ${conversation.purchaseTiming}. Trabalhe a mensagem em cima dessa data — ela é a melhor alavanca de urgência que você tem, e é honesta porque partiu do cliente.`
        : `${nome} ainda não declarou prazo. Pergunte de forma concreta ("a obra começa em qual semana?") — sem data, o orçamento fica em aberto e a conversa esfria.`,
      followUps: ["Qual a melhor próxima mensagem?"],
    };
  }

  return {
    text: `Não tenho uma resposta pronta pra isso, mas com base nesta conversa: ${nome} é ${tierInfo.label.toLowerCase()}, está ${conversation.leadTemperature ?? "em qualificação"}${lead.product ? ` e o interesse é ${lead.product}` : ""}. Pergunte sobre resumo, prontidão para fechar, objeções, histórico ou a próxima mensagem que eu respondo com detalhe.`,
    followUps: [...QUICK_PROMPTS].slice(0, 3),
  };
}
