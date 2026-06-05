// Serviço de notificações de novas mensagens (in-app + browser).
// - Dedupe por message.id/external_id com TTL.
// - Som via WebAudio (beep curto), sem dependência de asset.
// - Browser notification via Web Notifications API quando permitido + aba não focada na conversa.
// - Clique na notificação abre /inbox/{conversationId}.

import { getNotificationPrefs } from "./notification-prefs";

const DEDUPE_TTL_MS = 5 * 60 * 1000;
const dedupe = new Map<string, number>();

function rememberSeen(key: string) {
  const now = Date.now();
  dedupe.set(key, now);
  // GC
  if (dedupe.size > 500) {
    for (const [k, t] of dedupe) {
      if (now - t > DEDUPE_TTL_MS) dedupe.delete(k);
    }
  }
}

function alreadySeen(key: string): boolean {
  const t = dedupe.get(key);
  if (!t) return false;
  if (Date.now() - t > DEDUPE_TTL_MS) {
    dedupe.delete(key);
    return false;
  }
  return true;
}

// ---------- som ----------
let audioCtx: AudioContext | null = null;
let audioUnlocked = false;

function ensureAudioCtx(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (!audioCtx) {
    try {
      const Ctx =
        (window as unknown as { AudioContext?: typeof AudioContext }).AudioContext ||
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctx) return null;
      audioCtx = new Ctx();
    } catch {
      return null;
    }
  }
  return audioCtx;
}

// Desbloqueia áudio no primeiro gesto do usuário (requisito de autoplay).
export function setupAudioUnlock() {
  if (typeof window === "undefined" || audioUnlocked) return;
  const unlock = () => {
    audioUnlocked = true;
    const ctx = ensureAudioCtx();
    if (ctx && ctx.state === "suspended") {
      void ctx.resume();
    }
    window.removeEventListener("pointerdown", unlock);
    window.removeEventListener("keydown", unlock);
  };
  window.addEventListener("pointerdown", unlock, { once: true });
  window.addEventListener("keydown", unlock, { once: true });
}

function playBeep(volume = 0.18) {
  const ctx = ensureAudioCtx();
  if (!ctx) return;
  if (ctx.state === "suspended") {
    void ctx.resume();
  }
  try {
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(880, now);
    osc.frequency.exponentialRampToValueAtTime(1320, now + 0.12);
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(volume, now + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.28);
    osc.connect(gain).connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.3);
  } catch {
    // ignore
  }
}

// ---------- preview por tipo ----------
export function describeMessage(
  text: string | null | undefined,
  subtype: string | null | undefined,
  metadata: Record<string, unknown> | null | undefined,
): string {
  const kind =
    subtype ||
    (metadata && typeof metadata === "object"
      ? (metadata as { media_kind?: string; type?: string }).media_kind ??
        (metadata as { type?: string }).type
      : undefined);

  switch (kind) {
    case "image":
      return "📷 Enviou uma imagem";
    case "audio":
    case "voice":
    case "ptt":
      return "🎤 Enviou um áudio";
    case "video":
      return "🎥 Enviou um vídeo";
    case "document":
    case "file":
      return "📎 Enviou um documento";
    case "sticker":
      return "💟 Enviou um sticker";
    case "location":
      return "📍 Enviou uma localização";
  }

  const t = (text ?? "").trim();
  if (!t) return "Enviou uma mensagem";
  return t.length > 80 ? t.slice(0, 77) + "…" : t;
}

// ---------- API principal ----------
export interface NotifyInput {
  messageId: string;
  externalId?: string | null;
  conversationId: string;
  leadName: string;
  body: string;
  // se a conversa já está aberta e visível em foco
  suppressBrowser: boolean;
  onOpen: () => void;
}

export function notifyNewLeadMessage(input: NotifyInput) {
  const key = input.messageId || input.externalId || `${input.conversationId}:${Date.now()}`;
  if (alreadySeen(key)) return;
  rememberSeen(key);

  const prefs = getNotificationPrefs();

  if (prefs.soundEnabled) {
    // som mais baixo quando conversa em foco
    playBeep(input.suppressBrowser ? 0.08 : 0.18);
  }

  if (prefs.browserEnabled && !input.suppressBrowser && typeof Notification !== "undefined") {
    if (Notification.permission !== "granted") return;
    try {
      const n = new Notification(input.leadName, {
        body: input.body,
        tag: `conv-${input.conversationId}`,
        icon: "/icon-192.png",
        badge: "/icon-192.png",
      });
      n.onclick = () => {
        try {
          window.focus();
        } catch {
          // ignore
        }
        input.onOpen();
        n.close();
      };
    } catch {
      // ignore
    }
  }
}
