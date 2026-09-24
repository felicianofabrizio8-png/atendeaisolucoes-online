// Camada de negócio da dashboard.
//
// Todo cálculo mora aqui; os painéis só desenham. Isso importa por dois
// motivos: a mesma métrica não pode ser calculada de dois jeitos em dois
// cards, e regra de negócio testável não pode estar presa dentro de JSX.
//
// O QUE A DASHBOARD RESPONDE, em ordem de importância para quem vende:
//   1. Quanto entrou?            receita fechada, com comparação
//   2. Quanto está em jogo?      pipeline aberto
//   3. Está crescendo?           série temporal
//   4. Onde eu perco?            funil, motivo de perda, objeções
//   5. O que preciso fazer AGORA? fila de atenção
//   6. De onde vem e quando?     canal e horário

import { useMemo } from "react";
import type { Conversation, Lead } from "@/data/mock";
import type { Quote } from "@/data/quotes";
import { delta } from "./charts/primitives";
import type { DashboardData } from "./useDashboardData";

export type Periodo = "semana" | "mes" | "ano";

export interface Janela {
  inicio: number;
  fim: number;
  /** Mesma duração, imediatamente antes — a base da comparação. */
  anteriorInicio: number;
}

export interface ValorComparado {
  atual: number;
  anterior: number;
  /** null quando o período anterior é zero: % partindo do nada mente. */
  variacao: number | null;
}

export interface SerieItem {
  label: string;
  fullLabel: string;
  value: number;
}

export interface ItemRanqueado {
  label: string;
  value: number;
}

export interface CelulaHorario {
  day: number;
  hour: number;
  value: number;
}

export interface DashboardMetrics {
  receita: ValorComparado;
  vendas: ValorComparado;
  ticketMedio: number;
  pipeline: number;
  pipelineQuentes: number;

  funil: Array<{ label: string; value: number; hint?: string }>;
  serieReceita: SerieItem[];
  serieLeads: SerieItem[];

  atencao: {
    semResposta: number;
    slaEstourado: number;
    aguardandoHumano: number;
    quentesParados: number;
    total: number;
  };

  motivosPerda: ItemRanqueado[];
  objecoes: ItemRanqueado[];
  canais: Array<{ key: string; label: string; leads: number; vendas: number; receita: number }>;
  horarios: CelulaHorario[];
  horasExibidas: number[];

  taxaConversao: number;
  temDados: boolean;
}

const DIA = 86_400_000;

function janelaDe(periodo: Periodo, agora: number): Janela {
  const dias = periodo === "semana" ? 7 : periodo === "mes" ? 30 : 365;
  const duracao = dias * DIA;
  return { inicio: agora - duracao, fim: agora, anteriorInicio: agora - duracao * 2 };
}

function dentro(iso: string | undefined | null, de: number, ate: number): boolean {
  if (!iso) return false;
  const t = new Date(iso).getTime();
  return Number.isFinite(t) && t >= de && t < ate;
}

/** Valor de uma venda: o fechado manda; o estimado é só o reserva. */
function valorDaVenda(lead: Lead): number {
  return lead.closedValue ?? lead.estimatedValue ?? 0;
}

function comparar(atual: number, anterior: number): ValorComparado {
  return { atual, anterior, variacao: delta(atual, anterior) };
}

function ranquear(contagem: Map<string, number>, limite = 5): ItemRanqueado[] {
  return [...contagem.entries()]
    .map(([label, value]) => ({ label, value }))
    .sort((a, b) => b.value - a.value)
    .slice(0, limite);
}

