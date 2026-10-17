/**
 * Visitas por lead para a recuperação. Com a agenda pessoal, uma visita agendada por um
 * colega fica invisível na leitura direta de `visits`; a função `agenda_lead_visits`
 * devolve só lead, data e status de qualquer visita do lead (sem expor o compromisso).
 * Antes da migração de hierarquia, lê `visits` como sempre.
 */
export interface LeadVisit {
  lead_id: string;
  scheduled_at: string;
  status: string;
}

interface Client {
  rpc: (
    name: string,
    args: Record<string, unknown>,
  ) => PromiseLike<{ data: unknown; error: unknown }>;
  from: (table: string) => {
    select: (columns: string) => {
      eq: (column: string, value: string) => {
        in: (column: string, values: string[]) => PromiseLike<{ data: unknown; error: unknown }>;
      };
    };
  };
}

export async function fetchLeadVisits(
  client: Client,
  companyId: string,
  leadIds: string[],
): Promise<LeadVisit[]> {
  if (!leadIds.length) return [];
  const viaRpc = await client.rpc("agenda_lead_visits", { _leads: leadIds });
  if (!viaRpc.error) return (viaRpc.data ?? []) as LeadVisit[];
  const { data } = await client
    .from("visits")
    .select("lead_id, scheduled_at, status")
    .eq("company_id", companyId)
    .in("lead_id", leadIds);
  return (data ?? []) as LeadVisit[];
}
