// ============================================================================
// ExecutiveNarrativeAdapter — Adapter real do agente Executive Narrative.
// READ-ONLY: verifica prontidão (LLM key + prerequisites Executive Knowledge).
// NÃO invoca `generate()` para evitar custo de LLM e escrita — a geração real
// permanece disponível para chamadas explícitas via handlers de domínio.
// ============================================================================

import { IntelligenceAdapterBase, type IntelligenceProbeContext, type IntelligenceProbeOutput } from "./IntelligenceAdapterBase.server";

export class ExecutiveNarrativeAdapter extends IntelligenceAdapterBase {
  readonly agentId = "executive-narrative";
  constructor() {
    super();
    (this as { supportedJobs: string[] }).supportedJobs = ["runtime:executive-narrative"];
  }

  protected async probe({ supabase, companyId }: IntelligenceProbeContext): Promise<IntelligenceProbeOutput> {
    const hasApiKey = Boolean(process.env.LOVABLE_API_KEY);
    const { ExecutiveKnowledgeService } = await import("@/lib/executive-knowledge/ExecutiveKnowledgeService.server");
    const prereq = await ExecutiveKnowledgeService.latest(supabase, companyId, "30d");
    // Import do serviço garante que o módulo carrega sem erro.
    const svc = await import("@/lib/executive-narrative/ExecutiveNarrativeService.server");
    if (!svc?.ExecutiveNarrativeService) {
      throw new Error("narrative_service_missing");
    }
    return {
      reason: "executive_narrative_ready",
      detail: {
        hasApiKey,
        hasKnowledgePrereq: Boolean(prereq),
        mode: "readiness_check",
      },
    };
  }
}
