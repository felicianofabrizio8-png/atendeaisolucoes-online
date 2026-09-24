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

/** Faixas do dia. Três blocos, não vinte e quatro horas: a decisão que este
 *  dado alimenta é de ESCALA DE EQUIPE e horário de disparo, e ninguém monta
 *  turno de uma hora. O pico de hora continua disponível por dia. */
export const FAIXAS_DIA = [
  { key: "manha", label: "Manhã", de: 7, ate: 11 },
  { key: "tarde", label: "Tarde", de: 12, ate: 17 },
  { key: "noite", label: "Noite", de: 18, ate: 21 },
] as const;

export interface DiaMovimento {
  day: number;
  label: string;
  /** Contagem por faixa, na ordem de FAIXAS_DIA. */
  faixas: number[];
  total: number;
  /** Hora de maior movimento no dia — o detalhe que a faixa agrega. */
  picoHora: number | null;
  picoValor: number;
}

/** Campo denso de entrada de leads: hora (linha) × balde do filtro (coluna).
 *
 *  Duas dimensões e não uma: com um bloco por dia sobram trinta quadradinhos
 *  e o painel vira um calendário esparso. Cruzando com a hora, o mesmo
 *  período vira um campo com centenas de células — e a pergunta fica melhor,
 *  porque "entra lead de manhã ou de noite, e isso mudou ao longo do mês?"
 *  não se responde só com o total do dia. */
export interface GradeLeads {
  /** Rótulos das colunas, na ordem do tempo (esquerda → direita). */
  colunas: string[];
  colunasCheias: string[];
  /** Horas exibidas, de cima para baixo. */
  linhas: number[];
  /** valores[linha][coluna] */
  valores: number[][];
  total: number;
}

/** Uma célula do mapa de calor do funil: uma transição, num canal. */
export interface CelulaFunil {
  linha: string;
  coluna: string;
  /** Quantos entraram nesta etapa. */
  entrou: number;
  /** Quantos avançaram para a seguinte. */
  avancou: number;
  /** avancou / entrou, em %. null quando não entrou ninguém. */
  taxa: number | null;
}

/** Um item do treemap de objeções: rótulo, contagem e participação. */
export interface ItemArea {
  label: string;
  value: number;
  share: number;
}

/** Um balde da série, quebrado por canal — as faixas do gráfico de fluxo. */
export interface FaixaTemporal {
  label: string;
  fullLabel: string;
  total: number;
  /** Chave do canal → valor no balde. Ordem fixa, definida em `CANAIS`. */
  porCanal: Record<string, number>;
}

/** Linha da matriz canal × etapa. Responde "qual canal CONVERTE", não só
 *  "qual traz volume" — são perguntas diferentes e a segunda sozinha engana. */
export interface LinhaCanal {
  key: string;
  label: string;
  leads: number;
  conversas: number;
  orcamentos: number;
  vendas: number;
  receita: number;
  /** vendas / leads, em %. */
  conversao: number;
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
  /** Receita por balde quebrada por canal — faixas do gráfico de fluxo. */
  serieReceitaCanal: FaixaTemporal[];
  /** Mesma série de leads, um período inteiro atrás. É a linha tracejada de
   *  comparação: sem ela "40 leads" não diz se foi bom ou ruim. */
  serieLeadsAnterior: SerieItem[];
  matrizCanais: LinhaCanal[];

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
  /** Movimento agregado por dia e faixa — o gráfico de barras por dia. */
  movimentoPorDia: DiaMovimento[];
  /** Campo de entrada de leads por hora × tempo. */
  gradeLeads: GradeLeads;
  /** Mapa de calor do funil: linhas = canal (+ todos), colunas = transição. */
  matrizFunil: {
    linhas: string[];
    colunas: string[];
    celulas: CelulaFunil[];
  };

  taxaConversao: number;
  temDados: boolean;
}

const DIA = 86_400_000;

/** Ordem fixa dos canais. Vale para a lista, para a matriz e para a ordem
 *  das faixas do fluxo — se cada gráfico ordenasse do seu jeito, a mesma cor
 *  significaria canais diferentes de um painel para o outro. */
export const CANAIS = [
  { key: "whatsapp", label: "WhatsApp" },
  { key: "instagram", label: "Instagram" },
  { key: "facebook", label: "Facebook" },
] as const;

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

