import { describe, expect, it } from "vitest";
import {
  BRUNA_WHATSAPP_TEXT_ADAPTER_ENV,
  isBrunaWhatsappTextAdapterEnabled,
} from "../bruna-whatsapp-feature-flag";

describe("Bruna WhatsApp text adapter feature flag", () => {
  it("stays off by default and for near-miss values", () => {
    expect(isBrunaWhatsappTextAdapterEnabled({})).toBe(false);
    expect(isBrunaWhatsappTextAdapterEnabled({ [BRUNA_WHATSAPP_TEXT_ADAPTER_ENV]: "true" })).toBe(false);
    expect(isBrunaWhatsappTextAdapterEnabled({ [BRUNA_WHATSAPP_TEXT_ADAPTER_ENV]: "enabled " })).toBe(true);
  });
});
