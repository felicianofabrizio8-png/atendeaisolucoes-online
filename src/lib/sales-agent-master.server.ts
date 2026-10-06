import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { isExternalSalesAgentEligible } from "./external-sales-agent-adapter.server";
import {
  ASSISTED_PENDING_CLASSIFICATION,
  ASSISTED_SUPERSEDED_CLASSIFICATION,
} from "./sales-agent-assisted";
import { isSalesAgentMasterOff, type SalesAgentModeSettings } from "./sales-agent-mode";

type Result<T> = PromiseLike<{ data: T | null; error: unknown }>;

// Subconjunto do supabase-js usado aqui (injetável em testes).
export interface SalesAgentMasterClient {
  from(table: "company_settings"): {
    select(columns: string): {
      eq(
        column: string,
        value: string,
      ): { maybeSingle(): Result<Pick<SalesAgentModeSettings, "sales_agent_master_enabled">> };
    };
  };
}

/**
 * A empresa desligou a Vendedora IA no botão mestre? Lido à parte das demais colunas para
 * que a falta da coluna (migration ainda não aplicada) ou um erro de leitura valha como
 * ligado: só o valor `false` gravado desliga. Empresa fora da lista da Vendedora nunca conta
 * como desligada: o botão não existe para ela.
 */
export async function isCompanySalesAgentMasterOff(
  companyId: string,
  client: SalesAgentMasterClient = supabaseAdmin as unknown as SalesAgentMasterClient,
  env: Record<string, string | undefined> = process.env,
): Promise<boolean> {
  if (!isExternalSalesAgentEligible(companyId, env)) return false;
  try {
    const { data, error } = await client
      .from("company_settings")
      .select("sales_agent_master_enabled")
      .eq("company_id", companyId)
      .maybeSingle();
    if (error) return false;
    return isSalesAgentMasterOff(data);
  } catch {
    return false;
  }
}

type WriteFilter<T> = {
  eq(column: string, value: string | boolean): WriteFilter<T>;
  select(columns: string): PromiseLike<{ data: T[] | null; error: unknown }>;
};

// Subconjunto do supabase-js usado para trocar o botão (injetável em testes).
export interface SalesAgentMasterWriteClient {
  from(table: "company_settings" | "ai_suggestions_log"): {
    update(values: Record<string, unknown>): WriteFilter<Record<string, unknown>>;
  };
}

export type SetSalesAgentMasterResult =
  | { ok: true; enabled: boolean; superseded: number | null }
  | { ok: false; code: "not_eligible" | "supersede_failed" | "update_failed" | "not_found" };

/**
 * Tira do cartão do atendente as sugestões pendentes da Vendedora desta empresa. Nada é
 * apagado: a linha continua no histórico, só deixa de ser a sugestão atual (mesma marca
 * que o tick usa quando o cliente manda outra mensagem). Sempre filtrado pela empresa.
 */
async function supersedePendingSuggestions(
  client: SalesAgentMasterWriteClient,
  companyId: string,
): Promise<number | null> {
  try {
    const { data, error } = await client
      .from("ai_suggestions_log")
      .update({ classification: ASSISTED_SUPERSEDED_CLASSIFICATION })
      .eq("company_id", companyId)
      .eq("classification", ASSISTED_PENDING_CLASSIFICATION)
      .eq("was_sent", false)
      .select("id");
    if (error) return null;
    return (data ?? []).length;
  } catch {
    return null;
  }
}

/**
 * Liga ou desliga a Vendedora IA da empresa. Sugestão pendente dela não atravessa o período
 * desligado:
 *  - ao desligar, as pendentes saem do cartão;
 *  - ao religar, as pendentes saem de novo ANTES de o botão voltar a valer. É isso que
 *    garante que nada antigo reapareça (cobre também um turno que estava em andamento no
 *    instante em que desligaram). Se essa limpeza falhar, a Vendedora continua desligada.
 * O modo da empresa e o automático por conversa não são tocados.
 */
export async function setCompanySalesAgentMaster(
  input: { companyId: string; enabled: boolean },
  client: SalesAgentMasterWriteClient = supabaseAdmin as unknown as SalesAgentMasterWriteClient,
  env: Record<string, string | undefined> = process.env,
): Promise<SetSalesAgentMasterResult> {
  const { companyId, enabled } = input;
  if (!isExternalSalesAgentEligible(companyId, env)) return { ok: false, code: "not_eligible" };

  let superseded: number | null = null;
  if (enabled) {
    superseded = await supersedePendingSuggestions(client, companyId);
    if (superseded === null) return { ok: false, code: "supersede_failed" };
  }

  try {
    const { data, error } = await client
      .from("company_settings")
      .update({ sales_agent_master_enabled: enabled })
      .eq("company_id", companyId)
      .select("company_id");
    if (error) return { ok: false, code: "update_failed" };
    if (!data || data.length === 0) return { ok: false, code: "not_found" };
  } catch {
    return { ok: false, code: "update_failed" };
  }

  // Ao desligar a limpeza é só antecipada: quem garante é a do religamento.
  if (!enabled) superseded = await supersedePendingSuggestions(client, companyId);
  return { ok: true, enabled, superseded };
}
