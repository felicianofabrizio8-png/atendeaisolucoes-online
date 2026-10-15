import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Trash2 } from "lucide-react";
import { apiListPublishContents, apiListPublishSchedule, apiPreviewMarketingCleanup, apiArchiveMarketingCleanup, type MarketingCleanupStatus } from "@/data/marketingRepo";
import { getPublisherStats } from "@/lib/marketing-publisher/publisher.functions";
import { MarketingApprovals } from "./MarketingApprovals";
import { MarketingSchedule } from "./MarketingSchedule";
import { MarketingPublisherDashboard } from "./MarketingPublisherDashboard";
import { Chip, ChipRow } from "./ui/MarketingUi";

export type PublishView = "review" | "approved" | "scheduled" | "published" | "problems";

interface Props {
  companyId: string;
  view?: PublishView;
  onViewChange?: (view: PublishView) => void;
}

const VIEWS: Array<{ id: PublishView; label: string }> = [
  { id: "review", label: "Para revisar" },
  { id: "approved", label: "Aprovadas" },
  { id: "scheduled", label: "Agendadas" },
  { id: "published", label: "Publicadas" },
  { id: "problems", label: "Com problema" },
];

type Counts = Partial<Record<PublishView, number>>;

/** Revisão, agendamento e acompanhamento em um só lugar, filtrados por etapa. */
export function MarketingPublishHub({ companyId, view: controlled, onViewChange }: Props) {
  const [inner, setInner] = useState<PublishView>("review");
  const view = controlled ?? inner;
  const setView = (next: PublishView) => {
    setInner(next);
    onViewChange?.(next);
  };
  const [counts, setCounts] = useState<Counts>({});
  const [countsError, setCountsError] = useState<string | null>(null);
  const [publishRefreshToken, setPublishRefreshToken] = useState(0);
  const countLoadInFlight = useRef(false);

  const loadCounts = useCallback(async () => {
    if (countLoadInFlight.current) return;
    countLoadInFlight.current = true;
    try {
      let loadError: string | null = null;
      const [contents, schedule, stats] = await Promise.all([
      apiListPublishContents().catch((error) => {
        loadError = error instanceof Error ? error.message : "Falha ao carregar os contadores de Publicar.";
        return null;
      }),
      apiListPublishSchedule().catch(() => null),
      getPublisherStats().catch(() => null),
    ]);
    const s = stats as { published?: number; failed?: number } | null;
    setCountsError(loadError);
    setCounts({
      review: contents ? contents.filter((c) => c.status === "draft" || c.status === "pending" || c.status === "rejected").length : undefined,
      approved: contents ? contents.filter((c) => c.status === "approved").length : undefined,
      scheduled: schedule ? schedule.filter((x) => x.status === "planned" || x.status === "queued" || x.status === "publishing").length : undefined,
      published: s?.published,
      problems: s?.failed,
      });
    } finally {
      countLoadInFlight.current = false;
    }
  }, []);

  useEffect(() => {
    void loadCounts();
    const id = window.setInterval(() => {
      if (document.visibilityState === "visible") void loadCounts();
    }, 60000);
    return () => window.clearInterval(id);
  }, [loadCounts, companyId]);

  return (
    <div className="min-w-0 space-y-4">
      <div>
        <h2 className="text-2xl font-semibold tracking-tight">Publicar</h2>
        <p className="text-sm text-muted-foreground">Revise, agende e acompanhe.</p>
      </div>
      <ChipRow label="Etapa da publicação">
        {VIEWS.map((v) => (
          <Chip key={v.id} active={view === v.id} onClick={() => setView(v.id)} count={counts[v.id] ?? null} tone={v.id === "problems" ? "danger" : undefined}>
            {v.label}
          </Chip>
        ))}
      </ChipRow>
      {countsError && <p className="text-sm text-destructive" role="alert">{countsError}</p>}
      {view === "review" && <MarketingApprovals key={`review-${publishRefreshToken}`} companyId={companyId} forcedFilter="review" onChanged={loadCounts} />}
      {view === "approved" && <MarketingApprovals key={`approved-${publishRefreshToken}`} companyId={companyId} forcedFilter="approved" onChanged={loadCounts} />}
      {view === "scheduled" && <MarketingSchedule companyId={companyId} upcomingOnly />}
      {view === "published" && <MarketingPublisherDashboard companyId={companyId} view="published" />}
      {view === "problems" && <MarketingPublisherDashboard companyId={companyId} view="problems" />}
      <CleanupDialog onCompleted={() => { setPublishRefreshToken((value) => value + 1); void loadCounts(); }} />
    </div>
  );
}

