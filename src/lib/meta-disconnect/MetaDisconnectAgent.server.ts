// ============================================================================
// Agente — fachada única usada pelo endpoint HTTP.
// Valida admin e delega ao Service.
// ============================================================================

import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { MetaDisconnectService } from "./MetaDisconnectService.server";
import type { DisconnectMode, DisconnectReport, DryRunReport } from "./MetaDisconnectTypes";

export interface AgentInput {
  bearerToken: string;
  integrationId: string;
  mode: DisconnectMode;
}

export type AgentResult =
  | { ok: true; mode: "dry-run"; report: DryRunReport }
  | { ok: true; mode: "disconnect"; report: DisconnectReport }
  | { ok: false; status: number; error: string };

export class MetaDisconnectAgent {
  async run(input: AgentInput): Promise<AgentResult> {
    // 1) valida bearer
    const { data: userRes, error: uerr } = await supabaseAdmin.auth.getUser(input.bearerToken);
    if (uerr || !userRes.user) {
      return { ok: false, status: 401, error: "sessão inválida" };
    }
    const userId = userRes.user.id;

    // 2) deriva company_id via profile (nunca aceitar do body)
    const { data: profile } = await supabaseAdmin
      .from("profiles")
      .select("company_id")
      .eq("id", userId)
      .maybeSingle();
    if (!profile?.company_id) {
      return { ok: false, status: 403, error: "perfil sem empresa" };
    }
    const companyId = profile.company_id;

    // 3) valida admin
    const { data: isAdmin } = await supabaseAdmin.rpc("has_role", {
      _user_id: userId,
      _company_id: companyId,
      _role: "admin",
    });
    if (!isAdmin) {
      return { ok: false, status: 403, error: "apenas administradores" };
    }

    const service = new MetaDisconnectService(supabaseAdmin);
    const ctx = { companyId, userId, integrationId: input.integrationId };

    if (input.mode === "dry-run") {
      const r = await service.dryRun(ctx);
      if (!r.ok) return r;
      return { ok: true, mode: "dry-run", report: r.report };
    }
    const r = await service.disconnect(ctx);
    if (!r.ok) return r;
    return { ok: true, mode: "disconnect", report: r.report };
  }
}
