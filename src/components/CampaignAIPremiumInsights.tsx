// ============================================================================
// CampaignAIPremiumInsights — Painel visual/analítico ADICIONADO ao Gestor IA.
// Somente leitura. Não altera campanhas, publicação Meta, sincronização, regras
// nem comportamentos já validados. Apenas calcula métricas derivadas a partir
// de dados já sincronizados (campaign_metrics, campaign_creatives, campaigns).
// ============================================================================

import { useEffect, useMemo, useState } from "react";
import {
  Loader2,
  TrendingUp,
  TrendingDown,
  Minus,
  Trophy,
  Target,
  Zap,
  AlertOctagon,
  Sparkles,
  ArrowRight,
  Wand2,
  Copy as CopyIcon,
  Files,
  BarChart3,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

// ---------- Tipos ----------

interface MetricRow {
  metric_date: string | null;
  impressions: number;
  clicks: number;
  ctr: number;
  cpc: number;
  cpm: number;
  spent: number;
  messages: number;
  leads: number;
  reach: number;
}
interface CreativeRow {
  id: string;
  title: string;
  primary_text: string | null;
  cta: string | null;
  image_url: string | null;
}
interface CampaignBasics {
  id: string;
  name: string;
  status: string;
  daily_budget: number | null;
  start_date: string | null;
  spent: number | null;
  created_at: string;
}

// ---------- Helpers ----------

function fmtNumber(n: number, digits = 0): string {
  if (!Number.isFinite(n)) return "—";
  return n.toLocaleString("pt-BR", { minimumFractionDigits: digits, maximumFractionDigits: digits });
}
function fmtBRL(n: number): string {
  if (!Number.isFinite(n)) return "—";
  return n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}
function fmtPct(n: number, digits = 2): string {
  if (!Number.isFinite(n)) return "—";
  return `${n.toFixed(digits)}%`;
}
function daysBetween(a: Date, b: Date): number {
  return Math.max(0, Math.round((b.getTime() - a.getTime()) / 86400000));
}

// Soma agregada de um conjunto de rows (recalcula CTR/CPC/CPM).
function aggregate(rows: MetricRow[]) {
  const impressions = rows.reduce((s, r) => s + (r.impressions || 0), 0);
  const clicks = rows.reduce((s, r) => s + (r.clicks || 0), 0);
  const spent = rows.reduce((s, r) => s + (Number(r.spent) || 0), 0);
  const messages = rows.reduce((s, r) => s + (r.messages || 0), 0);
  const leads = rows.reduce((s, r) => s + (r.leads || 0), 0);
  const reach = rows.reduce((s, r) => s + (r.reach || 0), 0);
  const ctr = impressions > 0 ? (clicks / impressions) * 100 : 0;
  const cpc = clicks > 0 ? spent / clicks : 0;
  const cpm = impressions > 0 ? (spent / impressions) * 1000 : 0;
  return { impressions, clicks, spent, messages, leads, reach, ctr, cpc, cpm };
}

// Score 0..100 — baseado em CTR, CPC, CPM, leads, mensagens e tempo ativo.
function computeScore(agg: ReturnType<typeof aggregate>, daysActive: number): number {
  let score = 50;
  // CTR (ref: ~1% bom, 2%+ excelente)
  if (agg.impressions >= 200) {
    if (agg.ctr >= 2) score += 18;
    else if (agg.ctr >= 1) score += 10;
    else if (agg.ctr >= 0.5) score += 2;
    else score -= 10;
  }
  // CPC (ref: <= R$0.80 bom; >= R$3 ruim)
  if (agg.clicks >= 20) {
    if (agg.cpc > 0 && agg.cpc <= 0.8) score += 10;
    else if (agg.cpc <= 1.5) score += 4;
    else if (agg.cpc >= 3) score -= 10;
  }
  // CPM (ref: <= R$15 bom; >= R$40 ruim)
  if (agg.impressions >= 500) {
    if (agg.cpm > 0 && agg.cpm <= 15) score += 6;
    else if (agg.cpm >= 40) score -= 6;
  }
  // Leads / mensagens
  if (daysActive >= 1) {
    const leadsPerDay = agg.leads / Math.max(1, daysActive);
    if (leadsPerDay >= 3) score += 14;
    else if (leadsPerDay >= 1) score += 8;
    else if (leadsPerDay >= 0.3) score += 3;
    else if (agg.spent > 50 && leadsPerDay < 0.1) score -= 12;

    const msgsPerDay = agg.messages / Math.max(1, daysActive);
    if (msgsPerDay >= 5) score += 6;
    else if (msgsPerDay >= 2) score += 3;
  }
  // Maturidade — campanhas muito novas não devem pontuar 100
  if (daysActive < 3) score = Math.min(score, 78);
  if (daysActive < 1) score = Math.min(score, 60);

  return Math.max(0, Math.min(100, Math.round(score)));
}

function scoreClassification(score: number): { label: string; tone: "excellent" | "good" | "warn" | "critical"; cls: string } {
  if (score >= 90) return { label: "Excelente", tone: "excellent", cls: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/30" };
  if (score >= 75) return { label: "Boa", tone: "good", cls: "bg-sky-500/15 text-sky-600 dark:text-sky-400 border-sky-500/30" };
  if (score >= 60) return { label: "Atenção", tone: "warn", cls: "bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/30" };
  return { label: "Crítica", tone: "critical", cls: "bg-destructive/15 text-destructive border-destructive/30" };
}

interface Bottleneck {
  area: "Criativo" | "Público" | "Orçamento" | "Conversão WhatsApp" | "Frequência elevada" | "Sem gargalo evidente";
  explanation: string;
}

function detectBottleneck(agg: ReturnType<typeof aggregate>, daysActive: number, dailyBudget: number | null): Bottleneck {
  if (agg.impressions < 200 && daysActive >= 1) {
    return { area: "Orçamento", explanation: "Volume de impressões muito baixo. O orçamento ou o público estão restringindo a entrega." };
  }
  if (agg.impressions >= 500 && agg.ctr < 0.6) {
    return { area: "Criativo", explanation: "O criativo não está atraindo cliques. CTR abaixo da média — vale testar nova imagem/título." };
  }
  if (agg.clicks >= 30 && agg.cpc >= 3) {
    return { area: "Público", explanation: "Custo por clique elevado. O público pode estar caro ou pouco qualificado." };
  }
  if (agg.clicks >= 20 && agg.messages < agg.clicks * 0.1) {
    return { area: "Conversão WhatsApp", explanation: "Muitos cliques, poucas conversas. Revise a primeira mensagem e o fluxo de entrada." };
  }
  if (agg.impressions >= 2000 && agg.spent > 0 && agg.reach && agg.impressions / Math.max(1, agg.reach) > 3) {
    return { area: "Frequência elevada", explanation: "O mesmo público está vendo o anúncio muitas vezes. Hora de renovar o criativo." };
  }
  if (dailyBudget && agg.spent > 0 && daysActive >= 3 && agg.leads === 0) {
    return { area: "Orçamento", explanation: "Investimento sem retorno de leads. Considere pausar e revisar criativo + público." };
  }
  return { area: "Sem gargalo evidente", explanation: "A campanha está equilibrada. Continue monitorando." };
}

// ---------- Componente ----------

export function CampaignAIPremiumInsights({ campaignId }: { campaignId: string }) {
  const [loading, setLoading] = useState(true);
  const [campaign, setCampaign] = useState<CampaignBasics | null>(null);
  const [metrics, setMetrics] = useState<MetricRow[]>([]);
  const [creatives, setCreatives] = useState<CreativeRow[]>([]);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      try {
        const [{ data: camp }, { data: mets }, { data: cres }] = await Promise.all([
          supabase
            .from("campaigns")
            .select("id,name,status,daily_budget,start_date,spent,created_at")
            .eq("id", campaignId)
            .maybeSingle(),
          supabase
            .from("campaign_metrics")
            .select("metric_date,impressions,clicks,ctr,cpc,cpm,spent,messages,leads,reach")
            .eq("campaign_id", campaignId)
            .order("metric_date", { ascending: false })
            .limit(90),
          supabase
            .from("campaign_creatives")
            .select("id,title,primary_text,cta,image_url")
            .eq("campaign_id", campaignId)
            .order("created_at", { ascending: true }),
        ]);
        if (cancelled) return;
        setCampaign(camp as CampaignBasics | null);
        setMetrics((mets ?? []) as MetricRow[]);
        setCreatives((cres ?? []) as CreativeRow[]);
      } catch (e) {
        console.warn("[premium-insights] load failed", e);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => { cancelled = true; };
  }, [campaignId]);

  const computed = useMemo(() => {
    if (!campaign) return null;
    const today = new Date();
    const startRef = campaign.start_date ? new Date(campaign.start_date) : new Date(campaign.created_at);
    const daysActive = Math.max(1, daysBetween(startRef, today));

    // Janelas
    const dated = metrics.filter((m) => m.metric_date);
    const sortedAsc = [...dated].sort((a, b) => (a.metric_date! < b.metric_date! ? -1 : 1));
    const last7 = sortedAsc.slice(-7);
    const prev7 = sortedAsc.slice(-14, -7);
    const aggAll = aggregate(metrics);
    const agg7 = aggregate(last7);
    const aggPrev = aggregate(prev7);

    const totalDaysWithData = Math.max(1, sortedAsc.length);
    const leadsPerDay = aggAll.leads / Math.max(1, Math.min(daysActive, totalDaysWithData));
    const messagesPerDay = aggAll.messages / Math.max(1, Math.min(daysActive, totalDaysWithData));

    const score = computeScore(aggAll, daysActive);
    const cls = scoreClassification(score);

    const today0 = new Date(); today0.setHours(0, 0, 0, 0);
    const todayKey = today0.toISOString().slice(0, 10);
    const todayRow = sortedAsc.find((r) => r.metric_date === todayKey);
    const spentToday = todayRow ? Number(todayRow.spent) || 0 : 0;

    // Projeções (faixas conservador/otimista)
    const proj = (days: number) => {
      const base = leadsPerDay * days;
      const low = Math.max(0, Math.floor(base * 0.7));
      const high = Math.max(low, Math.ceil(base * 1.3));
      return { low, high };
    };

    // Comparação 7d vs 7d anteriores
    const delta = (cur: number, prev: number) => {
      if (!prev) return cur > 0 ? 100 : 0;
      return ((cur - prev) / prev) * 100;
    };
    const compare = aggPrev.impressions > 0 || aggPrev.clicks > 0 || aggPrev.leads > 0
      ? {
          ctr: delta(agg7.ctr, aggPrev.ctr),
          cpc: delta(agg7.cpc, aggPrev.cpc),
          cpm: delta(agg7.cpm, aggPrev.cpm),
          leads: delta(agg7.leads, aggPrev.leads),
          messages: delta(agg7.messages, aggPrev.messages),
        }
      : null;

    const bottleneck = detectBottleneck(aggAll, daysActive, campaign.daily_budget);

    // Próxima ação sugerida (heurística determinística)
    let nextAction: { title: string; impact: "Alto" | "Médio" | "Baixo"; reason: string };
    if (bottleneck.area === "Criativo") {
      nextAction = { title: "Trocar criativo principal", impact: "Alto", reason: "CTR abaixo da média indica criativo cansado ou pouco atrativo." };
    } else if (bottleneck.area === "Conversão WhatsApp") {
      nextAction = { title: "Revisar mensagem de boas-vindas", impact: "Alto", reason: "Cliques chegam mas não viram conversa — o gargalo está na entrada do WhatsApp." };
    } else if (bottleneck.area === "Público") {
      nextAction = { title: "Refinar segmentação de público", impact: "Médio", reason: "CPC elevado sugere público pouco qualificado para o produto." };
    } else if (bottleneck.area === "Orçamento") {
      nextAction = { title: "Ajustar orçamento diário", impact: "Médio", reason: "Volume de entrega insuficiente para validar o anúncio." };
    } else if (bottleneck.area === "Frequência elevada") {
      nextAction = { title: "Renovar variações criativas", impact: "Médio", reason: "O público já viu o anúncio muitas vezes — começa a saturar." };
    } else {
      nextAction = { title: "Manter rumo e ampliar gradualmente", impact: "Baixo", reason: "A campanha está saudável. Pequenos aumentos de orçamento podem escalar resultados." };
    }

    return {
      daysActive,
      score,
      cls,
      aggAll,
      agg7,
      aggPrev,
      compare,
      bottleneck,
      nextAction,
      proj7: proj(7),
      proj30: proj(30),
      spentToday,
      leadsPerDay,
      messagesPerDay,
    };
  }, [campaign, metrics]);

  if (loading) {
    return (
      <div className="rounded-xl border bg-card p-6 text-center text-sm text-muted-foreground flex items-center justify-center gap-2">
        <Loader2 className="h-4 w-4 animate-spin" /> Calculando insights da campanha…
      </div>
    );
  }
  if (!campaign || !computed) return null;

  const { score, cls, aggAll, compare, bottleneck, nextAction, proj7, proj30, spentToday } = computed;

  return (
    <div className="space-y-4">
      {/* SCORE + MÉTRICAS RESUMO */}
      <section className={cn("rounded-xl border-2 bg-card p-4 md:p-5 space-y-4", cls.cls)}>
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-4">
            <div className="relative h-20 w-20 shrink-0">
              <ScoreRing score={score} tone={cls.tone} />
            </div>
            <div className="min-w-0">
              <div className="text-[11px] uppercase tracking-wide font-semibold flex items-center gap-1.5">
                <Sparkles className="h-3 w-3" /> Score da campanha
              </div>
              <div className="text-2xl md:text-3xl font-bold leading-tight">
                {score}<span className="text-base font-medium text-muted-foreground">/100</span>
              </div>
              <span className={cn("inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold border", cls.cls)}>
                {cls.label}
              </span>
            </div>
          </div>
          <div className="text-xs text-muted-foreground text-right max-w-xs">
            Baseado em CTR, CPC, CPM, leads, mensagens e tempo ativo da campanha.
            <br />
            <span className="text-[11px]">{computed.daysActive} {computed.daysActive === 1 ? "dia ativo" : "dias ativos"}</span>
          </div>
        </div>

        {/* Métricas resumidas */}
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-2">
          <MetricChip label="Invest. total" value={fmtBRL(aggAll.spent)} />
          <MetricChip label="Invest. hoje" value={fmtBRL(spentToday)} />
          <MetricChip label="Leads" value={fmtNumber(aggAll.leads)} />
          <MetricChip label="Mensagens" value={fmtNumber(aggAll.messages)} />
          <MetricChip label="CPC" value={aggAll.cpc > 0 ? fmtBRL(aggAll.cpc) : "—"} />
          <MetricChip label="CTR" value={aggAll.impressions > 0 ? fmtPct(aggAll.ctr) : "—"} />
          <MetricChip label="CPM" value={aggAll.cpm > 0 ? fmtBRL(aggAll.cpm) : "—"} />
        </div>
      </section>

      {/* PROJEÇÃO + GARGALO + PRÓXIMA AÇÃO */}
      <div className="grid md:grid-cols-3 gap-4">
        <section className="rounded-xl border bg-card p-4 space-y-3">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <Target className="h-4 w-4 text-primary" /> Projeção IA
          </div>
          <p className="text-xs text-muted-foreground">Mantendo o desempenho atual:</p>
          <div className="space-y-2">
            <ProjectionRow days={7} low={proj7.low} high={proj7.high} />
            <ProjectionRow days={30} low={proj30.low} high={proj30.high} />
          </div>
          <p className="text-[11px] text-muted-foreground">
            Estimativa baseada em {fmtNumber(computed.leadsPerDay, 2)} leads/dia observados.
          </p>
        </section>

        <section className="rounded-xl border bg-card p-4 space-y-3">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <AlertOctagon className="h-4 w-4 text-amber-500" /> Gargalo principal
          </div>
          <div className="rounded-lg bg-amber-500/10 border border-amber-500/30 px-3 py-2">
            <div className="text-sm font-semibold text-amber-700 dark:text-amber-400">{bottleneck.area}</div>
            <p className="text-xs text-muted-foreground mt-1">{bottleneck.explanation}</p>
          </div>
        </section>

        <section className="rounded-xl border bg-card p-4 space-y-3">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <Zap className="h-4 w-4 text-primary" /> Próxima ação sugerida
          </div>
          <div className="rounded-lg border bg-primary/5 px-3 py-2">
            <div className="text-sm font-semibold">{nextAction.title}</div>
            <div className="text-[11px] text-muted-foreground mt-1">
              Impacto esperado: <span className={cn(
                "font-semibold",
                nextAction.impact === "Alto" && "text-emerald-600 dark:text-emerald-400",
                nextAction.impact === "Médio" && "text-amber-600 dark:text-amber-400",
                nextAction.impact === "Baixo" && "text-muted-foreground",
              )}>{nextAction.impact}</span>
            </div>
            <p className="text-xs text-muted-foreground mt-1">Motivo: {nextAction.reason}</p>
          </div>
        </section>
      </div>

      {/* COMPARAÇÃO 7D vs 7D ANTERIORES */}
      {compare && (
        <section className="rounded-xl border bg-card p-4 space-y-3">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <BarChart3 className="h-4 w-4 text-primary" /> Comparação: últimos 7 dias vs período anterior
          </div>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
            <CompareChip label="CTR" deltaPct={compare.ctr} betterWhen="up" />
            <CompareChip label="CPC" deltaPct={compare.cpc} betterWhen="down" />
            <CompareChip label="CPM" deltaPct={compare.cpm} betterWhen="down" />
            <CompareChip label="Leads" deltaPct={compare.leads} betterWhen="up" />
            <CompareChip label="Mensagens" deltaPct={compare.messages} betterWhen="up" />
          </div>
        </section>
      )}

      {/* RANKING DE CRIATIVOS */}
      {creatives.length > 1 && (
        <section className="rounded-xl border bg-card p-4 space-y-3">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <Trophy className="h-4 w-4 text-amber-500" /> Ranking dos criativos
          </div>
          <ul className="space-y-2">
            {creatives.slice(0, 3).map((cr, i) => (
              <li key={cr.id} className="flex items-center gap-3 rounded-lg border p-2.5">
                <div className="text-xl shrink-0">{["🥇", "🥈", "🥉"][i] ?? "•"}</div>
                {cr.image_url ? (
                  <img src={cr.image_url} alt="" className="h-10 w-10 rounded object-cover shrink-0" />
                ) : (
                  <div className="h-10 w-10 rounded bg-muted shrink-0" />
                )}
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium truncate">{cr.title || `Criativo ${i + 1}`}</div>
                  <div className="text-[11px] text-muted-foreground truncate">{cr.primary_text || "—"}</div>
                </div>
              </li>
            ))}
          </ul>
          <p className="text-[11px] text-muted-foreground">
            Posição inicial pela ordem de criação. CTR por criativo aparece aqui após sincronização ad-level da Meta.
          </p>
        </section>
      )}

      {/* AÇÕES RECOMENDADAS (apenas sugestões — nada é aplicado) */}
      <section className="rounded-xl border bg-card p-4 space-y-3">
        <div className="flex items-center gap-2 text-sm font-semibold">
          <Wand2 className="h-4 w-4 text-primary" /> Ações que a IA pode sugerir
        </div>
        <p className="text-[11px] text-muted-foreground">
          A IA apenas gera sugestões. Nada é aplicado automaticamente.
        </p>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
          <ActionButton icon={<Sparkles className="h-3.5 w-3.5" />} label="Gerar novo criativo"
            onClick={() => toast.info("Use o botão 'Analisar campanha' para receber ideias de novos criativos.")} />
          <ActionButton icon={<Wand2 className="h-3.5 w-3.5" />} label="Melhorar texto"
            onClick={() => toast.info("Use o botão 'Analisar campanha' para receber sugestões de texto.")} />
          <ActionButton icon={<Files className="h-3.5 w-3.5" />} label="Duplicar campanha"
            onClick={() => toast.info("Vá em Campanhas e use o menu da campanha para duplicar.")} />
          <ActionButton icon={<BarChart3 className="h-3.5 w-3.5" />} label="Gerar análise avançada"
            onClick={() => toast.info("Clique em 'Analisar campanha' acima para gerar uma nova análise.")} />
        </div>
      </section>
    </div>
  );
}

// ---------- Subcomponentes ----------

function ScoreRing({ score, tone }: { score: number; tone: "excellent" | "good" | "warn" | "critical" }) {
  const r = 32;
  const c = 2 * Math.PI * r;
  const offset = c - (score / 100) * c;
  const stroke =
    tone === "excellent" ? "rgb(16 185 129)" :
    tone === "good" ? "rgb(14 165 233)" :
    tone === "warn" ? "rgb(245 158 11)" :
    "rgb(239 68 68)";
  return (
    <svg viewBox="0 0 80 80" className="h-20 w-20 -rotate-90">
      <circle cx="40" cy="40" r={r} stroke="currentColor" strokeOpacity="0.15" strokeWidth="7" fill="none" />
      <circle cx="40" cy="40" r={r} stroke={stroke} strokeWidth="7" fill="none"
        strokeDasharray={c} strokeDashoffset={offset} strokeLinecap="round" />
    </svg>
  );
}

function MetricChip({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border bg-background/60 px-2.5 py-2">
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="text-sm font-semibold tabular-nums">{value}</div>
    </div>
  );
}

function ProjectionRow({ days, low, high }: { days: number; low: number; high: number }) {
  return (
    <div className="flex items-center justify-between gap-2 rounded-md border px-3 py-2">
      <div className="text-xs text-muted-foreground">{days} dias</div>
      <div className="text-sm font-semibold tabular-nums">
        {low === high ? `${low}` : `${low} a ${high}`} <span className="text-xs font-normal text-muted-foreground">leads</span>
      </div>
    </div>
  );
}

function CompareChip({ label, deltaPct, betterWhen }: { label: string; deltaPct: number; betterWhen: "up" | "down" }) {
  const isUp = deltaPct > 0.5;
  const isDown = deltaPct < -0.5;
  const positive = (betterWhen === "up" && isUp) || (betterWhen === "down" && isDown);
  const negative = (betterWhen === "up" && isDown) || (betterWhen === "down" && isUp);
  const Icon = isUp ? TrendingUp : isDown ? TrendingDown : Minus;
  const cls = positive ? "text-emerald-600 dark:text-emerald-400" :
              negative ? "text-destructive" :
              "text-muted-foreground";
  const sign = deltaPct > 0 ? "+" : "";
  return (
    <div className="rounded-lg border bg-background/60 px-2.5 py-2">
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className={cn("text-sm font-semibold flex items-center gap-1 tabular-nums", cls)}>
        <Icon className="h-3.5 w-3.5" />
        {sign}{deltaPct.toFixed(0)}%
      </div>
    </div>
  );
}

function ActionButton({ icon, label, onClick }: { icon: React.ReactNode; label: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="inline-flex items-center gap-1.5 h-9 px-3 rounded-md border bg-background text-xs font-medium hover:bg-muted transition-colors"
    >
      {icon}
      <span className="truncate">{label}</span>
      <ArrowRight className="h-3 w-3 ml-auto opacity-50" />
    </button>
  );
}
