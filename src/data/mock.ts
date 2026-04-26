// Mock data for Atende Ai! — realistic, but generic enough to fit any business.
// Replace with real backend later.

export type Channel = "whatsapp" | "instagram" | "facebook";
export type LeadStatus = "novo" | "aguardando" | "quente" | "morno" | "frio" | "fechado" | "perdido";
export type MessageRole = "lead" | "agent" | "system";

export interface Message {
  id: string;
  conversationId: string;
  role: MessageRole;
  text: string;
  at: string; // ISO
}

export interface NextAction {
  label: string;
  dueAt: string; // ISO
}

export interface Lead {
  id: string;
  name: string;
  phone?: string;
  handle?: string;
  channel: Channel;
  status: LeadStatus;
  tags: string[];
  estimatedValue?: number; // BRL
  product?: string;
  nextAction?: NextAction;
  assignedTo?: string;
  createdAt: string;
  closedAt?: string;
  closedValue?: number;
  lostAt?: string;
  lossReason?: string;
}

export interface Conversation {
  id: string;
  leadId: string;
  channel: Channel;
  lastMessageAt: string;
  unread: number;
  awaitingReply: boolean; // last message was from lead and not answered
  slaBreached: boolean;
}

const now = Date.now();
const minutesAgo = (m: number) => new Date(now - m * 60_000).toISOString();
const hoursAgo = (h: number) => new Date(now - h * 3_600_000).toISOString();
const inHours = (h: number) => new Date(now + h * 3_600_000).toISOString();

export const leads: Lead[] = [
  {
    id: "l1",
    name: "Marina Souza",
    phone: "+55 11 98123-4521",
    channel: "whatsapp",
    status: "quente",
    tags: ["pediu preço", "piscina fibra"],
    estimatedValue: 28500,
    product: "Piscina de fibra 6x3",
    nextAction: { label: "Enviar orçamento revisado", dueAt: inHours(2) },
    assignedTo: "Você",
    createdAt: hoursAgo(26),
  },
  {
    id: "l2",
    name: "Carlos Tavares",
    phone: "+55 21 99988-1122",
    channel: "whatsapp",
    status: "novo",
    tags: ["meta ads"],
    estimatedValue: 14200,
    product: "Aquecedor solar",
    createdAt: minutesAgo(38),
  },
  {
    id: "l3",
    name: "@bia.lifestyle",
    handle: "@bia.lifestyle",
    channel: "instagram",
    status: "aguardando",
    tags: ["dúvida técnica"],
    estimatedValue: 9800,
    product: "Troca de vinil",
    nextAction: { label: "Confirmar medidas", dueAt: hoursAgo(1) },
    createdAt: hoursAgo(72),
  },
  {
    id: "l4",
    name: "Ricardo Mendes",
    phone: "+55 47 98877-6655",
    channel: "facebook",
    status: "morno",
    tags: ["follow-up"],
    estimatedValue: 6400,
    product: "Acessórios",
    nextAction: { label: "Ligar para alinhar entrega", dueAt: inHours(5) },
    createdAt: hoursAgo(120),
  },
  {
    id: "l5",
    name: "Fernanda Lima",
    phone: "+55 11 97766-5544",
    channel: "whatsapp",
    status: "quente",
    tags: ["negociação", "desconto"],
    estimatedValue: 42000,
    product: "Spa 4 lugares + instalação",
    nextAction: { label: "Fechar proposta hoje", dueAt: inHours(4) },
    createdAt: hoursAgo(8),
  },
  {
    id: "l6",
    name: "João Pedro",
    phone: "+55 31 98080-2020",
    channel: "whatsapp",
    status: "frio",
    tags: ["sem retorno"],
    estimatedValue: 3200,
    product: "Tratamento de água",
    createdAt: hoursAgo(240),
  },
  {
    id: "l7",
    name: "Ana Beatriz",
    handle: "@ana.beatriz.dec",
    channel: "instagram",
    status: "novo",
    tags: [],
    estimatedValue: 18700,
    product: "Piscina de vinil 5x2,5",
    createdAt: minutesAgo(12),
  },
  {
    id: "l8",
    name: "Helena Costa",
    phone: "+55 11 95544-3322",
    channel: "whatsapp",
    status: "fechado",
    tags: ["fechou rápido"],
    estimatedValue: 27500,
    closedValue: 27500,
    closedAt: hoursAgo(48),
    product: "Piscina de fibra 6x3",
    createdAt: hoursAgo(96),
  },
  {
    id: "l9",
    name: "Lucas Andrade",
    phone: "+55 11 94433-2211",
    channel: "whatsapp",
    status: "fechado",
    tags: ["upgrade"],
    estimatedValue: 14200,
    closedValue: 12900,
    closedAt: hoursAgo(20),
    product: "Aquecedor solar para piscina pequena",
    createdAt: hoursAgo(72),
  },
  {
    id: "l10",
    name: "Patricia Nunes",
    phone: "+55 11 93322-1100",
    channel: "whatsapp",
    status: "fechado",
    tags: [],
    estimatedValue: 4800,
    closedValue: 4800,
    closedAt: hoursAgo(5),
    product: "Troca de vinil 4x2",
    createdAt: hoursAgo(50),
  },
  {
    id: "l11",
    name: "Gabriel Souza",
    phone: "+55 21 92211-0099",
    channel: "whatsapp",
    status: "perdido",
    tags: ["sem retorno"],
    estimatedValue: 18700,
    product: "Piscina de vinil 5x2,5",
    lossReason: "Sem retorno do cliente",
    lostAt: hoursAgo(72),
    createdAt: hoursAgo(200),
  },
  {
    id: "l12",
    name: "Marcia Oliveira",
    handle: "@marcia.dec",
    channel: "instagram",
    status: "perdido",
    tags: [],
    estimatedValue: 28500,
    product: "Piscina de fibra 6x3",
    lossReason: "Preço acima do orçamento",
    lostAt: hoursAgo(36),
    createdAt: hoursAgo(140),
  },
  {
    id: "l13",
    name: "Rafael Lima",
    phone: "+55 31 91100-9988",
    channel: "facebook",
    status: "perdido",
    tags: [],
    estimatedValue: 8900,
    product: "Trocador de calor 75.000 BTU",
    lossReason: "Comprou do concorrente",
    lostAt: hoursAgo(80),
    createdAt: hoursAgo(180),
  },
  {
    id: "l14",
    name: "Beatriz Alves",
    phone: "+55 11 98899-7766",
    channel: "whatsapp",
    status: "perdido",
    tags: [],
    estimatedValue: 6400,
    product: "Acessórios",
    lossReason: "Preço acima do orçamento",
    lostAt: hoursAgo(60),
    createdAt: hoursAgo(150),
  },
];

