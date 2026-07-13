// ============================================================================
// Onboarding — Validator
// Determinístico. Sem PII. Sem side effects.
// ============================================================================

import type {
  OnboardingHealth,
  OnboardingHealthIssue,
  OnboardingSignals,
} from "./OnboardingTypes";

export class OnboardingValidator {
  static health(companyId: string, signals: OnboardingSignals): OnboardingHealth {
    const issues: OnboardingHealthIssue[] = [];

    if (!signals.hasMeta)
      issues.push({ code: "no_meta", severity: "warn", message: "Meta não conectada." });
    if (!signals.hasWhatsapp)
      issues.push({ code: "no_whatsapp", severity: "critical", message: "WhatsApp não conectado." });
    if (!signals.hasInstagram)
      issues.push({ code: "no_instagram", severity: "info", message: "Instagram não conectado." });
    if (!signals.hasFacebook)
      issues.push({ code: "no_facebook", severity: "info", message: "Facebook não conectado." });
    if (!signals.hasProducts)
      issues.push({ code: "no_products", severity: "warn", message: "Nenhum produto cadastrado." });
    if (!signals.hasAiProfile)
      issues.push({ code: "no_ai_profile", severity: "warn", message: "Perfil da IA incompleto." });
    if (!signals.hasTemplates)
      issues.push({ code: "no_templates", severity: "info", message: "Templates não sincronizados." });
    if (signals.usersCount === 0)
      issues.push({ code: "no_users", severity: "critical", message: "Empresa sem usuários." });
    if (signals.hasWhatsapp === false && signals.hasMeta === false)
      issues.push({ code: "no_integration", severity: "critical", message: "Nenhuma integração ativa." });

    const critical = issues.some((i) => i.severity === "critical");
    return {
      companyId,
      ready: !critical && signals.hasWhatsapp && signals.hasAiProfile,
      issues,
      checkedAt: new Date().toISOString(),
    };
  }
}
