// Atalhos da barra inferior do celular, escolhidos por cada pessoa no menu
// ("Personalizar barra"). Ficam no aparelho: quem vende fixa Chat e Orçamentos,
// quem gere fixa Metas ou Executivo. Rotas sem permissão somem sozinhas na
// barra (a mesma regra da sidebar), então a lista nunca abre tela proibida.

const STORAGE_KEY = "lume.mobile-dock.v1";

export const DOCK_MIN = 2;
export const DOCK_MAX = 4;
export const DEFAULT_DOCK = ["/", "/atendimento", "/marketing", "/agenda"];

type Listener = () => void;
const listeners = new Set<Listener>();
let cache: string[] | null = null;

function read(): string[] {
  if (cache) return cache;
  try {
    const raw = typeof window !== "undefined" ? window.localStorage.getItem(STORAGE_KEY) : null;
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    cache =
      Array.isArray(parsed) &&
      parsed.length >= DOCK_MIN &&
      parsed.every((item) => typeof item === "string")
        ? (parsed as string[]).slice(0, DOCK_MAX)
        : DEFAULT_DOCK;
  } catch {
    cache = DEFAULT_DOCK;
  }
  return cache;
}

export function getDock(): string[] {
  return read();
}

export function getServerDock(): string[] {
  return DEFAULT_DOCK;
}

export function subscribeDock(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function write(next: string[]) {
  cache = next;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Navegação privada/armazenamento cheio: vale só até recarregar.
  }
  listeners.forEach((listener) => listener());
}

/**
 * Liga/desliga uma rota na barra. Retorna `false` quando não dá (já tem o
 * máximo, ou tirar deixaria menos que o mínimo) para a tela avisar.
 */
export function toggleDockRoute(route: string): boolean {
  const current = read();
  if (current.includes(route)) {
    if (current.length <= DOCK_MIN) return false;
    write(current.filter((item) => item !== route));
    return true;
  }
  if (current.length >= DOCK_MAX) return false;
  write([...current, route]);
  return true;
}

export function resetDock() {
  write(DEFAULT_DOCK);
}
