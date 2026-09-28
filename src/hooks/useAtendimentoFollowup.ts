import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { FollowupCycleView } from "@/lib/atendimento/followup-view";

export function useAtendimentoFollowup({ enabled = true }: { enabled?: boolean } = {}) {
  const [cycles, setCycles] = useState<FollowupCycleView[]>([]);
  const [loading, setLoading] = useState(enabled);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!enabled) {
      setCycles([]);
      setLoading(false);
      setError(null);
      return;
    }
    setLoading(true);
    try {
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      if (!token) {
        setCycles([]);
        setError(null);
        return;
      }
      const response = await fetch("/api/atendimento/followup", {
        headers: { Authorization: `Bearer ${token}` },
      });
      const payload = (await response.json()) as {
        ok?: boolean;
        cycles?: FollowupCycleView[];
        error?: string;
      };
      if (!response.ok || !payload.ok) throw new Error(payload.error ?? "Falha ao carregar follow-ups");
      setCycles(payload.cycles ?? []);
      setError(null);
    } catch (cause) {
      setCycles([]);
      setError(cause instanceof Error ? cause.message : "Falha ao carregar follow-ups");
    } finally {
      setLoading(false);
    }
  }, [enabled]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const byConversation = useMemo(
    () => new Map(cycles.map((cycle) => [cycle.conversationId, cycle] as const)),
    [cycles],
  );

  return { cycles, byConversation, loading, error, refresh };
}
