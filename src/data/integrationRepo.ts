// Repositório de integrações de canais (WhatsApp, Instagram, Facebook).
// Lê e escreve no Supabase respeitando o company_id via RLS.

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
  // Tokens são retornados pra UI mascarar — nunca exibir em texto puro.
  hasAccessToken: boolean;
  hasWebhookSecret: boolean;
  verifyToken: string | null;
  lastSyncedAt: string | null;
  lastError: string | null;
}

interface DbRow {
  id: string;
  company_id: string;
  channel: ChannelType;
  display_name: string;
  active: boolean;
  external_account_id: string | null;
  account_metadata: Record<string, unknown> | null;
  access_token: string | null;
  webhook_secret: string | null;
  verify_token: string | null;
  last_synced_at: string | null;
  last_error: string | null;
}

function toIntegration(r: DbRow): Integration {
  return {
    id: r.id,
    companyId: r.company_id,
    channel: r.channel,
    displayName: r.display_name,
    active: r.active,
    externalAccountId: r.external_account_id,
    accountMetadata: r.account_metadata ?? {},
    hasAccessToken: !!r.access_token,
    hasWebhookSecret: !!r.webhook_secret,
    verifyToken: r.verify_token,
    lastSyncedAt: r.last_synced_at,
    lastError: r.last_error,
  };
}

export async function listIntegrations(companyId: string): Promise<Integration[]> {
  const { data, error } = await supabase
    .from("integrations")
    .select(
      "id, company_id, channel, display_name, active, external_account_id, account_metadata, access_token, webhook_secret, verify_token, last_synced_at, last_error",
    )
    .eq("company_id", companyId)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return (data ?? []).map((r) => toIntegration(r as DbRow));
}

export interface SaveWhatsAppInput {
  companyId: string;
  displayName: string;
  phoneNumberId: string; // external_account_id
  phoneNumber?: string;
  wabaId?: string;
  accessToken: string;
  verifyToken: string;
  webhookSecret?: string;
}

export async function upsertWhatsAppIntegration(
  input: SaveWhatsAppInput,
): Promise<Integration> {
  const payload = {
    company_id: input.companyId,
    channel: "whatsapp" as const,
    display_name: input.displayName,
    active: true,
    external_account_id: input.phoneNumberId,
    account_metadata: {
      phone_number: input.phoneNumber ?? null,
      waba_id: input.wabaId ?? null,
    },
    access_token: input.accessToken,
    verify_token: input.verifyToken,
    webhook_secret: input.webhookSecret ?? null,
  };

  // Procura existente pelo phone_number_id na empresa
  const { data: existing } = await supabase
    .from("integrations")
    .select("id")
    .eq("company_id", input.companyId)
    .eq("channel", "whatsapp")
    .eq("external_account_id", input.phoneNumberId)
    .maybeSingle();

  if (existing?.id) {
    const { data, error } = await supabase
      .from("integrations")
      .update(payload)
      .eq("id", existing.id)
      .select(
        "id, company_id, channel, display_name, active, external_account_id, account_metadata, access_token, webhook_secret, verify_token, last_synced_at, last_error",
      )
      .single();
    if (error) throw error;
    return toIntegration(data as DbRow);
  }

  const { data, error } = await supabase
    .from("integrations")
    .insert(payload)
    .select(
      "id, company_id, channel, display_name, active, external_account_id, account_metadata, access_token, webhook_secret, verify_token, last_synced_at, last_error",
    )
    .single();
  if (error) throw error;
  return toIntegration(data as DbRow);
}

export async function setIntegrationActive(id: string, active: boolean) {
  const { error } = await supabase
    .from("integrations")
    .update({ active })
    .eq("id", id);
  if (error) throw error;
}

export async function deleteIntegration(id: string) {
  const { error } = await supabase.from("integrations").delete().eq("id", id);
  if (error) throw error;
}
