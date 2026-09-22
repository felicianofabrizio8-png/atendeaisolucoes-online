import { Link } from "@tanstack/react-router";
import { ArrowRight, Bot, CheckCircle2, Clock3, MessageSquare, UserRoundCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { getLeadById } from "@/data/leadRepo";
import { timeAgo } from "@/data/mock";
import type { DashboardData } from "./useDashboardData";

export function AICommand({ data }: { data: DashboardData }) {
  const active = data.conversations.filter((item) => item.aiHandling).length;
  const completed = data.conversations.filter((item) => item.aiStatus === "pre_atendido_ia").length;
  const waitingHuman = data.conversations.filter((item) => item.aiStatus === "aguardando_humano").length;
  const recent = [...data.conversations]
    .filter((item) => item.aiHandling || Boolean(item.aiStatus))
    .sort((a, b) => +new Date(b.lastMessageAt) - +new Date(a.lastMessageAt))
    .slice(0, 4);

  return (
    <section aria-labelledby="ai-title" className="col-span-12 overflow-hidden rounded-lg border border-primary/25 bg-card/80 lg:col-span-8">
      <div className="grid gap-5 p-5 md:grid-cols-[minmax(0,1fr)_260px]">
        <div className="min-w-0">
          <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3">
            <div className="flex min-w-0 items-center gap-3"><span className="grid h-10 w-10 shrink-0 place-items-center rounded-md bg-primary/10 text-primary"><Bot className="h-5 w-5" /></span><div className="min-w-0"><h2 id="ai-title" className="truncate font-semibold">Vendedora IA</h2><p className="text-xs text-muted-foreground">Atendimento automatizado em tempo real</p></div></div>
            <span className="inline-flex shrink-0 items-center gap-2 rounded-md border border-status-won/25 bg-status-won/10 px-2.5 py-1 text-xs font-medium text-status-won"><span className="h-1.5 w-1.5 rounded-full bg-status-won motion-safe:animate-pulse" />Operando</span>
          </div>
          <div className="mt-6 grid grid-cols-3 gap-2">
            <AiMetric icon={MessageSquare} label="Em atendimento" value={active} />
            <AiMetric icon={CheckCircle2} label="Concluídas" value={completed} />
            <AiMetric icon={UserRoundCheck} label="Aguardando humano" value={waitingHuman} alert={waitingHuman > 0} />
          </div>
          <Button asChild className="mt-5"><Link to="/inbox">Acompanhar atendimentos <ArrowRight /></Link></Button>
        </div>
        <div className="border-t pt-4 md:border-l md:border-t-0 md:pl-5 md:pt-0">
          <div className="mb-3 flex items-center gap-2 text-xs font-medium text-muted-foreground"><Clock3 className="h-3.5 w-3.5" />Últimas conversas</div>
          {recent.length === 0 ? <Empty text="Nenhuma conversa da IA registrada." /> : <ul className="space-y-1">{recent.map((item) => <li key={item.id}><Link to="/inbox/$conversationId" params={{ conversationId: item.id }} className="grid grid-cols-[minmax(0,1fr)_auto] gap-2 rounded-md px-2 py-2 hover:bg-accent/50"><span className="truncate text-xs font-medium">{getLeadById(item.leadId)?.name ?? "Contato"}</span><span className="text-[11px] text-muted-foreground">{timeAgo(item.lastMessageAt)}</span></Link></li>)}</ul>}
        </div>
      </div>
    </section>
  );
}

function AiMetric({ icon: Icon, label, value, alert }: { icon: typeof Bot; label: string; value: number; alert?: boolean }) {
  return <div className="min-w-0 rounded-md border bg-background/45 p-3"><Icon className={alert ? "h-4 w-4 text-status-warm" : "h-4 w-4 text-primary"} /><div className="mt-3 text-2xl font-semibold">{value}</div><div className="mt-1 text-xs leading-tight text-muted-foreground">{label}</div></div>;
}

function Empty({ text }: { text: string }) { return <div className="rounded-md border border-dashed p-4 text-center text-xs text-muted-foreground">{text}</div>; }