export const conversations: Conversation[] = [
  { id: "c1", leadId: "l1", channel: "whatsapp", lastMessageAt: minutesAgo(47), unread: 2, awaitingReply: true, slaBreached: true },
  { id: "c2", leadId: "l2", channel: "whatsapp", lastMessageAt: minutesAgo(38), unread: 1, awaitingReply: true, slaBreached: false },
  { id: "c3", leadId: "l3", channel: "instagram", lastMessageAt: hoursAgo(20), unread: 0, awaitingReply: false, slaBreached: false },
  { id: "c4", leadId: "l4", channel: "facebook", lastMessageAt: hoursAgo(6), unread: 0, awaitingReply: false, slaBreached: false },
  { id: "c5", leadId: "l5", channel: "whatsapp", lastMessageAt: minutesAgo(9), unread: 3, awaitingReply: true, slaBreached: false },
  { id: "c6", leadId: "l6", channel: "whatsapp", lastMessageAt: hoursAgo(72), unread: 0, awaitingReply: false, slaBreached: false },
  { id: "c7", leadId: "l7", channel: "instagram", lastMessageAt: minutesAgo(12), unread: 1, awaitingReply: true, slaBreached: false },
];

export const messages: Message[] = [
  // c1 — Marina
  { id: "m1", conversationId: "c1", role: "lead", text: "Oi! Vi o anúncio da piscina 6x3. Vocês instalam em Cotia?", at: hoursAgo(26) },
  { id: "m2", conversationId: "c1", role: "agent", text: "Olá Marina! Instalamos sim 🙂 Posso te enviar o orçamento completo. Tem preferência por entrega?", at: hoursAgo(25) },
  { id: "m3", conversationId: "c1", role: "lead", text: "Quero pra final do mês. Qual o valor à vista?", at: hoursAgo(24) },
  { id: "m4", conversationId: "c1", role: "agent", text: "À vista R$ 27.500 com 5% off. Posso travar?", at: hoursAgo(23) },
  { id: "m5", conversationId: "c1", role: "lead", text: "Hmmm, tá caro. Consegue 25?", at: minutesAgo(50) },
  { id: "m6", conversationId: "c1", role: "lead", text: "Tô comparando com outra empresa também", at: minutesAgo(47) },

  // c2 — Carlos
  { id: "m7", conversationId: "c2", role: "lead", text: "Bom dia, gostaria de saber sobre aquecedor solar pra piscina pequena", at: minutesAgo(38) },

  // c3 — Bia
  { id: "m8", conversationId: "c3", role: "lead", text: "Oii, dá pra trocar o vinil da minha piscina? Tem 4x2", at: hoursAgo(72) },
  { id: "m9", conversationId: "c3", role: "agent", text: "Oi Bia! Dá sim. Me manda uma foto e as medidas exatas?", at: hoursAgo(71) },
  { id: "m10", conversationId: "c3", role: "lead", text: "Ah deixa eu medir certinho e te mando", at: hoursAgo(20) },

  // c5 — Fernanda
  { id: "m11", conversationId: "c5", role: "lead", text: "Boa tarde! Quero o spa de 4 lugares com instalação", at: hoursAgo(8) },
  { id: "m12", conversationId: "c5", role: "agent", text: "Perfeito Fernanda! O valor com instalação fica R$ 42.000 em até 12x", at: hoursAgo(7) },
  { id: "m13", conversationId: "c5", role: "lead", text: "Consigo parcelar em 18x?", at: minutesAgo(40) },
  { id: "m14", conversationId: "c5", role: "lead", text: "E se eu pagar metade à vista?", at: minutesAgo(20) },
  { id: "m15", conversationId: "c5", role: "lead", text: "Preciso decidir hoje, pode me ajudar?", at: minutesAgo(9) },

  // c7 — Ana
  { id: "m16", conversationId: "c7", role: "lead", text: "Olá! Vocês têm piscina de vinil 5x2,5? Preço?", at: minutesAgo(12) },
];

