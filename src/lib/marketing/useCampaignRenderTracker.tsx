// ============================================================================
// Campaign Render Tracker — polling global independente da tela ativa.
//
// Resolve a causa raiz de "cliquei em gerar e nada acontece": antes, o
// polling vivia dentro do gerador; ao mudar de aba/rota o componente
// desmontava e o usuário perdia o feedback. Agora o polling roda no
// provider (montado no __root) e persiste a lista em localStorage, então:
//
//   - navegar entre abas do Marketing IA não perde o progresso;
//   - navegar para outra rota (inbox, campanhas) mantém o rastreamento;
//   - recarregar a página retoma os polls das campanhas ainda pendentes;
//   - toast global avisa quando cada campanha termina (sucesso ou falha).
//
// Contrato: chame `trackCampaign(campaignId)` após criar a campanha.
// Consuma `useCampaignRenderTracker()` para renderizar barras de progresso
// em qualquer tela.
// ============================================================================

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { toast } from "sonner";
import { apiGetCampaignRenderStatus } from "@/data/marketingRepo";
import { friendlyRenderError } from "@/lib/marketing/render-error-messages";

const STORAGE_KEY = "atendeai.campaign-tracker.v1";
const POLL_INTERVAL_ACTIVE = 6000; // 6s quando aba visível
const POLL_INTERVAL_HIDDEN = 20000; // 20s em background
const MAX_TRACK_HOURS = 6;

type RoleStatus = {
  status: string;
  progress: number | null;
  errorCode: string | null;
  videoId: string | null;
  jobId: string | null;
};

export interface TrackedCampaign {
  campaignId: string;
  createdAt: number;
  finishedAt: number | null;
  feed: RoleStatus;
  story: RoleStatus;
  /** true assim que ambos os formatos chegam a estado terminal. */
  done: boolean;
  /** true se qualquer formato falhou. */
  hasFailure: boolean;
}

type CampaignMap = Record<string, TrackedCampaign>;

interface ContextValue {
  campaigns: CampaignMap;
  trackCampaign: (id: string) => void;
  untrackCampaign: (id: string) => void;
  refresh: (id?: string) => Promise<void>;
}

const Ctx = createContext<ContextValue | null>(null);

function emptyRole(): RoleStatus {
  return { status: "pending", progress: 0, errorCode: null, videoId: null, jobId: null };
}

function loadFromStorage(): CampaignMap {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as CampaignMap;
    // Garbage-collect campanhas antigas.
    const cutoff = Date.now() - MAX_TRACK_HOURS * 3600_000;
    const out: CampaignMap = {};
    for (const [k, v] of Object.entries(parsed)) {
      if (v && typeof v === "object" && v.createdAt > cutoff) out[k] = v;
    }
    return out;
  } catch {
    return {};
  }
}

function saveToStorage(map: CampaignMap): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
  } catch {
    /* localStorage cheio — sem estratégia de retry */
  }
}

function isTerminalStatus(s: string, videoId: string | null): boolean {
  return !!videoId || s === "failed" || s === "cancelled";
}

