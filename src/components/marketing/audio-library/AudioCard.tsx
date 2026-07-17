import { Edit3, Loader2, Pause, Play, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import type { AudioLibraryRow } from "@/lib/audio-library/audio-library.types";
import { formatPreferredRange, splitWithMore } from "./audio-ui-helpers";

function formatDuration(seconds: number | null): string {
  if (!seconds || !Number.isFinite(seconds)) return "—";
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString("pt-BR");
  } catch {
    return "—";
  }
}

export function AudioCard({
  row,
  isActiveTrack,
  isPlaying,
  isLoading,
  onTogglePlay,
  onEdit,
  onDelete,
  onToggleActive,
}: {
  row: AudioLibraryRow;
  isActiveTrack: boolean;
  isPlaying: boolean;
  isLoading: boolean;
  onTogglePlay: (row: AudioLibraryRow) => void;
  onEdit: (row: AudioLibraryRow) => void;
  onDelete: (row: AudioLibraryRow) => void;
  onToggleActive: (row: AudioLibraryRow, active: boolean) => void;
}) {
  const showPause = isActiveTrack && isPlaying;
  return (
    <article className="rounded-xl border bg-card p-4 flex flex-col gap-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="font-medium truncate">{row.name}</h3>
          {row.description ? (
            <p className="text-xs text-muted-foreground line-clamp-2">
              {row.description}
            </p>
          ) : null}
        </div>
        <Button
          size="icon"
          variant="secondary"
          onClick={() => onTogglePlay(row)}
          aria-label={showPause ? "Pausar áudio" : "Reproduzir áudio"}
          disabled={isLoading && isActiveTrack}
        >
          {isLoading && isActiveTrack ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : showPause ? (
            <Pause className="h-4 w-4" />
          ) : (
            <Play className="h-4 w-4" />
          )}
        </Button>
      </div>

      <div className="flex flex-wrap gap-1">
        {row.category ? <Badge variant="secondary">{row.category}</Badge> : null}
        {row.mood ? <Badge variant="outline">{row.mood}</Badge> : null}
        {row.energy ? (
          <Badge variant="outline">energia {row.energy}</Badge>
        ) : null}
        {row.vocal_type ? <Badge variant="outline">{row.vocal_type}</Badge> : null}
      </div>

      {row.recommended_for.length > 0 ? (
        <div className="flex flex-wrap gap-1">
          {row.recommended_for.map((r) => (
            <span
              key={r}
              className="text-[10px] rounded bg-muted px-1.5 py-0.5"
            >
              {r}
            </span>
          ))}
        </div>
      ) : null}

      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>{formatDuration(row.duration_seconds)}</span>
        <span>{formatDate(row.created_at)}</span>
      </div>

      <div className="flex items-center justify-between pt-2 border-t">
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          <Switch
            checked={row.is_active}
            onCheckedChange={(v) => onToggleActive(row, v)}
          />
          {row.is_active ? "Ativa" : "Inativa"}
        </label>
        <div className="flex gap-1">
          <Button
            size="icon"
            variant="ghost"
            onClick={() => onEdit(row)}
            aria-label="Editar"
          >
            <Edit3 className="h-4 w-4" />
          </Button>
          <Button
            size="icon"
            variant="ghost"
            onClick={() => onDelete(row)}
            aria-label="Excluir"
          >
            <Trash2 className="h-4 w-4 text-destructive" />
          </Button>
        </div>
      </div>
    </article>
  );
}
