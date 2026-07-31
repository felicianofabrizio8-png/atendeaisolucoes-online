// ============================================================================
// INSIGHTS (Fase 6.4) — puro.
//
// Traduz `GroupStat` em frases que o dono da empresa entende. Duas regras
// inegociáveis de linguagem:
//  1. nunca afirmar causalidade ("porque", "faz com que") — apenas associação;
//  2. sempre acompanhar de amostra, confiança e janela analisada.
// ============================================================================

import { featureLabel } from "./features";
import { pct } from "./stats";
import type { GroupStat, LearningInsight, RecoveryDataset } from "./types";
import { MIN_SAMPLES } from "./types";

const DIMENSION_PHRASE: Record<string, (value: string) => string> = {
  produto: (v) => `Negociações de ${v}`,
  origem: (v) => `Clientes vindos de ${v}`,
  faixa_score: (v) => `Leads com score ${v}`,
  janela: (v) => `Tentativas com janela ${v}`,
  tipo_mensagem: (v) => (v === "template" ? "Envios por template aprovado" : "Envios por mensagem livre"),
  template: (v) => `O template "${v}"`,
  comprimento: (v) => `Mensagens ${v}s`,
  edicao: (v) => (v === "editada" ? "Mensagens editadas pelo vendedor" : "Mensagens enviadas sem edição"),
  tempo_parado: (v) => `Leads ${featureLabel("tempo_parado", v)}`,
  valor: (v) => `Negociações de ${featureLabel("valor", v)}`,
  horario: (v) => `Contatos feitos na ${featureLabel("horario", v)}`,
  dia_semana: (v) => `Contatos de ${v}`,
  tom: (v) => `O tom "${v}"`,
  estrategia: (v) => `A estratégia "${v}"`,
  insistencia: (v) => `Tentativas de ${featureLabel("insistencia", v)}`,
  vendedor: () => "Este vendedor",
};

/** Diferença mínima, em pontos percentuais, para virar insight. */
const MIN_LIFT_PP = 8;

function phrase(stat: GroupStat): string {
  const subject = (DIMENSION_PHRASE[stat.dimension] ?? ((v: string) => v))(stat.value);
  const rate = pct(stat.recoveryRate);
  const direction = stat.liftPp >= 0 ? "acima" : "abaixo";
  const magnitude = Math.abs(stat.liftPp);
  return (
    `${subject} apresentam ${rate}% de recuperação, ` +
    `${magnitude} pontos ${direction} da média da empresa — associação observada, não causa comprovada.`
  );
}

export function buildInsights(
  dataset: RecoveryDataset,
  groups: Record<string, GroupStat[]>,
  windowLabel: string,
  generatedAt: string,
  limit = 12,
): LearningInsight[] {
  if (dataset.total < MIN_SAMPLES) return [];

  const candidates: LearningInsight[] = [];
  for (const stats of Object.values(groups)) {
    // Uma dimensão com um único valor não distingue nada: seu lift é zero
    // por construção e a frase seria vazia de informação.
    if (stats.length < 2) continue;
    for (const stat of stats) {
      if (stat.samples < MIN_SAMPLES) continue;
      if (Math.abs(stat.liftPp) < MIN_LIFT_PP) continue;
      candidates.push({
        id: `${stat.dimension}:${stat.value}`,
        dimension: stat.dimension,
        value: stat.value,
        text: phrase(stat),
        direction: stat.liftPp > 0 ? "positivo" : stat.liftPp < 0 ? "negativo" : "neutro",
        samples: stat.samples,
        confidence: stat.confidence,
        liftPp: stat.liftPp,
        windowLabel,
        updatedAt: generatedAt,
      });
    }
  }

  // Ordena por evidência (confiança × magnitude), não por magnitude bruta:
  // um lift enorme com 8 amostras não pode liderar o painel.
  candidates.sort(
    (a, b) => b.confidence * Math.abs(b.liftPp) - a.confidence * Math.abs(a.liftPp),
  );
  return candidates.slice(0, limit);
}
