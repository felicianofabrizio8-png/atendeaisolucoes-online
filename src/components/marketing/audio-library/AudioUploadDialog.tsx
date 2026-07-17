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
  AUDIO_BRAND_STYLES,
  AUDIO_CATEGORIES,
  AUDIO_ENERGIES,
  AUDIO_MARKETING_OBJECTIVES,
  AUDIO_MOODS,
  AUDIO_RECOMMENDED_FOR,
  AUDIO_SEASONS,
  AUDIO_TARGET_AUDIENCES,
  AUDIO_VIDEO_DURATIONS,
  AUDIO_VOCAL_TYPES,
  type AudioBrandStyle,
  type AudioCategory,
  type AudioEnergy,
  type AudioMarketingObjective,
  type AudioMood,
  type AudioQuotaInfo,
  type AudioRecommendedFor,
  type AudioSeason,
  type AudioTargetAudience,
  type AudioVideoDuration,
  type AudioVocalType,
} from "@/lib/audio-library/audio-library.types";
import {
  createAudioWithUpload,
  DuplicateAudioError,
} from "@/lib/audio-library/audio-library-service";
import { validateAudioFile } from "@/lib/audio-library/audio-library-validation";
import { logAudioEvent } from "./audio-observability";
import { EnumSelect } from "./EnumSelect";
import { MultiChipSelect } from "./MultiChipSelect";
import {
  applySeasonToggle,
  formatSeconds,
  toggleInArray,
  validateClientPreferredRange,
} from "./audio-ui-helpers";

function parseSecondsInput(v: string): number | null {
  const trimmed = v.trim();
  if (!trimmed) return null;
  const n = Number(trimmed);
  return Number.isFinite(n) ? Math.floor(n) : null;
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
  const [marketingObjectives, setMarketingObjectives] = useState<
    AudioMarketingObjective[]
  >([]);
  const [brandStyles, setBrandStyles] = useState<AudioBrandStyle[]>([]);
  const [seasons, setSeasons] = useState<AudioSeason[]>([]);
  const [targetAudiences, setTargetAudiences] = useState<AudioTargetAudience[]>(
    [],
  );
  const [bestVideoDurations, setBestVideoDurations] = useState<
    AudioVideoDuration[]
  >([]);
  const [startSec, setStartSec] = useState<string>("");
  const [endSec, setEndSec] = useState<string>("");
  const [source, setSource] = useState("");
  const [rightsNotes, setRightsNotes] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [duration, setDuration] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);

  const quotaReached = quota?.limit != null && quota.used >= quota.limit;

  function reset() {
    setFile(null);
    setName("");
    setDescription("");
    setCategory("");
    setMood("");
    setEnergy("");
    setVocalType("");
    setRecommendedFor([]);
    setMarketingObjectives([]);
    setBrandStyles([]);
    setSeasons([]);
    setTargetAudiences([]);
    setBestVideoDurations([]);
    setStartSec("");
    setEndSec("");
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

  async function handleSubmit() {
    if (!file) return toast.error("Selecione o arquivo de áudio");
    if (!name.trim()) return toast.error("Informe um nome");
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
      return toast.error(
        `Limite do plano ${quota?.tier} atingido (${quota?.used}/${quota?.limit}).`,
      );
    }
    const startVal = parseSecondsInput(startSec);
    const endVal = parseSecondsInput(endSec);
    const rangeCheck = validateClientPreferredRange({
      start: startVal,
      end: endVal,
      durationSeconds: duration,
    });
    if (!rangeCheck.ok) return toast.error(rangeCheck.message);

    setSaving(true);
    logAudioEvent("upload_started", { size_bytes: file.size, mime: file.type });
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
        marketingObjectives,
        brandStyles,
        seasons,
        targetAudiences,
        bestVideoDurations,
        preferredStartSecond: rangeCheck.result.start,
        preferredEndSecond: rangeCheck.result.end,
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
        const quotaMatch = msg.match(/^quota_exceeded:([^:]+):(\d+):(.+)$/);
        if (quotaMatch) toast.error(quotaMatch[3]);
        else toast.error(msg);
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
                {duration ? ` — ${formatSeconds(duration)}` : ""}
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

          <MultiChipSelect
            label="Usos recomendados"
            value={recommendedFor}
            options={AUDIO_RECOMMENDED_FOR}
            onToggle={(v) => setRecommendedFor((p) => toggleInArray(p, v))}
          />

          <MultiChipSelect
            label="Objetivos de marketing"
            value={marketingObjectives}
            options={AUDIO_MARKETING_OBJECTIVES}
            onToggle={(v) => setMarketingObjectives((p) => toggleInArray(p, v))}
          />

          <MultiChipSelect
            label="Estilos de marca"
            value={brandStyles}
            options={AUDIO_BRAND_STYLES}
            onToggle={(v) => setBrandStyles((p) => toggleInArray(p, v))}
          />

          <MultiChipSelect
            label="Estações"
            helperText='Selecionar "todas" limpa as demais estações.'
            value={seasons}
            options={AUDIO_SEASONS}
            onToggle={(v) => setSeasons((p) => applySeasonToggle(p, v))}
          />

          <MultiChipSelect
            label="Públicos-alvo"
            value={targetAudiences}
            options={AUDIO_TARGET_AUDIENCES}
            onToggle={(v) => setTargetAudiences((p) => toggleInArray(p, v))}
          />

          <MultiChipSelect<AudioVideoDuration>
            label="Durações recomendadas de vídeo"
            value={bestVideoDurations}
            options={AUDIO_VIDEO_DURATIONS}
            onToggle={(v) => setBestVideoDurations((p) => toggleInArray(p, v))}
            renderLabel={(n) => `${n}s`}
          />

          <div className="grid gap-3 md:grid-cols-2">
            <div>
              <Label htmlFor="pref-start">Trecho preferido — início (s)</Label>
              <Input
                id="pref-start"
                type="number"
                min={0}
                inputMode="numeric"
                value={startSec}
                onChange={(e) => setStartSec(e.target.value)}
                placeholder="ex.: 22"
              />
            </div>
            <div>
              <Label htmlFor="pref-end">Trecho preferido — fim (s)</Label>
              <Input
                id="pref-end"
                type="number"
                min={0}
                inputMode="numeric"
                value={endSec}
                onChange={(e) => setEndSec(e.target.value)}
                placeholder="ex.: 37"
              />
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