export function CampaignRenderTrackerProvider({ children }: { children: ReactNode }) {
  const [campaigns, setCampaigns] = useState<CampaignMap>(() => loadFromStorage());
  const campaignsRef = useRef<CampaignMap>(campaigns);
  campaignsRef.current = campaigns;

  // Sincroniza estado com storage e cross-tab.
  useEffect(() => {
    saveToStorage(campaigns);
  }, [campaigns]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const onStorage = (e: StorageEvent) => {
      if (e.key !== STORAGE_KEY) return;
      setCampaigns(loadFromStorage());
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const fetchOne = useCallback(async (id: string): Promise<TrackedCampaign | null> => {
    try {
      const s = await apiGetCampaignRenderStatus(id);
      const prev = campaignsRef.current[id];
      const feed: RoleStatus = {
        status: s.feed.video_id ? "completed" : (s.feed.job?.status ?? "pending"),
        progress: s.feed.video_id ? 100 : (s.feed.job?.progress ?? 0),
        errorCode: s.feed.job?.error_code ?? null,
        videoId: s.feed.video_id,
        jobId: s.feed.job_id,
      };
      const story: RoleStatus = {
        status: s.story.video_id ? "completed" : (s.story.job?.status ?? "pending"),
        progress: s.story.video_id ? 100 : (s.story.job?.progress ?? 0),
        errorCode: s.story.job?.error_code ?? null,
        videoId: s.story.video_id,
        jobId: s.story.job_id,
      };
      const feedTerm = isTerminalStatus(feed.status, feed.videoId);
      const storyTerm = isTerminalStatus(story.status, story.videoId);
      const done = feedTerm && storyTerm;
      const hasFailure = feed.status === "failed" || story.status === "failed";
      return {
        campaignId: id,
        createdAt: prev?.createdAt ?? Date.now(),
        finishedAt: done ? (prev?.finishedAt ?? Date.now()) : null,
        feed,
        story,
        done,
        hasFailure,
      };
    } catch {
      return null;
    }
  }, []);

  const applyUpdate = useCallback((prev: CampaignMap, updated: TrackedCampaign): CampaignMap => {
    const before = prev[updated.campaignId];
    const next: CampaignMap = { ...prev, [updated.campaignId]: updated };

    // Toast quando transiciona para terminal.
    if (updated.done && (!before || !before.done)) {
      if (updated.hasFailure) {
        const code = updated.feed.errorCode ?? updated.story.errorCode ?? "render_failed";
        toast.error("Renderização falhou", {
          description: friendlyRenderError(code),
          duration: 8000,
        });
      } else {
        toast.success("Vídeo pronto!", {
          description: "Feed e Story foram renderizados.",
          duration: 8000,
        });
      }
    }
    return next;
  }, []);

  const refresh = useCallback(
    async (id?: string) => {
      const ids = id ? [id] : Object.keys(campaignsRef.current).filter((k) => !campaignsRef.current[k].done);
      if (ids.length === 0) return;
      const results = await Promise.all(ids.map(fetchOne));
      setCampaigns((prev) => {
        let next = prev;
        for (const r of results) {
          if (r) next = applyUpdate(next, r);
        }
        return next;
      });
    },
    [fetchOne, applyUpdate],
  );

  // Poll loop
  useEffect(() => {
    if (typeof window === "undefined") return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const schedule = () => {
      const pending = Object.values(campaignsRef.current).some((c) => !c.done);
      if (!pending) {
        timer = setTimeout(schedule, POLL_INTERVAL_ACTIVE);
        return;
      }
      const interval = document.hidden ? POLL_INTERVAL_HIDDEN : POLL_INTERVAL_ACTIVE;
      timer = setTimeout(async () => {
        await refresh();
        schedule();
      }, interval);
    };
    schedule();
    return () => {
      if (timer) clearTimeout(timer);
    };
  }, [refresh]);

  const trackCampaign = useCallback(
    (id: string) => {
      setCampaigns((prev) => {
        if (prev[id]) return prev;
        return {
          ...prev,
          [id]: {
            campaignId: id,
            createdAt: Date.now(),
            finishedAt: null,
            feed: emptyRole(),
            story: emptyRole(),
            done: false,
            hasFailure: false,
          },
        };
      });
      // Primeiro fetch imediato para trocar o placeholder o quanto antes.
      void refresh(id);
    },
    [refresh],
  );

  const untrackCampaign = useCallback((id: string) => {
    setCampaigns((prev) => {
      if (!prev[id]) return prev;
      const { [id]: _drop, ...rest } = prev;
      void _drop;
      return rest;
    });
  }, []);

  const value = useMemo<ContextValue>(
    () => ({ campaigns, trackCampaign, untrackCampaign, refresh }),
    [campaigns, trackCampaign, untrackCampaign, refresh],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useCampaignRenderTracker(): ContextValue {
  const v = useContext(Ctx);
  if (!v) {
    // Silent fallback: componentes de UI podem ser usados fora do provider
    // (ex.: prévias). Retorna valor "vazio" sem funcionalidade.
    return {
      campaigns: {},
      trackCampaign: () => {},
      untrackCampaign: () => {},
      refresh: async () => {},
    };
  }
  return v;
}

/** Hook conveniente para uma única campanha. */
export function useTrackedCampaign(id: string | null): TrackedCampaign | null {
  const { campaigns } = useCampaignRenderTracker();
  if (!id) return null;
  return campaigns[id] ?? null;
}
