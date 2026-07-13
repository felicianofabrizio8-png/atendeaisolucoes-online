// ============================================================================
// Onboarding — Types
// Zero PII. Somente contagens, flags e timestamps.
// ============================================================================

export type OnboardingStepKey =
  | "company_created"
  | "admin_created"
  | "team_invited"
  | "meta_connected"
  | "whatsapp_connected"
  | "instagram_connected"
  | "facebook_connected"
  | "products_added"
  | "templates_synced"
  | "professor_initialized"
  | "scientific_memory_created";

export type OnboardingStatus = "pending" | "in_progress" | "completed" | "paused";

export interface OnboardingChecklistItem {
  key: OnboardingStepKey;
  label: string;
  ok: boolean;
  required: boolean;
  weight: number; // contribuição para o Readiness Score
  hint?: string;
}

export interface OnboardingChecklist {
  companyId: string;
  items: OnboardingChecklistItem[];
  completedCount: number;
  totalCount: number;
  requiredCount: number;
  requiredCompletedCount: number;
}

export interface OnboardingStatusSnapshot {
  companyId: string;
  status: OnboardingStatus;
  progress: number; // 0-100
  currentStep: OnboardingStepKey;
  completedSteps: OnboardingStepKey[];
  missingSteps: OnboardingStepKey[];
  nextRecommendedStep: OnboardingStepKey | null;
  startedAt: string;
  completedAt: string | null;
  updatedAt: string;
}

export interface OnboardingHealthIssue {
  code:
    | "no_meta"
    | "no_whatsapp"
    | "no_instagram"
    | "no_facebook"
    | "no_products"
    | "no_ai_profile"
    | "no_templates"
    | "no_users"
    | "no_integration";
  severity: "info" | "warn" | "critical";
  message: string;
}

export interface OnboardingHealth {
  companyId: string;
  ready: boolean;
  issues: OnboardingHealthIssue[];
  checkedAt: string;
}

export interface ReadinessScore {
  score: number; // 0-100
  breakdown: Array<{ area: string; weight: number; achieved: number }>;
}

export interface NextBestAction {
  step: OnboardingStepKey;
  label: string;
  reason: string;
}

export interface OnboardingSignals {
  hasAdmin: boolean;
  hasTeam: boolean;
  hasMeta: boolean;
  hasWhatsapp: boolean;
  hasInstagram: boolean;
  hasFacebook: boolean;
  hasProducts: boolean;
  hasTemplates: boolean;
  hasProfessor: boolean;
  hasScientificMemory: boolean;
  hasAiProfile: boolean;
  productsCount: number;
  templatesCount: number;
  usersCount: number;
}

export interface OnboardingTimelineEvent {
  id: string;
  eventType: string;
  payload: Record<string, string | number | boolean | null>;
  createdAt: string;
}