/** Rótulos curtos e estáveis para os baldes da série temporal. */
function bucketsDe(
  periodo: Periodo,
  agora: number,
): Array<{ inicio: number; fim: number; label: string; fullLabel: string }> {
  const out: Array<{ inicio: number; fim: number; label: string; fullLabel: string }> = [];

  if (periodo === "semana") {
    const nomes = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
    for (let i = 6; i >= 0; i--) {
      const d = new Date(agora - i * DIA);
      d.setHours(0, 0, 0, 0);
      const inicio = d.getTime();
      out.push({
        inicio,
        fim: inicio + DIA,
        label: nomes[d.getDay()],
        fullLabel: d.toLocaleDateString("pt-BR", { day: "2-digit", month: "short" }),
      });
    }
    return out;
  }

  if (periodo === "mes") {
    // Seis blocos de cinco dias: 30 colunas diárias viram palito ilegível.
    for (let i = 5; i >= 0; i--) {
      const fim = agora - i * 5 * DIA;
      const inicio = fim - 5 * DIA;
      const d = new Date(inicio);
      out.push({
        inicio,
        fim,
        label: `${d.getDate()}`,
        fullLabel: `${d.toLocaleDateString("pt-BR", { day: "2-digit", month: "short" })} + 5 dias`,
      });
    }
    return out;
  }

  const meses = [
    "jan",
    "fev",
    "mar",
    "abr",
    "mai",
    "jun",
    "jul",
    "ago",
    "set",
    "out",
    "nov",
    "dez",
  ];
  for (let i = 11; i >= 0; i--) {
    const d = new Date(agora);
    d.setMonth(d.getMonth() - i, 1);
    d.setHours(0, 0, 0, 0);
    const inicio = d.getTime();
    const proximo = new Date(d);
    proximo.setMonth(proximo.getMonth() + 1);
    out.push({
      inicio,
      fim: proximo.getTime(),
      label: meses[d.getMonth()],
      fullLabel: d.toLocaleDateString("pt-BR", { month: "long", year: "numeric" }),
    });
  }
  return out;
}

