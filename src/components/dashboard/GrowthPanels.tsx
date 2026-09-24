import { Link } from "@tanstack/react-router";
import { ArrowRight, Facebook, Instagram } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { MarketingContentChannel } from "@/lib/marketing/marketing.types";
import { ChartCard } from "./charts/ChartCard";
import { num, stagger, useInView } from "./charts/primitives";
import type { DashboardData } from "./useDashboardData";

const SEMANA = 7 * 86_400_000;
const SEMANAS = 8;

export function MarketingPanel({ data }: { data: DashboardData }) {
  return (
    <ChartCard
      title="Marketing"
      subtitle={`Ritmo de publicação nas últimas ${SEMANAS} semanas`}
      className="col-span-12 lg:col-span-4"
      delay="360ms"
    >
      <div className="flex h-full flex-col">
        <div className="space-y-3">
          <NetworkRow channel="instagram" label="Instagram" icon={Instagram} data={data} />
          <NetworkRow channel="facebook" label="Facebook" icon={Facebook} data={data} />
        </div>
        <Button asChild className="mt-5 w-full">
          <Link to="/marketing">
            Criar publicação <ArrowRight />
          </Link>
        </Button>
      </div>
    </ChartCard>
  );
}

/**
 * Ritmo: uma coluna por semana, altura pelo número de publicações.
 *
 * O painel prometia "ritmo de conteúdo" e mostrava um número e uma data.
 * Ritmo é uma propriedade do TEMPO — só aparece numa sequência. Oito colunas
 * dizem em um olhar se a conta está publicando de forma constante ou aos
 * trancos, que é a pergunta de quem cuida da rede.
 */
function Cadencia({ contagens, color }: { contagens: number[]; color: string }) {
  const [ref, inView] = useInView<HTMLDivElement>();
  const max = Math.max(...contagens, 1);

  return (
    <div ref={ref} className="mt-2.5 flex h-8 items-end gap-1" aria-hidden>
      {contagens.map((c, i) => (
        <span
          key={i}
          className="min-w-0 flex-1 rounded-[2px] transition-[height,opacity] duration-500 ease-out"
          style={{
            height: inView ? `${Math.max((c / max) * 100, 8)}%` : "8%",
            background: c > 0 ? color : "var(--viz-track)",
            opacity: inView ? 1 : 0,
            transitionDelay: stagger(i, 50, 400),
          }}
        />
      ))}
    </div>
  );
}

function NetworkRow({
  channel,
  label,
  icon: Icon,
  data,
}: {
  channel: MarketingContentChannel;
  label: string;
  icon: typeof Instagram;
  data: DashboardData;
}) {
  const doCanal = data.schedule.filter((item) => item.channel === channel);
  const scheduled = doCanal.filter((item) => ["planned", "queued"].includes(item.status)).length;
  const published = doCanal
    .filter((item) => item.status === "published")
    .sort((a, b) => +new Date(b.scheduled_at) - +new Date(a.scheduled_at))[0];

  // Baldes semanais, do mais antigo para o mais recente.
  const agora = Date.now();
  const contagens = Array.from({ length: SEMANAS }, (_, i) => {
    const fim = agora - (SEMANAS - 1 - i) * SEMANA;
    const inicio = fim - SEMANA;
    return doCanal.filter((item) => {
      if (item.status !== "published") return false;
      const t = new Date(item.scheduled_at).getTime();
      return Number.isFinite(t) && t >= inicio && t < fim;
    }).length;
  });
  const publicadas = contagens.reduce((s, c) => s + c, 0);

  return (
    <div className="rounded-xl border border-border p-3">
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2">
        <span className="flex min-w-0 items-center gap-2 text-xs font-semibold">
          <Icon
            className="h-4 w-4 shrink-0"
            style={{ color: `var(--channel-${channel})` }}
            aria-hidden
          />
          {label}
        </span>
        <span className="shrink-0 text-[11px] text-muted-foreground">
          {num(scheduled)} programada{scheduled === 1 ? "" : "s"}
        </span>
      </div>

      <Cadencia contagens={contagens} color={`var(--channel-${channel})`} />

      <p className="mt-2 text-[10px] text-muted-foreground">
        {publicadas > 0
          ? `${num(publicadas)} publicada${publicadas === 1 ? "" : "s"} no período`
          : "Nenhuma publicação no período"}
        {published
          ? ` · última em ${new Date(published.scheduled_at).toLocaleDateString("pt-BR")}`
          : ""}
      </p>
    </div>
  );
}
