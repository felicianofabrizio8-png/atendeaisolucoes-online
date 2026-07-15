// Persiste registros de simulação em `environment_simulations`.
// SEMPRE recebe payload já sanitizado. A sanitização acontece no Guard, não aqui.
// Nunca lança para o chamador — falhas são reportadas via retorno.

import type { SimulationRecord } from "./types";

type SupabaseAdminClient = {
  from: (table: string) => {
    insert: (row: Record<string, unknown>) => {
      select: (cols: string) => {
        single: () => Promise<{ data: { id: string } | null; error: unknown }>;
      };
    };
  };
};

export interface LogResult {
  ok: boolean;
  id: string | null;
  error?: string;
}

export async function logSimulation(record: SimulationRecord): Promise<LogResult> {
  try {
    const mod = await import("@/integrations/supabase/client.server");
    const admin = mod.supabaseAdmin as unknown as SupabaseAdminClient;
    const { data, error } = await admin
      .from("environment_simulations")
      .insert({
        company_id: record.companyId,
        user_id: record.userId ?? null,
        agent_id: record.agentId ?? null,
        action: record.action,
        target_url: record.targetUrl ?? null,
        method: record.method ?? null,
        payload_sanitized: record.payloadSanitized,
        reason: record.reason,
        simulated_result: record.simulatedResult,
      })
      .select("id")
      .single();
    if (error || !data) {
      return { ok: false, id: null, error: String(error ?? "insert_returned_null") };
    }
    return { ok: true, id: data.id };
  } catch (e) {
    return {
      ok: false,
      id: null,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}
