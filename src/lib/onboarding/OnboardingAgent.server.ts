// ============================================================================
// Onboarding — Agent
// Fachada única para endpoints. Nenhum efeito colateral em módulos operacionais.
// ============================================================================

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { OnboardingService } from "./OnboardingService.server";
import type {
  NextBestAction,
  OnboardingChecklist,
  OnboardingHealth,
  OnboardingStatusSnapshot,
  OnboardingTimelineEvent,
  ReadinessScore,
} from "./OnboardingTypes";

export class OnboardingAgent {
  private readonly service: OnboardingService;

  constructor(writer: SupabaseClient<Database>) {
    this.service = new OnboardingService(writer);
  }

  status(companyId: string): Promise<OnboardingStatusSnapshot> {
    return this.service.status(companyId);
  }

  checklist(companyId: string): Promise<OnboardingChecklist> {
    return this.service.checklist(companyId);
  }

  health(companyId: string): Promise<OnboardingHealth> {
    return this.service.health(companyId);
  }

  score(companyId: string): Promise<ReadinessScore> {
    return this.service.readinessScore(companyId);
  }

  async nextBestAction(companyId: string): Promise<NextBestAction | null> {
    const cl = await this.service.checklist(companyId);
    return this.service.nextBestAction(cl);
  }

  timeline(companyId: string, limit = 100): Promise<OnboardingTimelineEvent[]> {
    return this.service.timeline(companyId, limit);
  }
}
