// Repositório de integrações (WhatsApp/Instagram/Facebook).
// LEITURA: usa a view pública `integrations_safe`, que NÃO expõe tokens.
// ESCRITA: chama endpoints servidor (`/api/whatsapp/integration`) com Bearer
// do usuário — tokens só existem do lado do servidor.

import { supabase } from "@/integrations/supabase/client";
import { safeErrorMessage, summarizeHttp } from "@/lib/audit/sanitize";

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
  tokenExpiresAt: string | null;
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
  token_expires_at: string | null;
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
    tokenExpiresAt: r.token_expires_at,
  };
}

export async function listIntegrations(_companyId: string): Promise<Integration[]> {
  // O filtro por company_id é aplicado pela view (current_company_id()).
  const { data, error } = await (supabase as unknown as {
    from: (t: string) => {
      select: (cols: string) => {
        order: (col: string, opts: { ascending: boolean }) => Promise<{
          data: SafeRow[] | null;
          error: { message: string } | null;
        }>;
      };
    };
  })
    .from("integrations_safe")
    .select(
      "id, company_id, channel, display_name, active, external_account_id, account_metadata, has_access_token, has_webhook_secret, last_synced_at, last_error, token_expires_at",
    )
    .order("created_at", { ascending: true });
  console.log("[listIntegrations] response", { count: data?.length ?? 0, hasError: !!error });
  if (error) {
    console.error("[listIntegrations] Supabase error", safeErrorMessage(error.message));
    throw new Error(
      `Falha ao carregar integrações: ${error.message ?? JSON.stringify(error)}`,
    );
  }
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
    let details: unknown = null;
    try {
      const j = (await res.json()) as { error?: string; details?: unknown };
      details = j;
      if (j.error) msg = j.error;
    } catch {
      /* ignore */
    }
    console.error("[authedFetch] request failed", {
      ...summarizeHttp(res.status, details),
      path: typeof input === "string" ? input.split("?")[0] : "[request]",
    });
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
  console.log("[upsertWhatsAppIntegration] start", {
    companyId: input.companyId,
    phoneNumberId: input.phoneNumberId,
    displayName: input.displayName,
    hasPhoneNumber: !!input.phoneNumber,
    hasWabaId: !!input.wabaId,
    hasAccessToken: !!input.accessToken,
    hasVerifyToken: !!input.verifyToken,
    hasWebhookSecret: !!input.webhookSecret,
  });
  const res = await authedFetch("/api/whatsapp/integration", {
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
  const json = (await res.json()) as {
    id?: string;
    created?: boolean;
    updated?: boolean;
    row?: SafeRow;
  };
  console.log("[upsertWhatsAppIntegration] server response", {
    id: json.id,
    created: json.created,
    updated: json.updated,
    hasRow: !!json.row,
  });

  // Caminho rápido: o servidor já devolveu a linha completa.
  if (json.row) return toIntegration(json.row);

  // Fallback: recarrega a lista e procura. Útil para respostas legadas.
  const list = await listIntegrations(input.companyId);
  const found = list.find(
    (i) => i.channel === "whatsapp" && i.externalAccountId === input.phoneNumberId,
  );
  if (!found) {
    console.error("[upsertWhatsAppIntegration] saved id not found in list", {
      hasSavedId: !!json.id,
      listSize: list.length,
      listChannels: list.map((i) => i.channel),
    });
    throw new Error("Integração salva mas não encontrada na lista");
  }
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

export interface RenewTokenResult {
  ok: boolean;
  error?: string;
  validatedAt?: string;
  expiresAt?: string | null;
  isPermanent?: boolean;
  metaResponse?: unknown;
}

export async function renewWhatsAppToken(
  integrationId: string,
  accessToken: string,
  expiresAt?: string | null,
): Promise<RenewTokenResult> {
  const res = await authedFetch("/api/whatsapp/token-refresh", {
    method: "POST",
    body: JSON.stringify({ integrationId, accessToken, expiresAt: expiresAt ?? null }),
  });
  return (await res.json()) as RenewTokenResult;
}

export async function validateWhatsAppToken(
  integrationId: string,
): Promise<RenewTokenResult> {
  const res = await authedFetch("/api/whatsapp/token-refresh", {
    method: "PUT",
    body: JSON.stringify({ integrationId }),
  });
  return (await res.json()) as RenewTokenResult;
}
