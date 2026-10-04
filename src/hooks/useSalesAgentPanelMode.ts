import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/auth/AuthContext";
import { isSalesAgentServingAttendants } from "@/lib/sales-agent-mode";

/**
 * Qual painel de IA o atendente desta empresa vê:
 *  - "vendedora": a empresa usa a Vendedora 2.0 (assistido/automático) — painel só dela;
 *  - "coach": a empresa continua no fluxo anterior (Coach);
 *  - "loading"/"error": ainda não se sabe. Nenhum painel é montado nesses estados, para
 *    que o Coach nunca gere uma segunda resposta numa empresa que usa a Vendedora 2.0.
 * A decisão é sempre da configuração da empresa (company_id), nunca global.
 */
export type SalesAgentPanelMode = "loading" | "error" | "vendedora" | "coach";

export function useSalesAgentPanelMode(): { mode: SalesAgentPanelMode; retry: () => void } {
  const { profile } = useAuth();
  const companyId = profile?.company_id ?? null;
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<{ companyId: string | null; mode: SalesAgentPanelMode }>({
    companyId: null,
    mode: "loading",
  });

  useEffect(() => {
    if (!companyId) return;
    let cancelled = false;
    setState({ companyId, mode: "loading" });
    void (async () => {
      try {
        const { data, error } = await supabase
          .from("company_settings")
          .select("sales_agent_v2_enabled, sales_agent_v2_mode")
          .eq("company_id", companyId)
          .maybeSingle();
        if (cancelled) return;
        if (error) {
          setState({ companyId, mode: "error" });
          return;
        }
        setState({ companyId, mode: isSalesAgentServingAttendants(data) ? "vendedora" : "coach" });
      } catch {
        if (!cancelled) setState({ companyId, mode: "error" });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [companyId, attempt]);

  const retry = useCallback(() => setAttempt((value) => value + 1), []);
  return { mode: state.companyId === companyId ? state.mode : "loading", retry };
}