/**
 * Baldes FINOS, só para o campo de calor.
 *
 * Os baldes das séries são grossos de propósito: no mês são seis blocos de
 * cinco dias, porque trinta colunas de barra viram palito ilegível. O campo
 * de calor tem o problema oposto — com seis colunas e quinze linhas a grade
 * nasce em pé e quase vazia. Aqui a granularidade é a mais fina que ainda
 * cabe: dia na semana e no mês, semana no ano.
 */
function bucketsFinos(
  periodo: Periodo,
  agora: number,
): Array<{ inicio: number; fim: number; label: string; fullLabel: string }> {
  const out: Array<{ inicio: number; fim: number; label: string; fullLabel: string }> = [];

  if (periodo === "ano") {
    for (let i = 51; i >= 0; i--) {
      const fim = agora - i * 7 * DIA;
      const inicio = fim - 7 * DIA;
      const d = new Date(inicio);
      out.push({
        inicio,
        fim,
        label: d.toLocaleDateString("pt-BR", { month: "short" }),
        fullLabel: `semana de ${d.toLocaleDateString("pt-BR", { day: "2-digit", month: "short" })}`,
      });
    }
    return out;
  }

  const dias = periodo === "semana" ? 7 : 30;
  for (let i = dias - 1; i >= 0; i--) {
    const d = new Date(agora - i * DIA);
    d.setHours(0, 0, 0, 0);
    const inicio = d.getTime();
    out.push({
      inicio,
      fim: inicio + DIA,
      label: `${d.getDate()}`,
      fullLabel: d.toLocaleDateString("pt-BR", { day: "2-digit", month: "short" }),
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

    // Mesmos baldes, deslocados uma janela inteira para trás. Vira a linha
    // tracejada de comparação: o número sozinho não diz se o mês foi bom.
    const duracao = j.fim - j.inicio;
    const serieLeadsAnterior = bucketsDe(periodo, agora - duracao).map((b) => ({
      label: b.label,
      fullLabel: b.fullLabel,
      value: leads.filter((l) => dentro(l.createdAt, b.inicio, b.fim)).length,
    }));

    // Receita por balde QUEBRADA POR CANAL: as faixas do gráfico de fluxo.
    // O total continua sendo o mesmo de `serieReceita` — a quebra é adição de
    // informação, não troca.
    const serieReceitaCanal: FaixaTemporal[] = buckets.map((b) => {
      const doBalde = leads.filter(
        (l) => l.status === "fechado" && dentro(l.closedAt ?? l.createdAt, b.inicio, b.fim),
      );
      const porCanal: Record<string, number> = {};
      for (const c of CANAIS) {
        porCanal[c.key] = doBalde
          .filter((l) => l.channel === c.key)
          .reduce((sum, l) => sum + valorDaVenda(l), 0);
      }
      return {
        label: b.label,
        fullLabel: b.fullLabel,
        total: doBalde.reduce((sum, l) => sum + valorDaVenda(l), 0),
        porCanal,
      };
    });

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
    const canais = CANAIS.map((c) => {
      const doCanal = leadsNoPeriodo.filter((l) => l.channel === c.key);
      const vendidos = fechadosNoPeriodo.filter((l) => l.channel === c.key);
      return {
        ...c,
        leads: doCanal.length,
        vendas: vendidos.length,
        receita: vendidos.reduce((s, l) => s + valorDaVenda(l), 0),
      };
    });

    // Matriz canal × etapa. O mesmo funil, uma linha por canal — é o que
    // separa "de onde vem volume" de "de onde vem VENDA". Um canal pode
    // dominar a entrada de leads e não fechar nada, e a lista de barras por
    // volume esconde exatamente isso.
    const canalDoLead = new Map(leads.map((l) => [l.id, l.channel]));
    const matrizCanais: LinhaCanal[] = CANAIS.map((c) => {
      const leadsCanal = leadsNoPeriodo.filter((l) => l.channel === c.key).length;
      const vendasCanal = fechadosNoPeriodo.filter((l) => l.channel === c.key);
      return {
        key: c.key,
        label: c.label,
        leads: leadsCanal,
        conversas: conversasNoPeriodo.filter((conv) => conv.channel === c.key).length,
        orcamentos: orcamentosNoPeriodo.filter((q) => canalDoLead.get(q.leadId) === c.key).length,
        vendas: vendasCanal.length,
        receita: vendasCanal.reduce((sum, l) => sum + valorDaVenda(l), 0),
        conversao: leadsCanal > 0 ? (vendasCanal.length / leadsCanal) * 100 : 0,
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

    // Agregação por dia e faixa, mais a hora de pico de cada dia.
    const NOMES_DIA = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
    const movimentoPorDia: DiaMovimento[] = NOMES_DIA.map((label, day) => {
      const faixas = FAIXAS_DIA.map((faixa) => {
        let soma = 0;
        for (let h = faixa.de; h <= faixa.ate; h++) soma += mapaHorario.get(`${day}-${h}`) ?? 0;
        return soma;
      });
      let picoHora: number | null = null;
      let picoValor = 0;
      for (const hour of horasExibidas) {
        const v = mapaHorario.get(`${day}-${hour}`) ?? 0;
        if (v > picoValor) {
          picoValor = v;
          picoHora = hour;
        }
      }
      return {
        day,
        label,
        faixas,
        total: faixas.reduce((a, b) => a + b, 0),
        picoHora,
        picoValor,
      };
    });

    // Campo denso da entrada de leads: hora × balde do filtro.
    //
    // As colunas seguem o MESMO recorte do resto da tela (7 dias, 30 dias ou
    // 12 meses). Usar um recorte próprio aqui faria este painel responder a
    // um período e os vizinhos a outro, na mesma tela.
    const colunasGrade = bucketsFinos(periodo, agora);
    const gradeValores: number[][] = horasExibidas.map(() => colunasGrade.map(() => 0));
    let gradeTotal = 0;
    for (const lead of leads) {
      if (!lead.createdAt) continue;
      const t = new Date(lead.createdAt);
      const ms = t.getTime();
      if (!Number.isFinite(ms)) continue;
      const coluna = colunasGrade.findIndex((b) => ms >= b.inicio && ms < b.fim);
      if (coluna < 0) continue;
      const linha = horasExibidas.indexOf(t.getHours());
      if (linha < 0) continue;
      gradeValores[linha][coluna] += 1;
      gradeTotal += 1;
    }
    const gradeLeads: GradeLeads = {
      colunas: colunasGrade.map((b) => b.label),
      colunasCheias: colunasGrade.map((b) => b.fullLabel),
      linhas: horasExibidas,
      valores: gradeValores,
      total: gradeTotal,
    };

    // Mapa de calor do funil.
    //
    // Cada célula é uma TAXA DE AVANÇO, não um volume: é a pergunta do painel
    // ("onde eu perco") e é o que permite comparar um canal de 200 leads com
    // um de 20 na mesma escala — volume faria o canal grande parecer melhor
    // em toda etapa só por ser grande.
    const TRANSICOES = [
      { coluna: "Lead → Conversa", de: "leads", para: "conversas" },
      { coluna: "Conversa → Orçam.", de: "conversas", para: "orcamentos" },
      { coluna: "Orçam. → Venda", de: "orcamentos", para: "vendas" },
      { coluna: "Lead → Venda", de: "leads", para: "vendas" },
    ] as const;

    const totaisFunil = {
      leads: funil[0].value,
      conversas: funil[1].value,
      orcamentos: funil[2].value,
      vendas: funil[3].value,
    };
    const fontesFunil: Array<{ linha: string; dados: Record<string, number> }> = [
      { linha: "Todos", dados: totaisFunil },
      ...matrizCanais.map((c) => ({
        linha: c.label,
        dados: {
          leads: c.leads,
          conversas: c.conversas,
          orcamentos: c.orcamentos,
          vendas: c.vendas,
        },
      })),
    ];

    const matrizFunil = {
      linhas: fontesFunil.map((f) => f.linha),
      colunas: TRANSICOES.map((t) => t.coluna),
      celulas: fontesFunil.flatMap((fonte) =>
        TRANSICOES.map((t) => {
          const entrou = fonte.dados[t.de] ?? 0;
          const avancou = fonte.dados[t.para] ?? 0;
          return {
            linha: fonte.linha,
            coluna: t.coluna,
            entrou,
            avancou,
            // Sem base não se inventa taxa: zero entrando não é 0% de avanço,
            // é ausência de medida. A célula fica neutra.
            taxa: entrou > 0 ? Math.min((avancou / entrou) * 100, 100) : null,
          };
        }),
      ),
    };

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
      serieReceitaCanal,
      serieLeadsAnterior,
      matrizCanais,
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
      movimentoPorDia,
      gradeLeads,
      matrizFunil,
      taxaConversao,
      temDados: leads.length > 0 || conversations.length > 0,
    };
  }, [leads, conversations, quotes, periodo, agora]);
}

export type { Conversation, Lead };
