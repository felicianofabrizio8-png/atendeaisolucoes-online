import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("Bruna WhatsApp status contract", () => {
  const migration = readFileSync(
    "supabase/migrations/20261022190100_whatsapp_attempts_phase1.sql",
    "utf8",
  );
  const reconciliation = readFileSync(
    "supabase/migrations/20261022210000_reconcile_whatsapp_status_events.sql",
    "utf8",
  );
  const webhook = readFileSync("supabase/functions/meta-webhook/index.ts", "utf8");

  it("persists tenant-scoped orphan status events idempotently", () => {
    expect(migration).toContain("CREATE TABLE public.whatsapp_send_status_events");
    expect(migration).toContain(
      "UNIQUE (company_id, integration_id, provider_message_id, provider_status, status_at)",
    );
    expect(migration).toContain("public.record_whatsapp_send_status");
    expect(migration).toContain("RETURN QUERY SELECT v_event, false, true");
  });

  it("keeps uncertain terminal and delivery status monotonic", () => {
    expect(migration).toContain("IF v_attempt.status = 'uncertain'");
    expect(migration).toContain("provider_status = 'delivered' AND v_status = 'read'");
    expect(migration).toContain("provider_status IN ('sent', 'failed')");
    expect(webhook).toContain('"record_whatsapp_send_status"');
    expect(webhook).toContain('["delivered", "read"].includes(currentStatus)');
  });

  it("scopes webhook message lookup and compare-and-set by tenant", () => {
    expect(webhook).toContain('.eq("company_id", companyId)');
    expect(webhook).toContain('.eq("delivery_status", currentStatus)');
  });

  it("reconciles orphan events when accept/complete associates a provider id", () => {
    expect(reconciliation).toContain("whatsapp_send_attempts_provider_message_uidx");
    expect(reconciliation).toContain("HAVING count(*) > 1");
    expect(reconciliation).toContain("whatsapp_attempts_reconcile_status_events");
    expect(reconciliation).toContain("company_id = v_attempt.company_id");
    expect(reconciliation).toContain("integration_id = v_attempt.integration_id");
    expect(reconciliation).toContain("WHEN 'read' THEN 3");
    expect(reconciliation).toContain("provider_status_at");
  });
});
