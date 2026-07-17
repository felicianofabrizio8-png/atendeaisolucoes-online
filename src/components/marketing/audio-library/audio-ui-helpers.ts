// Pure helpers used by Biblioteca de Áudio UI. Kept side-effect free e
// isolados para permitir cobertura por testes em ambiente node (vitest).

import {
  validatePreferredRange,
  type PreferredRangeResult,
} from "@/lib/audio-library/audio-library-validation";
import type {
  AudioBrandStyle,
  AudioLibraryQuery,
  AudioMarketingObjective,
  AudioSeason,
  AudioTargetAudience,
  AudioVideoDuration,
} from "@/lib/audio-library/audio-library.types";
import type { AudioFiltersState } from "./AudioFilters";

/** Toggle genérico preservando ordem (append no fim). */
export function toggleInArray<T>(list: readonly T[], value: T): T[] {
  return list.includes(value)
    ? list.filter((v) => v !== value)
    : [...list, value];
}

/**
 * Aplica a regra de exclusividade de "todas" em seasons:
 * - selecionar "todas" ⇒ apenas ["todas"]
 * - selecionar outra quando "todas" está ativo ⇒ substitui por [outra]
 * - senão, toggle normal.
 */
export function applySeasonToggle(
  current: readonly AudioSeason[],
  value: AudioSeason,
): AudioSeason[] {
  if (value === "todas") {
    // se já era "todas", desmarca — permite estado "sem preferência".
    return current.length === 1 && current[0] === "todas" ? [] : ["todas"];
  }
  if (current.includes("todas")) return [value];
  return toggleInArray(current, value);
}

/** Formata segundos → mm:ss. Valores inválidos → "--:--". */
export function formatSeconds(seconds: number | null | undefined): string {
  if (
    seconds == null ||
    !Number.isFinite(seconds) ||
    seconds < 0
  ) {
    return "--:--";
  }
  const total = Math.floor(seconds);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

/** Faixa "mm:ss–mm:ss" ou null quando trecho preferido não definido. */
export function formatPreferredRange(
  start: number | null | undefined,
  end: number | null | undefined,
): string | null {
  if (start == null || end == null) return null;
  return `${formatSeconds(start)}–${formatSeconds(end)}`;
}

/** Utilitário para cards: mostra `max` itens + "+N" quando sobrar. */
export function splitWithMore<T>(
  items: readonly T[],
  max: number,
): { visible: T[]; extra: number } {
  if (max <= 0) return { visible: [], extra: items.length };
  if (items.length <= max) return { visible: [...items], extra: 0 };
  return { visible: items.slice(0, max), extra: items.length - max };
}

/**
 * Valida trecho preferido no cliente antes de submeter — retorna mensagem
 * pt-BR pronta para toast. Reutiliza a validação canônica do server.
 */
export function validateClientPreferredRange(input: {
  start: number | null | undefined;
  end: number | null | undefined;
  durationSeconds?: number | null;
}): { ok: true; result: PreferredRangeResult } | { ok: false; message: string } {
  const res = validatePreferredRange({
    start: input.start ?? null,
    end: input.end ?? null,
    durationSeconds: input.durationSeconds ?? null,
  });
  if (res.ok) return { ok: true, result: res };
  const reason = res.reason;
  const map: Record<string, string> = {
    start_only: "Informe também o segundo final do trecho.",
    end_only: "Informe também o segundo inicial do trecho.",
    start_negative: "O segundo inicial não pode ser negativo.",
    end_not_greater_than_start:
      "O segundo final deve ser maior que o inicial.",
    start_out_of_duration:
      "O segundo inicial ultrapassa a duração do áudio.",
    end_out_of_duration: "O segundo final ultrapassa a duração do áudio.",
    not_integer: "Use apenas valores inteiros em segundos.",
  };
  return {
    ok: false,
    message: map[reason ?? ""] ?? "Trecho preferido inválido.",
  };
}

/**
 * Converte o estado de filtros da UI em `AudioLibraryQuery` — descarta os
 * "all" e mapeia os novos filtros para os nomes esperados pelo service.
 * `search` é mantido separadamente para filtro client-side (ilike já roda
 * no server, mas queremos digitação instantânea sem round-trip).
 */
export function filtersToQuery(
  filters: AudioFiltersState,
): AudioLibraryQuery {
  const q: AudioLibraryQuery = {};
  if (filters.category !== "all") q.category = filters.category;
  if (filters.mood !== "all") q.mood = filters.mood;
  if (filters.energy !== "all") q.energy = filters.energy;
  if (filters.recommendedFor !== "all") q.recommendedFor = filters.recommendedFor;
  if (filters.marketingObjective && filters.marketingObjective !== "all") {
    q.marketingObjective =
      filters.marketingObjective as AudioMarketingObjective;
  }
  if (filters.brandStyle && filters.brandStyle !== "all") {
    q.brandStyle = filters.brandStyle as AudioBrandStyle;
  }
  if (filters.season && filters.season !== "all") {
    q.season = filters.season as AudioSeason;
  }
  if (filters.targetAudience && filters.targetAudience !== "all") {
    q.targetAudience = filters.targetAudience as AudioTargetAudience;
  }
  if (filters.bestVideoDuration && filters.bestVideoDuration !== "all") {
    q.bestVideoDuration = Number(filters.bestVideoDuration) as AudioVideoDuration;
  }
  return q;
}
