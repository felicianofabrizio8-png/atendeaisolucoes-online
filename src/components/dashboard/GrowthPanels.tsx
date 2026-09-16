import { Link } from "@tanstack/react-router";
import { AlertTriangle, ArrowRight, Facebook, Instagram, Megaphone, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatBRL } from "@/lib/campaigns";
import type { MarketingContentChannel } from "@/lib/marketing/marketing.types";
import type { DashboardData } from "./useDashboardData";

export function CampaignsPanel({ data }: { data: DashboardData }) {
  const active = data.campaigns.filter((item) => item.meta_delivery_status === "active_on_meta" || item.status === "active");
  const leads = data.campaigns.reduce((sum, item) => sum + item.leads_count, 0);
  const invested = data.campaigns.reduce((sum, item) => sum + Number(item.spent || 0), 0);
  return (
    <section aria-labelledby="campaign-title" className="col-span-12 rounded-lg border bg-card/70 p-5 lg:col-span-4">
      <PanelTitle id="campaign-title" icon={Megaphone} title="Campanhas" subtitle="Desempenho real consolidado" />
      {data.loadingGrowth ? <Empty text="Carregando campanhas…" /> : data.campaigns.length === 0 ? <Empty text="Nenhuma campanha cadastrada." /> : <div className="mt-5 grid grid-cols-2 gap-3"><Metric label="Ativas" value={String(active.length)} /><Metric label="Leads" value={String(leads)} /><Metric label="Investimento" value={formatBRL(invested)} /><Metric label="Custo por lead" value={leads ? formatBRL(invested / leads) : "—"} /></div>}
      <Button asChild variant="outline" className="mt-5 w-full"><Link to="/campanhas">Ver campanhas <ArrowRight /></Link></Button>
    </section>
  );
}

export function MarketingPanel({ data }: { data: DashboardData }) {
  return (
    <section aria-labelledby="marketing-title" className="col-span-12 rounded-lg border bg-card/70 p-5 lg:col-span-4">
      <PanelTitle id="marketing-title" icon={Sparkles} title="Marketing" subtitle="Ritmo de conteúdo por rede" />
      <div className="mt-5 space-y-3"><NetworkRow channel="instagram" label="Instagram" icon={Instagram} data={data} /><NetworkRow channel="facebook" label="Facebook" icon={Facebook} data={data} /></div>
      <Button asChild className="mt-5 w-full"><Link to="/marketing">Criar publicação <ArrowRight /></Link></Button>
    </section>
  );
}

export function AttentionPanel({ data }: { data: DashboardData }) {
  const rows = [
    { label: "Aguardando humano", count: data.conversations.filter((item) => item.aiStatus === "aguardando_humano").length },
    { label: "Leads sem resposta", count: data.conversations.filter((item) => item.awaitingReply).length },
    { label: "Campanhas com problema", count: data.campaigns.filter((item) => item.meta_delivery_status === "issues_on_meta" || item.meta_sync_status === "failed").length },
    { label: "Publicações com falha", count: data.schedule.filter((item) => item.status === "failed").length },
  ].filter((item) => item.count > 0);
  return (
    <section aria-labelledby="attention-title" className="col-span-12 rounded-lg border bg-card/70 p-5 lg:col-span-4">
      <PanelTitle id="attention-title" icon={AlertTriangle} title="Precisa da sua atenção" subtitle={data.attentionCount ? `${data.attentionCount} sinais ativos` : "Operação sem pendências"} alert={data.attentionCount > 0} />
      {rows.length === 0 ? <Empty text="Tudo em ordem por aqui." /> : <ul className="mt-5 divide-y rounded-md border bg-background/45">{rows.map((row) => <li key={row.label} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-3 py-3"><span className="truncate text-sm">{row.label}</span><strong className="text-sm text-status-warm">{row.count}</strong></li>)}</ul>}
      <Button asChild variant="outline" className="mt-5 w-full"><Link to="/inbox">Revisar pendências <ArrowRight /></Link></Button>
    </section>
  );
}

function NetworkRow({ channel, label, icon: Icon, data }: { channel: MarketingContentChannel; label: string; icon: typeof Instagram; data: DashboardData }) {
  const scheduled = data.schedule.filter((item) => item.channel === channel && ["planned", "queued"].includes(item.status)).length;
  const published = data.schedule.filter((item) => item.channel === channel && item.status === "published").sort((a, b) => +new Date(b.scheduled_at) - +new Date(a.scheduled_at))[0];
  return <div className="rounded-md border bg-background/45 p-3"><div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2"><span className="flex min-w-0 items-center gap-2 text-sm font-medium"><Icon className="h-4 w-4 shrink-0 text-primary" />{label}</span><span className="text-xs text-muted-foreground">{scheduled} programada{scheduled === 1 ? "" : "s"}</span></div><p className="mt-2 text-xs text-muted-foreground">{published ? `Última publicação em ${new Date(published.scheduled_at).toLocaleDateString("pt-BR")}` : "Nenhuma publicação registrada"}</p></div>;
}

function PanelTitle({ id, icon: Icon, title, subtitle, alert }: { id: string; icon: typeof Megaphone; title: string; subtitle: string; alert?: boolean }) { return <div className="flex items-start gap-3"><span className={alert ? "grid h-9 w-9 shrink-0 place-items-center rounded-md bg-status-warm/10 text-status-warm" : "grid h-9 w-9 shrink-0 place-items-center rounded-md bg-primary/10 text-primary"}><Icon className="h-4 w-4" /></span><div className="min-w-0"><h2 id={id} className="truncate font-semibold">{title}</h2><p className="text-xs text-muted-foreground">{subtitle}</p></div></div>; }
function Metric({ label, value }: { label: string; value: string }) { return <div className="rounded-md border bg-background/45 p-3"><div className="truncate text-lg font-semibold">{value}</div><div className="text-xs text-muted-foreground">{label}</div></div>; }
function Empty({ text }: { text: string }) { return <div className="mt-5 rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">{text}</div>; }