export function getLead(id: string) {
  return leads.find((l) => l.id === id);
}
export function getConversation(id: string) {
  return conversations.find((c) => c.id === id);
}
export function getMessages(conversationId: string) {
  return messages
    .filter((m) => m.conversationId === conversationId)
    .sort((a, b) => +new Date(a.at) - +new Date(b.at));
}

// Sort: awaiting reply first (urgent first), then hot leads, then overdue follow-ups, then rest by recency
export function sortedConversations(): Conversation[] {
  const score = (c: Conversation) => {
    const lead = getLead(c.leadId);
    let s = 0;
    if (c.awaitingReply && c.slaBreached) s += 1000;
    if (c.awaitingReply) s += 500;
    if (lead?.status === "quente") s += 300;
    if (lead?.nextAction && new Date(lead.nextAction.dueAt).getTime() < now) s += 200;
    if (lead?.status === "novo") s += 100;
    s += -(now - new Date(c.lastMessageAt).getTime()) / 60_000 / 1000;
    return s;
  };
  return [...conversations].sort((a, b) => score(b) - score(a));
}

export function dashboardSummary() {
  const noResponse = conversations.filter((c) => c.awaitingReply).length;
  const hot = leads.filter((l) => l.status === "quente").length;
  const followUpsToday = leads.filter(
    (l) => l.nextAction && new Date(l.nextAction.dueAt).toDateString() === new Date().toDateString()
  ).length;
  const negotiating = leads
    .filter((l) => ["quente", "morno", "aguardando", "novo"].includes(l.status))
    .reduce((sum, l) => sum + (l.estimatedValue ?? 0), 0);
  return { noResponse, hot, followUpsToday, negotiating };
}

export function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60_000);
  if (m < 1) return "agora";
  if (m < 60) return `${m}min`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  return `${d}d`;
}

export function formatBRL(v: number): string {
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
}
