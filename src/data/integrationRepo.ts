// Repositório de integrações (WhatsApp/Instagram/Facebook).
// LEITURA: usa a view pública `integrations_safe`, que NÃO expõe tokens.
// ESCRITA: chama endpoints servidor (`/api/whatsapp/integration`) com Bearer
// do usuário — tokens só existem do lado do servidor.

import { supabase } from "@/integrations/supabase/client";

export type ChannelType = "whatsapp" | "instagram" | "facebook";

export interface Integration {
  id: string;
  companyId: string;
  channel: ChannelType;
  displayName: string;
  active: boolean;
  externalAccountId: string | null;
  accountMetadata: Record<string, unknown>;
  hasAccessToken: boolean;
  hasWebhookSecret: boolean;
  // Mantido por compatibilidade com a UI antiga; não é mais carregado do banco
  // — verify_token nunca volta para o cliente.
  verifyToken: string | null;
  lastSyncedAt: string | null;
  lastError: string | null;
}

interface SafeRow {
  id: string;
  company_id: string;
  channel: ChannelType;
  display_name: string;
  active: boolean;
  external_account_id: string | null;
  account_metadata: Record<string, unknown> | null;
  has_access_token: boolean;
  has_webhook_secret: boolean;
  last_synced_at: string | null;
  last_error: string | null;
}

function toIntegration(r: SafeRow): Integration {
  return {
    id: r.id,
    companyId: r.company_id,
    channel: r.channel,
    displayName: r.display_name,
    active: r.active,
    externalAccountId: r.external_account_id,
    accountMetadata: r.account_metadata ?? {},
    hasAccessToken: r.has_access_token,
    hasWebhookSecret: r.has_webhook_secret,
    verifyToken: null,
    lastSyncedAt: r.last_synced_at,
    lastError: r.last_error,
  };
}

export async function listIntegrations(_companyId: string): Promise<Integration[]> {
  // O filtro por company_id é aplicado pela view (current_company_id()).
  const { data, error } = await supabase
    // @ts-expect-error — view não tipada nos types gerados
    .from("integrations_safe")
    .select(
      "id, company_id, channel, display_name, active, external_account_id, account_metadata, has_access_token, has_webhook_secret, last_synced_at, last_error",
    )
    .order("created_at", { ascending: true });
  if (error) throw error;
  return ((data ?? []) as SafeRow[]).map(toIntegration);
}

async function authedFetch(input: RequestInfo, init?: RequestInit) {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error("Sessão expirada. Faça login novamente.");
  const res = await fetch(input, {
    ...init,
    headers: {
      ...(init?.headers ?? {}),
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
  });
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try {
      const j = (await res.json()) as { error?: string };
      if (j.error) msg = j.error;
    } catch {
      /* ignore */
    }
    throw new Error(msg);
  }
  return res;
}

export interface SaveWhatsAppInput {
  companyId: string;
  displayName: string;
  phoneNumberId: string;
  phoneNumber?: string;
  wabaId?: string;
  accessToken: string;
  verifyToken: string;
  webhookSecret?: string;
}

export async function upsertWhatsAppIntegration(
  input: SaveWhatsAppInput,
): Promise<Integration> {
  await authedFetch("/api/whatsapp/integration", {
    method: "POST",
    body: JSON.stringify({
      displayName: input.displayName,
      phoneNumberId: input.phoneNumberId,
      phoneNumber: input.phoneNumber,
      wabaId: input.wabaId,
      accessToken: input.accessToken,
      verifyToken: input.verifyToken,
      webhookSecret: input.webhookSecret,
    }),
  });
  // Recarrega lista e retorna o item atualizado
  const list = await listIntegrations(input.companyId);
  const found = list.find(
    (i) => i.channel === "whatsapp" && i.externalAccountId === input.phoneNumberId,
  );
  if (!found) throw new Error("Integração salva mas não encontrada na lista");
  return found;
}

export async function setIntegrationActive(id: string, active: boolean) {
  await authedFetch("/api/whatsapp/integration", {
    method: "PATCH",
    body: JSON.stringify({ id, active }),
  });
}

export async function deleteIntegration(id: string) {
  await authedFetch("/api/whatsapp/integration", {
    method: "DELETE",
    body: JSON.stringify({ id }),
  });
}
