import { Link } from "@tanstack/react-router";
import { ArrowRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { ChannelMatrix } from "./charts/ChannelMatrix";
import { ChartCard, ChartEmpty } from "./charts/ChartCard";
import { DayBars, type FaixaDia } from "./charts/DayBars";
import { RadialQueue, type QueueItem } from "./charts/RadialQueue";
import { Treemap } from "./charts/Treemap";
import { num } from "./charts/primitives";
import { FAIXAS_DIA, type DashboardMetrics } from "./useDashboardMetrics";

/**
 * Fila de atenção.
 *
 * O painel mais importante da tela: responde "o que eu faço AGORA". Cada
 * linha é um número E um caminho — um alerta que não leva a lugar nenhum é
 * decoração.
 *
 * Deixou de ser lista e virou anéis concêntricos. A lista dava cinco números
 * empilhados e obrigava o leitor a compará-los de cabeça; com os anéis, o
 * arco mais cheio salta antes de qualquer número ser lido, que é exatamente
 * a leitura que uma fila pede. Os números, os textos de apoio e os links
 * continuam todos ali, na legenda ao lado.
 */
export function AttentionQueue({
  m,
  campanhasComProblema = 0,
  publicacoesComFalha = 0,
}: {
  m: DashboardMetrics;
  /** Sinais que não vêm de conversa, herdados do painel anterior. */
  campanhasComProblema?: number;
  publicacoesComFalha?: number;
}) {
  const itens: QueueItem[] = [
    {
      key: "sem-resposta",
      label: "Sem resposta",
      hint: "Cliente falou e ninguém respondeu",
      value: m.atencao.semResposta,
      tone: "falha",
    },
    {
      key: "sla",
      label: "SLA estourado",
      hint: "Passou do tempo combinado",
      value: m.atencao.slaEstourado,
      tone: "falha",
    },
    {
      key: "humano",
      label: "Aguardando humano",
      hint: "A IA pediu para alguém assumir",
      value: m.atencao.aguardandoHumano,
      tone: "oportunidade",
    },
    {
      key: "quentes",
      label: "Quentes parados",
      hint: "Pronto para fechar e esperando",
      value: m.atencao.quentesParados,
      tone: "oportunidade",
    },
    // Só aparecem quando existem: uma linha zerada de campanha todo dia
    // ensina o olho a ignorar a lista inteira.
    ...(campanhasComProblema > 0
      ? [
          {
            key: "campanhas",
            label: "Campanhas com problema",
            hint: "Erro de entrega ou sincronização na Meta",
            value: campanhasComProblema,
            tone: "sistema" as const,
          },
        ]
      : []),
    ...(publicacoesComFalha > 0
      ? [
          {
            key: "publicacoes",
            label: "Publicações com falha",
            hint: "Conteúdo agendado que não subiu",
            value: publicacoesComFalha,
            tone: "sistema" as const,
          },
        ]
      : []),
  ];

  const limpo = itens.every((i) => i.value === 0);

  return (
    <ChartCard
      title="Precisa de você agora"
      subtitle={limpo ? "Nada pendente" : `${num(m.atencao.total)} conversas aguardando`}
      className="col-span-12 lg:col-span-4"
      delay="60ms"
      action={
        <Link
          to="/atendimento"
          className="inline-flex shrink-0 items-center gap-1 rounded-full bg-primary px-2.5 py-1 text-[11px] font-semibold text-primary-foreground transition-opacity hover:opacity-90"
        >
          Abrir <ArrowRight className="h-3 w-3" />
        </Link>
      }
    >
      {limpo ? (
        <FilaLimpa />
      ) : (
        <RadialQueue
          items={itens}
          renderItem={(item, marcador, ativo) => (
            <Link
              to="/atendimento"
              className={cn(
                "flex items-center gap-2.5 rounded-lg px-2 py-1.5 transition-colors hover:bg-accent/50",
                ativo ? "opacity-100" : "opacity-45",
              )}
            >
              {marcador}
              <span className="min-w-0 flex-1">
                <span className="block truncate text-xs font-semibold text-foreground">
                  {item.label}
                </span>
                <span className="block truncate text-[10px] text-muted-foreground">
                  {item.hint}
                </span>
              </span>
              <span
                className={cn(
                  "shrink-0 text-base font-bold tabular-nums",
                  item.value === 0
                    ? "text-muted-foreground"
                    : item.tone === "falha"
                      ? "text-status-urgent"
                      : "text-foreground",
                )}
              >
                {num(item.value)}
              </span>
            </Link>
          )}
        />
      )}
    </ChartCard>
  );
}

/** Fila vazia: um anel inteiro fechado, sem ícone. A forma já é a mensagem. */
function FilaLimpa() {
  return (
    <div className="flex h-full min-h-[150px] flex-col items-center justify-center gap-3 text-center">
      <svg viewBox="0 0 48 48" className="h-12 w-12" aria-hidden>
        <circle
          cx="24"
          cy="24"
          r="18"
          fill="none"
          stroke="var(--status-won)"
          strokeWidth="3"
          strokeLinecap="round"
          strokeDasharray={2 * Math.PI * 18}
          className="viz-stroke"
          style={{ strokeDashoffset: 2 * Math.PI * 18 }}
        />
      </svg>
      <p className="text-xs text-muted-foreground">
        Fila limpa. Nenhum cliente esperando resposta.
      </p>
    </div>
  );
}

/**
 * Por que o cliente não fecha.
 *
 * As objeções saem de `detectedObjections`, que a IA já extrai de toda
 * conversa. O dado existia e não aparecia em lugar nenhum do produto — é a
 * informação com maior retorno por linha de código nesta tela.
 *
 * Dois blocos, duas cores: objeção (ouro) é o que o cliente DIZ durante a
 * conversa; motivo de perda (violeta) é o veredito registrado depois. São
 * naturezas diferentes de dado e misturá-las num treemap só faria área de
 * coisas incomparáveis.
 */
export function LossInsights({ m }: { m: DashboardMetrics }) {
  const semNada = m.objecoes.length === 0 && m.motivosPerda.length === 0;

  return (
    <ChartCard
      title="Por que não fecha"
      subtitle="Objeções detectadas pela IA e motivos de perda"
      className="col-span-12 lg:col-span-4"
      delay="120ms"
    >
      {semNada ? (
        <ChartEmpty text="Ainda não há objeção registrada. A IA preenche isto conforme conversa com os clientes." />
      ) : (
        <div className="space-y-5">
          {m.objecoes.length > 0 && (
            <div>
              <p className="mb-2 text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
                Objeções na conversa
              </p>
              <Treemap data={m.objecoes} color="var(--viz-3)" />
            </div>
          )}
          {m.motivosPerda.length > 0 && (
            <div>
              <p className="mb-2 text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
                Motivo da perda
              </p>
              <Treemap data={m.motivosPerda} color="var(--viz-2)" />
            </div>
          )}
        </div>
      )}
    </ChartCard>
  );
}

/**
 * Canais: volume e conversão lado a lado.
 *
 * A barra de participação que estava aqui respondia só "de onde vem volume".
 * A matriz responde também "de onde vem VENDA" — e é comum serem canais
 * diferentes. Tudo o que a versão anterior mostrava (leads, participação,
 * vendas, receita) continua presente; o que entrou foi a etapa intermediária
 * e a taxa de conversão por canal.
 */
export function ChannelMix({ m }: { m: DashboardMetrics }) {
  const total = m.canais.reduce((s, c) => s + c.leads, 0);

  return (
    <ChartCard
      title="De onde vêm os clientes"
      subtitle={total > 0 ? `${num(total)} leads no período` : "Sem leads no período"}
      className="col-span-12 lg:col-span-4"
      delay="180ms"
    >
      {total === 0 ? (
        <ChartEmpty text="Nenhum contato novo no período." />
      ) : (
        <ChannelMatrix linhas={m.matrizCanais} />
      )}
    </ChartCard>
  );
}

/**
 * Movimento por horário.
 *
 * Serve para decidir escala de equipe e horário de disparo de campanha.
 *
 * A matriz de pontos hora a hora mostrava a textura da semana e exigia que o
 * leitor tirasse a conclusão sozinho. Agrupado em três faixas, o painel
 * responde direto: qual dia carrega mais e em que parte do dia. A hora exata
 * de pico não se perdeu — está no cabeçalho, para o dia mais movimentado, e
 * o tooltip de cada barra traz o número da faixa.
 *
 * Honestidade sobre a fonte: sai do último contato de cada conversa mais a
 * criação do lead, porque o repositório carrega só a última mensagem por
 * conversa. Lê-se como "quando há movimento", não como volume total de
 * mensagens — e o canto do painel diz isso.
 */
export function ActivityPanel({ m }: { m: DashboardMetrics }) {
  const temMovimento = m.movimentoPorDia.some((d) => d.total > 0);
  return (
    <ChartCard
      title="Movimento por horário"
      subtitle="Quando seus clientes procuram você"
      className="col-span-12 lg:col-span-8"
      delay="240ms"
      action={
        <span className="hidden shrink-0 text-[11px] text-muted-foreground sm:inline">
          Baseado no último contato de cada conversa
        </span>
      }
    >
      {temMovimento ? (
        <DayBars data={m.movimentoPorDia} bands={FAIXAS} />
      ) : (
        <ChartEmpty text="Ainda não há movimento registrado." />
      )}
    </ChartCard>
  );
}

/** Faixas do dia com a janela de horas escrita — o leitor não adivinha
 *  onde "tarde" começa, e essa fronteira muda de negócio para negócio.
 *
 *  Laranja, azul e roxo escuro: a progressão acompanha a luz do dia, então a
 *  associação vem antes da legenda. Os três também se separam bem em
 *  deuteranopia, que a rampa fria anterior não garantia entre tarde e noite. */
const FAIXAS: FaixaDia[] = FAIXAS_DIA.map((f) => ({
  key: f.key,
  label: f.label,
  hint: `${f.de}h–${f.ate}h`,
  color: `var(--viz-turno-${f.key})`,
}));
