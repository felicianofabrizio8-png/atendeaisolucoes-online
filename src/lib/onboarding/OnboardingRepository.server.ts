// ============================================================================
// Onboarding — Repository
// READ-ONLY em relação a módulos operacionais.
// Escreve apenas em company_onboarding e company_onboarding_events (service_role).
// ============================================================================

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import type {
  OnboardingSignals,
  OnboardingStatus,
  OnboardingStepKey,
  OnboardingTimelineEvent,
} from "./OnboardingTypes";

type Row = Record<string, unknown>;
type AnyClient = SupabaseClient<Database> | (SupabaseClient<Database> & Record<string, unknown>);

interface OnboardingRow {
  id: string;
  company_id: string;
  current_step: string;
  completed_steps_json: unknown;
  status: OnboardingStatus;
  progress: number;
  started_at: string;
  completed_at: string | null;
  updated_at: string;
}

export class OnboardingRepository {
  constructor(private readonly writer: AnyClient) {}

  // ---- signals (read-only, cross-module) ----
  async collectSignals(companyId: string): Promise<OnboardingSignals> {
    const c = this.writer as unknown as {
      from: (t: string) => {
        select: (
          c: string,
          o?: { count?: "exact"; head?: boolean },
        ) => {
          eq: (col: string, v: unknown) => {
            eq?: (col: string, v: unknown) => Promise<{ count: number | null; data: Row[] | null }>;
            limit?: (n: number) => Promise<{ data: Row[] | null }>;
            maybeSingle?: () => Promise<{ data: Row | null }>;
          } & Promise<{ count: number | null; data: Row[] | null }>;
        };
      };
    };

    const countRows = async (
      table: string,
      filters: Array<[string, unknown]>,
    ): Promise<number> => {
      let q = this.writer.from(table as never).select("id", { count: "exact", head: true });
      for (const [col, val] of filters) q = (q as unknown as { eq: (a: string, b: unknown) => typeof q }).eq(col, val);
      const { count } = (await q) as { count: number | null };
      return count ?? 0;
    };
    void c;

    const [
      integrationsAll,
      integrationsWpp,
      integrationsIg,
      integrationsFb,
      productsCount,
      templatesCount,
      usersCount,
      aiProfile,
      metaPages,
      professorSettings,
      lastScientificMemory,
      admins,
    ] = await Promise.all([
      countRows("integrations", [["company_id", companyId], ["active", true]]),
      countRows("integrations", [["company_id", companyId], ["channel", "whatsapp"], ["active", true]]),
      countRows("integrations", [["company_id", companyId], ["channel", "instagram"], ["active", true]]),
      countRows("integrations", [["company_id", companyId], ["channel", "facebook"], ["active", true]]),
      countRows("products", [["company_id", companyId]]),
      countRows("whatsapp_templates", [["company_id", companyId]]),
      countRows("profiles", [["company_id", companyId]]),
      this.writer
        .from("ai_profiles")
        .select("description, products, region")
        .eq("company_id", companyId)
        .maybeSingle(),
      countRows("meta_pages", [["company_id", companyId], ["active", true]]),
      this.writer
        .from("company_settings")
        .select("ai_initial_message, ai_auto_reply_enabled")
        .eq("company_id", companyId)
        .maybeSingle(),
      this.writer
        .from("scientific_memory")
        .select("id")
        .eq("company_id", companyId)
        .limit(1),
      countRows("user_roles", [["company_id", companyId], ["role", "admin"]]),
    ]);

    const aiProfileRow = (aiProfile as { data: Row | null }).data;
    const professor = (professorSettings as { data: Row | null }).data;
    const memoryList = (lastScientificMemory as { data: Row[] | null }).data ?? [];

    const aiProfileFilled =
      !!aiProfileRow &&
      [aiProfileRow.description, aiProfileRow.products, aiProfileRow.region].filter(
        (v) => typeof v === "string" && (v as string).trim().length > 4,
      ).length >= 2;

    const professorReady =
      !!professor &&
      typeof professor.ai_initial_message === "string" &&
      (professor.ai_initial_message as string).trim().length > 10;

    const hasMeta = (integrationsIg ?? 0) + (integrationsFb ?? 0) + metaPages > 0;

    return {
      hasAdmin: admins > 0,
      hasTeam: usersCount > 1,
      hasMeta,
      hasWhatsapp: integrationsWpp > 0,
      hasInstagram: integrationsIg > 0 || metaPages > 0,
      hasFacebook: integrationsFb > 0 || metaPages > 0,
      hasProducts: productsCount > 0,
      hasTemplates: templatesCount > 0,
      hasProfessor: professorReady,
      hasScientificMemory: memoryList.length > 0,
      hasAiProfile: aiProfileFilled,
      productsCount,
      templatesCount,
      usersCount,
    };
  }

  // ---- onboarding state ----
  async getOrCreate(companyId: string): Promise<OnboardingRow> {
    const existing = await this.writer
      .from("company_onboarding")
      .select("*")
      .eq("company_id", companyId)
      .maybeSingle();
    const row = (existing as { data: OnboardingRow | null }).data;
    if (row) return row;
    const inserted = await this.writer
      .from("company_onboarding")
      .insert({ company_id: companyId })
      .select("*")
      .maybeSingle();
    const created = (inserted as { data: OnboardingRow | null; error: { message: string } | null });
    if (created.error || !created.data)
      throw new Error(`[Onboarding.getOrCreate] ${created.error?.message ?? "insert failed"}`);
    return created.data;
  }

  async update(
    companyId: string,
    patch: Partial<{
      current_step: OnboardingStepKey;
      completed_steps_json: OnboardingStepKey[];
      status: OnboardingStatus;
      progress: number;
      completed_at: string | null;
    }>,
  ): Promise<void> {
    const { error } = (await this.writer
      .from("company_onboarding")
      .update(patch)
      .eq("company_id", companyId)) as { error: { message: string } | null };
    if (error) throw new Error(`[Onboarding.update] ${error.message}`);
  }

  // ---- timeline (append-only) ----
  async appendEvent(
    companyId: string,
    eventType: string,
    payload: Record<string, unknown> = {},
  ): Promise<void> {
    const { error } = (await this.writer.from("company_onboarding_events").insert({
      company_id: companyId,
      event_type: eventType,
      payload: payload as never,
    })) as { error: { message: string } | null };
    if (error) throw new Error(`[Onboarding.appendEvent] ${error.message}`);
  }

  async timeline(companyId: string, limit = 100): Promise<OnboardingTimelineEvent[]> {
    const { data } = (await this.writer
      .from("company_onboarding_events")
      .select("id, event_type, payload, created_at")
      .eq("company_id", companyId)
      .order("created_at", { ascending: false })
      .limit(limit)) as {
      data: Array<{ id: string; event_type: string; payload: unknown; created_at: string }> | null;
    };
    return (data ?? []).map((r) => ({
      id: r.id,
      eventType: r.event_type,
      payload: (r.payload ?? {}) as Record<string, unknown>,
      createdAt: r.created_at,
    }));
  }
}
