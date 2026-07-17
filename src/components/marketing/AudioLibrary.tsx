import { useEffect, useMemo, useRef, useState } from "react";
import { Loader2, Music2, Play, Pause, Trash2, Upload, Edit3, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AUDIO_CATEGORIES,
  AUDIO_ENERGIES,
  AUDIO_MOODS,
  AUDIO_RECOMMENDED_FOR,
  AUDIO_VOCAL_TYPES,
  type AudioCategory,
  type AudioEnergy,
  type AudioLibraryRow,
  type AudioMood,
  type AudioRecommendedFor,
  type AudioVocalType,
} from "@/lib/audio-library/audio-library.types";
import {
  createAudioWithUpload,
  deleteAudioById,
  getSignedAudioUrl,
  listAudioLibrary,
  updateAudioMetadata,
} from "@/lib/audio-library/audio-library-service";
import { validateAudioFile } from "@/lib/audio-library/audio-library-validation";

interface Props {
  companyId: string;
}

type Filters = {
  search: string;
  category: AudioCategory | "all";
  mood: AudioMood | "all";
  energy: AudioEnergy | "all";
  recommendedFor: AudioRecommendedFor | "all";
};

const emptyFilters: Filters = {
  search: "",
  category: "all",
  mood: "all",
  energy: "all",
  recommendedFor: "all",
};

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

export function AudioLibrary({ companyId }: Props) {
  const [rows, setRows] = useState<AudioLibraryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState<Filters>(emptyFilters);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [editRow, setEditRow] = useState<AudioLibraryRow | null>(null);
  const [playingId, setPlayingId] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  async function reload() {
    setLoading(true);
    try {
      const list = await listAudioLibrary({ activeOnly: false });
      setRows(list);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao carregar áudios");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void reload();
    return () => {
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyId]);

  const filtered = useMemo(() => {
    const term = filters.search.trim().toLowerCase();
    return rows.filter((r) => {
      if (filters.category !== "all" && r.category !== filters.category) return false;
      if (filters.mood !== "all" && r.mood !== filters.mood) return false;
      if (filters.energy !== "all" && r.energy !== filters.energy) return false;
      if (
        filters.recommendedFor !== "all" &&
        !r.recommended_for.includes(filters.recommendedFor)
      )
        return false;
      if (term && !r.name.toLowerCase().includes(term)) return false;
      return true;
    });
  }, [rows, filters]);

  async function handleTogglePlay(row: AudioLibraryRow) {
    try {
      if (playingId === row.id && audioRef.current) {
        if (audioRef.current.paused) {
          await audioRef.current.play();
        } else {
          audioRef.current.pause();
          setPlayingId(null);
        }
        return;
      }
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current = null;
      }
      const url = await getSignedAudioUrl(row.id);
      const audio = new Audio(url);
      audio.preload = "none";
      audio.addEventListener("ended", () => setPlayingId(null));
      audioRef.current = audio;
      setPlayingId(row.id);
      await audio.play();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao reproduzir áudio");
      setPlayingId(null);
    }
  }

  async function handleDelete(row: AudioLibraryRow) {
    if (!confirm(`Excluir a música "${row.name}"? Esta ação é irreversível.`))
      return;
    try {
      await deleteAudioById(row.id);
      toast.success("Música excluída");
      if (playingId === row.id && audioRef.current) {
        audioRef.current.pause();
        audioRef.current = null;
        setPlayingId(null);
      }
      await reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao excluir");
    }
  }

  async function handleToggleActive(row: AudioLibraryRow, active: boolean) {
    try {
      await updateAudioMetadata({ id: row.id, isActive: active });
      setRows((prev) =>
        prev.map((r) => (r.id === row.id ? { ...r, is_active: active } : r)),
      );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao atualizar");
    }
  }

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-center gap-2 justify-between">
        <div className="flex items-center gap-2">
          <Music2 className="h-5 w-5 text-primary" />
          <div>
            <h2 className="text-lg font-semibold">Biblioteca de Áudio</h2>
            <p className="text-xs text-muted-foreground">
              Envie e organize as músicas usadas nas suas campanhas. Cada empresa
              acessa somente seus próprios arquivos.
            </p>
          </div>
        </div>
        <Button onClick={() => setUploadOpen(true)}>
          <Upload className="h-4 w-4 mr-2" />
          Adicionar música
        </Button>
      </header>

      <div className="grid gap-2 md:grid-cols-5">
        <Input
          placeholder="Buscar por nome…"
          value={filters.search}
          onChange={(e) => setFilters((f) => ({ ...f, search: e.target.value }))}
        />
        <FilterSelect
          value={filters.category}
          onChange={(v) =>
            setFilters((f) => ({ ...f, category: v as Filters["category"] }))
          }
          placeholder="Categoria"
          options={AUDIO_CATEGORIES}
        />
        <FilterSelect
          value={filters.mood}
          onChange={(v) =>
            setFilters((f) => ({ ...f, mood: v as Filters["mood"] }))
          }
          placeholder="Humor"
          options={AUDIO_MOODS}
        />
        <FilterSelect
          value={filters.energy}
          onChange={(v) =>
            setFilters((f) => ({ ...f, energy: v as Filters["energy"] }))
          }
          placeholder="Energia"
          options={AUDIO_ENERGIES}
        />
        <FilterSelect
          value={filters.recommendedFor}
          onChange={(v) =>
            setFilters((f) => ({
              ...f,
              recommendedFor: v as Filters["recommendedFor"],
            }))
          }
          placeholder="Uso recomendado"
          options={AUDIO_RECOMMENDED_FOR}
        />
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground p-6 justify-center">
          <Loader2 className="h-4 w-4 animate-spin" /> Carregando biblioteca…
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-xl border bg-card p-8 text-center text-sm text-muted-foreground">
          Nenhuma música encontrada.
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((row) => (
            <article
              key={row.id}
              className="rounded-xl border bg-card p-4 flex flex-col gap-3"
            >
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
                  onClick={() => handleTogglePlay(row)}
                  aria-label={
                    playingId === row.id ? "Pausar áudio" : "Reproduzir áudio"
                  }
                >
                  {playingId === row.id ? (
                    <Pause className="h-4 w-4" />
                  ) : (
                    <Play className="h-4 w-4" />
                  )}
                </Button>
              </div>

              <div className="flex flex-wrap gap-1">
                {row.category ? <Badge variant="secondary">{row.category}</Badge> : null}
                {row.mood ? <Badge variant="outline">{row.mood}</Badge> : null}
                {row.energy ? <Badge variant="outline">energia {row.energy}</Badge> : null}
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
                    onCheckedChange={(v) => handleToggleActive(row, v)}
                  />
                  {row.is_active ? "Ativa" : "Inativa"}
                </label>
                <div className="flex gap-1">
                  <Button
                    size="icon"
                    variant="ghost"
                    onClick={() => setEditRow(row)}
                    aria-label="Editar"
                  >
                    <Edit3 className="h-4 w-4" />
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    onClick={() => handleDelete(row)}
                    aria-label="Excluir"
                  >
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                </div>
              </div>
            </article>
          ))}
        </div>
      )}

      <UploadDialog
        open={uploadOpen}
        onClose={() => setUploadOpen(false)}
        companyId={companyId}
        onUploaded={reload}
      />

      <EditDialog
        row={editRow}
        onClose={() => setEditRow(null)}
        onSaved={reload}
      />
    </div>
  );
}

