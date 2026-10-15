import { Link } from "@tanstack/react-router";
import { ArrowUpRight, Megaphone } from "lucide-react";
import { ChartCard, ChartEmpty } from "./charts/ChartCard";
import { brl, num } from "./charts/primitives";
import type { DashboardData } from "./useDashboardData";

export function CampaignEfficiency({
  data,
  ticketMedio,
}: {
  data: DashboardData;
  ticketMedio: number;
}) {
  const active = data.campaigns.filter(
    (c) => c.meta_delivery_status === "active_on_meta" || c.status === "active",
  ).length;
  const spent = data.campaigns.reduce((s, c) => s + Number(c.spent || 0), 0);
  const leads = data.campaigns.reduce((s, c) => s + (c.leads_count || 0), 0);
  const cpl = leads > 0 ? spent / leads : null;
  return (
    <ChartCard
      title="Investimento em oportunidades"
      subtitle={`Acumulado das campanhas · ${num(active)} ${active === 1 ? "ativa" : "ativas"}`}
      className="dash-campaign-chart col-span-12 lg:col-span-6"
      action={
        <Link to="/campanhas" aria-label="Abrir campanhas" className="text-muted-foreground">
          <ArrowUpRight size={18} />
        </Link>
      }
    >
      {data.loadingGrowth ? (
        <ChartEmpty text="Carregando campanhas…" />
      ) : !data.campaigns.length ? (
        <ChartEmpty text="Ao cadastrar uma campanha, acompanhe aqui o investimento e o custo por lead." />
      ) : (
        <div>
          <div className="dash-campaign-cost mb-6 flex items-center gap-4 rounded-2xl p-5">
            <span className="rounded-full bg-background p-3 text-[var(--dash-purple)]">
              <Megaphone size={22} />
            </span>
            <div>
              <p className="text-[11px] text-muted-foreground">Custo por lead</p>
              <p className="mt-1 text-3xl font-semibold tracking-tight tabular-nums">
                {cpl === null ? "—" : brl(cpl)}
              </p>
            </div>
          </div>
          <dl className="grid grid-cols-3 gap-4">
            {[
              ["Investido", brl(spent)],
              ["Leads gerados", num(leads)],
              ["Ticket médio", ticketMedio > 0 ? brl(ticketMedio) : "—"],
            ].map(([label, value]) => (
              <div key={label}>
                <dt className="text-[11px] text-muted-foreground">{label}</dt>
                <dd className="mt-2 text-base font-semibold tabular-nums">{value}</dd>
              </div>
            ))}
          </dl>
          <p className="mt-6 text-[11px] leading-relaxed text-muted-foreground">
            Custo por lead = investimento ÷ leads gerados. O ticket médio considera as vendas do
            período selecionado; não é uma medida de retorno das campanhas.
          </p>
        </div>
      )}
    </ChartCard>
  );
}
