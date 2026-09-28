// Base de clientes SIMULADOS para desenhar/validar a tela de atendimento.
//
// Por que existe: a branch de design não tem clientes reais, então a tela nova
// ficaria vazia e impossível de avaliar. Estes dados vivem SÓ em memória no
// navegador — nada aqui é escrito no Supabase e nada aqui aparece quando a
// empresa logada já tem conversas reais (ver `useAtendimentoData`).
//
// Todos os horários são relativos ao `now` recebido, então a fila sempre
// parece "viva" independentemente de quando o app for aberto.

import type { Conversation, Lead, Message } from "@/data/mock";
import type { CustomerHistory } from "@/lib/customer-loyalty";

export interface DemoContact {
  lead: Lead;
  conversation: Conversation;
  messages: Message[];
  history: CustomerHistory;
  /** Matiz usada no avatar gerado — mantém a lista colorida sem precisar de fotos. */
  hue: number;
}

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

/** Um turno do diálogo. O terceiro item é "há quantos minutos" a mensagem caiu. */
type Turn = [role: Message["role"], text: string, minutesAgo: number];

interface ContactSpec {
  id: string;
  name: string;
  phone?: string;
  handle?: string;
  channel: Lead["channel"];
  status: Lead["status"];
  city: string;
  state: string;
  product: string;
  value?: number;
  tags: string[];
  hue: number;
  /** Há quantos minutos chegou a última mensagem da conversa. */
  lastMessageMinutesAgo: number;
  awaitingReply: boolean;
  unread?: number;
  temperature?: "frio" | "morno" | "quente";
  score?: number;
  readyToClose?: boolean;
  aiStatus?: string;
  intent?: string;
  budget?: string;
  timing?: string;
  objections?: string[];
  summary: string;
  history: {
    firstContactDaysAgo: number;
    totalConversations: number;
    closedDeals: number;
    lastPurchaseDaysAgo?: number;
    totalSpent?: number;
  };
  /** Diálogo em ordem cronológica. O último item é a mensagem mais recente. */
  turns: Turn[];
}

