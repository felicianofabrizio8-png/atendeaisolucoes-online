import { useEffect, useState } from "react";
import { AlertCircle, ArrowRight, CalendarDays, CheckCircle2, Plus, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { apiListContents, apiListSchedule } from "@/data/marketingRepo";
import type { MarketingContentRow, MarketingScheduleRow } from "@/lib/marketing/marketing.types";

interface Props { companyId: string; onCreate?: () => void; }
export function MarketingDashboard({ companyId, onCreate }: Props) {
  const [contents, setContents] = useState<MarketingContentRow[]>([]);
  const [schedule, setSchedule] = useState<MarketingScheduleRow[]>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let active = true;
    void Promise.all([apiListContents().catch(() => []), apiListSchedule().catch(() => [])]).then(([c, s]) => {
      if (!active) return;
      setContents(c); setSchedule(s); setLoading(false);
    });
    return () => { active = false; };
  }, [companyId]);
  const review = contents.filter((item) => item.status === "draft" || item.status === "pending");
  const failures = schedule.filter((item) => item.status === "failed");
  const upcoming = schedule.filter((item) => item.status === "planned" || item.status === "queued").slice(0, 5);
  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 rounded-2xl border bg-card p-5 sm:flex-row sm:items-center sm:justify-between">
        <div><p className="text-sm font-medium text-primary">Marketing IA</p><h2 className="mt-1 text-2xl font-semibold tracking-tight">O que vamos criar hoje?</h2><p className="mt-1 max-w-xl text-sm text-muted-foreground">Crie uma campanha, revise com calma e publique quando estiver pronta.</p></div>
        <Button onClick={onCreate} className="shrink-0"><Plus className="mr-2 h-4 w-4" /> Criar conteúdo</Button>
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <AttentionCard icon={Sparkles} label="Para revisar" value={review.length} tone={review.length ? "primary" : "neutral"} />
        <AttentionCard icon={CalendarDays} label="Próximos" value={upcoming.length} tone="neutral" />
        <AttentionCard icon={AlertCircle} label="Falhas" value={failures.length} tone={failures.length ? "danger" : "neutral"} />
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <section className="rounded-xl border bg-card p-4"><div className="mb-3 flex items-center justify-between"><div><h3 className="font-semibold">Precisa de atenção</h3><p className="text-xs text-muted-foreground">Conteúdos que ainda não foram aprovados.</p></div><ArrowRight className="h-4 w-4 text-muted-foreground" /></div>{loading ? <p className="text-sm text-muted-foreground">Carregando…</p> : review.length ? <div className="space-y-2">{review.slice(0, 4).map((item) => <div key={item.id} className="rounded-lg border p-3"><div className="text-xs uppercase text-muted-foreground">{item.format}</div><div className="mt-1 line-clamp-2 text-sm font-medium">{item.title || item.body}</div></div>)}</div> : <div className="flex items-center gap-2 py-5 text-sm text-muted-foreground"><CheckCircle2 className="h-4 w-4 text-emerald-500" /> Tudo revisado por enquanto.</div>}</section>
        <section className="rounded-xl border bg-card p-4"><div className="mb-3"><h3 className="font-semibold">Próximas publicações</h3><p className="text-xs text-muted-foreground">Planejamentos já aprovados.</p></div>{loading ? <p className="text-sm text-muted-foreground">Carregando…</p> : upcoming.length ? <div className="space-y-2">{upcoming.map((item) => <div key={item.id} className="flex items-center justify-between gap-3 rounded-lg border p-3"><div className="min-w-0"><div className="truncate text-sm font-medium">{new Date(item.scheduled_at).toLocaleString("pt-BR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}</div><div className="text-xs text-muted-foreground">{item.channel}</div></div><CalendarDays className="h-4 w-4 shrink-0 text-muted-foreground" /></div>)}</div> : <p className="py-5 text-sm text-muted-foreground">Nenhuma publicação programada.</p>}</section>
      </div>
      {failures.length > 0 && <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm"><div className="flex items-center gap-2 font-medium text-destructive"><AlertCircle className="h-4 w-4" /> Há publicações que precisam ser reprocessadas.</div><p className="mt-1 text-muted-foreground">Abra Publicar para ver o motivo e tentar novamente.</p></div>}
    </div>
  );
}
function AttentionCard({ icon: Icon, label, value, tone }: { icon: typeof Sparkles; label: string; value: number; tone: "primary" | "danger" | "neutral" }) { return <div className={`rounded-xl border p-4 ${tone === "danger" ? "border-destructive/30 bg-destructive/5" : tone === "primary" ? "border-primary/30 bg-primary/5" : "bg-card"}`}><Icon className="h-4 w-4 text-muted-foreground" /><div className="mt-3 text-2xl font-semibold">{value}</div><div className="text-sm text-muted-foreground">{label}</div></div>; }