// ============================================================================
// FASE 3.3 · ETAPA 2B — CLI de ativação piloto do Coach Interpreter.
//
// Uso (nunca em produção sem aprovação humana):
//   COACH_PILOT_COMPANY_ID=<uuid-completo> \
//   COACH_PILOT_ACTOR_ID=<uuid-do-admin> \
//   COACH_PILOT_REASON="Ativação piloto autorizada por <fulano>" \
//   COACH_PILOT_ACTION=enable \
//   COACH_PILOT_DRY_RUN=true \
//   APP_ENVIRONMENT=production \
//   bunx tsx scripts/coach-interpreter-pilot.ts
//
// Padrões defensivos:
//  - COACH_PILOT_DRY_RUN=true por padrão; escrita real só com "false" explícito.
//  - service_role NUNCA é aceito como argumento — vem de SUPABASE_SERVICE_ROLE_KEY.
//  - Nenhuma chave, token ou UUID completo é impressa; log usa máscara.
//  - Este arquivo NÃO é importado por nenhuma rota. Sem endpoint público.
// ============================================================================
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../src/integrations/supabase/types";
import {
  maskUuid,
  runPilotActivation,
  type PilotAction,
  type PilotActivationDeps,
} from "../src/lib/coach-interpreter/pilot-activation.server";

function required(name: string): string {
  const v = process.env[name];
  if (typeof v !== "string" || v.trim() === "") {
    console.error(`[coach-pilot] variável obrigatória ausente: ${name}`);
    process.exit(2);
  }
  return v;
}

function parseAction(v: string | undefined): PilotAction {
  if (v === "enable" || v === "disable") return v;
  console.error(`[coach-pilot] COACH_PILOT_ACTION deve ser "enable" ou "disable".`);
  process.exit(2);
}

function parseDryRun(v: string | undefined): boolean {
  // Padrão TRUE. Apenas o literal "false" desliga o dry-run.
  if (v === undefined) return true;
  const norm = v.trim().toLowerCase();
  if (norm === "false") return false;
  return true;
}

function buildDeps(sb: SupabaseClient<Database>): PilotActivationDeps {
  return {
    async fetchCompany(id) {
      const { data, error } = await sb
        .from("companies")
        .select("id, name")
        .eq("id", id)
        .maybeSingle();
      if (error) throw new Error(`fetchCompany failed: ${error.code ?? "unknown"}`);
      return data ? { id: data.id as string, name: (data.name as string) ?? "" } : null;
    },
    async fetchSettings(companyId) {
      const { data, error } = await sb
        .from("company_settings")
        .select("coach_interpreter_enabled")
        .eq("company_id", companyId)
        .maybeSingle();
      if (error) throw new Error(`fetchSettings failed: ${error.code ?? "unknown"}`);
      return data ? { coach_interpreter_enabled: Boolean(data.coach_interpreter_enabled) } : null;
    },
    async fetchActor(userId) {
      const { data, error } = await sb
        .from("profiles")
        .select("id")
        .eq("id", userId)
        .maybeSingle();
      if (error) throw new Error(`fetchActor failed: ${error.code ?? "unknown"}`);
      return data ? { id: data.id as string } : null;
    },
    async actorIsAdmin(userId) {
      const { data, error } = await sb
        .from("user_roles")
        .select("role")
        .eq("user_id", userId)
        .eq("role", "admin")
        .maybeSingle();
      if (error) throw new Error(`actorIsAdmin failed: ${error.code ?? "unknown"}`);
      return Boolean(data);
    },
    async countOtherEnabled(excludeCompanyId) {
      const { count, error } = await sb
        .from("company_settings")
        .select("company_id", { count: "exact", head: true })
        .eq("coach_interpreter_enabled", true)
        .neq("company_id", excludeCompanyId);
      if (error) throw new Error(`countOtherEnabled failed: ${error.code ?? "unknown"}`);
      return count ?? 0;
    },
    async updateFlag(companyId, expectedBefore, desired) {
      const { data, error } = await sb
        .from("company_settings")
        .update({ coach_interpreter_enabled: desired })
        .eq("company_id", companyId)
        .eq("coach_interpreter_enabled", expectedBefore)
        .select("company_id");
      if (error) return { rowsAffected: 0, error: error.code ?? "update_failed" };
      return { rowsAffected: data?.length ?? 0 };
    },
    async insertAudit(row) {
      const { error } = await sb.from("audit_log").insert(row);
      if (error) return { error: error.code ?? "audit_failed" };
      return {};
    },
  };
}

async function main() {
  const companyId = required("COACH_PILOT_COMPANY_ID");
  const actorUserId = required("COACH_PILOT_ACTOR_ID");
  const reason = required("COACH_PILOT_REASON");
  const action = parseAction(process.env.COACH_PILOT_ACTION);
  const dryRun = parseDryRun(process.env.COACH_PILOT_DRY_RUN);
  const environment = process.env.APP_ENVIRONMENT ?? "";

  const url = required("SUPABASE_URL");
  const key = required("SUPABASE_SERVICE_ROLE_KEY");

  const sb = createClient<Database>(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  console.log("[coach-pilot] invocando", {
    action,
    dryRun,
    environment,
    company: maskUuid(companyId),
    actor: maskUuid(actorUserId),
    reasonLen: reason.length,
  });

  const result = await runPilotActivation(
    { companyId, action, actorUserId, reason, dryRun, environment },
    buildDeps(sb),
  );

  // Saída sanitizada — nunca imprime UUID completo ou chaves.
  console.log("[coach-pilot] resultado:", JSON.stringify(result, null, 2));
  process.exit(result.ok ? 0 : 1);
}

main().catch((err) => {
  const msg = err instanceof Error ? err.message : String(err);
  console.error("[coach-pilot] erro inesperado:", msg);
  process.exit(1);
});