export function useDashboardMetrics(
  data: DashboardData,
  periodo: Periodo,
  agora: number = Date.now(),
): DashboardMetrics {
  const { leads, conversations, quotes } = data;

  return useMemo(() => {
    const j = janelaDe(periodo, agora);

    // ---- dinheiro ----------------------------------------------------
    const fechadosNoPeriodo = leads.filter(
      (l) => l.status === "fechado" && dentro(l.closedAt ?? l.createdAt, j.inicio, j.fim),
    );
    const fechadosAntes = leads.filter(
      (l) =>
        l.status === "fechado" && dentro(l.closedAt ?? l.createdAt, j.anteriorInicio, j.inicio),
    );

    const receitaAtual = fechadosNoPeriodo.reduce((s, l) => s + valorDaVenda(l), 0);
    const receitaAnterior = fechadosAntes.reduce((s, l) => s + valorDaVenda(l), 0);

    const abertos = leads.filter((l) => l.status !== "fechado" && l.status !== "perdido");
    const pipeline = abertos.reduce((s, l) => s + (l.estimatedValue ?? 0), 0);
    const pipelineQuentes = abertos
      .filter((l) => l.status === "quente")
      .reduce((s, l) => s + (l.estimatedValue ?? 0), 0);

    // ---- funil ---------------------------------------------------------
    const leadsNoPeriodo = leads.filter((l) => dentro(l.createdAt, j.inicio, j.fim));
    const idsNoPeriodo = new Set(leadsNoPeriodo.map((l) => l.id));
    const conversasNoPeriodo = conversations.filter(
      (c) => idsNoPeriodo.has(c.leadId) || dentro(c.lastMessageAt, j.inicio, j.fim),
    );
    const orcamentosNoPeriodo = quotes.filter((q: Quote) => dentro(q.createdAt, j.inicio, j.fim));

    const funil = [
      { label: "Leads", value: leadsNoPeriodo.length, hint: "Contatos novos no período" },
      { label: "Em conversa", value: conversasNoPeriodo.length },
      { label: "Orçamentos", value: orcamentosNoPeriodo.length },
      { label: "Vendas", value: fechadosNoPeriodo.length },
    ];

    // ---- séries ---------------------------------------------------------
    const buckets = bucketsDe(periodo, agora);
    const serieReceita = buckets.map((b) => ({
      label: b.label,
      fullLabel: b.fullLabel,
      value: leads
        .filter((l) => l.status === "fechado" && dentro(l.closedAt ?? l.createdAt, b.inicio, b.fim))
        .reduce((s, l) => s + valorDaVenda(l), 0),
    }));
    const serieLeads = buckets.map((b) => ({
      label: b.label,
      fullLabel: b.fullLabel,
      value: leads.filter((l) => dentro(l.createdAt, b.inicio, b.fim)).length,
    }));

    // ---- atenção agora (estado, não período) ----------------------------
    const semResposta = conversations.filter((c) => c.awaitingReply).length;
    const slaEstourado = conversations.filter((c) => c.slaBreached).length;
    const aguardandoHumano = conversations.filter((c) => c.aiStatus === "aguardando_humano").length;
    const quentesParados = conversations.filter(
      (c) => c.leadTemperature === "quente" && c.awaitingReply,
    ).length;

    // ---- por que perde --------------------------------------------------
    const perdas = new Map<string, number>();
    for (const l of leads) {
      if (l.status !== "perdido") continue;
      if (!dentro(l.lostAt ?? l.createdAt, j.inicio, j.fim)) continue;
      const motivo = l.lossReason?.trim() || "Não informado";
      perdas.set(motivo, (perdas.get(motivo) ?? 0) + 1);
    }

    // As objeções vêm da IA (`detectedObjections`). É o dado mais subaproveitado
    // do sistema: ele já existe e ninguém olha.
    const objecoes = new Map<string, number>();
    for (const c of conversations) {
      for (const o of c.detectedObjections ?? []) {
        const chave = o.trim();
        if (!chave) continue;
        objecoes.set(chave, (objecoes.get(chave) ?? 0) + 1);
      }
    }

    // ---- canais ---------------------------------------------------------
    const canaisDef = [
      { key: "whatsapp", label: "WhatsApp" },
      { key: "instagram", label: "Instagram" },
      { key: "facebook", label: "Facebook" },
    ];
    const canais = canaisDef.map((c) => {
      const doCanal = leadsNoPeriodo.filter((l) => l.channel === c.key);
      const vendidos = fechadosNoPeriodo.filter((l) => l.channel === c.key);
      return {
        ...c,
        leads: doCanal.length,
        vendas: vendidos.length,
        receita: vendidos.reduce((s, l) => s + valorDaVenda(l), 0),
      };
    });

    // ---- horário --------------------------------------------------------
    // Fonte: último contato de cada conversa + criação do lead. Não é o
    // histórico completo de mensagens (o repo carrega só a última por
    // conversa), então lê-se como "quando há movimento", não "volume total".
    const mapaHorario = new Map<string, number>();
    const registrar = (iso: string | undefined) => {
      if (!iso) return;
      const d = new Date(iso);
      if (!Number.isFinite(d.getTime())) return;
      const k = `${d.getDay()}-${d.getHours()}`;
      mapaHorario.set(k, (mapaHorario.get(k) ?? 0) + 1);
    };
    for (const c of conversations) registrar(c.lastMessageAt);
    for (const l of leads) registrar(l.createdAt);

    const horasExibidas = Array.from({ length: 15 }, (_, i) => i + 7); // 7h–21h
    const horarios: CelulaHorario[] = [];
    for (let day = 0; day < 7; day++) {
      for (const hour of horasExibidas) {
        horarios.push({ day, hour, value: mapaHorario.get(`${day}-${hour}`) ?? 0 });
      }
    }

    const taxaConversao =
      leadsNoPeriodo.length > 0 ? (fechadosNoPeriodo.length / leadsNoPeriodo.length) * 100 : 0;

    return {
      receita: comparar(receitaAtual, receitaAnterior),
      vendas: comparar(fechadosNoPeriodo.length, fechadosAntes.length),
      ticketMedio: fechadosNoPeriodo.length > 0 ? receitaAtual / fechadosNoPeriodo.length : 0,
      pipeline,
      pipelineQuentes,
      funil,
      serieReceita,
      serieLeads,
      atencao: {
        semResposta,
        slaEstourado,
        aguardandoHumano,
        quentesParados,
        total: semResposta + slaEstourado + aguardandoHumano,
      },
      motivosPerda: ranquear(perdas),
      objecoes: ranquear(objecoes),
      canais,
      horarios,
      horasExibidas,
      taxaConversao,
      temDados: leads.length > 0 || conversations.length > 0,
    };
  }, [leads, conversations, quotes, periodo, agora]);
}

export type { Conversation, Lead };
