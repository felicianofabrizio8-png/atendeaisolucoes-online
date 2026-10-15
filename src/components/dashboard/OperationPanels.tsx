import { Link } from "@tanstack/react-router";
import { ArrowUpRight, Check, MessageSquare, Clock3, UserRound, Flame } from "lucide-react";
import { ChannelMatrix } from "./charts/ChannelMatrix";
import { ChartCard, ChartEmpty, ChartDetails } from "./charts/ChartCard";
import { ActivityHeatmap, ChannelOrbit, ObjectionPlot } from "./charts/SignatureCharts";
import { num } from "./charts/primitives";
import { type DashboardMetrics } from "./useDashboardMetrics";

export function AttentionQueue({
  m,
  campanhasComProblema = 0,
  publicacoesComFalha = 0,
}: {
  m: DashboardMetrics;
  campanhasComProblema?: number;
  publicacoesComFalha?: number;
}) {
  const items = [
    {
      label: "Sem resposta",
      hint: "O cliente está esperando",
      value: m.atencao.semResposta,
      Icon: MessageSquare,
      to: "/atendimento" as const,
    },
    {
      label: "Tempo de resposta excedido",
      hint: "Priorize estes atendimentos",
      value: m.atencao.slaEstourado,
      Icon: Clock3,
      to: "/atendimento" as const,
    },
    {
      label: "Precisam de um atendente",
      hint: "Encaminhados pela IA",
      value: m.atencao.aguardandoHumano,
      Icon: UserRound,
      to: "/atendimento" as const,
    },
    {
      label: "Leads quentes parados",
      hint: "Retome a negociação",
      value: m.atencao.quentesParados,
      Icon: Flame,
      to: "/atendimento" as const,
    },
    ...(campanhasComProblema
      ? [
          {
            label: "Campanhas com problema",
            hint: "Confira a entrega na Meta",
            value: campanhasComProblema,
            Icon: Clock3,
            to: "/campanhas" as const,
          },
        ]
      : []),
    ...(publicacoesComFalha
      ? [
          {
            label: "Publicações com falha",
            hint: "Confira os agendamentos",
            value: publicacoesComFalha,
            Icon: Clock3,
            to: "/marketing" as const,
          },
        ]
      : []),
  ];
  return (
    <ChartCard
      title="Precisa de você agora"
      subtitle="A próxima ação começa aqui"
      className="dash-attention col-span-12 lg:col-span-4"
      action={
        <Link
          to="/atendimento"
          aria-label="Abrir atendimentos"
          className="rounded-full border border-border p-2"
        >
          <ArrowUpRight size={15} />
        </Link>
      }
    >
      {items.every((i) => i.value === 0) ? (
        <div className="flex min-h-52 flex-col items-center justify-center gap-3 text-center">
          <span className="rounded-full bg-status-won/10 p-4 text-status-won">
            <Check size={24} />
          </span>
          <p className="text-sm font-medium">Tudo em dia.</p>
          <p className="text-xs text-muted-foreground">Nenhum cliente esperando resposta.</p>
        </div>
      ) : (
        <>
          <p className="mb-4 flex items-baseline gap-2">
            <strong className="text-4xl font-semibold tabular-nums tracking-tight">
              {num(m.atencao.semResposta)}
            </strong>
            <span className="text-xs text-muted-foreground">clientes sem resposta</span>
          </p>
          <div className="space-y-1">
            {items.map(({ label, hint, value, Icon, to }) => (
              <Link
                to={to}
                key={label}
                className="dash-attention-row group flex items-center gap-3 rounded-2xl py-2.5 transition-colors hover:bg-secondary"
              >
                <span className="rounded-xl bg-secondary p-2 text-muted-foreground">
                  <Icon size={15} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-xs font-medium">{label}</span>
                  <span className="block text-[10px] text-muted-foreground">{hint}</span>
                </span>
                <strong className="text-lg font-semibold tabular-nums">{num(value)}</strong>
              </Link>
            ))}
          </div>
          <p className="mt-3 text-[10px] text-muted-foreground">
            Uma conversa pode aparecer em mais de um alerta.
          </p>
        </>
      )}
    </ChartCard>
  );
}

export function LossInsights({ m }: { m: DashboardMetrics }) {
  return (
    <ChartCard
      title="O que impede a venda?"
      subtitle="Motivos para orientar a próxima conversa"
      className="dash-loss-chart col-span-12 lg:col-span-4"
    >
      {!m.objecoes.length && !m.motivosPerda.length ? (
        <ChartEmpty text="Ainda não há objeções ou motivos de perda registrados." />
      ) : (
        <div className="space-y-6">
          {!!m.objecoes.length && (
            <div>
              <p className="mb-4 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                Objeções identificadas pela IA
              </p>
              <ObjectionPlot items={m.objecoes} />
            </div>
          )}
          {!!m.motivosPerda.length && (
            <div>
              <p className="mb-4 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                Motivos de perda registrados
              </p>
              <div className="flex flex-wrap gap-2">
                {m.motivosPerda.map((d) => (
                  <div key={d.label} className="dash-loss-chip">
                    <span>{d.label}</span>
                    <strong>{num(d.value)}</strong>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </ChartCard>
  );
}
export function ChannelMix({ m }: { m: DashboardMetrics }) {
  const total = m.canais.reduce((s, c) => s + c.leads, 0);
  return (
    <ChartCard
      title="De onde vêm os clientes"
      subtitle="Participação nos novos contatos"
      className="dash-channel-chart col-span-12 lg:col-span-4"
    >
      {!total ? (
        <ChartEmpty text="Nenhum contato novo no período." />
      ) : (
        <>
          <ChannelOrbit channels={m.canais} />
          <ChartDetails title="Comparar conversão por canal">
            <ChannelMatrix linhas={m.matrizCanais} />
          </ChartDetails>
        </>
      )}
    </ChartCard>
  );
}
export function ActivityPanel({ m }: { m: DashboardMetrics }) {
  const hasData = m.horarios.some((d) => d.value > 0);
  return (
    <ChartCard
      title="O ritmo dos seus clientes"
      subtitle="Dias e horários em que as conversas acontecem"
      className="dash-activity-chart col-span-12 lg:col-span-8"
    >
      {hasData ? (
        <ActivityHeatmap data={m.horarios} hours={m.horasExibidas} />
      ) : (
        <ChartEmpty text="Ainda não há movimento registrado entre 7h e 21h." />
      )}
      <p className="mt-5 text-[10px] leading-relaxed text-muted-foreground">
        Visão geral entre 7h e 21h, baseada na criação dos leads e no último contato de cada
        conversa. Não representa o total de mensagens.
      </p>
    </ChartCard>
  );
}
