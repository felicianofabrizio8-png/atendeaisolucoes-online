import { Link } from "@tanstack/react-router";
import { ArrowRight, TrendingDown, TrendingUp } from "lucide-react";
import { cn } from "@/lib/utils";
import { ChartCard, ChartEmpty } from "./charts/ChartCard";
import { brl, brlCompact, num } from "./charts/primitives";
import type { DashboardData } from "./useDashboardData";

/**
 * Eficiência de campanha.
 *
 * O painel anterior mostrava investimento e leads; o número que decide é o
 * **custo por lead** confrontado com o **ticket médio**. Investir R$ 80 por
 * lead num ticket de R$ 20 mil é ótimo; o mesmo R$ 80 num ticket de R$ 300 é
 * prejuízo. Sem os dois lado a lado, o gasto não tem como ser julgado.
 */
export function CampaignEfficiency({
  data,
  ticketMedio,
}: {
  data: DashboardData;
  ticketMedio: number;
}) {
  // Mesmos campos que o painel anterior usava — `spent` e `leads_count`.
  const ativas = data.campaigns.filter(
    (c) => c.meta_delivery_status === "active_on_meta" || c.status === "active",
  );
  const investido = data.campaigns.reduce((total, c) => total + Number(c.spent || 0), 0);
  const leads = data.campaigns.reduce((total, c) => total + (c.leads_count || 0), 0);
  const cpl = leads > 0 ? investido / leads : null;

  // Razão entre o que um cliente vale e o que custa trazer um lead.
  const retorno = cpl !== null && cpl > 0 && ticketMedio > 0 ? ticketMedio / cpl : null;
  const saudavel = retorno !== null && retorno >= 3;

  return (
    <ChartCard
      title="Eficiência de campanha"
      subtitle={
        ativas.length > 0
          ? `${num(ativas.length)} ativa${ativas.length === 1 ? "" : "s"}`
          : "Nenhuma campanha ativa"
      }
      className="col-span-12 lg:col-span-6"
      delay="300ms"
      action={
        <Link
          to="/campanhas"
          className="inline-flex shrink-0 items-center gap-1 text-[11px] font-semibold text-muted-foreground transition-colors hover:text-foreground"
        >
          Campanhas <ArrowRight className="h-3 w-3" />
        </Link>
      }
    >
      {data.loadingGrowth ? (
        <ChartEmpty text="Carregando campanhas…" />
      ) : data.campaigns.length === 0 ? (
        <ChartEmpty text="Nenhuma campanha cadastrada. Quando houver, o custo por lead aparece aqui." />
      ) : (
        <div className="space-y-3">
          <div className="grid grid-cols-3 gap-2">
            <Cell label="Investido" value={brlCompact(investido)} />
            <Cell label="Leads" value={num(leads)} />
            <Cell label="Custo por lead" value={cpl !== null ? brl(cpl) : "—"} destaque />
          </div>

          {retorno !== null && (
            <div
              className={cn(
                "flex items-start gap-2.5 rounded-xl border px-3 py-2.5",
                saudavel
                  ? "border-status-won/25 bg-status-won/5"
                  : "border-status-warm/25 bg-status-warm/5",
              )}
            >
              {saudavel ? (
                <TrendingUp className="mt-0.5 h-4 w-4 shrink-0 text-status-won" />
              ) : (
                <TrendingDown className="mt-0.5 h-4 w-4 shrink-0 text-status-warm" />
              )}
              <p className="text-[11px] leading-relaxed text-muted-foreground">
                Cada lead custa <strong className="text-foreground">{brl(cpl ?? 0)}</strong> e o
                ticket médio é{" "}
                <strong className="text-foreground">{brlCompact(ticketMedio)}</strong> —{" "}
                <strong className={saudavel ? "text-status-won" : "text-status-warm"}>
                  {retorno.toFixed(1).replace(".", ",")}× de retorno
                </strong>
                {saudavel ? "." : ". Margem apertada: vale revisar segmentação ou criativo."}
              </p>
            </div>
          )}
        </div>
      )}
    </ChartCard>
  );
}

function Cell({ label, value, destaque }: { label: string; value: string; destaque?: boolean }) {
  return (
    <div
      className={cn(
        "min-w-0 rounded-xl border px-3 py-2.5",
        destaque ? "border-[var(--viz-1)]/30 bg-[var(--viz-1)]/5" : "border-border",
      )}
    >
      <p className="truncate text-sm font-bold tabular-nums text-foreground">{value}</p>
      <p className="mt-0.5 truncate text-[10px] text-muted-foreground">{label}</p>
    </div>
  );
}
