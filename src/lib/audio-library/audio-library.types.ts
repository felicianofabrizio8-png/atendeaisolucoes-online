// Shared types for the Audio Library module.
// Server functions, client service and UI all import from here.

export type AudioCategory =
  | "tropical"
  | "resort"
  | "familia"
  | "promocional"
  | "elegante"
  | "institucional"
  | "motivacional"
  | "infantil"
  | "fashion"
  | "comemorativa"
  | "outros";

export type AudioMood =
  | "alegre"
  | "relaxante"
  | "emocionante"
  | "sofisticado"
  | "energetico"
  | "leve"
  | "divertido"
  | "inspirador";

export type AudioEnergy = "baixa" | "media" | "alta";

export type AudioVocalType = "instrumental" | "vocal" | "jingle" | "efeitos";

export type AudioRecommendedFor =
  | "story"
  | "reel"
  | "feed"
  | "promocao"
  | "institucional"
  | "produto"
  | "depoimento"
  | "oferta"
  | "data_comemorativa";

export const AUDIO_CATEGORIES: AudioCategory[] = [
  "tropical",
  "resort",
  "familia",
  "promocional",
  "elegante",
  "institucional",
  "motivacional",
  "infantil",
  "fashion",
  "comemorativa",
  "outros",
];

export const AUDIO_MOODS: AudioMood[] = [
  "alegre",
  "relaxante",
  "emocionante",
  "sofisticado",
  "energetico",
  "leve",
  "divertido",
  "inspirador",
];

export const AUDIO_ENERGIES: AudioEnergy[] = ["baixa", "media", "alta"];

export const AUDIO_VOCAL_TYPES: AudioVocalType[] = [
  "instrumental",
  "vocal",
  "jingle",
  "efeitos",
];

export const AUDIO_RECOMMENDED_FOR: AudioRecommendedFor[] = [
  "story",
  "reel",
  "feed",
  "promocao",
  "institucional",
  "produto",
  "depoimento",
  "oferta",
  "data_comemorativa",
];

export const AUDIO_ALLOWED_MIME_TYPES = [
  "audio/mpeg",
  "audio/mp3",
  "audio/wav",
  "audio/x-wav",
] as const;

export type AudioMimeType = (typeof AUDIO_ALLOWED_MIME_TYPES)[number];

export const AUDIO_MAX_FILE_BYTES = 30 * 1024 * 1024; // 30 MB

export interface AudioLibraryRow {
  id: string;
  company_id: string;
  name: string;
  description: string | null;
  file_path: string;
  original_filename: string | null;
  mime_type: string;
  file_size_bytes: number | null;
  duration_seconds: number | null;
  category: AudioCategory | null;
  mood: AudioMood | null;
  energy: AudioEnergy | null;
  vocal_type: AudioVocalType | null;
  recommended_for: AudioRecommendedFor[];
  source: string | null;
  commercial_use_confirmed: boolean;
  commercial_rights_notes: string | null;
  is_active: boolean;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

/** Filtros para consultas na biblioteca (usado pela camada de serviço). */
export interface AudioLibraryQuery {
  category?: AudioCategory | null;
  mood?: AudioMood | null;
  energy?: AudioEnergy | null;
  recommendedFor?: AudioRecommendedFor | null;
  activeOnly?: boolean;
  search?: string | null;
}
