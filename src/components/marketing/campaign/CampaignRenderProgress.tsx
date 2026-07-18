// Barra de progresso amigável para o render de uma campanha (Feed + Story).
// Traduz stages do worker para PT-BR e mostra percentual quando disponível.

import { AlertTriangle, CheckCircle2, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { friendlyRenderError } from "@/lib/marketing/render-error-messages";
import type { TrackedCampaign } from "@/lib/marketing/useCampaignRenderTracker";

interface Props {
  tracked: TrackedCampaign | null;
  onRetry: (role: "feed" | "story") => void;
}

const STEP_LABELS: Array<{ id: string; label: string; minProgress: number }> = [
  { id: "queued", label: "Na fila", minProgress: 0 },
  { id: "downloading_sources", label: "Preparando imagens e áudio", minProgress: 10 },
  { id: "rendering", label: "Renderizando vídeo", minProgress: 30 },
  { id: "validating", label: "Validando qualidade", minProgress: 70 },
  { id: "uploading", label: "Enviando vídeo", minProgress: 85 },
  { id: "finalizing", label: "Finalizando", minProgress: 95 },
];

function stageFromProgress(progress: number): string {
  let label = STEP_LABELS[0].label;
  for (const s of STEP_LABELS) {
    if (progress >= s.minProgress) label = s.label;
  }
  return label;
}

export function CampaignRenderProgress({ tracked, onRetry }: Props) {
  if (!tracked) return null;
  return (
    <div className="rounded-lg border bg-card p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="text-sm font-semibold">Renderização</div>
        <div className="text-xs text-muted-foreground">
          {tracked.done
            ? tracked.hasFailure
              ? "Concluído com falhas"
              : "Concluído"
            : "Em andamento"}
        </div>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <RoleProgress
          label="Feed 4:5"
          status={tracked.feed.status}
          progress={tracked.feed.progress}
          errorCode={tracked.feed.errorCode}
          done={!!tracked.feed.videoId}
          onRetry={() => onRetry("feed")}
        />
        <RoleProgress
          label="Story 9:16"
          status={tracked.story.status}
          progress={tracked.story.progress}
          errorCode={tracked.story.errorCode}
          done={!!tracked.story.videoId}
          onRetry={() => onRetry("story")}
        />
      </div>
    </div>
  );
}

function RoleProgress({
  label,
  status,
  progress,
  errorCode,
  done,
  onRetry,
}: {
  label: string;
  status: string;
  progress: number | null;
  errorCode: string | null;
  done: boolean;
  onRetry: () => void;
}) {
  const failed = status === "failed";
  const pct = Math.max(0, Math.min(100, progress ?? 0));
  const stageLabel = done ? "Vídeo pronto" : failed ? "Falhou" : stageFromProgress(pct);
  return (
    <div className="rounded-md border p-3 space-y-2 min-w-0">
      <div className="flex items-center justify-between gap-2 min-w-0">
        <div className="min-w-0">
          <div className="text-sm font-medium truncate">{label}</div>
          <div className="text-xs text-muted-foreground truncate">{stageLabel}</div>
        </div>
        <div className="shrink-0">
          {done ? (
            <CheckCircle2 className="h-5 w-5 text-emerald-500" />
          ) : failed ? (
            <AlertTriangle className="h-5 w-5 text-destructive" />
          ) : (
            <Loader2 className="h-5 w-5 animate-spin text-primary" />
          )}
        </div>
      </div>
      {!done && !failed && (
        <div>
          <div className="h-2 rounded-full bg-muted overflow-hidden">
            <div
              className="h-full bg-primary transition-all duration-500 ease-out"
              style={{ width: `${pct}%` }}
              aria-valuenow={pct}
              aria-valuemin={0}
              aria-valuemax={100}
              role="progressbar"
              aria-label={`Progresso ${label}`}
            />
          </div>
          <div className="mt-1 text-right text-[11px] text-muted-foreground">{pct}%</div>
        </div>
      )}
      {failed && (
        <div className="flex items-start justify-between gap-2">
          <div className="text-xs text-destructive min-w-0">
            {friendlyRenderError(errorCode)}
          </div>
          <Button type="button" size="sm" variant="outline" onClick={onRetry}>
            Tentar de novo
          </Button>
        </div>
      )}
    </div>
  );
}