const SPECS: ContactSpec[] = [
  {
    id: "d1",
    name: "Lilian Prado",
    phone: "+5511984420117",
    channel: "whatsapp",
    status: "quente",
    city: "Campinas",
    state: "SP",
    product: "Piscina 6x3 em fibra",
    value: 42800,
    tags: ["fibra", "obra iniciada"],
    hue: 268,
    lastMessageMinutesAgo: 4,
    awaitingReply: true,
    unread: 2,
    temperature: "quente",
    score: 51,
    readyToClose: true,
    aiStatus: "aguardando_humano",
    intent: "Fechar o pedido ainda nesta semana",
    budget: "Até R$ 45 mil, quer parcelar em 10x",
    timing: "Obra começa no dia 28",
    summary:
      "Já visitou o showroom, escolheu o modelo 6x3 em fibra e pediu o contrato. Quer saber se o prazo de entrega cabe na obra que começa dia 28.",
    history: {
      firstContactDaysAgo: 3,
      totalConversations: 1,
      closedDeals: 0,
    },
    turns: [
      ["lead", "Oi! Vi o modelo de 6x3 no Instagram de vocês, ainda está disponível?", 190],
      ["agent", "Oi Lilian! Está sim 😊 Esse é o nosso campeão de vendas. Você já tem o espaço preparado?", 176],
      ["lead", "Tenho, o pedreiro começa a escavação dia 28.", 150],
      ["agent", "Perfeito. Fechando até sexta eu consigo garantir a entrega antes disso.", 96],
      ["lead", "Fechado então! Me manda o contrato que eu assino hoje ainda.", 12],
      ["lead", "E consigo parcelar em 10x?", 4],
    ],
  },
  {
    id: "d2",
    name: "Angela Bertoldi",
    phone: "+5511971138840",
    channel: "whatsapp",
    status: "quente",
    city: "Valinhos",
    state: "SP",
    product: "Aquecedor solar + capa térmica",
    value: 9600,
    tags: ["aquecimento", "indicação"],
    hue: 12,
    lastMessageMinutesAgo: 26,
    awaitingReply: true,
    unread: 1,
    temperature: "quente",
    score: 48,
    aiStatus: "pre_atendido_ia",
    intent: "Aquecer a piscina antes do verão",
    budget: "R$ 8 a 10 mil",
    timing: "Quer instalado até outubro",
    summary:
      "Cliente antiga (comprou a piscina em 2023) voltando para o aquecimento. Pergunta sobre brindes porque indicou duas amigas.",
    history: {
      firstContactDaysAgo: 880,
      totalConversations: 4,
      closedDeals: 2,
      lastPurchaseDaysAgo: 410,
      totalSpent: 51200,
    },
    turns: [
      ["lead", "Bom dia! Sou cliente de vocês desde 2023, lembram? 😄", 240],
      ["agent", "Claro que lembro, Angela! Piscina 8x4 com prainha, certo?", 232],
      ["lead", "Essa mesma! Agora quero aquecer ela pro verão.", 210],
      ["agent", "Consigo vários brindes pra vcs tbm — capa térmica entra de cortesia no combo solar.", 60],
      ["lead", "Adorei! E já indiquei duas amigas, rende alguma coisa? 😅", 26],
    ],
  },
  {
    id: "d3",
    name: "Angélica C. Souza",
    phone: "+5519998210043",
    channel: "whatsapp",
    status: "morno",
    city: "Indaiatuba",
    state: "SP",
    product: "Filtro de areia + bomba 1/2cv",
    value: 3150,
    tags: ["manutenção", "orçamento enviado"],
    hue: 190,
    lastMessageMinutesAgo: 118,
    awaitingReply: true,
    temperature: "morno",
    score: 34,
    aiStatus: "pre_atendido_ia",
    intent: "Trocar o filtro que parou de funcionar",
    budget: "Ainda comparando preço",
    timing: "Nas próximas duas semanas",
    objections: ["Achou o valor acima do esperado"],
    summary:
      "Filtro atual parou. Orçamento de R$ 3.150 enviado, achou caro e pediu para comparar com um modelo menor.",
    history: {
      firstContactDaysAgo: 46,
      totalConversations: 2,
      closedDeals: 0,
    },
    turns: [
      ["lead", "Meu filtro parou de rodar, vocês fazem troca?", 320],
      ["agent", "Fazemos sim! O filtro de areia é o equipamento responsável por filtrar e manter a água cristalina — te mando o orçamento.", 300],
      ["agent", "Orçamento enviado: filtro + bomba 1/2cv instalados por R$ 3.150.", 240],
      ["lead", "Nossa, achei um pouco salgado. Tem opção mais em conta?", 118],
    ],
  },
  {
    id: "d4",
    name: "Denilson Ramos",
    phone: "+5511993310087",
    channel: "whatsapp",
    status: "quente",
    city: "Jundiaí",
    state: "SP",
    product: "Piscina 8x4 com prainha",
    value: 68500,
    tags: ["alto ticket", "prainha"],
    hue: 142,
    lastMessageMinutesAgo: 168,
    awaitingReply: false,
    temperature: "quente",
    score: 45,
    readyToClose: true,
    intent: "Piscina completa com aquecimento",
    budget: "R$ 70 mil aprovados pelo banco",
    timing: "Assina na segunda-feira",
    summary:
      "Financiamento aprovado. Falta só definir a cor do revestimento e agendar a visita técnica.",
    history: {
      firstContactDaysAgo: 21,
      totalConversations: 1,
      closedDeals: 0,
    },
    turns: [
      ["lead", "Quero uma piscina grande, com prainha e aquecida. Tem como?", 900],
      ["agent", "Tem sim! O modelo 8x4 com prainha atende direitinho. Aquecimento entra como combo.", 880],
      ["lead", "Banco aprovou o financiamento hoje 🙌", 300],
      ["agent", "*Brindes inclusos:* 💧 Piscina preparada para aquecedor; 💧 Led RGB; 💧 Kit de limpeza completo.", 168],
    ],
  },
  {
    id: "d5",
    name: "Antonio Carlos Caricati",
    phone: "+5511987770412",
    channel: "whatsapp",
    status: "aguardando",
    city: "Itatiba",
    state: "SP",
    product: "Reforma de revestimento (vinil)",
    value: 14200,
    tags: ["reforma", "recompra"],
    hue: 46,
    lastMessageMinutesAgo: 246,
    awaitingReply: true,
    temperature: "morno",
    score: 48,
    intent: "Trocar o vinil da piscina de 2019",
    budget: "Até R$ 15 mil",
    timing: "Antes do Natal",
    summary:
      "Comprou a piscina em 2019 e o deck em 2022. Agora quer trocar o vinil. Pediu para retomar o orçamento.",
    history: {
      firstContactDaysAgo: 2400,
      totalConversations: 5,
      closedDeals: 2,
      lastPurchaseDaysAgo: 1100,
      totalSpent: 73900,
    },
    turns: [
      ["lead", "Boa tarde! Vocês trocam o vinil de piscina antiga?", 400],
      ["agent", "Trocamos sim, Antonio! A sua é a 7x3,5 que instalamos em 2019, certo?", 380],
      ["lead", "Isso mesmo, boa memória 👏", 330],
      ["agent", "Te mandei o orçamento da troca completa. Qualquer dúvida me chama!", 300],
      ["lead", "🙏", 246],
    ],
  },
  {
    id: "d6",
    name: "Janaína Ferro",
    handle: "@janaferro",
    channel: "instagram",
    status: "novo",
    city: "Bragança Paulista",
    state: "SP",
    product: "Spa 4 lugares",
    value: 22400,
    tags: ["spa", "veio do reels"],
    hue: 320,
    lastMessageMinutesAgo: 302,
    awaitingReply: true,
    unread: 3,
    temperature: "morno",
    score: 30,
    aiStatus: "pre_atendido_ia",
    intent: "Spa para a área gourmet",
    timing: "Sem pressa, pesquisando",
    summary:
      "Chegou pelo Reels do spa iluminado. Primeira conversa, ainda descobrindo preço e prazo.",
    history: {
      firstContactDaysAgo: 0,
      totalConversations: 1,
      closedDeals: 0,
    },
    turns: [
      ["lead", "Oi! Vi o vídeo do spa com led, quanto fica?", 320],
      ["agent", "Oi Janaína! O spa de 4 lugares sai a partir de R$ 22.400 instalado 💧", 314],
      ["lead", "E cabe numa área de 3x3?", 308],
      ["lead", "Vocês entregam em Bragança?", 302],
    ],
  },
  {
    id: "d7",
    name: "Patrícia Menezes",
    phone: "+5519993440021",
    channel: "whatsapp",
    status: "morno",
    city: "Americana",
    state: "SP",
    product: "Tratamento e limpeza mensal",
    value: 480,
    tags: ["recorrência", "plano mensal"],
    hue: 210,
    lastMessageMinutesAgo: 320,
    awaitingReply: false,
    temperature: "morno",
    score: 40,
    intent: "Contratar plano de manutenção",
    budget: "R$ 400 a 500 por mês",
    timing: "Quer começar no próximo mês",
    summary:
      "Cliente de manutenção há dois anos, renovando o plano mensal. Perguntou se o produto de tratamento entra no pacote.",
    history: {
      firstContactDaysAgo: 760,
      totalConversations: 9,
      closedDeals: 6,
      lastPurchaseDaysAgo: 32,
      totalSpent: 11800,
    },
    turns: [
      ["lead", "Oi! Quero renovar o plano de manutenção 😊", 420],
      ["agent", "Oi Patrícia! Claro. O plano mensal segue R$ 480 com 2 visitas.", 400],
      ["lead", "O cloro e o clarificante já vêm inclusos né?", 330],
      ["agent", "Vêm sim! Produto + mão de obra, tudo no mesmo valor.", 320],
    ],
  },
  {
    id: "d8",
    name: "Marcos Vinícius",
    phone: "+5511995512278",
    channel: "whatsapp",
    status: "frio",
    city: "Atibaia",
    state: "SP",
    product: "Piscina 5x2,5 em fibra",
    value: 31900,
    tags: ["sem resposta", "reaquecer"],
    hue: 20,
    lastMessageMinutesAgo: 3 * 24 * 60,
    awaitingReply: true,
    temperature: "frio",
    score: 18,
    objections: ["Sumiu depois do preço"],
    summary:
      "Recebeu o orçamento e sumiu há 3 dias. Bom candidato para campanha de reativação.",
    history: {
      firstContactDaysAgo: 12,
      totalConversations: 1,
      closedDeals: 0,
    },
    turns: [
      ["lead", "Qual o valor da 5x2,5 instalada?", 5000],
      ["agent", "Sai R$ 31.900 com instalação e kit de limpeza incluso 💧", 4600],
      ["agent", "Conseguiu ver o orçamento, Marcos?", 4320],
    ],
  },
  {
    id: "d9",
    name: "Solário Piscinas — Fabrizio",
    phone: "+5511970001122",
    channel: "whatsapp",
    status: "fechado",
    city: "Vinhedo",
    state: "SP",
    product: "Deck de madeira + iluminação",
    value: 17600,
    tags: ["venda fechada", "pós-venda"],
    hue: 158,
    lastMessageMinutesAgo: 2 * 24 * 60,
    awaitingReply: false,
    temperature: "quente",
    score: 62,
    summary:
      "Venda fechada na semana passada. Agora é pós-venda: agendamento da instalação do deck.",
    history: {
      firstContactDaysAgo: 520,
      totalConversations: 6,
      closedDeals: 3,
      lastPurchaseDaysAgo: 7,
      totalSpent: 96400,
    },
    turns: [
      ["lead", "Fechado! Pode emitir a nota 🙌", 4400],
      ["agent", "Show! Nota emitida e instalação agendada pra quinta.", 4300],
      ["agent", "😊", 2880],
    ],
  },
  {
    id: "d10",
    name: "Renata Kobayashi",
    handle: "@renata.koba",
    channel: "instagram",
    status: "novo",
    city: "Louveira",
    state: "SP",
    product: "Piscina 4x2 compacta",
    value: 19900,
    tags: ["primeiro contato", "comentário"],
    hue: 292,
    lastMessageMinutesAgo: 9 * 60,
    awaitingReply: true,
    unread: 1,
    temperature: "frio",
    score: 12,
    summary:
      "Comentou em um post perguntando o preço. Ainda não respondeu à mensagem no direct.",
    history: {
      firstContactDaysAgo: 0,
      totalConversations: 1,
      closedDeals: 0,
    },
    turns: [
      ["lead", "quanto custa a menorzinha? 👀", 560],
      ["agent", "Oi Renata! A 4x2 sai R$ 19.900 instalada. Te mando as fotos?", 545],
      ["lead", "manda sim", 540],
    ],
  },
  {
    id: "d11",
    name: "Cláudio Bianchi",
    phone: "+5511988004455",
    channel: "facebook",
    status: "perdido",
    city: "Louveira",
    state: "SP",
    product: "Piscina 7x3,5 alvenaria",
    value: 54000,
    tags: ["perdido", "preço"],
    hue: 0,
    lastMessageMinutesAgo: 6 * 24 * 60,
    awaitingReply: false,
    temperature: "frio",
    score: -800,
    objections: ["Fechou com concorrente por preço"],
    summary:
      "Fechou com um concorrente por R$ 6 mil a menos. Vale acompanhar para a próxima obra.",
    history: {
      firstContactDaysAgo: 60,
      totalConversations: 2,
      closedDeals: 0,
    },
    turns: [
      ["lead", "Recebi uma proposta mais barata de outra empresa.", 9000],
      ["agent", "Entendo, Cláudio. Consigo revisar com brinde de aquecimento, topa?", 8900],
      ["lead", "Já assinei com eles, obrigado pela atenção.", 8640],
    ],
  },
  {
    id: "d12",
    name: "Eliane Tavares",
    phone: "+5519991230098",
    channel: "whatsapp",
    status: "aguardando",
    city: "Paulínia",
    state: "SP",
    product: "Cascata + iluminação RGB",
    value: 5800,
    tags: ["acabamento", "recompra"],
    hue: 250,
    lastMessageMinutesAgo: 22 * 60,
    awaitingReply: true,
    temperature: "morno",
    score: 36,
    intent: "Adicionar cascata na piscina existente",
    budget: "Até R$ 6 mil",
    timing: "Quer para o aniversário do filho",
    summary:
      "Comprou a piscina em 2024 e volta agora para a cascata. Quer entrega antes do aniversário do filho.",
    history: {
      firstContactDaysAgo: 600,
      totalConversations: 3,
      closedDeals: 1,
      lastPurchaseDaysAgo: 540,
      totalSpent: 38700,
    },
    turns: [
      ["lead", "Oi! Vocês instalam cascata em piscina que já existe?", 1500],
      ["agent", "Instalamos sim, Eliane! Na sua a cascata de inox fica linda.", 1440],
      ["lead", "Preciso pro dia 4, dá tempo?", 1320],
    ],
  },
];

