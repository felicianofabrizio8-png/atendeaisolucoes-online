// ============================================================================
// CampaignAIAdvisor — Aba "Gestor IA" (consultivo, somente leitura).
// Reutiliza dados já carregados/sincronizados da campanha. NÃO altera
// nada na campanha nem chama Meta Ads diretamente.
// ============================================================================

import { useEffect, useState } from "react";
import { Loader2, Sparkles, Wand2, AlertTriangle, CheckCircle2, Copy, History, RefreshCw } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

interface DiagnosisShape {
  health?: "boa" | "atencao" | "ruim" | "sem_dados";
  strengths?: string[];
  risks?: string[];
}
interface Recommendation { title: string; detail: string; priority: "alta" | "media" | "baixa" }
interface CreativeIdea { concept: string; description: string }
interface CopyIdea { headline: string; primary_text: string; cta: string }

export interface CampaignAdvisoryAnalysis {
  id: string | null;
  created_at: string;
  summary?: string;
  diagnosis?: DiagnosisShape;
  recommendations?: Recommendation[];
  creative_ideas?: CreativeIdea[];
  copy_ideas?: CopyIdea[];
  model?: string;
}

interface HistoryItem extends CampaignAdvisoryAnalysis { id: string }

const HEALTH_META: Record<NonNullable<DiagnosisShape["health"]>, { label: string; cls: string }> = {
  boa: { label: "Saúde boa", cls: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400" },
  atencao: { label: "Requer atenção", cls: "bg-amber-500/15 text-amber-600 dark:text-amber-400" },
  ruim: { label: "Performance ruim", cls: "bg-destructive/15 text-destructive" },
  sem_dados: { label: "Sem dados suficientes", cls: "bg-muted text-muted-foreground" },
};

const PRIO_META: Record<Recommendation["priority"], string> = {
  alta: "bg-destructive/15 text-destructive",
  media: "bg-amber-500/15 text-amber-600 dark:text-amber-400",
  baixa: "bg-muted text-muted-foreground",
};

async function callAdvisor(campaignId: string, mode: "analyze" | "history"): Promise<Response> {
  const { data: sess } = await supabase.auth.getSession();
  const token = sess.session?.access_token ?? "";
  return fetch("/api/ai/campaign-advisor", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ campaignId, mode }),
  });
}

