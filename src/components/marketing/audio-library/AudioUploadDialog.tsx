import { useState } from "react";
import { Loader2, Upload, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  AUDIO_CATEGORIES,
  AUDIO_ENERGIES,
  AUDIO_MOODS,
  AUDIO_RECOMMENDED_FOR,
  AUDIO_VOCAL_TYPES,
  type AudioCategory,
  type AudioEnergy,
  type AudioMood,
  type AudioQuotaInfo,
  type AudioRecommendedFor,
  type AudioVocalType,
} from "@/lib/audio-library/audio-library.types";
import {
  createAudioWithUpload,
  DuplicateAudioError,
} from "@/lib/audio-library/audio-library-service";
import { validateAudioFile } from "@/lib/audio-library/audio-library-validation";
import { logAudioEvent } from "./audio-observability";
import { EnumSelect } from "./EnumSelect";

function formatDuration(seconds: number | null): string {
  if (!seconds || !Number.isFinite(seconds)) return "—";
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function AudioUploadDialog({
  open,
  onClose,
  companyId,
  quota,
  onUploaded,
}: {
  open: boolean;
  onClose: () => void;
  companyId: string;
  quota: AudioQuotaInfo | null;
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

  const quotaReached =
    quota?.limit != null && quota.used >= quota.limit;

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
    if (quotaReached) {
      toast.error(
        `Limite do plano ${quota?.tier} atingido (${quota?.used}/${quota?.limit}).`,
      );
      return;
    }
    setSaving(true);
    logAudioEvent("upload_started", {
      size_bytes: file.size,
      mime: file.type,
    });
    try {
      const row = await createAudioWithUpload({
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
      logAudioEvent("upload_completed", { audio_id: row.id });
      toast.success("Música adicionada à biblioteca");
      reset();
      onClose();
      await onUploaded();
    } catch (e) {
      if (e instanceof DuplicateAudioError) {
        logAudioEvent("upload_duplicate", { existing_id: e.existingId });
        toast.error(e.message);
      } else {
        const msg = e instanceof Error ? e.message : "Falha no upload";
        // Erro traduzido de quota vindo do servidor.
        const quotaMatch = msg.match(/^quota_exceeded:([^:]+):(\d+):(.+)$/);
        if (quotaMatch) {
          toast.error(quotaMatch[3]);
        } else {
          toast.error(msg);
        }
        logAudioEvent("upload_failed", { error: msg });
      }
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

        {quota ? (
          <div
            className={`text-xs rounded-md border p-2 ${
              quotaReached
                ? "border-destructive/40 bg-destructive/10 text-destructive"
                : "text-muted-foreground bg-muted/30"
            }`}
          >
            Plano <strong>{quota.tier}</strong>:{" "}
            {quota.limit == null
              ? `${quota.used} músicas (ilimitado)`
              : `${quota.used} de ${quota.limit} músicas utilizadas`}
            {quotaReached ? " — limite atingido." : ""}
          </div>
        ) : null}

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
          <Button
            onClick={handleSubmit}
            disabled={saving || !confirmed || !file || quotaReached}
          >
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
