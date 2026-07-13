// ============================================================================
// Repository — leitura/escrita local de ativos Meta para desconexão.
// SEMPRE filtra por (integration_id, company_id) para blindar multi-tenant.
// ============================================================================

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import type { AssetSummary, MetaChannel } from "./MetaDisconnectTypes";

function maskId(v: string | null | undefined): string | null {
  if (!v) return null;
  const s = String(v);
  if (s.length <= 4) return "***";
  return `${s.slice(0, 2)}…${s.slice(-2)}`;
}

function maskPhone(v: string | null | undefined): string | null {
  if (!v) return null;
  const s = String(v).replace(/\D/g, "");
  if (s.length < 4) return "***";
  return `***${s.slice(-4)}`;
}

export interface LocalIntegrationRow {
  id: string;
  company_id: string;
  channel: MetaChannel;
  active: boolean;
  external_account_id: string | null;
  account_metadata: Record<string, unknown> | null;
  has_access_token: boolean;
  has_webhook_secret: boolean;
  access_token: string | null;
  token_expires_at: string | null;
  last_error: string | null;
}

export interface LocalMetaPageRow {
  id: string;
  company_id: string;
  integration_id: string | null;
  page_id: string;
  page_name: string;
  ig_business_account_id: string | null;
  ig_username: string | null;
  page_access_token: string | null;
  ig_user_access_token: string | null;
  active: boolean;
  token_expires_at: string | null;
}

export class MetaDisconnectRepository {
  constructor(private readonly admin: SupabaseClient<Database>) {}

  /** Carrega a integração APENAS se pertencer ao tenant informado. */
  async loadIntegration(
    integrationId: string,
    companyId: string,
  ): Promise<LocalIntegrationRow | null> {
    const { data } = await this.admin
      .from("integrations")
      .select(
        "id, company_id, channel, active, external_account_id, account_metadata, has_access_token, has_webhook_secret, access_token, token_expires_at, last_error",
      )
      .eq("id", integrationId)
      .eq("company_id", companyId)
      .maybeSingle();
    return (data as LocalIntegrationRow | null) ?? null;
  }

  /** Páginas Meta associadas ao mesmo tenant (multi-tenant safe). */
  async loadMetaPages(
    integrationId: string,
    companyId: string,
  ): Promise<LocalMetaPageRow[]> {
    const { data } = await this.admin
      .from("meta_pages")
      .select(
        "id, company_id, integration_id, page_id, page_name, ig_business_account_id, ig_username, page_access_token, ig_user_access_token, active, token_expires_at",
      )
      .eq("company_id", companyId)
      .eq("integration_id", integrationId);
    return (data ?? []) as LocalMetaPageRow[];
  }

  toAssetSummary(row: LocalIntegrationRow): AssetSummary {
    const meta = (row.account_metadata ?? {}) as Record<string, unknown>;
    return {
      channel: row.channel,
      hasAccessToken: row.has_access_token,
      hasWebhookSecret: row.has_webhook_secret,
      externalAccountIdMasked: maskId(row.external_account_id),
      wabaIdMasked: maskId((meta.waba_id as string | undefined) ?? null),
      phoneMasked: maskPhone((meta.phone_number as string | undefined) ?? null),
      tokenExpiresAt: row.token_expires_at,
      active: row.active,
    };
  }

  toPageAssetSummary(row: LocalMetaPageRow): AssetSummary {
    return {
      channel: row.ig_business_account_id ? "instagram" : "facebook",
      hasAccessToken: Boolean(row.page_access_token),
      hasWebhookSecret: false,
      externalAccountIdMasked: null,
      pageIdMasked: maskId(row.page_id),
      igBusinessAccountIdMasked: maskId(row.ig_business_account_id),
      tokenExpiresAt: row.token_expires_at,
      active: row.active,
    };
  }

  /** Marca a integração como disconnecting (idempotente). */
  async markDisconnecting(integrationId: string, companyId: string): Promise<void> {
    const { data: cur } = await this.admin
      .from("integrations")
      .select("account_metadata")
      .eq("id", integrationId)
      .eq("company_id", companyId)
      .maybeSingle();
    const meta = ((cur?.account_metadata as Record<string, unknown>) ?? {}) as Record<
      string,
      unknown
    >;
    await this.admin
      .from("integrations")
      .update({
        account_metadata: { ...meta, disconnect_status: "disconnecting" } as never,
      })
      .eq("id", integrationId)
      .eq("company_id", companyId);
  }

  /** Estado final — remove credenciais locais, mantém histórico. */
  async finalize(
    integrationId: string,
    companyId: string,
    status: "disconnected" | "partial_disconnect" | "disconnect_failed",
    reason: string,
  ): Promise<void> {
    const { data: cur } = await this.admin
      .from("integrations")
      .select("account_metadata")
      .eq("id", integrationId)
      .eq("company_id", companyId)
      .maybeSingle();
    const meta = ((cur?.account_metadata as Record<string, unknown>) ?? {}) as Record<
      string,
      unknown
    >;
    const nextMeta = {
      ...meta,
      disconnect_status: status,
      disconnected_at: new Date().toISOString(),
      disconnect_reason: reason.slice(0, 200),
    } as Record<string, unknown>;

    await this.admin
      .from("integrations")
      .update({
        active: false,
        // access_token/webhook_secret/verify_token nulificados quando a
        // desconexão foi bem-sucedida no lado local (mesmo em partial).
        access_token: null,
        webhook_secret: null,
        verify_token: null,
        token_expires_at: null,
        last_error: status === "disconnect_failed" ? reason.slice(0, 200) : null,
        account_metadata: nextMeta as never,
      })
      .eq("id", integrationId)
      .eq("company_id", companyId);
  }

  /** Desassocia páginas Meta locais deste tenant. Não apaga histórico. */
  async detachMetaPages(integrationId: string, companyId: string): Promise<number> {
    const { data, error } = await this.admin
      .from("meta_pages")
      .update({
        active: false,
        page_access_token: "",
        ig_user_access_token: null,
        token_expires_at: null,
      })
      .eq("company_id", companyId)
      .eq("integration_id", integrationId)
      .select("id");
    if (error) throw new Error(error.message);
    return (data ?? []).length;
  }
}
