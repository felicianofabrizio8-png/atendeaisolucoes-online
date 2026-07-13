// ============================================================================
// Onboarding — Checklist builder
// Determinístico. Pesos usados para Readiness Score.
// ============================================================================

import type {
  OnboardingChecklist,
  OnboardingChecklistItem,
  OnboardingSignals,
  OnboardingStepKey,
} from "./OnboardingTypes";

interface StepSpec {
  key: OnboardingStepKey;
  label: string;
  required: boolean;
  weight: number;
  probe: (s: OnboardingSignals) => { ok: boolean; hint?: string };
}

const STEPS: StepSpec[] = [
  {
    key: "company_created",
    label: "Empresa criada",
    required: true,
    weight: 5,
    probe: () => ({ ok: true }),
  },
  {
    key: "admin_created",
    label: "Usuário administrador criado",
    required: true,
    weight: 10,
    probe: (s) => ({ ok: s.hasAdmin }),
  },
  {
    key: "team_invited",
    label: "Equipe convidada",
    required: false,
    weight: 5,
    probe: (s) => ({ ok: s.hasTeam, hint: `${s.usersCount} usuário(s)` }),
  },
  {
    key: "meta_connected",
    label: "Meta conectada",
    required: false,
    weight: 10,
    probe: (s) => ({ ok: s.hasMeta }),
  },
  {
    key: "whatsapp_connected",
    label: "WhatsApp conectado",
    required: true,
    weight: 20,
    probe: (s) => ({ ok: s.hasWhatsapp }),
  },
  {
    key: "instagram_connected",
    label: "Instagram conectado",
    required: false,
    weight: 5,
    probe: (s) => ({ ok: s.hasInstagram }),
  },
  {
    key: "facebook_connected",
    label: "Facebook conectado",
    required: false,
    weight: 5,
    probe: (s) => ({ ok: s.hasFacebook }),
  },
  {
    key: "products_added",
    label: "Produtos cadastrados",
    required: false,
    weight: 10,
    probe: (s) => ({ ok: s.hasProducts, hint: `${s.productsCount} produto(s)` }),
  },
  {
    key: "templates_synced",
    label: "Templates sincronizados",
    required: false,
    weight: 5,
    probe: (s) => ({ ok: s.hasTemplates, hint: `${s.templatesCount} template(s)` }),
  },
  {
    key: "professor_initialized",
    label: "Professor inicializado",
    required: true,
    weight: 15,
    probe: (s) => ({ ok: s.hasProfessor && s.hasAiProfile }),
  },
  {
    key: "scientific_memory_created",
    label: "Scientific Memory criada",
    required: false,
    weight: 10,
    probe: (s) => ({ ok: s.hasScientificMemory }),
  },
];

export class OnboardingChecklistBuilder {
  static build(companyId: string, signals: OnboardingSignals): OnboardingChecklist {
    const items: OnboardingChecklistItem[] = STEPS.map((spec) => {
      const { ok, hint } = spec.probe(signals);
      return {
        key: spec.key,
        label: spec.label,
        ok,
        required: spec.required,
        weight: spec.weight,
        hint,
      };
    });

    const completedCount = items.filter((i) => i.ok).length;
    const requiredCount = items.filter((i) => i.required).length;
    const requiredCompletedCount = items.filter((i) => i.required && i.ok).length;

    return {
      companyId,
      items,
      completedCount,
      totalCount: items.length,
      requiredCount,
      requiredCompletedCount,
    };
  }

  static allSteps(): StepSpec[] {
    return STEPS.slice();
  }
}
