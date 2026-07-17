import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Play, Trash2, EyeOff, Eye, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useServerFn } from "@tanstack/react-start";
import {
  listVideos,
  getVideoSignedUrl,
  setVideoActive,
  deleteVideo,
} from "@/lib/render-engine/render-job.functions";
import type { VideoLibraryRow } from "@/lib/render-engine/render.types";
import { VIDEO_FORMAT_DIMENSIONS } from "@/lib/render-engine/render.types";
import { formatVideoTimeLabel } from "@/lib/render-engine/render.validation";

interface Props {
  companyId: string;
  refreshKey?: number;
}

export function VideoLibraryGrid({ refreshKey }: Props) {
  const [videos, setVideos] = useState<VideoLibraryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [playingUrl, setPlayingUrl] = useState<string | null>(null);
  const [playingId, setPlayingId] = useState<string | null>(null);
  const list = useServerFn(listVideos);
  const sign = useServerFn(getVideoSignedUrl);
  const setActive = useServerFn(setVideoActive);
  const del = useServerFn(deleteVideo);

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const res = await list({ data: { limit: 60 } });
        if (mounted) setVideos(res.videos);
      } finally {
        if (mounted) setLoading(false);
      }
    })();
    return () => { mounted = false; };
  }, [list, refreshKey]);

  async function onPlay(v: VideoLibraryRow) {
    try {
      const { url } = await sign({ data: { id: v.id } });
      setPlayingUrl(url);
      setPlayingId(v.id);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao obter URL.");
    }
  }

  async function onToggle(v: VideoLibraryRow) {
    try {
      await setActive({ data: { id: v.id, active: !v.is_active } });
      setVideos((prev) =>
        prev.map((x) => (x.id === v.id ? { ...x, is_active: !v.is_active } : x)),
      );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha.");
    }
  }

  async function onDelete(v: VideoLibraryRow) {
    if (!confirm(`Excluir "${v.name}"? Esta ação é permanente.`)) return;
    try {
      await del({ data: { id: v.id } });
      setVideos((prev) => prev.filter((x) => x.id !== v.id));
      if (playingId === v.id) {
        setPlayingUrl(null);
        setPlayingId(null);
      }
      toast.success("Vídeo excluído.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao excluir.");
    }
  }

  if (loading) {
    return (
      <div className="rounded-lg border bg-card p-4 text-sm text-muted-foreground flex items-center gap-2">
        <Loader2 className="h-4 w-4 animate-spin" /> Carregando vídeos…
      </div>
    );
  }

  if (videos.length === 0) {
    return (
      <div className="rounded-lg border bg-card p-4 text-sm text-muted-foreground">
        Nenhum vídeo ainda. Gere um vídeo na aba <strong>Gerar vídeo</strong>.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {playingUrl && (
        <div className="rounded-lg border bg-card p-3">
          {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
          <video src={playingUrl} controls autoPlay className="w-full max-h-[70vh] rounded" />
          <div className="mt-2 flex justify-end">
            <Button variant="ghost" size="sm" onClick={() => { setPlayingUrl(null); setPlayingId(null); }}>
              Fechar player
            </Button>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {videos.map((v) => (
          <div key={v.id} className="rounded-lg border bg-card p-3 space-y-2">
            <div className="text-sm font-semibold truncate">{v.name}</div>
            <div className="text-xs text-muted-foreground flex flex-wrap gap-x-2">
              <span>{VIDEO_FORMAT_DIMENSIONS[v.video_format].label}</span>
              <span>·</span>
              <span>{formatVideoTimeLabel(v.duration_seconds)}</span>
              <span>·</span>
              <span>{v.width}×{v.height}</span>
              {!v.is_active && (
                <span className="text-amber-600 dark:text-amber-400">· inativo</span>
              )}
            </div>
            <div className="text-[10px] text-muted-foreground">
              {new Date(v.created_at).toLocaleString()}
            </div>
            <div className="flex flex-wrap gap-1 pt-1">
              <Button size="sm" variant="secondary" onClick={() => onPlay(v)}>
                <Play className="h-3.5 w-3.5 mr-1" /> Reproduzir
              </Button>
              <Button size="sm" variant="ghost" onClick={() => onToggle(v)}>
                {v.is_active ? <EyeOff className="h-3.5 w-3.5 mr-1" /> : <Eye className="h-3.5 w-3.5 mr-1" />}
                {v.is_active ? "Desativar" : "Ativar"}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => onDelete(v)}>
                <Trash2 className="h-3.5 w-3.5 mr-1" /> Excluir
              </Button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