function iso(now: number, minutesAgo: number): string {
  return new Date(now - minutesAgo * MIN).toISOString();
}

function buildContact(spec: ContactSpec, now: number): DemoContact {
  const lastAt = now - spec.lastMessageMinutesAgo * MIN;

  const messages: Message[] = spec.turns.map(([role, text, minutesAgo], i) => ({
    id: `${spec.id}-m${i}`,
    conversationId: `${spec.id}-conv`,
    role,
    text,
    at: iso(now, minutesAgo),
    deliveryStatus: role === "agent" ? ("read" as const) : null,
  }));

  const lead: Lead = {
    id: `${spec.id}-lead`,
    name: spec.name,
    phone: spec.phone,
    handle: spec.handle,
    channel: spec.channel,
    status: spec.status,
    tags: spec.tags,
    estimatedValue: spec.value,
    product: spec.product,
    createdAt: iso(now, spec.history.firstContactDaysAgo * 24 * 60),
    ...(spec.status === "fechado"
      ? { closedAt: iso(now, 7 * 24 * 60), closedValue: spec.value }
      : {}),
    ...(spec.status === "perdido"
      ? { lostAt: iso(now, 6 * 24 * 60), lossReason: "preço" }
      : {}),
  };

  const conversation: Conversation = {
    id: `${spec.id}-conv`,
    leadId: lead.id,
    channel: spec.channel,
    lastMessageAt: new Date(lastAt).toISOString(),
    unread: spec.unread ?? 0,
    awaitingReply: spec.awaitingReply,
    slaBreached: spec.awaitingReply && spec.lastMessageMinutesAgo > 30,
    interactionType: "direct_message",
    aiStatus: spec.aiStatus ?? null,
    detectedCity: spec.city,
    detectedState: spec.state,
    detectedIntent: spec.intent ?? null,
    detectedInterest: spec.product,
    detectedBudget: spec.budget ?? null,
    purchaseTiming: spec.timing ?? null,
    leadTemperature: spec.temperature ?? null,
    leadScore: spec.score,
    leadReadyToClose: spec.readyToClose ?? false,
    detectedObjections: spec.objections ?? [],
  };

  const history: CustomerHistory = {
    firstContactAt: iso(now, spec.history.firstContactDaysAgo * 24 * 60),
    totalConversations: spec.history.totalConversations,
    closedDeals: spec.history.closedDeals,
    lastPurchaseAt:
      spec.history.lastPurchaseDaysAgo != null
        ? iso(now, spec.history.lastPurchaseDaysAgo * 24 * 60)
        : null,
    totalSpent: spec.history.totalSpent,
  };

  return { lead, conversation, messages, history, hue: spec.hue };
}

/** Resumo gerado pela "IA" do demo — no app real vem do campo de qualificação. */
export const DEMO_SUMMARIES: Record<string, string> = Object.fromEntries(
  SPECS.map((s) => [`${s.id}-conv`, s.summary]),
);

export function buildDemoInbox(now = Date.now()): DemoContact[] {
  return SPECS.map((spec) => buildContact(spec, now)).sort(
    (a, b) =>
      new Date(b.conversation.lastMessageAt).getTime() -
      new Date(a.conversation.lastMessageAt).getTime(),
  );
}

export const DEMO_DAY_MS = DAY;
export const DEMO_HOUR_MS = HOUR;