export function CampaignAIAdvisor({ campaignId, hasMetrics }: { campaignId: string; hasMetrics: boolean }) {
  const [analysis, setAnalysis] = useState<CampaignAdvisoryAnalysis | null>(null);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function loadHistory() {
    setHistoryLoading(true);
    try {
      const r = await callAdvisor(campaignId, "history");
      const j = await r.json();
      if (j.ok && Array.isArray(j.history)) {
        setHistory(j.history as HistoryItem[]);
        if (!analysis && j.history.length > 0) setAnalysis(j.history[0] as CampaignAdvisoryAnalysis);
      }
    } catch (e) {
      console.warn("[ai-advisor] load history failed", e);
    } finally {
      setHistoryLoading(false);
    }
  }

  useEffect(() => { void loadHistory(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [campaignId]);

  async function runAnalyze() {
    setLoading(true);
    setError(null);
    try {
      const r = await callAdvisor(campaignId, "analyze");
      const j = await r.json();
      if (!j.ok) {
        setError(j.error ?? "Falha ao gerar análise.");
        toast.error(j.error ?? "Falha ao gerar análise.");
      } else {
        setAnalysis(j.analysis as CampaignAdvisoryAnalysis);
        toast.success("Análise consultiva gerada.");
        void loadHistory();
      }
    } catch (e) {
      const m = e instanceof Error ? e.message : "Erro inesperado.";
      setError(m);
      toast.error(m);
    } finally {
      setLoading(false);
    }
  }

  const healthInfo = analysis?.diagnosis?.health ? HEALTH_META[analysis.diagnosis.health] : null;

  return (
    <div className="space-y-5">
      <div className="rounded-xl border bg-card p-4 space-y-3">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="min-w-0">
            <div className="text-[11px] uppercase tracking-wide text-primary font-semibold flex items-center gap-1.5">
              <Sparkles className="h-3 w-3" /> Gestor IA (consultivo)
            </div>
            <h2 className="text-base md:text-lg font-semibold mt-0.5">
              Diagnóstico, recomendações e ideias para sua campanha
            </h2>
            <p className="text-xs text-muted-foreground mt-1">
              A IA lê os dados já sincronizados da Meta e gera sugestões. Nada é alterado automaticamente — você decide o que aplicar.
            </p>
          </div>
          <button
            onClick={runAnalyze}
            disabled={loading}
            className="inline-flex items-center gap-2 h-10 px-3 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 disabled:opacity-60"
          >
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wand2 className="h-4 w-4" />}
            {analysis ? "Gerar nova análise" : "Analisar campanha"}
          </button>
        </div>
        {!hasMetrics && (
          <div className="rounded-md border border-dashed bg-muted/30 px-3 py-2 text-xs text-muted-foreground flex items-start gap-2">
            <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
            Ainda não há métricas reais sincronizadas. A análise será feita com base no criativo, copy e configuração da campanha.
          </div>
        )}
        {error && (
          <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">{error}</div>
        )}
      </div>

      {!analysis && !loading && (
        <div className="rounded-xl border border-dashed bg-muted/20 p-8 text-center text-sm text-muted-foreground">
          Clique em <strong className="text-foreground">Analisar campanha</strong> para receber o primeiro diagnóstico consultivo.
        </div>
      )}

      {loading && !analysis && (
        <div className="rounded-xl border bg-card p-8 text-center text-sm text-muted-foreground flex items-center justify-center gap-2">
          <Loader2 className="h-4 w-4 animate-spin" /> Gerando análise…
        </div>
      )}

      {analysis && (
        <>
          {/* Diagnóstico */}
          <section className="rounded-xl border bg-card p-4 space-y-3">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <h3 className="text-sm font-semibold">Diagnóstico</h3>
              {healthInfo && (
                <span className={cn("inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium", healthInfo.cls)}>
                  {healthInfo.label}
                </span>
              )}
            </div>
            {analysis.summary && <p className="text-sm">{analysis.summary}</p>}
            <div className="grid md:grid-cols-2 gap-3">
              <div className="rounded-lg border p-3 space-y-1.5">
                <div className="text-xs font-semibold text-emerald-600 dark:text-emerald-400 flex items-center gap-1.5">
                  <CheckCircle2 className="h-3.5 w-3.5" /> Pontos fortes
                </div>
                {(analysis.diagnosis?.strengths ?? []).length === 0 ? (
                  <p className="text-xs text-muted-foreground">—</p>
                ) : (
                  <ul className="space-y-1">
                    {analysis.diagnosis?.strengths?.map((s, i) => (
                      <li key={i} className="text-xs text-muted-foreground">• {s}</li>
                    ))}
                  </ul>
                )}
              </div>
              <div className="rounded-lg border p-3 space-y-1.5">
                <div className="text-xs font-semibold text-amber-600 dark:text-amber-400 flex items-center gap-1.5">
                  <AlertTriangle className="h-3.5 w-3.5" /> Alertas / riscos
                </div>
                {(analysis.diagnosis?.risks ?? []).length === 0 ? (
                  <p className="text-xs text-muted-foreground">—</p>
                ) : (
                  <ul className="space-y-1">
                    {analysis.diagnosis?.risks?.map((s, i) => (
                      <li key={i} className="text-xs text-muted-foreground">• {s}</li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          </section>

          {/* Recomendações */}
          <section className="rounded-xl border bg-card p-4 space-y-3">
            <h3 className="text-sm font-semibold">Recomendações</h3>
            {(analysis.recommendations ?? []).length === 0 ? (
              <p className="text-xs text-muted-foreground">Sem recomendações nesta análise.</p>
            ) : (
              <ul className="space-y-2">
                {analysis.recommendations?.map((r, i) => (
                  <li key={i} className="rounded-lg border p-3 space-y-1">
                    <div className="flex items-center justify-between gap-2 flex-wrap">
                      <div className="text-sm font-medium">{r.title}</div>
                      <span className={cn("inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase", PRIO_META[r.priority])}>
                        {r.priority}
                      </span>
                    </div>
                    <p className="text-xs text-muted-foreground">{r.detail}</p>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/* Ideias de criativo */}
          <section className="rounded-xl border bg-card p-4 space-y-3">
            <h3 className="text-sm font-semibold">Ideias de novos criativos</h3>
            {(analysis.creative_ideas ?? []).length === 0 ? (
              <p className="text-xs text-muted-foreground">—</p>
            ) : (
              <div className="grid md:grid-cols-2 gap-3">
                {analysis.creative_ideas?.map((c, i) => (
                  <div key={i} className="rounded-lg border p-3 space-y-1">
                    <div className="text-sm font-medium">{c.concept}</div>
                    <p className="text-xs text-muted-foreground">{c.description}</p>
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* Sugestões de copy */}
          <section className="rounded-xl border bg-card p-4 space-y-3">
            <h3 className="text-sm font-semibold">Sugestões de novos textos</h3>
            {(analysis.copy_ideas ?? []).length === 0 ? (
              <p className="text-xs text-muted-foreground">—</p>
            ) : (
              <div className="space-y-3">
                {analysis.copy_ideas?.map((c, i) => (
                  <div key={i} className="rounded-lg border p-3 space-y-2">
                    <div className="flex items-start justify-between gap-2">
                      <div className="text-sm font-semibold">{c.headline}</div>
                      <button
                        onClick={() => {
                          navigator.clipboard.writeText(`${c.headline}\n\n${c.primary_text}\n\nCTA: ${c.cta}`);
                          toast.success("Copiado.");
                        }}
                        className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                      >
                        <Copy className="h-3 w-3" /> Copiar
                      </button>
                    </div>
                    <p className="text-xs text-muted-foreground whitespace-pre-wrap">{c.primary_text}</p>
                    <div className="inline-flex items-center gap-1 h-7 px-2.5 rounded-md bg-primary/10 text-primary text-[11px] font-medium">
                      {c.cta}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        </>
      )}

      {/* Histórico */}
      <section className="rounded-xl border bg-card p-4 space-y-3">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-sm font-semibold flex items-center gap-2">
            <History className="h-4 w-4 text-primary" /> Histórico de análises
          </h3>
          <button
            onClick={loadHistory}
            disabled={historyLoading}
            className="inline-flex items-center gap-1 h-7 px-2 rounded-md border text-xs hover:bg-muted disabled:opacity-60"
          >
            <RefreshCw className={cn("h-3 w-3", historyLoading && "animate-spin")} /> Atualizar
          </button>
        </div>
        {history.length === 0 ? (
          <p className="text-xs text-muted-foreground">Nenhuma análise registrada ainda.</p>
        ) : (
          <ul className="space-y-1.5">
            {history.map((h) => (
              <li key={h.id}>
                <button
                  onClick={() => setAnalysis(h)}
                  className={cn(
                    "w-full text-left rounded-md border px-3 py-2 text-xs hover:bg-muted transition-colors",
                    analysis?.id === h.id && "border-primary/50 bg-primary/5",
                  )}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium truncate">{h.summary ?? "Análise"}</span>
                    <span className="text-muted-foreground shrink-0">
                      {new Date(h.created_at).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}
                    </span>
                  </div>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
