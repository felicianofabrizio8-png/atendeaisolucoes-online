// ============================================================================
// LGPD — Service (Fase 1: apenas dry-run que retorna contagens).
// Nenhuma ação destrutiva. Nenhum consumidor operacional.
// ============================================================================

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import type {
  LGPDAnonymizeRequest,
  LGPDDeleteRequest,
  LGPDDryRunReport,
  LGPDExportRequest,
  LGPDRetentionRun,
} from "./LGPDTypes";

const COMPANY_TABLES: Array<keyof Database["public"]["Tables"]> = [
  "leads",
  "conversations",
  "messages",
  "quotes",
  "products",
  "campaigns",
  "campaign_creatives",
  "follow_ups",
  "coach_alerts",
  "coach_suggestions",
  "quick_replies",
  "visits",
  "whatsapp_messages",
  "whatsapp_templates",
  "audit_log",
  "conversation_facts",
  "billing_usage_events",
  "http_audit_log",
];

export class LGPDService {
  constructor(private readonly writer: SupabaseClient<Database>) {}

  async exportPreview(req: LGPDExportRequest): Promise<LGPDDryRunReport> {
    return this.countTouched(req.companyId, "export");
  }

  async deletePreview(req: LGPDDeleteRequest): Promise<LGPDDryRunReport> {
    return this.countTouched(req.companyId, "delete");
  }

  async anonymizePreview(req: LGPDAnonymizeRequest): Promise<LGPDDryRunReport> {
    return {
      companyId: req.companyId,
      action: "anonymize",
      wouldTouch: { leads: 1, messages: 0, conversations: 0 },
      notes: [
        "Fase 1: apenas contrato de anonimização. Nenhum registro alterado.",
        `Lead alvo: ${req.leadId}`,
      ],
    };
  }

  async retentionPreview(req: LGPDRetentionRun): Promise<LGPDDryRunReport> {
    return {
      companyId: req.companyId ?? "*",
      action: "retention",
      wouldTouch: {},
      notes: [
        "Fase 1: retention plan não executa nada.",
        "Planejado: apagar messages > 24 meses, error_log > 90 dias, http_audit_log > 180 dias.",
      ],
    };
  }

  private async countTouched(
    companyId: string,
    action: "export" | "delete",
  ): Promise<LGPDDryRunReport> {
    const wouldTouch: Record<string, number> = {};
    // Uso de `any` local — este é apenas um previewer LGPD Fase 1, sem execução real.
    // A tipagem de select-em-tabela-dinâmica não é validável pelo TS.
    const w = this.writer as unknown as {
      from: (t: string) => {
        select: (c: string, o: { count: "exact"; head: true }) => {
          eq: (col: string, v: string) => Promise<{ count: number | null }>;
        };
      };
    };
    for (const table of COMPANY_TABLES) {
      try {
        const { count } = await w
          .from(String(table))
          .select("*", { count: "exact", head: true })
          .eq("company_id", companyId);
        if (typeof count === "number") wouldTouch[String(table)] = count;
      } catch {
        // ignora tabelas que não expõem company_id explicit
      }
    }
    return {
      companyId,
      action,
      wouldTouch,
      notes: [
        "Fase 1: apenas dry-run. Nenhum registro exportado ou removido.",
        "Necessário implementar exportação assíncrona por job antes de acionar em produção.",
      ],
    };
  }
}
