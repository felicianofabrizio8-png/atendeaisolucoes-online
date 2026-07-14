// ============================================================================
// Persistência local (localStorage) para: favoritos, últimos abertos e
// fila do Modo Foco. Sem backend, sem endpoints, sem migrations.
// ============================================================================

import { useEffect, useSyncExternalStore } from "react";

const FAV_KEY = "inbox.favorites.v1";
const RECENT_KEY = "inbox.recent.v1";
const FOCUS_KEY = "inbox.focus.v1";
const RECENT_MAX = 10;

type Listener = () => void;
const listeners = new Set<Listener>();

function notify() { for (const l of listeners) l(); }

function subscribe(cb: Listener) {
  listeners.add(cb);
  const onStorage = (e: StorageEvent) => {
    if (!e.key || [FAV_KEY, RECENT_KEY, FOCUS_KEY].includes(e.key)) cb();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(cb);
    window.removeEventListener("storage", onStorage);
  };
}

function readArray(key: string): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return [];
    const p = JSON.parse(raw);
    return Array.isArray(p) ? p.filter((x): x is string => typeof x === "string") : [];
  } catch { return []; }
}
function writeArray(key: string, val: string[]) {
  try { localStorage.setItem(key, JSON.stringify(val)); } catch { /* noop */ }
  notify();
}

// -------- Favoritos ---------------------------------------------------------
export function getFavorites(): string[] { return readArray(FAV_KEY); }
export function toggleFavorite(id: string) {
  const cur = new Set(readArray(FAV_KEY));
  if (cur.has(id)) cur.delete(id); else cur.add(id);
  writeArray(FAV_KEY, [...cur]);
}

// -------- Recentes ----------------------------------------------------------
export function getRecent(): string[] { return readArray(RECENT_KEY); }
export function pushRecent(id: string) {
  const cur = readArray(RECENT_KEY).filter((x) => x !== id);
  cur.unshift(id);
  writeArray(RECENT_KEY, cur.slice(0, RECENT_MAX));
}

// -------- Modo Foco ---------------------------------------------------------
export interface FocusState {
  queue: string[];
  index: number;
  startedAt: string;
}
export function getFocus(): FocusState | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(FOCUS_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw) as FocusState;
    if (!Array.isArray(p.queue) || typeof p.index !== "number") return null;
    return p;
  } catch { return null; }
}
export function startFocus(queue: string[]) {
  if (queue.length === 0) return;
  const state: FocusState = { queue, index: 0, startedAt: new Date().toISOString() };
  localStorage.setItem(FOCUS_KEY, JSON.stringify(state));
  notify();
}
export function advanceFocus(): string | null {
  const s = getFocus();
  if (!s) return null;
  const nextIdx = s.index + 1;
  if (nextIdx >= s.queue.length) { stopFocus(); return null; }
  const next: FocusState = { ...s, index: nextIdx };
  localStorage.setItem(FOCUS_KEY, JSON.stringify(next));
  notify();
  return next.queue[nextIdx];
}
export function stopFocus() {
  try { localStorage.removeItem(FOCUS_KEY); } catch { /* noop */ }
  notify();
}

// -------- Hooks React -------------------------------------------------------
export function useFavorites(): Set<string> {
  const snap = useSyncExternalStore(subscribe, getFavorites, getFavorites);
  return new Set(snap);
}
export function useRecent(): string[] {
  return useSyncExternalStore(subscribe, getRecent, getRecent);
}
export function useFocus(): FocusState | null {
  return useSyncExternalStore(subscribe, getFocus, () => null);
}

// Registra automaticamente que o usuário abriu uma conversa
export function useTrackRecent(id: string | undefined) {
  useEffect(() => { if (id) pushRecent(id); }, [id]);
}
