import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
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
  type AudioLibraryRow,
  type AudioMarketingObjective,
  type AudioMood,
  type AudioRecommendedFor,
  type AudioSeason,
  type AudioTargetAudience,
  type AudioVideoDuration,
  type AudioVocalType,
} from "@/lib/audio-library/audio-library.types";
import { updateAudioMetadata } from "@/lib/audio-library/audio-library-service";
import { EnumSelect } from "./EnumSelect";
import { MultiChipSelect } from "./MultiChipSelect";
import {
  applySeasonToggle,
  toggleInArray,
  validateClientPreferredRange,
} from "./audio-ui-helpers";

function parseSecondsInput(v: string): number | null {
  const trimmed = v.trim();
  if (!trimmed) return null;
  const n = Number(trimmed);
  return Number.isFinite(n) ? Math.floor(n) : null;
}

export function AudioEditDialog({
  row,
  onClose,
  onUpdated,
}: {
  row: AudioLibraryRow | null;
  onClose: () => void;
  onUpdated: () => void | Promise<void>;
}) {
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
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!row) return;
    setName(row.name);
    setDescription(row.description ?? "");
    setCategory((row.category as AudioCategory | null) ?? "");
    setMood((row.mood as AudioMood | null) ?? "");
    setEnergy((row.energy as AudioEnergy | null) ?? "");
    setVocalType((row.vocal_type as AudioVocalType | null) ?? "");
    setRecommendedFor(row.recommended_for as AudioRecommendedFor[]);
    setMarketingObjectives(row.marketing_objectives ?? []);
    setBrandStyles(row.brand_styles ?? []);
    setSeasons(row.seasons ?? []);
    setTargetAudiences(row.target_audiences ?? []);
    setBestVideoDurations(row.best_video_durations ?? []);
    setStartSec(
      row.preferred_start_second != null ? String(row.preferred_start_second) : "",
    );
    setEndSec(
      row.preferred_end_second != null ? String(row.preferred_end_second) : "",
    );
    setSource(row.source ?? "");
    setRightsNotes(row.commercial_rights_notes ?? "");
  }, [row]);

  async function handleSave() {
    if (!row) return;
    if (!name.trim()) {
      toast.error("Informe um nome");
      return;
    }
    const startVal = parseSecondsInput(startSec);
    const endVal = parseSecondsInput(endSec);
    const rangeCheck = validateClientPreferredRange({
      start: startVal,
      end: endVal,
      durationSeconds: row.duration_seconds,
    });
    if (!rangeCheck.ok) return toast.error(rangeCheck.message);

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
        marketingObjectives,
        brandStyles,
        seasons,
        targetAudiences,
        bestVideoDurations,
        preferredStartSecond: rangeCheck.result.start,
        preferredEndSecond: rangeCheck.result.end,
      });
      toast.success("Áudio atualizado");
      onClose();
      await onUpdated();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao atualizar");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={!!row} onOpenChange={(v) => (v ? null : onClose())}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Editar áudio</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
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
              <Label htmlFor="edit-pref-start">
                Trecho preferido — início (s)
              </Label>
              <Input
                id="edit-pref-start"
                type="number"
                min={0}
                inputMode="numeric"
                value={startSec}
                onChange={(e) => setStartSec(e.target.value)}
              />
            </div>
            <div>
              <Label htmlFor="edit-pref-end">Trecho preferido — fim (s)</Label>
              <Input
                id="edit-pref-end"
                type="number"
                min={0}
                inputMode="numeric"
                value={endSec}
                onChange={(e) => setEndSec(e.target.value)}
              />
            </div>
          </div>

          <div>
            <Label>Observações sobre direitos comerciais</Label>
            <Textarea
              value={rightsNotes}
              onChange={(e) => setRightsNotes(e.target.value)}
              rows={2}
            />
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
