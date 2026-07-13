// ============================================================================
// Onboarding — Service
// Orquestra Repository + Validator + Checklist. Sempre READ-ONLY em módulos
// operacionais. Persiste apenas em company_onboarding(_events).
// ============================================================================

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { OnboardingRepository } from "./OnboardingRepository.server";
import { OnboardingValidator } from "./OnboardingValidator.server";
import { OnboardingChecklistBuilder } from "./OnboardingChecklist.server";
import type {
  NextBestAction,
  OnboardingChecklist,
  OnboardingHealth,
  OnboardingStatus,
  OnboardingStatusSnapshot,
  OnboardingStepKey,
  OnboardingTimelineEvent,
  ReadinessScore,
} from "./OnboardingTypes";

const NEXT_ACTION_LABELS: Record<OnboardingStepKey, { label: string; reason: string }> = {
  company_created: { label: "Criar empresa", reason: "Empresa ainda não registrada." },
  admin_created: { label: "Criar administrador", reason: "Nenhum usuário admin encontrado." },
  team_invited: { label: "Convidar equipe", reason: "Colabore com mais usuários para escalar o atendimento." },
  meta_connected: { label: "Conectar Meta", reason: "Habilite integração com Meta Business." },
  whatsapp_connected: { label: "Conectar WhatsApp", reason: "Canal principal do atendimento." },
  instagram_connected: { label: "Conectar Instagram", reason: "Amplie o alcance para DMs do Instagram." },
  facebook_connected: { label: "Conectar Facebook", reason: "Receba mensagens do Facebook Messenger." },
  products_added: { label: "Cadastrar produtos", reason: "A IA precisa do catálogo para recomendar." },
  templates_synced: { label: "Sincronizar templates", reason: "Templates aprovados permitem reengajamento." },
  professor_initialized: { label: "Inicializar Professor", reason: "Defina o perfil e mensagem inicial da IA." },
  scientific_memory_created: {
    label: "Gerar Scientific Memory",
    reason: "Baseline temporal para evolução da IA.",
  },
};

export class OnboardingService {
  readonly repo: OnboardingRepository;

  constructor(writer: SupabaseClient<Database>) {
    this.repo = new OnboardingRepository(writer);
  }

  async status(companyId: string): Promise<OnboardingStatusSnapshot> {
    const [row, signals] = await Promise.all([
      this.repo.getOrCreate(companyId),
      this.repo.collectSignals(companyId),
    ]);
    const checklist = OnboardingChecklistBuilder.build(companyId, signals);
    const completed = checklist.items.filter((i) => i.ok).map((i) => i.key);
    const missing = checklist.items.filter((i) => !i.ok).map((i) => i.key);
    const totalWeight = checklist.items.reduce((acc, i) => acc + i.weight, 0) || 1;
    const achieved = checklist.items.filter((i) => i.ok).reduce((acc, i) => acc + i.weight, 0);
    const progress = Math.round((achieved / totalWeight) * 100);
    const status: OnboardingStatus =
      progress === 0 ? "pending" : progress >= 100 ? "completed" : "in_progress";
    const nextRecommended = this.nextBestAction(checklist)?.step ?? null;
    const currentStep = (nextRecommended ?? "company_created") as OnboardingStepKey;

    return {
      companyId,
      status,
      progress,
      currentStep,
      completedSteps: completed,
      missingSteps: missing,
      nextRecommendedStep: nextRecommended,
      startedAt: row.started_at,
      completedAt: status === "completed" ? row.completed_at ?? new Date().toISOString() : null,
      updatedAt: row.updated_at,
    };
  }

  async checklist(companyId: string): Promise<OnboardingChecklist> {
    const signals = await this.repo.collectSignals(companyId);
    return OnboardingChecklistBuilder.build(companyId, signals);
  }

  async health(companyId: string): Promise<OnboardingHealth> {
    const signals = await this.repo.collectSignals(companyId);
    return OnboardingValidator.health(companyId, signals);
  }

  async readinessScore(companyId: string): Promise<ReadinessScore> {
    const signals = await this.repo.collectSignals(companyId);
    const checklist = OnboardingChecklistBuilder.build(companyId, signals);
    const totalWeight = checklist.items.reduce((acc, i) => acc + i.weight, 0) || 1;
    const achieved = checklist.items.filter((i) => i.ok).reduce((acc, i) => acc + i.weight, 0);
    return {
      score: Math.round((achieved / totalWeight) * 100),
      breakdown: checklist.items.map((i) => ({
        area: i.key,
        weight: i.weight,
        achieved: i.ok ? i.weight : 0,
      })),
    };
  }

  nextBestAction(checklist: OnboardingChecklist): NextBestAction | null {
    const missing = checklist.items.filter((i) => !i.ok);
    if (!missing.length) return null;
    // priorizar required, depois maior peso
    missing.sort((a, b) => {
      if (a.required !== b.required) return a.required ? -1 : 1;
      return b.weight - a.weight;
    });
    const first = missing[0];
    const meta = NEXT_ACTION_LABELS[first.key];
    return { step: first.key, label: meta.label, reason: meta.reason };
  }

  timeline(companyId: string, limit = 100): Promise<OnboardingTimelineEvent[]> {
    return this.repo.timeline(companyId, limit);
  }
}
