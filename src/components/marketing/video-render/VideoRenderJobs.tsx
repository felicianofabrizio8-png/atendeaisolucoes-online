import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Loader2, X, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { useServerFn } from "@tanstack/react-start";
import {
  cancelRenderJob,
  listRenderJobs,
} from "@/lib/render-engine/render-job.functions";
import type { RenderJobRow } from "@/lib/render-engine/render.types";
import { VIDEO_FORMAT_DIMENSIONS } from "@/lib/render-engine/render.types";

interface Props {
  companyId: string;
  refreshKey?: number;
}

const POLL_MS = 4000;

export function VideoRenderJobs({ refreshKey }: Props) {
  const [jobs, setJobs] = useState<RenderJobRow[]>([]);
  const [loading, setLoading] = useState(true);
  const list = useServerFn(listRenderJobs);
  const cancel = useServerFn(cancelRenderJob);

  useEffect(() => {
    let mounted = true;
    let timer: ReturnType<typeof setTimeout> | undefined;

    async function tick() {
      try {
        const res = await list({ data: { limit: 20 } });
        if (!mounted) return;
        setJobs(res.jobs);
        setLoading(false);
        // Continua polling apenas se houver jobs ativos
        const hasActive = res.jobs.some(
          (j) => j.status === "queued" || j.status === "processing",
        );
        if (hasActive && mounted) {
          timer = setTimeout(tick, POLL_MS);
        }
      } catch {
        setLoading(false);
      }
    }

    tick();
    return () => {
      mounted = false;
      if (timer) clearTimeout(timer);
    };
  }, [list, refreshKey]);

  async function onCancel(id: string) {
    try {
      await cancel({ data: { id } });
      toast.success("Job cancelado.");
      setJobs((prev) =>
        prev.map((j) => (j.id === id ? { ...j, status: "cancelled" } : j)),
      );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao cancelar.");
    }
  }

  if (loading) {
    return (
      <div className="rounded-lg border bg-card p-4 text-sm text-muted-foreground flex items-center gap-2">
        <Loader2 className="h-4 w-4 animate-spin" /> Carregando jobs…
      </div>
    );
  }

  if (jobs.length === 0) {
    return (
      <div className="rounded-lg border bg-card p-4 text-sm text-muted-foreground">
        Nenhum job de renderização ainda.
      </div>
    );
  }

  return (
    <div className="rounded-lg border bg-card p-4 space-y-2">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-sm">Jobs recentes</h3>
        <span className="text-xs text-muted-foreground">
          Atualização automática enquanto houver jobs ativos
        </span>
      </div>
      <ul className="divide-y">
        {jobs.map((j) => (
          <li key={j.id} className="py-2 flex items-center justify-between gap-3">
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium truncate">
                {VIDEO_FORMAT_DIMENSIONS[j.video_format].label} · {j.duration_seconds}s
              </div>
              <div className="text-xs text-muted-foreground flex items-center gap-2">
                <StatusBadge status={j.status} />
                {j.status === "processing" && (
                  <span className="inline-flex items-center gap-1">
                    <RefreshCw className="h-3 w-3 animate-spin" /> {j.progress}%
                  </span>
                )}
                {j.error_message_sanitized && (
                  <span className="text-destructive truncate max-w-[280px]">
                    {j.error_message_sanitized}
                  </span>
                )}
              </div>
            </div>
            {j.status === "queued" && (
              <Button variant="ghost" size="sm" onClick={() => onCancel(j.id)}>
                <X className="h-4 w-4 mr-1" /> Cancelar
              </Button>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

function StatusBadge({ status }: { status: RenderJobRow["status"] }) {
  const map: Record<RenderJobRow["status"], { label: string; cls: string }> = {
    queued:     { label: "Na fila",     cls: "bg-muted text-foreground" },
    processing: { label: "Processando", cls: "bg-blue-500/15 text-blue-700 dark:text-blue-300" },
    completed:  { label: "Concluído",   cls: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300" },
    failed:     { label: "Falhou",      cls: "bg-destructive/15 text-destructive" },
    cancelled:  { label: "Cancelado",   cls: "bg-muted text-muted-foreground" },
  };
  const { label, cls } = map[status];
  return (
    <span className={`inline-block rounded px-2 py-0.5 text-[10px] font-semibold ${cls}`}>
      {label}
    </span>
  );
}
