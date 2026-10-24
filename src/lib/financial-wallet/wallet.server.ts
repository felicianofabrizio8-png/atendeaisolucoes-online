import { supabaseAdmin } from "@/integrations/supabase/client.server";

export type WalletKind = "ia" | "whatsapp";
export type WalletReservation = { reservationId: string; amountCents: number };

export function walletGuardEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.FOLLOWUP_WALLET_GUARD === "enabled";
}

/**
 * Reserva uma ação automatizada somente quando o guard é explicitamente ligado.
 * Sem preço versionado, falha fechado antes de qualquer chamada paga.
 */
export async function reserveWalletCharge(input: {
  companyId: string;
  wallet: WalletKind;
  idempotencyKey: string;
  purpose: string;
  referenceId?: string | null;
  automated: boolean;
}): Promise<WalletReservation | null> {
  if (!walletGuardEnabled() || !input.automated) return null;
  const db = supabaseAdmin as any;
  const { data: price, error: priceError } = await db
    .from("wallet_price_versions")
    .select("price_cents")
    .eq("action_kind", input.wallet)
    .eq("active", true)
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (priceError) throw new Error("wallet_price_lookup_failed");
  const amount = Number(price?.price_cents ?? 0);
  if (!Number.isSafeInteger(amount) || amount <= 0) throw new Error("wallet_price_unconfigured");
  const { data, error } = await db.rpc("wallet_reserve", {
    p_company_id: input.companyId,
    p_wallet_kind: input.wallet,
    p_amount_cents: amount,
    p_idempotency_key: input.idempotencyKey,
    p_purpose: input.purpose,
    p_reference_id: input.referenceId ?? null,
  });
  if (error) throw new Error("wallet_reserve_failed");
  if (!data?.ok) throw new Error(String(data?.code ?? "wallet_reserve_denied"));
  return { reservationId: String(data.reservation_id), amountCents: amount };
}

export async function finishWalletCharge(input: {
  companyId: string;
  reservation: WalletReservation | null;
  action: "commit" | "release";
  idempotencyKey: string;
}): Promise<void> {
  if (!input.reservation) return;
  const { error, data } = await (supabaseAdmin as any).rpc("wallet_finish_reservation", {
    p_company_id: input.companyId,
    p_reservation_id: input.reservation.reservationId,
    p_action: input.action,
    p_idempotency_key: input.idempotencyKey,
  });
  if (error || !data?.ok) throw new Error("wallet_finish_failed");
}

