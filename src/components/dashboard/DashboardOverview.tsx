import { Facebook, Instagram, MessageCircle, Target, FileText, Trophy, Users } from "lucide-react";
import type { DashboardData } from "./useDashboardData";

const channels = [
  { key: "whatsapp", label: "WhatsApp", icon: MessageCircle, tone: "text-channel-whatsapp bg-channel-whatsapp/10" },
  { key: "instagram", label: "Instagram", icon: Instagram, tone: "text-channel-instagram bg-channel-instagram/10" },
  { key: "facebook", label: "Facebook", icon: Facebook, tone: "text-channel-facebook bg-channel-facebook/10" },
] as const;

export function CustomerOrigins({ data }: { data: DashboardData }) {
  return (
    <section aria-labelledby="origins-title" className="col-span-12 rounded-lg border bg-card/70 p-4 lg:col-span-7">
      <div className="mb-4">
        <h2 id="origins-title" className="font-semibold">Origem dos clientes</h2>
        <p className="text-xs text-muted-foreground">Contatos e conversas cadastrados por canal</p>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {channels.map(({ key, label, icon: Icon, tone }) => {
          const leads = data.leads.filter((lead) => lead.channel === key).length;
          const conversations = data.conversations.filter((item) => item.channel === key).length;
          return (
            <div key={key} className="rounded-md border bg-background/45 p-4">
              <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3">
                <span className="truncate text-sm font-medium">{label}</span>
                <span className={`grid h-8 w-8 shrink-0 place-items-center rounded-md ${tone}`}><Icon className="h-4 w-4" /></span>
              </div>
              <div className="mt-5 grid grid-cols-2 gap-3">
                <Metric label="Contatos" value={leads} />
                <Metric label="Conversas" value={conversations} />
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

export function CommercialSummary({ data }: { data: DashboardData }) {
  const opportunities = data.leads.filter((lead) => ["quente", "morno", "aguardando"].includes(lead.status)).length;
  const sales = data.leads.filter((lead) => lead.status === "fechado").length;
  const conversion = data.leads.length > 0 ? `${((sales / data.leads.length) * 100).toFixed(1)}%` : "—";
  const items = [
    { label: "Leads", value: data.leads.length, icon: Users },
    { label: "Oportunidades", value: opportunities, icon: Target },
    { label: "Orçamentos", value: data.quotes.length, icon: FileText },
    { label: "Vendas", value: sales, icon: Trophy },
  ];
  return (
    <section aria-labelledby="commercial-title" className="col-span-12 rounded-lg border bg-card/70 p-4 lg:col-span-5">
      <h2 id="commercial-title" className="font-semibold">Resumo comercial</h2>
      <p className="text-xs text-muted-foreground">Indicadores atuais da operação</p>
      <div className="mt-4 grid grid-cols-2 gap-3">
        {items.map(({ label, value, icon: Icon }) => (
          <div key={label} className="rounded-md border bg-background/45 p-3">
            <Icon className="h-4 w-4 text-primary" />
            <div className="mt-3 text-2xl font-semibold">{value}</div>
            <div className="text-xs text-muted-foreground">{label}</div>
          </div>
        ))}
      </div>
      <div className="mt-3 flex items-center justify-between rounded-md border bg-background/45 px-4 py-3">
        <span className="text-sm text-muted-foreground">Conversão</span>
        <strong className="text-lg text-status-won">{conversion}</strong>
      </div>
    </section>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return <div><div className="text-2xl font-semibold">{value}</div><div className="text-xs text-muted-foreground">{label}</div></div>;
}