// Preferências de notificação por usuário (localStorage).
// Pub/sub para a UI reagir aos toggles.

export interface NotificationPrefs {
  soundEnabled: boolean;
  browserEnabled: boolean;
}

const STORAGE_KEY = "atendeai.notifs.v1";
const DEFAULTS: NotificationPrefs = {
  soundEnabled: true,
  browserEnabled: false,
};

function load(): NotificationPrefs {
  if (typeof window === "undefined") return DEFAULTS;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULTS;
    const parsed = JSON.parse(raw) as Partial<NotificationPrefs>;
    return {
      soundEnabled: parsed.soundEnabled ?? DEFAULTS.soundEnabled,
      browserEnabled: parsed.browserEnabled ?? DEFAULTS.browserEnabled,
    };
  } catch {
    return DEFAULTS;
  }
}

let _prefs: NotificationPrefs = load();
const listeners = new Set<() => void>();

function persist() {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(_prefs));
  } catch {
    // ignore quota
  }
  for (const l of listeners) l();
}

export function getNotificationPrefs(): NotificationPrefs {
  return _prefs;
}

export function setNotificationPrefs(patch: Partial<NotificationPrefs>) {
  _prefs = { ..._prefs, ...patch };
  persist();
}

export function subscribeNotificationPrefs(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

export function getBrowserPermission(): NotificationPermission | "unsupported" {
  if (typeof window === "undefined" || typeof Notification === "undefined") {
    return "unsupported";
  }
  return Notification.permission;
}

export async function requestBrowserPermission(): Promise<NotificationPermission | "unsupported"> {
  if (typeof window === "undefined" || typeof Notification === "undefined") {
    return "unsupported";
  }
  try {
    const result = await Notification.requestPermission();
    if (result === "granted") {
      setNotificationPrefs({ browserEnabled: true });
    }
    return result;
  } catch {
    return "denied";
  }
}
