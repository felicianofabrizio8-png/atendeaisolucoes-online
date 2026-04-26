// Store de configurações da loja (SLA, motivos de perda etc.).
// Persistência em localStorage, pub/sub para componentes React reagirem.

export interface Settings {
  slaMinutes: number; // tempo máximo de resposta antes de marcar lead como "parado"
  lossReasons: string[]; // motivos de perda configurados pela loja
}

const STORAGE_KEY = "atendeai.settings.v1";
const DEFAULT_LOSS_REASONS = [
  "Sem retorno do cliente",
  "Preço acima do orçamento",
  "Comprou do concorrente",
  "Mudou de ideia",
  "Fora da região de atendimento",
];
const DEFAULTS: Settings = {
  slaMinutes: 5,
  lossReasons: DEFAULT_LOSS_REASONS,
};

function loadFromStorage(): Settings {
  if (typeof window === "undefined") return DEFAULTS;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULTS;
    const parsed = JSON.parse(raw) as Partial<Settings>;
    return {
      slaMinutes: parsed.slaMinutes ?? DEFAULTS.slaMinutes,
      lossReasons:
        Array.isArray(parsed.lossReasons) && parsed.lossReasons.length > 0
          ? parsed.lossReasons
          : DEFAULTS.lossReasons,
    };
  } catch {
    return DEFAULTS;
  }
}

function saveToStorage(s: Settings) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
  } catch {
    // ignore quota
  }
}

let _settings: Settings = loadFromStorage();
const listeners = new Set<() => void>();

function emit() {
  saveToStorage(_settings);
  for (const l of listeners) l();
}

export function getSettings(): Settings {
  return _settings;
}

export function subscribeSettings(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

export function updateSettings(patch: Partial<Settings>) {
  _settings = { ..._settings, ...patch };
  emit();
}

export function addLossReason(reason: string) {
  const trimmed = reason.trim();
  if (!trimmed) return;
  if (_settings.lossReasons.some((r) => r.toLowerCase() === trimmed.toLowerCase())) return;
  _settings = { ..._settings, lossReasons: [..._settings.lossReasons, trimmed] };
  emit();
}

export function updateLossReason(index: number, reason: string) {
  const trimmed = reason.trim();
  if (!trimmed) return;
  if (index < 0 || index >= _settings.lossReasons.length) return;
  const next = [..._settings.lossReasons];
  next[index] = trimmed;
  _settings = { ..._settings, lossReasons: next };
  emit();
}

export function removeLossReason(index: number) {
  if (index < 0 || index >= _settings.lossReasons.length) return;
  // não permitir esvaziar — motivos de perda são essenciais
  if (_settings.lossReasons.length === 1) return;
  const next = _settings.lossReasons.filter((_, i) => i !== index);
  _settings = { ..._settings, lossReasons: next };
  emit();
}

export const SLA_OPTIONS: { label: string; minutes: number }[] = [
  { label: "5 minutos", minutes: 5 },
  { label: "10 minutos", minutes: 10 },
  { label: "15 minutos", minutes: 15 },
  { label: "30 minutos", minutes: 30 },
  { label: "1 hora", minutes: 60 },
  { label: "2 horas", minutes: 120 },
];
