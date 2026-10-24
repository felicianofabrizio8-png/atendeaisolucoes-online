/** Contrato server-only para futuro webhook Mercado Pago.
 * A verificação de assinatura e a chamada ao provedor ficam fora desta etapa.
 */
export type ConfirmedWalletPayment =
  | { kind: "monthly"; companyId: string; paymentId: string; periodStart: string; periodEnd: string }
  | { kind: "topup"; companyId: string; paymentId: string; wallet: "ia" | "whatsapp"; amountCents: number };

export function assertConfirmedWalletPayment(input: ConfirmedWalletPayment): ConfirmedWalletPayment {
  if (!input.companyId || !input.paymentId) throw new Error("wallet_payment_identity_required");
  if (input.kind === "topup" && (!Number.isSafeInteger(input.amountCents) || input.amountCents <= 0))
    throw new Error("wallet_topup_amount_invalid");
  return input;
}
