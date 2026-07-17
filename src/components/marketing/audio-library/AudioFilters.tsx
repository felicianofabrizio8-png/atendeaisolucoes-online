import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { X } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
  type AudioBrandStyle,
  type AudioCategory,
  type AudioEnergy,
  type AudioMarketingObjective,
  type AudioMood,
  type AudioRecommendedFor,
  type AudioSeason,
  type AudioTargetAudience,
  type AudioVideoDuration,
} from "@/lib/audio-library/audio-library.types";

export type AudioFiltersState = {
  search: string;
  category: AudioCategory | "all";
  mood: AudioMood | "all";
  energy: AudioEnergy | "all";
  recommendedFor: AudioRecommendedFor | "all";
  marketingObjective: AudioMarketingObjective | "all";
  brandStyle: AudioBrandStyle | "all";
  season: AudioSeason | "all";
  targetAudience: AudioTargetAudience | "all";
  bestVideoDuration: AudioVideoDuration | "all";
};

export const emptyAudioFilters: AudioFiltersState = {
  search: "",
  category: "all",
  mood: "all",
  energy: "all",
  recommendedFor: "all",
  marketingObjective: "all",
  brandStyle: "all",
  season: "all",
  targetAudience: "all",
  bestVideoDuration: "all",
};

/** Retorna true se pelo menos um filtro está diferente do default. */
export function hasActiveAudioFilters(state: AudioFiltersState): boolean {
  return (
    state.search.trim() !== "" ||
    state.category !== "all" ||
    state.mood !== "all" ||
    state.energy !== "all" ||
    state.recommendedFor !== "all" ||
    state.marketingObjective !== "all" ||
    state.brandStyle !== "all" ||
    state.season !== "all" ||
    state.targetAudience !== "all" ||
    state.bestVideoDuration !== "all"
  );
}

function FilterSelect(props: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  options: readonly (string | number)[];
  ariaLabel?: string;
}) {
  return (
    <Select value={props.value} onValueChange={props.onChange}>
      <SelectTrigger aria-label={props.ariaLabel ?? props.placeholder}>
        <SelectValue placeholder={props.placeholder} />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="all">Todos — {props.placeholder}</SelectItem>
        {props.options.map((o) => (
          <SelectItem key={String(o)} value={String(o)}>
            {typeof o === "number" ? `${o}s` : o}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export function AudioFilters({
  value,
  onChange,
  onClear,
}: {
  value: AudioFiltersState;
  onChange: (patch: Partial<AudioFiltersState>) => void;
  onClear?: () => void;
}) {
  const canClear = hasActiveAudioFilters(value);
  return (
    <div className="space-y-2">
      <div className="grid gap-2 md:grid-cols-2 lg:grid-cols-5">
        <Input
          placeholder="Buscar por nome…"
          value={value.search}
          onChange={(e) => onChange({ search: e.target.value })}
          aria-label="Buscar áudios por nome"
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
        <FilterSelect
          value={value.marketingObjective}
          onChange={(v) =>
            onChange({
              marketingObjective: v as AudioFiltersState["marketingObjective"],
            })
          }
          placeholder="Objetivo"
          options={AUDIO_MARKETING_OBJECTIVES}
        />
        <FilterSelect
          value={value.brandStyle}
          onChange={(v) =>
            onChange({ brandStyle: v as AudioFiltersState["brandStyle"] })
          }
          placeholder="Estilo"
          options={AUDIO_BRAND_STYLES}
        />
        <FilterSelect
          value={value.season}
          onChange={(v) => onChange({ season: v as AudioFiltersState["season"] })}
          placeholder="Estação"
          options={AUDIO_SEASONS}
        />
        <FilterSelect
          value={value.targetAudience}
          onChange={(v) =>
            onChange({
              targetAudience: v as AudioFiltersState["targetAudience"],
            })
          }
          placeholder="Público"
          options={AUDIO_TARGET_AUDIENCES}
        />
        <FilterSelect
          value={String(value.bestVideoDuration)}
          onChange={(v) =>
            onChange({
              bestVideoDuration:
                v === "all"
                  ? "all"
                  : (Number(v) as AudioVideoDuration),
            })
          }
          placeholder="Duração"
          options={AUDIO_VIDEO_DURATIONS}
        />
      </div>
      {onClear ? (
        <div className="flex justify-end">
          <Button
            variant="ghost"
            size="sm"
            onClick={onClear}
            disabled={!canClear}
            aria-label="Limpar filtros"
          >
            <X className="h-3.5 w-3.5 mr-1" /> Limpar filtros
          </Button>
        </div>
      ) : null}
    </div>
  );
}
