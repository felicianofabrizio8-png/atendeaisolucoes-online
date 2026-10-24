import { describe, expect, it, vi } from "vitest";

const rpc = vi.hoisted(() => vi.fn());
const from = vi.hoisted(() => vi.fn());
vi.mock("@/integrations/supabase/client.server", () => ({ supabaseAdmin: { rpc, from } }));

import { reserveWalletCharge, walletGuardEnabled } from "../wallet.server";
import { assertConfirmedWalletPayment } from "../mercado-pago.server";

describe("financial wallet guard", () => {
  it("stays disabled unless explicitly enabled", () => {
    expect(walletGuardEnabled({} as NodeJS.ProcessEnv)).toBe(false);
  });

  it("does not query or reserve when disabled or human", async () => {
    await expect(reserveWalletCharge({
      companyId: "c1", wallet: "whatsapp", idempotencyKey: "k1", purpose: "manual", automated: false,
    })).resolves.toBeNull();
    expect(from).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
  });

  it("accepts only a verified payment contract with positive top-up", () => {
    expect(assertConfirmedWalletPayment({ kind: "topup", companyId: "c1", paymentId: "mp-1", wallet: "ia", amountCents: 5000 })).toMatchObject({ paymentId: "mp-1" });
    expect(() => assertConfirmedWalletPayment({ kind: "topup", companyId: "c1", paymentId: "mp-2", wallet: "ia", amountCents: 0 })).toThrow("wallet_topup_amount_invalid");
  });
});
