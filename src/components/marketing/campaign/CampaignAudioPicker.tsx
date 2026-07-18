// Seletor de áudio da campanha — estilo Spotify light.
// - Busca por nome/categoria/humor.
// - Chips de categoria.
// - Preview play/pause inline com URL assinada (via useAudioPlayer).
// - Favoritos persistidos em localStorage (per-empresa-ok, chave global neste MVP).
// - Badge de seleção visível.

import { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2, Music2, Check, Pause, Play, Star, Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { listAudioLibrary } from "@/lib/audio-library/audio-library-service";
import type { AudioLibraryRow } from "@/lib/audio-library/audio-library.types";
import { formatSeconds } from "@/components/marketing/audio-library/audio-ui-helpers";
import { useAudioPlayer } from "@/components/marketing/audio-library/useAudioPlayer";

const FAV_STORAGE_KEY = "atendeai.audio-favorites.v1";

interface Props {
  selectedId: string | null;
  onSelect: (audio: AudioLibraryRow | null) => void;
}

function loadFavs(): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const raw = window.localStorage.getItem(FAV_STORAGE_KEY);
    if (!raw) return new Set();
    const arr = JSON.parse(raw) as string[];
    return new Set(arr);
  } catch {
    return new Set();
  }
}

function saveFavs(s: Set<string>) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(FAV_STORAGE_KEY, JSON.stringify([...s]));
  } catch {
    /* noop */
  }
}

export function CampaignAudioPicker({ selectedId, onSelect }: Props) {
  const [rows, setRows] = useState<AudioLibraryRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<string | null>(null);
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const [favorites, setFavorites] = useState<Set<string>>(() => loadFavs());
  const player = useAudioPlayer();

  useEffect(() => {
    let cancelled = false;
    listAudioLibrary({ activeOnly: true })
      .then((r) => {
        if (!cancelled) setRows(r);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : "Falha ao carregar áudios");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const categories = useMemo(() => {
    if (!rows) return [] as string[];
    const set = new Set<string>();
    for (const r of rows) if (r.category) set.add(r.category);
    return [...set].sort();
  }, [rows]);

  const filtered = useMemo(() => {
    if (!rows) return [] as AudioLibraryRow[];
    const q = query.trim().toLowerCase();
    return rows.filter((a) => {
      if (favoritesOnly && !favorites.has(a.id)) return false;
      if (categoryFilter && a.category !== categoryFilter) return false;
      if (!q) return true;
      const hay = `${a.name} ${a.category ?? ""} ${a.mood ?? ""}`.toLowerCase();
      return hay.includes(q);
    });
  }, [rows, query, categoryFilter, favoritesOnly, favorites]);

  const toggleFavorite = useCallback((id: string) => {
    setFavorites((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      saveFavs(next);
      return next;
    });
  }, []);

  if (error) {
    return (
      <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
        {error}
      </div>
    );
  }
  if (!rows) {
    return (
      <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Carregando áudios…
      </div>
    );
  }
  if (rows.length === 0) {
    return (
      <div className="rounded-md border bg-muted/40 p-4 text-sm text-muted-foreground">
        Nenhum áudio cadastrado. Faça upload em <strong>Biblioteca &gt; Áudios</strong>.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Search + toggle favoritos */}
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar por nome, categoria ou humor…"
            className="pl-8"
          />
        </div>
        <Button
          type="button"
          size="sm"
          variant={favoritesOnly ? "default" : "outline"}
          onClick={() => setFavoritesOnly((v) => !v)}
          title={favoritesOnly ? "Mostrar tudo" : "Somente favoritos"}
        >
          <Star className={`h-4 w-4 ${favoritesOnly ? "fill-current" : ""}`} />
        </Button>
      </div>

      {/* Chips de categoria */}
      {categories.length > 0 && (
        <div className="flex flex-wrap gap-1">
          <Chip active={categoryFilter === null} onClick={() => setCategoryFilter(null)}>
            Todas
          </Chip>
          {categories.map((c) => (
            <Chip key={c} active={categoryFilter === c} onClick={() => setCategoryFilter(c)}>
              {c}
            </Chip>
          ))}
        </div>
      )}

      {/* Lista */}
      {filtered.length === 0 ? (
        <div className="rounded-md border bg-muted/40 p-4 text-sm text-muted-foreground">
          Nenhum áudio corresponde ao filtro.
        </div>
      ) : (
        <ul
          role="listbox"
          aria-label="Seleção de áudio da campanha"
          className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-[420px] overflow-y-auto pr-1"
        >
          {filtered.map((a) => {
            const sel = a.id === selectedId;
            const isPlaying = player.currentId === a.id && player.playing;
            const fav = favorites.has(a.id);
            return (
              <li key={a.id}>
                <div
                  role="option"
                  aria-selected={sel}
                  className={`w-full rounded-md border p-2 flex items-center gap-2 transition ${
                    sel
                      ? "border-primary bg-primary/5 ring-2 ring-primary/40"
                      : "border-border hover:bg-muted/40"
                  }`}
                >
                  {/* Play/Pause */}
                  <Button
                    type="button"
                    size="icon"
                    variant={isPlaying ? "default" : "outline"}
                    className="h-8 w-8 shrink-0"
                    onClick={() => player.toggle(a)}
                    aria-label={isPlaying ? "Pausar" : "Ouvir"}
                    title={isPlaying ? "Pausar" : "Ouvir"}
                  >
                    {isPlaying ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
                  </Button>

                  {/* Info clicável para seleção */}
                  <button
                    type="button"
                    onClick={() => onSelect(sel ? null : a)}
                    className="min-w-0 flex-1 text-left"
                  >
                    <div className="flex items-center gap-1 min-w-0">
                      <div className="truncate text-sm font-medium">{a.name}</div>
                      {sel && (
                        <span className="shrink-0 inline-flex items-center gap-1 rounded-full bg-primary/15 px-1.5 py-0.5 text-[10px] font-bold uppercase text-primary">
                          <Check className="h-3 w-3" />
                          Selecionada
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-muted-foreground truncate">
                      <Music2 className="inline h-3 w-3 mr-1" />
                      {a.category ?? "—"} · {a.mood ?? "—"} ·{" "}
                      {formatSeconds(Number(a.duration_seconds ?? 0))}
                    </div>
                  </button>

                  {/* Favorito */}
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    className="h-8 w-8 shrink-0"
                    onClick={() => toggleFavorite(a.id)}
                    aria-label={fav ? "Remover dos favoritos" : "Adicionar aos favoritos"}
                    title={fav ? "Remover dos favoritos" : "Favoritar"}
                  >
                    <Star
                      className={`h-4 w-4 ${fav ? "fill-yellow-400 text-yellow-500" : "text-muted-foreground"}`}
                    />
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function Chip({
  active,
  children,
  onClick,
}: {
  active: boolean;
  children: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`px-2.5 py-1 rounded-full text-xs font-medium border transition ${
        active
          ? "border-primary bg-primary text-primary-foreground"
          : "border-border bg-background text-foreground hover:bg-muted"
      }`}
    >
      {children}
    </button>
  );
}
