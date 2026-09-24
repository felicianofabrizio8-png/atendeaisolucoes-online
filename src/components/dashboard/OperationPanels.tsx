import { Link } from "@tanstack/react-router";
import {
  AlertTriangle,
  ArrowRight,
  Clock,
  Facebook,
  Flame,
  Instagram,
  MessageCircle,
  UserRoundCheck,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { ChartCard, ChartEmpty } from "./charts/ChartCard";
import { HeatmapGrid } from "./charts/HeatmapGrid";
import { RankedBars } from "./charts/RankedBars";
import { brlCompact, num, pct } from "./charts/primitives";
import type { DashboardMetrics } from "./useDashboardMetrics";

/**
 * Fila de atenção.
 *
 * O painel mais importante da tela e o que a versão anterior não tinha: ele
 * responde "o que eu faço AGORA". Cada linha é um número E um caminho — um
 * alerta que não leva a lugar nenhum é decoração.
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
  const itens = [
    {
      key: "sem-resposta",
      icon: MessageCircle,
      label: "Sem resposta",
      hint: "Cliente falou e ninguém respondeu",
      value: m.atencao.semResposta,
      grave: m.atencao.semResposta > 0,
    },
    {
      key: "sla",
      icon: Clock,
      label: "SLA estourado",
      hint: "Passou do tempo combinado",
      value: m.atencao.slaEstourado,
      grave: m.atencao.slaEstourado > 0,
    },
    {
      key: "humano",
      icon: UserRoundCheck,
      label: "Aguardando humano",
      hint: "A IA pediu para alguém assumir",
      value: m.atencao.aguardandoHumano,
      grave: m.atencao.aguardandoHumano > 0,
    },
    {
      key: "quentes",
      icon: Flame,
      label: "Quentes parados",
      hint: "Pronto para fechar e esperando",
      value: m.atencao.quentesParados,
      grave: m.atencao.quentesParados > 0,
    },
    // Só aparecem quando existem: uma linha zerada de campanha todo dia
    // ensina o olho a ignorar a lista inteira.
    ...(campanhasComProblema > 0
      ? [
          {
            key: "campanhas",
            icon: AlertTriangle,
            label: "Campanhas com problema",
            hint: "Erro de entrega ou sincronização na Meta",
            value: campanhasComProblema,
            grave: true,
          },
        ]
      : []),
    ...(publicacoesComFalha > 0
      ? [
          {
            key: "publicacoes",
            icon: AlertTriangle,
            label: "Publicações com falha",
            hint: "Conteúdo agendado que não subiu",
            value: publicacoesComFalha,
            grave: true,
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
        <div className="flex h-full min-h-[150px] flex-col items-center justify-center gap-2 text-center">
          <span className="flex h-10 w-10 items-center justify-center rounded-full bg-status-won/15">
            <UserRoundCheck className="h-5 w-5 text-status-won" />
          </span>
          <p className="text-xs text-muted-foreground">
            Fila limpa. Nenhum cliente esperando resposta.
          </p>
        </div>
      ) : (
        <ul className="space-y-1.5">
          {itens.map((item) => {
            const Icon = item.icon;
            return (
              <li key={item.key}>
                <Link
                  to="/atendimento"
                  className={cn(
                    "flex items-center gap-3 rounded-xl border px-3 py-2.5 transition-colors",
                    item.grave
                      ? "border-status-urgent/25 bg-status-urgent/5 hover:bg-status-urgent/10"
                      : "border-border hover:bg-accent/40",
                  )}
                >
                  <Icon
                    className={cn(
                      "h-4 w-4 shrink-0",
                      item.grave ? "text-status-urgent" : "text-muted-foreground",
                    )}
                  />
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
                      "shrink-0 text-lg font-bold tabular-nums",
                      item.grave ? "text-status-urgent" : "text-muted-foreground",
                    )}
                  >
                    {num(item.value)}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </ChartCard>
  );
}

/**
 * Por que o cliente não fecha.
 *
 * As objeções saem de `detectedObjections`, que a IA já extrai de toda
 * conversa. O dado existia e não aparecia em lugar nenhum do produto — é a
 * informação com maior retorno por linha de código nesta tela.
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
              <RankedBars data={m.objecoes} color="var(--viz-3)" />
            </div>
          )}
          {m.motivosPerda.length > 0 && (
            <div>
              <p className="mb-2 text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
                Motivo da perda
              </p>
              <RankedBars data={m.motivosPerda} color="var(--viz-2)" />
            </div>
          )}
        </div>
      )}
    </ChartCard>
  );
}

const ICONES = {
  whatsapp: MessageCircle,
  instagram: Instagram,
  facebook: Facebook,
} as const;

/**
 * Mix de canais.
 *
 * Small multiples, não uma barra empilhada colorida. Motivo medido, não
 * estético: verde do WhatsApp e rosa do Instagram ficam a ΔE 4,3 em
 * deuteranopia — indistinguíveis, e nenhum ajuste de tom resolve sem perder
 * a marca. Com uma linha por canal, ícone e nome carregam a identidade e a
 * cor vira só reforço.
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
        <ul className="space-y-3">
          {m.canais.map((c) => {
            const Icon = ICONES[c.key as keyof typeof ICONES];
            const share = total > 0 ? (c.leads / total) * 100 : 0;
            return (
              <li key={c.key} className="rounded-xl border border-border p-3">
                <div className="flex items-center gap-2">
                  <Icon
                    className="h-4 w-4 shrink-0"
                    style={{ color: `var(--channel-${c.key})` }}
                    aria-hidden
                  />
                  <span className="min-w-0 flex-1 truncate text-xs font-semibold">{c.label}</span>
                  <span className="shrink-0 text-xs font-bold tabular-nums">
                    {num(c.leads)}
                    <span className="ml-1.5 font-normal text-muted-foreground">
                      {pct(share, 0)}
                    </span>
                  </span>
                </div>

                <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-[var(--viz-track)]">
                  <div
                    className="h-full rounded-full transition-[width] duration-700 ease-out"
                    style={{ width: `${share}%`, background: `var(--channel-${c.key})` }}
                  />
                </div>

                <p className="mt-1.5 text-[10px] text-muted-foreground">
                  {c.vendas > 0
                    ? `${num(c.vendas)} venda${c.vendas === 1 ? "" : "s"} · ${brlCompact(c.receita)}`
                    : "Nenhuma venda fechada por este canal"}
                </p>
              </li>
            );
          })}
        </ul>
      )}
    </ChartCard>
  );
}

/**
 * Movimento por horário.
 *
 * Serve para decidir escala de equipe e horário de disparo de campanha.
 *
 * Honestidade sobre a fonte: sai do último contato de cada conversa mais a
 * criação do lead, porque o repositório carrega só a última mensagem por
 * conversa. Lê-se como "quando há movimento", não como volume total de
 * mensagens — e o subtítulo diz isso.
 */
export function ActivityPanel({ m }: { m: DashboardMetrics }) {
  const temMovimento = m.horarios.some((c) => c.value > 0);
  return (
    <ChartCard
      title="Movimento por horário"
      subtitle="Quando seus clientes procuram você"
      className="col-span-12"
      delay="240ms"
      action={
        <span className="hidden shrink-0 items-center gap-1 text-[11px] text-muted-foreground sm:inline-flex">
          <AlertTriangle className="h-3 w-3" />
          Baseado no último contato de cada conversa
        </span>
      }
    >
      {temMovimento ? (
        <HeatmapGrid cells={m.horarios} hours={m.horasExibidas} />
      ) : (
        <ChartEmpty text="Ainda não há movimento registrado." />
      )}
    </ChartCard>
  );
}
