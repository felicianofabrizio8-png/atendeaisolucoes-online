import type { ChartContext } from "@/lib/dashboard-analysis";
import type { DashboardData } from "./useDashboardData";
import type { DashboardMetrics } from "./useDashboardMetrics";
import { buildAiLoad } from "./charts/AiLoadChart";
import { brl, num, pct } from "./charts/primitives";

export function dashboardContexts(m: DashboardMetrics, data: DashboardData, period: string) {
  const contexts: Record<string, ChartContext> = {};
  const add = (title: string, columns: string[], rows: string[][], notes = "", window = period) => {
    contexts[title] = { title, period: window, notes, columns, rows };
  };
  add(
    "Receita",
    ["Período", "Receita"],
    [
      ["Atual", brl(m.receita.atual)],
      ["Anterior", brl(m.receita.anterior)],
    ],
  );
  add(
    "Oportunidades em aberto",
    ["Situação", "Valor"],
    [
      ["Em aberto", brl(m.pipeline)],
      ["Leads quentes", brl(m.pipelineQuentes)],
    ],
    "Leads quentes são parte das oportunidades, não um valor adicional.",
    "Agora",
  );
  add(
    "Conversão",
    ["Indicador", "Valor"],
    [
      ["Conversão", pct(m.taxaConversao)],
      ["Vendas", num(m.vendas.atual)],
      ["Ticket médio", brl(m.ticketMedio)],
    ],
    "Conversão = vendas / novos leads no período; não representa acompanhamento de uma coorte.",
  );
  add(
    "Novas oportunidades",
    ["Intervalo atual", "Leads", "Intervalo anterior", "Leads anteriores"],
    m.serieLeads.map((d, i) => [
      d.fullLabel,
      num(d.value),
      m.serieLeadsAnterior[i]?.fullLabel ?? "—",
      num(m.serieLeadsAnterior[i]?.value ?? 0),
    ]),
  );
  add(
    "Precisa de você agora",
    ["Alerta", "Conversas"],
    [
      ["Sem resposta", num(m.atencao.semResposta)],
      ["SLA excedido", num(m.atencao.slaEstourado)],
      ["Aguardando humano", num(m.atencao.aguardandoHumano)],
      ["Leads quentes parados", num(m.atencao.quentesParados)],
    ],
    "Uma conversa pode aparecer em mais de um alerta. Não some os alertas como clientes únicos.",
    "Agora",
  );
  add(
    "O que impede a venda?",
    ["Tipo", "Motivo", "Ocorrências"],
    [
      ...m.objecoes.map((d) => ["Objeção", d.label, num(d.value)]),
      ...m.motivosPerda.map((d) => ["Perda", d.label, num(d.value)]),
    ],
    "Objeções são menções identificadas pela IA; não provam a causa da perda. Os dois conjuntos são independentes.",
  );
  add(
    "De onde vêm os clientes",
    ["Canal", "Leads", "Vendas", "Receita"],
    m.canais.map((d) => [d.label, num(d.leads), num(d.vendas), brl(d.receita)]),
  );
  add(
    "O caminho até a venda",
    ["Etapa", "Volume"],
    m.funil.map((d) => [d.label, num(d.value)]),
    "Volumes independentes por etapa, não uma coorte de conversão.",
  );
  const spent = data.campaigns.reduce((s, c) => s + Number(c.spent || 0), 0),
    leads = data.campaigns.reduce((s, c) => s + (c.leads_count || 0), 0);
  add(
    "Investimento em oportunidades",
    ["Indicador", "Valor"],
    [
      ["Investimento", brl(spent)],
      ["Leads", num(leads)],
      ["CPL", leads ? brl(spent / leads) : "Sem base"],
      [`Ticket médio (${period})`, brl(m.ticketMedio)],
    ],
    "O ticket considera outro recorte. Não inferir ROI sem atribuição de vendas às campanhas.",
    "Acumulado das campanhas",
  );
  add(
    "O ritmo dos seus clientes",
    ["Dia", "Hora", "Registros"],
    m.horarios
      .filter((d) => m.horasExibidas.includes(d.hour))
      .map((d) => [
        ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"][d.day],
        `${d.hour}h`,
        num(d.value),
      ]),
    "Criação dos leads e último contato das conversas. Não é o total de mensagens nem histórico de todas as interações.",
    "Visão geral · 7h a 21h",
  );
  const ai = buildAiLoad(data.conversations);
  add(
    "Vendedora IA",
    ["Canal", "Concluídas", "Em atendimento", "Aguardando humano"],
    ai.groups.map((g) => [
      g.label,
      num(g.counts.completed),
      num(g.counts.active),
      num(g.counts.waiting),
    ]),
    "Retrato atual. Cada conversa contada uma vez; colunas normalizadas em 100%, não volumes históricos.",
    "Agora",
  );
  return contexts;
}
