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
import { updateAudioMetadata } from "@/lib/audio-library/audio-library-service";
import { EnumSelect } from "./EnumSelect";

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
    setSource(row.source ?? "");
    setRightsNotes(row.commercial_rights_notes ?? "");
  }, [row]);

  function toggleRecommended(value: AudioRecommendedFor) {
    setRecommendedFor((prev) =>
      prev.includes(value) ? prev.filter((v) => v !== value) : [...prev, value],
    );
  }

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
