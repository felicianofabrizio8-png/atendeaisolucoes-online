import { Link } from "@tanstack/react-router";
import { ArrowRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { ChartCard, ChartEmpty } from "./charts/ChartCard";
import { brl, brlCompact, num, useInView } from "./charts/primitives";
import type { DashboardData } from "./useDashboardData";

const META_RETORNO = 3;

/**
 * Eficiência de campanha.
 *
 * O painel original mostrava investimento e leads; o número que decide é o
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
  const saudavel = retorno !== null && retorno >= META_RETORNO;

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
        <div className="space-y-4">
          <div className="grid grid-cols-3 gap-2">
            <Cell label="Investido" value={brlCompact(investido)} />
            <Cell label="Leads" value={num(leads)} />
            <Cell label="Custo por lead" value={cpl !== null ? brl(cpl) : "—"} destaque />
          </div>

          {retorno !== null ? (
            <>
              <RetornoBullet retorno={retorno} saudavel={saudavel} />
              <p className="text-[11px] leading-relaxed text-muted-foreground">
                Cada lead custa <strong className="text-foreground">{brl(cpl ?? 0)}</strong> e o
                ticket médio é{" "}
                <strong className="text-foreground">{brlCompact(ticketMedio)}</strong> —{" "}
                <strong className={saudavel ? "text-status-won" : "text-status-urgent"}>
                  {retorno.toFixed(1).replace(".", ",")}× de retorno
                </strong>
                {saudavel ? "." : ". Margem apertada: vale revisar segmentação ou criativo."}
              </p>
            </>
          ) : (
            <p className="text-[11px] leading-relaxed text-muted-foreground">
              O retorno aparece aqui quando houver custo por lead e pelo menos uma venda fechada no
              período — são os dois lados da conta.
            </p>
          )}
        </div>
      )}
    </ChartCard>
  );
}

/**
 * Bullet: medida contra meta.
 *
 * Forma certa para "estou acima ou abaixo do que precisava?". O traço
 * vertical é a meta de 3× — um número solto não diz se 2,4× é bom, e a
 * distância até o traço diz.
 *
 * A escala vai até pelo menos 4× para a meta nunca encostar na borda: meta
 * colada no fim do trilho parece inalcançável mesmo quando falta pouco.
 */
function RetornoBullet({ retorno, saudavel }: { retorno: number; saudavel: boolean }) {
  const [ref, inView] = useInView<HTMLDivElement>();
  const escala = Math.max(retorno * 1.15, META_RETORNO + 1);
  const largura = Math.min((retorno / escala) * 100, 100);
  const meta = (META_RETORNO / escala) * 100;

  return (
    <div ref={ref}>
      <div className="relative h-7 w-full overflow-hidden rounded-lg bg-[var(--viz-track)]">
        <div
          className="h-full rounded-lg transition-[width] duration-1000 ease-out"
          style={{
            width: inView ? `${largura}%` : "0%",
            background: saudavel ? "var(--viz-1)" : "var(--status-urgent)",
            opacity: 0.85,
          }}
        />
        <span
          aria-hidden
          className="absolute inset-y-0 w-0.5 bg-foreground/70"
          style={{ left: `${meta}%` }}
        />
        <span
          className="absolute inset-y-0 flex items-center px-2 text-[11px] font-bold tabular-nums text-foreground"
          style={{ left: 0 }}
        >
          {retorno.toFixed(1).replace(".", ",")}×
        </span>
      </div>
      <div className="mt-1 flex justify-between text-[10px] text-muted-foreground">
        <span>Retorno por real investido</span>
        <span style={{ marginRight: `${Math.max(100 - meta - 6, 0)}%` }}>meta {META_RETORNO}×</span>
      </div>
    </div>
  );
}

function Cell({ label, value, destaque }: { label: string; value: string; destaque?: boolean }) {
  return (
    <div
      className={cn(
        "min-w-0 rounded-xl border px-3 py-2.5",
        destaque ? "border-[var(--viz-1)]/35 bg-[var(--viz-1)]/8" : "border-border",
      )}
    >
      <p className="truncate text-sm font-bold tabular-nums text-foreground">{value}</p>
      <p className="mt-0.5 truncate text-[10px] text-muted-foreground">{label}</p>
    </div>
  );
}