function FilterSelect(props: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  options: readonly string[];
}) {
  return (
    <Select value={props.value} onValueChange={props.onChange}>
      <SelectTrigger>
        <SelectValue placeholder={props.placeholder} />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="all">Todos — {props.placeholder}</SelectItem>
        {props.options.map((o) => (
          <SelectItem key={o} value={o}>
            {o}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

// -----------------------------------------------------------------------------
// Upload dialog
// -----------------------------------------------------------------------------

function UploadDialog({
  open,
  onClose,
  companyId,
  onUploaded,
}: {
  open: boolean;
  onClose: () => void;
  companyId: string;
  onUploaded: () => void | Promise<void>;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState<AudioCategory | "">("");
  const [mood, setMood] = useState<AudioMood | "">("");
  const [energy, setEnergy] = useState<AudioEnergy | "">("");
  const [vocalType, setVocalType] = useState<AudioVocalType | "">("");
  const [recommendedFor, setRecommendedFor] = useState<AudioRecommendedFor[]>([]);
  const [source, setSource] = useState("");
  const [rightsNotes, setRightsNotes] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [duration, setDuration] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);

  function reset() {
    setFile(null);
    setName("");
    setDescription("");
    setCategory("");
    setMood("");
    setEnergy("");
    setVocalType("");
    setRecommendedFor([]);
    setSource("");
    setRightsNotes("");
    setConfirmed(false);
    setDuration(null);
    setSaving(false);
  }

  function handleClose() {
    if (saving) return;
    reset();
    onClose();
  }

  function handleFileChosen(f: File | null) {
    setFile(f);
    if (!f) {
      setDuration(null);
      return;
    }
    if (!name) {
      const base = f.name.replace(/\.[a-zA-Z0-9]+$/, "");
      setName(base);
    }
    // Extrai duração via elemento <audio> sem baixar tudo desnecessariamente.
    try {
      const url = URL.createObjectURL(f);
      const audio = new Audio();
      audio.preload = "metadata";
      audio.onloadedmetadata = () => {
        setDuration(Number.isFinite(audio.duration) ? audio.duration : null);
        URL.revokeObjectURL(url);
      };
      audio.onerror = () => URL.revokeObjectURL(url);
      audio.src = url;
    } catch {
      /* ignore */
    }
  }

  function toggleRecommended(value: AudioRecommendedFor) {
    setRecommendedFor((prev) =>
      prev.includes(value) ? prev.filter((v) => v !== value) : [...prev, value],
    );
  }

  async function handleSubmit() {
    if (!file) {
      toast.error("Selecione o arquivo de áudio");
      return;
    }
    if (!name.trim()) {
      toast.error("Informe um nome");
      return;
    }
    const check = validateAudioFile({
      mimeType: file.type,
      sizeBytes: file.size,
      commercialUseConfirmed: confirmed,
    });
    if (!check.ok) {
      if (check.reason === "commercial_use_not_confirmed") {
        toast.error("Confirme os direitos comerciais para prosseguir");
      } else if (check.reason?.startsWith("mime_type_not_allowed")) {
        toast.error("Formato não suportado. Envie MP3 ou WAV.");
      } else if (check.reason?.startsWith("file_too_large")) {
        toast.error("Arquivo maior que 30 MB");
      } else {
        toast.error("Arquivo inválido");
      }
      return;
    }
    setSaving(true);
    try {
      await createAudioWithUpload({
        companyId,
        file,
        name: name.trim(),
        description: description.trim() || null,
        category: category || null,
        mood: mood || null,
        energy: energy || null,
        vocalType: vocalType || null,
        recommendedFor,
        source: source.trim() || null,
        commercialUseConfirmed: confirmed,
        commercialRightsNotes: rightsNotes.trim() || null,
        durationSeconds: duration,
      });
      toast.success("Música adicionada à biblioteca");
      reset();
      onClose();
      await onUploaded();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha no upload");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => (v ? null : handleClose())}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Adicionar música</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <Label>Arquivo (MP3 ou WAV, até 30 MB)</Label>
            <Input
              type="file"
              accept="audio/mpeg,audio/mp3,audio/wav,audio/x-wav"
              onChange={(e) => handleFileChosen(e.target.files?.[0] ?? null)}
            />
            {file ? (
              <p className="text-xs text-muted-foreground mt-1">
                {file.name} — {(file.size / (1024 * 1024)).toFixed(2)} MB
                {duration ? ` — ${formatDuration(duration)}` : ""}
              </p>
            ) : null}
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            <div>
              <Label>Nome</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div>
              <Label>Origem</Label>
              <Input
                value={source}
                onChange={(e) => setSource(e.target.value)}
                placeholder="ex.: Suno, banco próprio, licença X"
              />
            </div>
          </div>

          <div>
            <Label>Descrição</Label>
            <Textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
            />
          </div>

          <div className="grid gap-3 md:grid-cols-4">
            <EnumSelect
              label="Categoria"
              value={category}
              options={AUDIO_CATEGORIES}
              onChange={(v) => setCategory((v as AudioCategory) || "")}
            />
            <EnumSelect
              label="Humor"
              value={mood}
              options={AUDIO_MOODS}
              onChange={(v) => setMood((v as AudioMood) || "")}
            />
            <EnumSelect
              label="Energia"
              value={energy}
              options={AUDIO_ENERGIES}
              onChange={(v) => setEnergy((v as AudioEnergy) || "")}
            />
            <EnumSelect
              label="Vocal"
              value={vocalType}
              options={AUDIO_VOCAL_TYPES}
              onChange={(v) => setVocalType((v as AudioVocalType) || "")}
            />
          </div>

          <div>
            <Label>Usos recomendados</Label>
            <div className="flex flex-wrap gap-2 mt-1">
              {AUDIO_RECOMMENDED_FOR.map((v) => {
                const active = recommendedFor.includes(v);
                return (
                  <button
                    key={v}
                    type="button"
                    onClick={() => toggleRecommended(v)}
                    className={`text-xs px-2 py-1 rounded border ${active ? "bg-primary text-primary-foreground border-primary" : "bg-background"}`}
                  >
                    {v}
                  </button>
                );
              })}
            </div>
          </div>

          <div>
            <Label>Observações sobre direitos comerciais</Label>
            <Textarea
              value={rightsNotes}
              onChange={(e) => setRightsNotes(e.target.value)}
              rows={2}
              placeholder="ex.: música produzida sob contrato próprio, licença Suno Premium…"
            />
          </div>

          <label className="flex items-start gap-2 text-sm rounded-md border p-3 bg-muted/30">
            <Checkbox
              checked={confirmed}
              onCheckedChange={(v) => setConfirmed(v === true)}
              className="mt-0.5"
            />
            <span>
              Confirmo que possuo autorização para utilizar comercialmente este
              áudio. Sem esta confirmação, o upload não é permitido.
            </span>
          </label>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={handleClose} disabled={saving}>
            <X className="h-4 w-4 mr-1" /> Cancelar
          </Button>
          <Button onClick={handleSubmit} disabled={saving || !confirmed || !file}>
            {saving ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" /> Enviando…
              </>
            ) : (
              <>
                <Upload className="h-4 w-4 mr-2" /> Enviar
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function EnumSelect(props: {
  label: string;
  value: string;
  options: readonly string[];
  onChange: (v: string) => void;
}) {
  return (
    <div>
      <Label>{props.label}</Label>
      <Select
        value={props.value || "__none__"}
        onValueChange={(v) => props.onChange(v === "__none__" ? "" : v)}
      >
        <SelectTrigger>
          <SelectValue placeholder={props.label} />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="__none__">—</SelectItem>
          {props.options.map((o) => (
            <SelectItem key={o} value={o}>
              {o}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

// -----------------------------------------------------------------------------
// Edit dialog
// -----------------------------------------------------------------------------

function EditDialog({
  row,
  onClose,
  onSaved,
}: {
  row: AudioLibraryRow | null;
  onClose: () => void;
  onSaved: () => void | Promise<void>;
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState<AudioCategory | "">("");
  const [mood, setMood] = useState<AudioMood | "">("");
  const [energy, setEnergy] = useState<AudioEnergy | "">("");
  const [vocalType, setVocalType] = useState<AudioVocalType | "">("");
  const [recommendedFor, setRecommendedFor] = useState<AudioRecommendedFor[]>([]);
  const [source, setSource] = useState("");
  const [rightsNotes, setRightsNotes] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!row) return;
    setName(row.name);
    setDescription(row.description ?? "");
    setCategory(row.category ?? "");
    setMood(row.mood ?? "");
    setEnergy(row.energy ?? "");
    setVocalType(row.vocal_type ?? "");
    setRecommendedFor(row.recommended_for ?? []);
    setSource(row.source ?? "");
    setRightsNotes(row.commercial_rights_notes ?? "");
  }, [row]);

  if (!row) return null;

  async function handleSave() {
    if (!row) return;
    if (!name.trim()) {
      toast.error("Informe um nome");
      return;
    }
    setSaving(true);
    try {
      await updateAudioMetadata({
        id: row.id,
        name: name.trim(),
        description: description.trim() || null,
        category: category || null,
        mood: mood || null,
        energy: energy || null,
        vocalType: vocalType || null,
        recommendedFor,
        source: source.trim() || null,
        commercialRightsNotes: rightsNotes.trim() || null,
      });
      toast.success("Música atualizada");
      onClose();
      await onSaved();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao atualizar");
    } finally {
      setSaving(false);
    }
  }

  function toggleRecommended(value: AudioRecommendedFor) {
    setRecommendedFor((prev) =>
      prev.includes(value) ? prev.filter((v) => v !== value) : [...prev, value],
    );
  }

  return (
    <Dialog open={!!row} onOpenChange={(v) => (v ? null : onClose())}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Editar música</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <Label>Nome</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} />
          </div>

          <div>
            <Label>Descrição</Label>
            <Textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
            />
          </div>

          <div className="grid gap-3 md:grid-cols-4">
            <EnumSelect
              label="Categoria"
              value={category}
              options={AUDIO_CATEGORIES}
              onChange={(v) => setCategory((v as AudioCategory) || "")}
            />
            <EnumSelect
              label="Humor"
              value={mood}
              options={AUDIO_MOODS}
              onChange={(v) => setMood((v as AudioMood) || "")}
            />
            <EnumSelect
              label="Energia"
              value={energy}
              options={AUDIO_ENERGIES}
              onChange={(v) => setEnergy((v as AudioEnergy) || "")}
            />
            <EnumSelect
              label="Vocal"
              value={vocalType}
              options={AUDIO_VOCAL_TYPES}
              onChange={(v) => setVocalType((v as AudioVocalType) || "")}
            />
          </div>

          <div>
            <Label>Usos recomendados</Label>
            <div className="flex flex-wrap gap-2 mt-1">
              {AUDIO_RECOMMENDED_FOR.map((v) => {
                const active = recommendedFor.includes(v);
                return (
                  <button
                    key={v}
                    type="button"
                    onClick={() => toggleRecommended(v)}
                    className={`text-xs px-2 py-1 rounded border ${active ? "bg-primary text-primary-foreground border-primary" : "bg-background"}`}
                  >
                    {v}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            <div>
              <Label>Origem</Label>
              <Input value={source} onChange={(e) => setSource(e.target.value)} />
            </div>
            <div>
              <Label>Observações sobre direitos</Label>
              <Input
                value={rightsNotes}
                onChange={(e) => setRightsNotes(e.target.value)}
              />
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={saving}>
            Cancelar
          </Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" /> Salvando…
              </>
            ) : (
              "Salvar"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
