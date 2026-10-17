// Estado global do popup de Configurações (aberto + aba ativa).
// Qualquer parte do app pode abrir o popup direto numa aba com openSettings().

import { useSyncExternalStore } from "react";

export type SettingsTab = "usuarios" | "aparencia" | "atendimento" | "conexoes" | "privacidade";

/** `direct`: aberto já numa seção específica (o celular pula a lista). */
type State = { open: boolean; tab: SettingsTab; direct: boolean };

let state: State = { open: false, tab: "aparencia", direct: false };
const listeners = new Set<() => void>();

function set(next: State) {
  state = next;
  for (const l of listeners) l();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

const getState = () => state;

export function openSettings(tab?: SettingsTab) {
  set({ open: true, tab: tab ?? state.tab, direct: !!tab });
}

export function closeSettings() {
  set({ ...state, open: false });
}

export function setSettingsTab(tab: SettingsTab) {
  set({ ...state, tab });
}

export function useSettingsDialog(): State {
  return useSyncExternalStore(subscribe, getState, getState);
}