function CleanupDialog({ onCompleted }: { onCompleted?: () => void }) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [previewResult, setPreviewResult] = useState<{ eligibleCount: number; protectedCount: number; protectedByReason: { schedule: number; publication: number; alreadyHidden: number }; activeScheduleCount: number; linkedCampaignCount: number; campaignStatusCounts: Record<string, number>; campaignQueryError: string | null; ignoredStatusCount: number; scannedCount: number; truncated: boolean; ids: string[] } | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [ids, setIds] = useState<string[]>([]);
  const [before, setBefore] = useState(() => new Date(Date.now() - 90 * 86400000).toISOString().slice(0, 10));
  const [statuses, setStatuses] = useState<MarketingCleanupStatus[]>(["draft", "rejected"]);
  const previewRequestId = useRef(0);

  const preview = useCallback(async () => {
    const requestId = ++previewRequestId.current;
    if (!statuses.length || !before) { setPreviewResult(null); setPreviewError(null); setIds([]); return; }
    setLoading(true);
    try {
      const result = await apiPreviewMarketingCleanup({ statuses, before: new Date(`${before}T00:00:00.000Z`).toISOString() });
      if (requestId !== previewRequestId.current) return;
      setPreviewResult(result);
      setPreviewError(null);
      setIds(result.ids);
    } catch (e) {
      if (requestId !== previewRequestId.current) return;
      setPreviewResult(null);
      setPreviewError(e instanceof Error ? e.message : "Falha ao consultar a prévia.");
      setIds([]);
    } finally { if (requestId === previewRequestId.current) setLoading(false); }
  }, [before, statuses]);

  useEffect(() => { if (open) void preview(); }, [open, preview]);

  function toggleStatus(status: MarketingCleanupStatus) {
    setStatuses((current) => current.includes(status) ? current.filter((item) => item !== status) : [...current, status]);
  }

  async function confirmCleanup() {
    if (!ids.length || confirming) return;
    setConfirming(true);
    try {
      await apiArchiveMarketingCleanup({ statuses, before: new Date(`${before}T00:00:00.000Z`).toISOString(), ids });
      onCompleted?.();
      setOpen(false);
    } catch (e) {
      setPreviewError(e instanceof Error ? e.message : "Falha ao ocultar as publicações.");
    } finally { setConfirming(false); }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm"><Trash2 className="mr-1 h-3.5 w-3.5" />Ocultar publicações antigas</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle>Ocultar publicações antigas</DialogTitle></DialogHeader>
        <p className="text-sm text-muted-foreground">A ocultação tira os itens antigos do Início e do Publicar (revisão, aprovadas, agenda, publicadas e problemas) sem apagar nada: status, campanhas, agendamentos, histórico e arquivos continuam gravados.</p>
        <label className="text-sm">Anteriores a <input className="ml-2 rounded border bg-background px-2 py-1" type="date" value={before} onChange={(event) => setBefore(event.target.value)} /></label>
        <div className="space-y-2 text-sm">{(["draft", "pending", "approved", "rejected", "archived"] as MarketingCleanupStatus[]).map((status) => (
          <label key={status} className="flex items-center gap-2"><input type="checkbox" checked={statuses.includes(status)} onChange={() => toggleStatus(status)} />{status === "draft" ? "Rascunhos" : status === "pending" ? "Pendentes" : status === "approved" ? "Aprovadas" : status === "rejected" ? "Rejeitadas" : "Arquivadas"}</label>
        ))}</div>
        <div className="rounded-lg border bg-muted/30 p-3 text-sm" aria-live="polite">{loading ? "Calculando prévia…" : previewError ? `Erro: ${previewError}` : !previewResult ? "Escolha ao menos um status e uma data." : (
          <span>Elegíveis: <strong>{previewResult.eligibleCount}</strong>. Não elegíveis: <strong>{previewResult.protectedCount}</strong> (já ocultos: {previewResult.protectedByReason.alreadyHidden}). Vínculos informativos, sem bloqueio: campanhas {previewResult.linkedCampaignCount}, agenda {previewResult.protectedByReason.schedule}, publicação/histórico {previewResult.protectedByReason.publication}. A ocultação não altera esses vínculos. Ignorados por status: {previewResult.ignoredStatusCount}.{previewResult.truncated ? " A prévia cobre os 500 itens mais antigos; confirme e repita para os seguintes." : ""}{previewResult.activeScheduleCount > 0 && <strong className="ml-1 text-destructive">Atenção: {previewResult.activeScheduleCount} têm agendamento ativo e continuarão sendo publicados no horário, mesmo ocultos. Cancele o agendamento antes se não quiser publicá-los.</strong>} Analisados: {previewResult.scannedCount}. Campanhas por status: {Object.entries(previewResult.campaignStatusCounts).map(([status, count]) => <span key={status} className="ml-1">{status} {count}</span>)}{previewResult.campaignQueryError && <span className="ml-1">Falha no diagnóstico de campanhas: {previewResult.campaignQueryError}</span>}</span>
        )}</div>
        <p className="text-xs text-muted-foreground">A ocultação só ocorre após esta confirmação explícita, grava apenas a visibilidade da empresa atual e continua sujeita às permissões/RLS.</p>
        <div className="flex justify-end gap-2"><Button variant="outline" onClick={() => setOpen(false)}>Cancelar</Button><Button variant="destructive" disabled={!ids.length || loading || confirming} onClick={() => void confirmCleanup()}>{confirming ? "Ocultando…" : "Confirmar ocultação"}</Button></div>
      </DialogContent>
    </Dialog>
  );
}
