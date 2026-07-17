import { Input } from "@/components/ui/input";
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
  type AudioCategory,
  type AudioEnergy,
  type AudioMood,
  type AudioRecommendedFor,
} from "@/lib/audio-library/audio-library.types";

export type AudioFiltersState = {
  search: string;
  category: AudioCategory | "all";
  mood: AudioMood | "all";
  energy: AudioEnergy | "all";
  recommendedFor: AudioRecommendedFor | "all";
};

export const emptyAudioFilters: AudioFiltersState = {
  search: "",
  category: "all",
  mood: "all",
  energy: "all",
  recommendedFor: "all",
};

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

export function AudioFilters({
  value,
  onChange,
}: {
  value: AudioFiltersState;
  onChange: (patch: Partial<AudioFiltersState>) => void;
}) {
  return (
    <div className="grid gap-2 md:grid-cols-5">
      <Input
        placeholder="Buscar por nome…"
        value={value.search}
        onChange={(e) => onChange({ search: e.target.value })}
      />
      <FilterSelect
        value={value.category}
        onChange={(v) => onChange({ category: v as AudioFiltersState["category"] })}
        placeholder="Categoria"
        options={AUDIO_CATEGORIES}
      />
      <FilterSelect
        value={value.mood}
        onChange={(v) => onChange({ mood: v as AudioFiltersState["mood"] })}
        placeholder="Humor"
        options={AUDIO_MOODS}
      />
      <FilterSelect
        value={value.energy}
        onChange={(v) => onChange({ energy: v as AudioFiltersState["energy"] })}
        placeholder="Energia"
        options={AUDIO_ENERGIES}
      />
      <FilterSelect
        value={value.recommendedFor}
        onChange={(v) =>
          onChange({ recommendedFor: v as AudioFiltersState["recommendedFor"] })
        }
        placeholder="Uso recomendado"
        options={AUDIO_RECOMMENDED_FOR}
      />
    </div>
  );
}
