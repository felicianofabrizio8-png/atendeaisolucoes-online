// Onboarding timeline — best-effort append-only.
// Failure NEVER derrubar o handler chamador (integração > telemetria).
// Sem PII: apenas company_id (contexto autenticado) + event_type + payload numérico/booleano.

import { supabaseAdmin } from "@/integrations/supabase/client.server";

export type OnboardingEventType =
  | "meta_connected"
  | "whatsapp_connected"
  | "instagram_connected"
  | "facebook_connected"
  | "templates_synced";

// Debounce em memória (por worker) para evitar duplicatas no mesmo ciclo (~30s).
const recent = new Map<string, number>();
const DEBOUNCE_MS = 30_000;

function shouldSkip(key: string): boolean {
  const now = Date.now();
  const prev = recent.get(key);
  if (prev && now - prev < DEBOUNCE_MS) return true;
  recent.set(key, now);
  // GC leve
  if (recent.size > 500) {
    for (const [k, t] of recent) if (now - t > DEBOUNCE_MS) recent.delete(k);
  }
  return false;
}

export async function appendOnboardingEvent(
  companyId: string,
  eventType: OnboardingEventType,
  payload: Record<string, string | number | boolean | null> = {},
): Promise<void> {
  try {
    if (!companyId) return;
    const key = `${companyId}:${eventType}`;
    if (shouldSkip(key)) return;
    await supabaseAdmin
      .from("company_onboarding_events")
      .insert({ company_id: companyId, event_type: eventType, payload: payload as never });
  } catch (err) {
    console.warn("[appendOnboardingEvent] falhou (ignorado)", {
      eventType,
      companyId,
      err: err instanceof Error ? err.message : String(err),
    });
  }
}
