import { useEffect, useMemo, useState } from "react";
import { Loader2, Music2, Upload } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  getAudioLibraryQuota,
  listAudioLibrary,
  updateAudioMetadata,
} from "@/lib/audio-library/audio-library-service";
import type {
  AudioLibraryRow,
  AudioQuotaInfo,
} from "@/lib/audio-library/audio-library.types";
import { AudioCard } from "./audio-library/AudioCard";
import { AudioDeleteDialog } from "./audio-library/AudioDeleteDialog";
import { AudioEditDialog } from "./audio-library/AudioEditDialog";
import {
  AudioFilters,
  emptyAudioFilters,
  type AudioFiltersState,
} from "./audio-library/AudioFilters";
import { AudioUploadDialog } from "./audio-library/AudioUploadDialog";
import { filtersToQuery } from "./audio-library/audio-ui-helpers";
import { useAudioPlayer } from "./audio-library/useAudioPlayer";

interface Props {
  companyId: string;
}

/**
 * Biblioteca de Áudio — container enxuto.
 * Coordena listagem, filtros, quota, player e diálogos de upload/edit/delete.
 * Cada responsabilidade concreta vive em ./audio-library/*.
 */
export function AudioLibrary({ companyId }: Props) {
  const [rows, setRows] = useState<AudioLibraryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState<AudioFiltersState>(emptyAudioFilters);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [editing, setEditing] = useState<AudioLibraryRow | null>(null);
  const [deleting, setDeleting] = useState<AudioLibraryRow | null>(null);
  const [quota, setQuota] = useState<AudioQuotaInfo | null>(null);
  const player = useAudioPlayer();

  async function reload() {
    setLoading(true);
    try {
      const [list, q] = await Promise.all([
        listAudioLibrary({ activeOnly: false }),
        getAudioLibraryQuota().catch(() => null),
      ]);
      setRows(list);
      if (q) setQuota(q);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao carregar áudios");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyId]);

  const filtered = useMemo(() => {
    return rows.filter((r) => {
      if (
        filters.search &&
        !r.name.toLowerCase().includes(filters.search.toLowerCase())
      ) {
        return false;
      }
      if (filters.category !== "all" && r.category !== filters.category)
        return false;
      if (filters.mood !== "all" && r.mood !== filters.mood) return false;
      if (filters.energy !== "all" && r.energy !== filters.energy) return false;
      if (
        filters.recommendedFor !== "all" &&
        !r.recommended_for.includes(filters.recommendedFor)
      ) {
        return false;
      }
      return true;
    });
  }, [rows, filters]);

  async function handleToggleActive(row: AudioLibraryRow, active: boolean) {
    try {
      const updated = await updateAudioMetadata({ id: row.id, isActive: active });
      setRows((prev) => prev.map((r) => (r.id === row.id ? updated : r)));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao atualizar");
    }
  }

  const quotaLabel = quota
    ? quota.limit == null
      ? `${quota.used} músicas (plano ${quota.tier}, ilimitado)`
      : `${quota.used}/${quota.limit} músicas — plano ${quota.tier}`
    : null;

  return (
    <div className="space-y-4">
      <header className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <Music2 className="h-5 w-5" /> Biblioteca de Áudio
          </h2>
          <p className="text-xs text-muted-foreground">
            Músicas próprias para uso em vídeos e conteúdos da sua empresa.
            {quotaLabel ? (
              <span className="ml-1 font-medium text-foreground">
                • {quotaLabel}
              </span>
            ) : null}
          </p>
        </div>
        <Button onClick={() => setUploadOpen(true)}>
          <Upload className="h-4 w-4 mr-2" /> Adicionar música
        </Button>
      </header>

      <AudioFilters
        value={filters}
        onChange={(patch) => setFilters((prev) => ({ ...prev, ...patch }))}
      />

      {loading ? (
        <div className="flex items-center justify-center py-12 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin mr-2" /> Carregando…
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-12 border rounded-xl bg-muted/20">
          <Music2 className="h-10 w-10 mx-auto text-muted-foreground mb-2" />
          <p className="text-sm text-muted-foreground">
            {rows.length === 0
              ? "Nenhuma música na biblioteca ainda."
              : "Nenhum áudio corresponde aos filtros."}
          </p>
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((row) => (
            <AudioCard
              key={row.id}
              row={row}
              isActiveTrack={player.activeId === row.id}
              isPlaying={player.activeId === row.id && player.isPlaying}
              isLoading={player.isLoading}
              onTogglePlay={(r) => void player.toggle(r.id)}
              onEdit={setEditing}
              onDelete={setDeleting}
              onToggleActive={handleToggleActive}
            />
          ))}
        </div>
      )}

      <AudioUploadDialog
        open={uploadOpen}
        onClose={() => setUploadOpen(false)}
        companyId={companyId}
        quota={quota}
        onUploaded={reload}
      />
      <AudioEditDialog
        row={editing}
        onClose={() => setEditing(null)}
        onUpdated={reload}
      />
      <AudioDeleteDialog
        row={deleting}
        onClose={() => setDeleting(null)}
        onDeleted={reload}
      />
    </div>
  );
}

export default AudioLibrary;
