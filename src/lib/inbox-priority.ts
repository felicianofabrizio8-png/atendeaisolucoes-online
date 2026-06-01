import type { Conversation, Lead } from "@/data/mock";

export type Bucket = "max" | "humano" | "ia" | "normal" | "frio";

export interface BucketMeta {
  key: Bucket;
  icon: string;
  label: string;
  hint: string;
  /** cor token Tailwind para a borda/destaque */
  accent: string;
}

export const BUCKETS: BucketMeta[] = [
  { key: "max",    icon: "🔥", label: "Prioridade máxima",   hint: "Quentes / prontos para fechar / atrasados",  accent: "var(--status-urgent)" },
  { key: "humano", icon: "⚠️", label: "Aguardando humano",   hint: "IA solicitou intervenção",                    accent: "#f59e0b" },
  { key: "ia",     icon: "🤖", label: "Pré-atendidos pela IA", hint: "IA respondeu, aguardando próximo passo",   accent: "#a78bfa" },
  { key: "normal", icon: "💬", label: "Conversas normais",   hint: "Em andamento",                                 accent: "var(--primary)" },
  { key: "frio",   icon: "❄️", label: "Leads frios",         hint: "Baixo engajamento ou perdidos",                accent: "#60a5fa" },
];

export interface PriorityResult {
  bucket: Bucket;
  score: number;
  /** Alerta curto opcional para mostrar no card. */
  alert?: { tone: "urgent" | "warn" | "info" | "success"; text: string };
}

const MINUTE = 60_000;

export function computePriority(
  conv: Conversation,
  lead: Lead | undefined,
  slaMinutes: number,
  now: number = Date.now(),
): PriorityResult {
  const ageMin = (now - new Date(conv.lastMessageAt).getTime()) / MINUTE;
  const awaiting = conv.awaitingReply;
  const breached = awaiting && ageMin >= slaMinutes;
  const temp = conv.leadTemperature ?? (lead?.status === "quente" ? "quente" : null);
  const ready = !!conv.leadReadyToClose;
  const aiStatus = conv.aiStatus ?? null;
  const hasObjection = (conv.detectedObjections ?? []).length > 0;
  const isClosedLost = lead?.status === "fechado" || lead?.status === "perdido";
  const lastAutoMin = conv.lastAutoReplyAt
    ? (now - new Date(conv.lastAutoReplyAt).getTime()) / MINUTE
    : null;

  // Score dinâmico
  let score = 0;
  if (ready) score += 1000;
  if (aiStatus === "aguardando_humano") score += 700;
  if (temp === "quente") score += 500;
  if (temp === "morno") score += 150;
  if (temp === "frio") score -= 100;
  if (awaiting) score += 200;
  if (breached) score += 400 + Math.min(ageMin, 600);
  if (hasObjection) score += 80;
  score += Math.min(conv.leadScore ?? 0, 100);
  // Lead recém-aquecido: IA bumpou para quente nos últimos 60 min
  if (temp === "quente" && lastAutoMin !== null && lastAutoMin < 60) score += 250;
  if (isClosedLost) score -= 800;
  // SLA breach com lead quente é o caso mais urgente
  if (temp === "quente" && breached) score += 300;

  // Determina bucket
  let bucket: Bucket;
  if (isClosedLost && lead?.status === "perdido") bucket = "frio";
  else if (ready) bucket = "max";
  else if (aiStatus === "aguardando_humano") bucket = "humano";
  else if (temp === "quente" && (awaiting || breached)) bucket = "max";
  else if (breached) bucket = "max";
  else if (aiStatus === "pre_atendido_ia") bucket = "ia";
  else if (temp === "frio" && !awaiting) bucket = "frio";
  else bucket = "normal";

  // Alertas
  let alert: PriorityResult["alert"] | undefined;
  if (ready) {
    alert = { tone: "success", text: "Cliente pronto para fechar" };
  } else if (aiStatus === "aguardando_humano") {
    alert = { tone: "warn", text: "Aguardando atendimento humano" };
  } else if (temp === "quente" && breached) {
    alert = { tone: "urgent", text: `Lead quente aguardando há ${Math.round(ageMin)} min` };
  } else if (breached) {
    alert = { tone: "urgent", text: `Sem resposta há ${Math.round(ageMin)} min` };
  } else if (temp === "quente" && awaiting) {
    alert = { tone: "warn", text: `Lead quente aguardando há ${Math.round(ageMin)} min` };
  } else if (temp === "quente" && lastAutoMin !== null && lastAutoMin < 60) {
    alert = { tone: "info", text: "Lead recém-aquecido pela IA" };
  } else if (temp === "morno" && ageMin > 60 * 6) {
    alert = { tone: "info", text: "Lead esfriando" };
  } else if (hasObjection && awaiting) {
    alert = { tone: "warn", text: `Objeção pendente: ${conv.detectedObjections![0]}` };
  }

  return { bucket, score, alert };
}
