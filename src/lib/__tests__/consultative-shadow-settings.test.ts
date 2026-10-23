import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { isConsultativeShadowEnabled } from "../consultative-sales-shadow-runtime";
import type { AgentSettings } from "../sales-agent-core";

const migration = readFileSync(
  fileURLToPath(new URL("../../../supabase/migrations/20261020170000_add_consultative_shadow_settings.sql", import.meta.url)),
  "utf8",
);
const settingsTypeSource = readFileSync(
  fileURLToPath(new URL("../../integrations/supabase/types.ts", import.meta.url)),
  "utf8",
);
const agentSource = [
  // A integração consultiva do turno fica em consultative-turn.server.ts.
  "../ai-agent.server.ts",
  "../consultative-turn.server.ts",
].map((path) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8")).join("\n");

const profile = {
  version: 1,
  autonomyLevel: "assistido" as const,
  salesAgentMode: null,
  consultativeSales: {
    enabled: true,
    maxQualificationQuestionsPerTurn: 1,
    askReactionAfterPresentation: true,
    avoidRepeatedQuestions: true,
  },
  actions: {},
  authorizedObjectionTypes: [],
};

function settings(companyId: string, enabled?: boolean): AgentSettings {
  return {
    company_id: companyId,
    ai_auto_reply_enabled: false,
    ai_after_hours_only: true,
    ai_initial_message: null,
    ai_max_auto_replies: 5,
    ai_handoff_timeout_minutes: 30,
    ai_agent_name: "Synthetic",
    business_hours_start: "08:00",
    business_hours_end: "18:00",
    ...(enabled === undefined ? {} : { consultative_shadow_enabled: enabled }),
    consultative_capability_profile: profile,
  };
}

describe("consultative shadow settings contract", () => {
  it("mantém empresas existentes desligadas por default e torna o rollback estrito", () => {
    expect(isConsultativeShadowEnabled(settings("company-a"))).toBe(false);
    expect(isConsultativeShadowEnabled(settings("company-a", false))).toBe(false);
    expect(isConsultativeShadowEnabled(settings("company-a", true))).toBe(true);
  });

  it("mantém flag e perfil no mesmo registro company_settings", () => {
    expect(agentSource).toContain('from("company_settings").select("*").eq("company_id", companyId)');
    expect(agentSource).toContain("settings.consultative_capability_profile");
    expect(agentSource).toContain("isConsultativeShadowEnabled(settings)");
    expect(migration).toContain("ALTER TABLE public.company_settings");
    expect(migration).toContain("consultative_shadow_enabled boolean NOT NULL DEFAULT false");
    expect(migration).toContain("consultative_capability_profile jsonb");
  });

  it("não compartilha configuração entre empresas", () => {
    const companyA = settings("company-a", true);
    const companyB = settings("company-b", false);
    expect(companyA.company_id).not.toBe(companyB.company_id);
    expect(isConsultativeShadowEnabled(companyA)).toBe(true);
    expect(isConsultativeShadowEnabled(companyB)).toBe(false);
    expect(companyA.consultative_capability_profile).toBe(profile);
    expect(companyB.consultative_capability_profile).toBe(profile);
  });

  it("reflete as colunas na tipagem gerada do Supabase", () => {
    expect(settingsTypeSource).toContain("consultative_shadow_enabled: boolean");
    expect(settingsTypeSource).toContain("consultative_capability_profile: Json | null");
  });
});
