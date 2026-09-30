// ============================================================================
// Identidade de lead para mensagens WhatsApp recebidas pelo webhook TanStack.
//
// Regra: mensagem nova do cliente NUNCA reescreve dados comerciais do lead
// (status do funil, tags, nome editado pela equipe). Só completa o vínculo
// com a integração/external_id e reativa lead "perdido" — o mesmo contrato da
// RPC canônica `record_whatsapp_message` usada pelo webhook da Edge Function.
// Tudo filtrado por company_id.
// ============================================================================

type QueryResult<T> = { data: T | null; error: unknown };

// Cliente mínimo (subconjunto do supabase-js) para permitir testes sem banco.
export interface LeadIdentityClient {
  from(table: "leads"): {
    select(columns: string): {
      eq(
        column: string,
        value: string,
      ): {
        or(filter: string): {
          limit(n: number): { maybeSingle(): PromiseLike<QueryResult<ExistingLead>> };
        };
      };
    };
    update(values: Record<string, unknown>): {
      eq(
        column: string,
        value: string,
      ): {
        eq(column: string, value: string): PromiseLike<{ error: unknown }>;
      };
    };
    insert(values: Record<string, unknown>): {
      select(columns: string): { single(): PromiseLike<QueryResult<{ id: string }>> };
    };
  };
}

export interface ExistingLead {
  id: string;
  status: string | null;
  integration_id: string | null;
  external_id: string | null;
}

export interface WhatsappLeadIdentityInput {
  companyId: string;
  integrationId: string;
  waId: string;
  normalizedPhone: string;
  leadName: string;
}

/** Só dígitos: os valores entram no filtro `.or()` do PostgREST. */
function digits(value: string): string {
  return value.replace(/\D/g, "");
}

async function findExisting(
  client: LeadIdentityClient,
  input: WhatsappLeadIdentityInput,
): Promise<ExistingLead | null> {
  const wa = digits(input.waId);
  const phone = digits(input.normalizedPhone);
  const filters = [
    wa ? `external_id.eq.${wa}` : null,
    phone ? `phone.eq.${phone}` : null,
    wa && wa !== phone ? `phone.eq.${wa}` : null,
  ].filter((item): item is string => Boolean(item));
  if (filters.length === 0) return null;
  const { data } = await client
    .from("leads")
    .select("id, status, integration_id, external_id")
    .eq("company_id", input.companyId)
    .or(filters.join(","))
    .limit(1)
    .maybeSingle();
  return data ?? null;
}

/** Patch mínimo para lead existente — nunca status/tags/nome, exceto reativar "perdido". */
export function buildExistingLeadPatch(
  existing: ExistingLead,
  input: Pick<WhatsappLeadIdentityInput, "integrationId" | "waId">,
): Record<string, unknown> | null {
  const patch: Record<string, unknown> = {};
  if (existing.integration_id !== input.integrationId) patch.integration_id = input.integrationId;
  if (!existing.external_id && input.waId) patch.external_id = input.waId;
  if (existing.status === "perdido") patch.status = "novo";
  return Object.keys(patch).length > 0 ? patch : null;
}

export async function findOrCreateWhatsappLead(
  client: LeadIdentityClient,
  input: WhatsappLeadIdentityInput,
): Promise<string> {
  if (!input.companyId.trim()) throw new Error("company_id_required");

  const existing = await findExisting(client, input);
  if (existing) {
    const patch = buildExistingLeadPatch(existing, input);
    if (patch) {
      await client
        .from("leads")
        .update(patch)
        .eq("id", existing.id)
        .eq("company_id", input.companyId);
    }
    return existing.id;
  }

  const { data: created, error } = await client
    .from("leads")
    .insert({
      company_id: input.companyId,
      integration_id: input.integrationId,
      external_id: input.waId,
      name: input.leadName,
      phone: input.normalizedPhone,
      channel: "whatsapp",
      status: "novo",
      tags: [],
    })
    .select("id")
    .single();
  if (created?.id) return created.id;

  // Corrida com outra entrega simultânea (unique company_id+phone): relê.
  const raced = await findExisting(client, input);
  if (raced) return raced.id;
  throw error ?? new Error("whatsapp_lead_create_failed");
}
